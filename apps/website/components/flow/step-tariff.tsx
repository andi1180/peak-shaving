'use client'

import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import { parsePvProfile } from 'engine'
import {
  NETZBETREIBER_IDS,
  NETZBETREIBER_LABELS,
  NETZEBENEN,
  METERING_VARIANTS,
  METERING_VARIANT_LABELS,
  financialParamsSchema,
  hasMeteringVariant,
  lookupTariffProfile,
  pendingAcrossAllBetreiber,
  tariffParamsSchema,
  tariffSelectionFrom,
  type FinancialParams,
  type LoadProfile,
  type MeteringVariant,
  type Netzebene,
  type NetzbetreiberId,
  type PendingReason,
  type TariffParams,
  type TariffPricingInputs,
  type TariffSelection,
} from 'shared'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NumberField } from '@/components/ui/number-field'
import { BatteryTextPanel } from './battery-text-panel'
import { InfoHint, LabelWithInfo } from '@/components/ui/info-hint'
import { Num } from '@/components/report/num'
import { parseNum, percentHint } from '@/lib/form-utils'
import { FileDrop } from './file-drop'
import {
  TarifMessvarianteOffen,
  TarifNichtVerfuegbar,
  TarifOhneLeistungsmessung,
} from './tarif-nicht-verfuegbar'
import { loadTariffPricing } from '@/lib/tariff-pricing'
import type { BatteryPreset, ParsedPv, TariffPrefill, TariffResult } from './types'

async function readForParsing(
  file: File,
): Promise<{ content: string | ArrayBuffer; fileName: string; format: 'csv' | 'xlsx' }> {
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name)
  const content = isXlsx ? await file.arrayBuffer() : await file.text()
  return { content, fileName: file.name, format: isXlsx ? 'xlsx' : 'csv' }
}

const initial = {
  leistungspreisEurPerKwYear: '90',
  minBillableKw: '0',
  billingModel: 'monthly_max_average',
  energyPriceCtPerKwh: '25',
  einspeiseverguetungCtPerKwh: '8',
  energyPriceNightCtPerKwh: '18',
  windowFrom: '22:00',
  windowTo: '06:00',
  fixedSubsidyEur: '',
  subsidyPercent: '',
  investitionsfreibetragPercent: '',
  depreciationYears: '',
  taxRatePercent: '',
}
type FormState = typeof initial

/**
 * Die Katalog-Vorbelegung zu einer Kombination — die REINE Hälfte von `applySelection`.
 *
 * Sie steht hier ausserhalb der Komponente, weil sie ZWEI Aufrufer hat: die Auswahl von Hand
 * (`applySelection`, setState-basiert) und die Vorbelegung aus einem Rechnungs-Scan
 * (`buildInitialTariffState`, läuft vor dem ersten Render). Zweimal ausgeschrieben liefen die
 * beiden Wege auseinander, sobald jemand die Regel ändert — und dann bekäme derselbe Kunde je
 * nach Einstieg einen anderen Vorgabewert.
 */
function catalogPrefill(
  netzbetreiber: NetzbetreiberId,
  netzebene: Netzebene,
  stichtag: string,
): { fields: Partial<FormState>; selection: TariffSelection } | null {
  const result = lookupTariffProfile({ netzbetreiber, netzebene, on: stichtag })
  if (result.status !== 'available') return null
  return {
    fields: {
      leistungspreisEurPerKwYear: String(result.profile.leistungspreisEurPerKwYear),
      minBillableKw: String(result.profile.minBillableKw),
      billingModel: result.profile.billingModel,
    },
    selection: tariffSelectionFrom(result.set, result.profile),
  }
}

/**
 * Delta 9b-2b — der Anfangszustand des Formulars, wenn Schritt 1 einen Rechnungs-Scan mitgibt.
 *
 * ── ⚠ ALS INITIALZUSTAND, NICHT ALS EFFEKT ────────────────────────────────────────────────────
 * Ein `useEffect`, der nach dem ersten Render Felder setzt, hätte zwei Fehler auf einmal: der
 * Nutzer sähe für einen Moment die Vorgabewerte und dann etwas anderes, und jeder spätere Lauf des
 * Effekts überschriebe, was er inzwischen getippt hat. Ein Initialwert ist genau das, was eine
 * Vorbelegung ist — ein Startpunkt, den der Nutzer ab der ersten Tastatureingabe besitzt.
 *
 * ── ⚠ DIE REIHENFOLGE DER DREI SCHICHTEN IST DIE EIGENTLICHE FACHLICHE AUSSAGE ────────────────
 *   1. Katalog-Vorbelegung (B11) — was für diese Kombination allgemein gilt.
 *   2. „ohne Leistungsmessung" (Delta 9a) — setzt Leistungspreis und Sockel auf 0, weil dieser
 *      Anschluss den Posten nicht hat.
 *   3. Die TATSÄCHLICH auf der Rechnung gelesenen Sätze — sie schlagen beides.
 *
 * Schicht 3 zuletzt, weil Prinzip 1 sagt: die Rechnung ist die Wahrheit. Stünde sie vor Schicht 2,
 * überschriebe ausgerechnet die Pauschal-Regel den abgelesenen Wert. Und weil Schicht 3 nur
 * setzt, was NICHT `null` ist, bleibt die 0 aus Schicht 2 stehen, wo die Rechnung schweigt — genau
 * richtig: ein Anschluss ohne Leistungsmessung hat keinen Leistungspreis, und dass er nicht auf
 * der Rechnung steht, ist die Bestätigung und nicht die Lücke.
 *
 * ── UND WAS DARAUS FÜR `overriddenFields` FOLGT ───────────────────────────────────────────────
 * `overriddenFields` wird nicht mitgeschrieben, sondern ABGELEITET: `buildTariffSourceRef`
 * vergleicht die gerechneten Werte gegen `selection.defaults`. Weil Schicht 1 die Vorgabewerte
 * setzt UND `selection` füllt, erscheint jeder abgelesene Satz, der davon abweicht, von selbst als
 * überschrieben — was er ja auch ist: er kommt aus der Rechnung des Kunden und nicht aus unserer
 * Tabelle. Es war dafür keine Zeile Buchführung nötig, und das ist der Grund, warum diese Funktion
 * `catalogPrefill` benutzt statt die Felder direkt zu setzen.
 */
function buildInitialTariffState(prefill: TariffPrefill | undefined) {
  const stichtag = new Date().toISOString().slice(0, 10)
  /*
   * ── ⚠ NACH EINEM SCAN STARTEN DIE TARIFFELDER LEER, NICHT AUF DEN VORGABEWERTEN ──────────────
   * Das ist der Unterschied zwischen diesem Einstieg und den beiden anderen, und er ist gemessen
   * worden, nicht ausgedacht: liest der Scan den Arbeitspreis nicht (was bei einem Flex-Tarif mit
   * dreizehn Monatspreisen der RICHTIGE Ausgang ist), stünde dort sonst weiterhin die 25 aus
   * `initial` — und der Nutzer, dem eine Zeile darüber gerade „Rechnung gelesen" gemeldet wurde,
   * hält sie für seine Zahl. Ein Vorgabewert ist genau dann gefährlich, wenn er wie ein Messwert
   * aussieht.
   *
   * Was danach trotzdem stehen darf, steht aus einem NENNBAREN Grund da: die Katalog-Vorbelegung
   * (Schicht 1) trägt die Herkunftszeile sichtbar über den Feldern, und die 0 bei „ohne
   * Leistungsmessung" (Schicht 2) hat ihren eigenen erklärenden Hinweis. Alles Übrige bleibt leer
   * und wird beim Absenden als Pflichtfeld eingefordert — sichtbar, statt still gefüllt.
   *
   * `billingModel` ist davon ausgenommen: es ist eine Auswahl und kann nicht leer sein, und der
   * Scan liefert es grundsätzlich nicht (Delta 9b-2a: eine Rechnung zeigt einen abgerechneten
   * Wert, nicht die Regel dahinter). Es bleibt deshalb die Wahl des Nutzers.
   */
  const blanked: FormState = prefill
    ? {
        ...initial,
        leistungspreisEurPerKwYear: '',
        minBillableKw: '',
        energyPriceCtPerKwh: '',
        einspeiseverguetungCtPerKwh: '',
        energyPriceNightCtPerKwh: '',
      }
    : initial
  let form: FormState = { ...blanked }
  let selection: TariffSelection | null = null

  const netzbetreiber: NetzbetreiberId | typeof NOT_SET = prefill?.netzbetreiber ?? NOT_SET
  const ebene = prefill?.netzebene ?? null
  const netzebene = ebene != null ? String(ebene) : NOT_SET
  /*
   * Eine Messvariante nur dort, wo die Netzebene überhaupt eine anbietet — dieselbe Regel wie in
   * `applySelection`. Ohne sie stünde ein unsichtbarer Wert im State, den der Nutzer nicht mehr
   * korrigieren könnte, und der später in die Preisabfrage liefe.
   */
  const meteringVariant: MeteringVariant | typeof NOT_SET =
    ebene != null && hasMeteringVariant(ebene) && prefill?.meteringVariant
      ? prefill.meteringVariant
      : NOT_SET

  // 1. Katalog
  if (netzbetreiber !== NOT_SET && ebene != null) {
    const catalog = catalogPrefill(netzbetreiber, ebene, stichtag)
    if (catalog) {
      form = { ...form, ...catalog.fields }
      selection = catalog.selection
    }
  }

  // 2. Ohne Leistungsmessung (identisch zu `applyMeteringVariant`)
  if (meteringVariant === 'ohne_leistungsmessung') {
    form = { ...form, leistungspreisEurPerKwYear: '0', minBillableKw: '0' }
  }

  // 3. Die abgelesenen Sätze — nur, was tatsächlich dastand.
  const rates = prefill?.rates
  if (rates) {
    if (rates.leistungspreisEurPerKwYear != null) {
      form = { ...form, leistungspreisEurPerKwYear: String(rates.leistungspreisEurPerKwYear) }
    }
    if (rates.minBillableKw != null) form = { ...form, minBillableKw: String(rates.minBillableKw) }
    if (rates.energyPriceCtPerKwh != null) {
      form = { ...form, energyPriceCtPerKwh: String(rates.energyPriceCtPerKwh) }
    }
    if (rates.einspeiseverguetungCtPerKwh != null) {
      form = { ...form, einspeiseverguetungCtPerKwh: String(rates.einspeiseverguetungCtPerKwh) }
    }
    if (rates.energyPriceNightCtPerKwh != null) {
      form = { ...form, energyPriceNightCtPerKwh: String(rates.energyPriceNightCtPerKwh) }
    }
  }

  /*
   * Der Nachttarif-Abschnitt wird nur aufgeklappt, wenn die Rechnung tatsächlich einen ausweist.
   * Ihn vorsorglich zu öffnen hiesse, dem Nutzer ein leeres Fenster-Paar (22:00–06:00) als Angabe
   * seiner Rechnung unterzuschieben — die Fenster stehen NICHT im Scan (Delta 9b-2a: Strukturen,
   * keine Beträge), sie sind unsere Vorbelegung.
   */
  const useNight = rates?.energyPriceNightCtPerKwh != null

  return { stichtag, form, selection, netzbetreiber, netzebene, meteringVariant, useNight }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  )
}

/**
 * Sentinel für „nicht angegeben". Radix' `SelectItem` verträgt keinen leeren `value` — und ein
 * eigener Wert ist hier ohnehin ehrlicher als ein leerer: „Nicht angeben" ist eine bewusste
 * Antwort, kein fehlender Zustand.
 */
const NOT_SET = 'none'

type PendingState = {
  reason: PendingReason
  netzbetreiber: NetzbetreiberId | null
  netzebene: Netzebene
  note?: string
}

/** Ab welcher relativen Abweichung vom Vorgabewert ein neutraler Hinweis erscheint. */
const DEVIATION_THRESHOLD = 0.1

export function StepTariff({
  loadProfile,
  prefill,
  onBack,
  onComplete,
}: {
  /**
   * B21-3b: der bereits geparste Lastgang aus Schritt 1. Gebraucht wird allein sein ZEITRAUM —
   * die Preisabfragen laufen über genau die Zeitscheibe, die der Lastgang abdeckt (Delta 15
   * Regel A). Die Messwerte selbst verlassen den Browser weiterhin nicht (Prinzip 4).
   */
  loadProfile: LoadProfile
  onBack: () => void
  onComplete: (result: TariffResult) => void
  /**
   * Delta 9b-2b: die aus einer Rechnung abgelesenen Tarifangaben aus Schritt 1. `undefined` heisst
   * „kein Rechnungs-Scan" — dann verhält sich dieser Schritt Zeile für Zeile wie vor 9b-2b.
   */
  prefill?: TariffPrefill
}) {
  /*
   * EINMAL berechnet und danach festgehalten: der Anfangszustand hängt am Scan und am Stichtag,
   * und beide dürfen sich innerhalb einer Sitzung nicht ändern (der Stichtag aus demselben Grund
   * wie bisher — sonst wechselte eine Sitzung über Mitternacht still den Tarifsatz-Stand, mitten
   * in einer bereits vorbelegten Eingabe).
   */
  const [init] = useState(() => buildInitialTariffState(prefill))
  const [f, setF] = useState<FormState>(init.form)
  const [useNight, setUseNight] = useState(init.useNight)
  const [pvName, setPvName] = useState<string | null>(null)
  const [pv, setPv] = useState<ParsedPv | null>(null)
  const [pvIssue, setPvIssue] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  /*
   * ── B21-3b: der Tarifoptimierungs-Hebel (Delta 4) ───────────────────────────────────────────
   * Bewusst eine schlichte Schaltfläche und keine ausgearbeitete Oberfläche: die Darstellung des
   * Hebels im Ergebnis ist Delta 9 und ein eigener Bauabschnitt. Was hier steht, ist die
   * VERDRAHTUNG — ohne eine Möglichkeit, ihn einzuschalten, liesse sich der ganze Datenweg nicht
   * end-to-end prüfen.
   *
   * Ist er AUS, passiert nichts Neues: kein Netzwerkaufruf, kein zusätzliches Feld im Payload, und
   * die Engine rechnet wie vor B21.
   */
  const [useTariffOptimization, setUseTariffOptimization] = useState(false)
  const [pricingBusy, setPricingBusy] = useState(false)

  // ── B11: Netzbetreiber & Netzebene ────────────────────────────────────────────────────────────
  const [netzbetreiber, setNetzbetreiber] = useState<NetzbetreiberId | typeof NOT_SET>(
    init.netzbetreiber,
  )
  const [netzebene, setNetzebene] = useState<string>(init.netzebene)
  /*
   * Delta 9a — die dritte Auswahl-Dimension (Delta 5). Sichtbar NUR bei Netzebenen, die eine
   * Variante anbieten; bei allen anderen bleibt sie `NOT_SET` und reist als `null` in die Abfrage.
   *
   * Sie wird bewusst NICHT gerendert statt nur deaktiviert oder versteckt: ein deaktiviertes Feld
   * gäbe es weiterhin, und der nächste Umbau schickte seinen Wert mit — dann stünde eine Variante in
   * der Abfrage, wo `IS NULL` hingehört, und die gepflegte Tarifzeile wäre nicht auffindbar.
   * Dieselbe Überlegung wie im Admin-Formular (B21-2b).
   */
  const [meteringVariant, setMeteringVariant] = useState<MeteringVariant | typeof NOT_SET>(
    init.meteringVariant,
  )
  /** Gesetzt, sobald eine Kombination MIT Sätzen vorbelegt hat — trägt die Vorgabewerte von damals. */
  const [selection, setSelection] = useState<TariffSelection | null>(init.selection)
  /*
   * Der Stichtag EINMAL bestimmt und danach festgehalten: `lookupTariffProfile` ist rein und
   * bekommt das Datum übergeben (dieselbe Regel wie im Rechenkern). Würde es bei jedem Render neu
   * gelesen, könnte eine Sitzung über Mitternacht hinweg still auf einen anderen Tarifsatz-Stand
   * wechseln — mitten in einer bereits vorbelegten Eingabe.
   */
  const [stichtag] = useState(init.stichtag)

  /*
   * Delta 17 Teil 2 — der aus einer Freitext-Angabe BESTÄTIGTE Speicher.
   *
   * `null` ist der Normalfall und heisst „wie bisher": voller Katalog, Empfehlung, keine
   * Vorauswahl. Das Feld ist optional, und ohne Eingabe entsteht kein Netzaufruf.
   */
  const [batteryPreset, setBatteryPreset] = useState<BatteryPreset | null>(null)

  const set = (k: keyof FormState) => (v: string) => setF((s) => ({ ...s, [k]: v }))

  /**
   * Auswahl übernehmen: bei einer Kombination MIT Sätzen die drei Felder vorbelegen, sonst die
   * Vorbelegung wieder aufgeben.
   *
   * Vorbelegen heisst ÜBERSCHREIBEN — wer den Netzbetreiber wechselt, will die Werte des neuen
   * sehen, nicht die des alten. Was der Nutzer danach eintippt, bleibt stehen; die Auswahl wird
   * nicht erneut ausgewertet, und keine Neuberechnung im Report (§6.2) fasst diese Felder je wieder
   * an. Genau das macht den Vorgabewert zu einer Vorbelegung und nicht zu einer Vorschrift.
   */
  function applySelection(nextBetreiber: string, nextEbene: string) {
    setNetzbetreiber(nextBetreiber as NetzbetreiberId | typeof NOT_SET)
    setNetzebene(nextEbene)

    /*
     * Wechselt die Netzebene auf eine ohne Variante, wird die Auswahl zurückgenommen — sonst bliebe
     * ein unsichtbarer Wert stehen und liefe in die Abfrage. Das Feld ist dann nicht mehr sichtbar,
     * der Nutzer könnte ihn also gar nicht mehr korrigieren.
     */
    if (nextEbene === NOT_SET || !hasMeteringVariant(Number(nextEbene))) setMeteringVariant(NOT_SET)

    if (nextBetreiber === NOT_SET || nextEbene === NOT_SET) {
      setSelection(null)
      return
    }

    // Dieselbe reine Regel wie bei der Vorbelegung aus einem Rechnungs-Scan (9b-2b) — EIN Ort.
    const catalog = catalogPrefill(
      nextBetreiber as NetzbetreiberId,
      Number(nextEbene) as Netzebene,
      stichtag,
    )

    if (!catalog) {
      setSelection(null)
      return
    }

    setF((s) => ({ ...s, ...catalog.fields }))
    setSelection(catalog.selection)
  }

  /*
   * Liegt zur Auswahl kein Satz vor? Ohne Netzbetreiber wird die Frage über ALLE geführten
   * Netzbetreiber beantwortet — Netzebene 7 steht überall aus, und diese Aussage erst nach einer
   * zusätzlichen Auswahl zu machen wäre eine Hürde ohne Ertrag.
   */
  const pending: PendingState | null = (() => {
    if (netzebene === NOT_SET) return null
    const ebene = Number(netzebene) as Netzebene

    if (netzbetreiber === NOT_SET) {
      const reason = pendingAcrossAllBetreiber(ebene, stichtag)
      return reason ? { reason, netzbetreiber: null, netzebene: ebene } : null
    }

    const result = lookupTariffProfile({ netzbetreiber, netzebene: ebene, on: stichtag })
    return result.status === 'pending_regulation'
      ? {
          reason: result.profile.reason,
          netzbetreiber,
          netzebene: ebene,
          note: result.profile.note,
        }
      : null
  })()

  /** Bietet die gewählte Netzebene überhaupt eine Messvariante an (Delta 5: heute NE 7)? */
  const showMeteringVariant = netzebene !== NOT_SET && hasMeteringVariant(Number(netzebene))

  /*
   * Delta 9a — der gültige Fall ohne Leistungspreis-Komponente. Er hebt die B11-Sperre auf, und
   * zwar aus einem fachlichen und nicht aus einem Bequemlichkeits-Grund: die Sperre steht dort, wo
   * uns eine Zahl FEHLT. Hier fehlt keine — für diesen Anschluss gibt es keine. Was ohne
   * Leistungspreis rechenbar bleibt (Eigenverbrauch, Lastverschiebung, der Vergleich mit den
   * Börsenpreisen), ist genau das, worum es diesem Kunden geht.
   */
  const noPowerMeasurement = showMeteringVariant && meteringVariant === 'ohne_leistungsmessung'

  /*
   * Delta 9a, Nachtrag — solange die Messvariante offen ist, gilt KEINE der beiden Aussagen.
   *
   * Der Zustand ist neu, die Sperre ist es nicht: `blocked` hängt weiterhin allein an `pending` und
   * an „ohne Leistungsmessung". Eine unbeantwortete Frage ist kein Grund, weiterzurechnen — welcher
   * Leistungspreis gälte, ist ja gerade das, was hier noch offen ist.
   */
  const meteringVariantOpen = showMeteringVariant && meteringVariant === NOT_SET
  const blocked = pending != null && !noPowerMeasurement

  /**
   * Messvariante übernehmen. Bei „ohne Leistungsmessung" wird der Leistungspreis auf 0 vorbelegt —
   * das ist keine erfundene Zahl, sondern die einzige richtige: dieser Anschluss hat den Posten
   * nicht. Stünde dort weiter der Vorgabewert, wiese der Report eine Spitzenkappungs-Ersparnis aus,
   * die der Hinweis darüber im selben Atemzug bestreitet.
   *
   * Beim Zurückwechseln wird NICHTS wiederhergestellt: was der Nutzer sieht, ist sein Feld, und ein
   * Formular, das eingetragene Werte hinter seinem Rücken zurücksetzt, ist schlimmer als eine 0, die
   * er stehen sieht.
   */
  function applyMeteringVariant(next: string) {
    setMeteringVariant(next as MeteringVariant | typeof NOT_SET)
    if (next === 'ohne_leistungsmessung') {
      setF((s) => ({ ...s, leistungspreisEurPerKwYear: '0', minBillableKw: '0' }))
    }
  }

  /*
   * Weicht der eingetragene Leistungspreis deutlich vom Vorgabewert ab, ein NEUTRALER Hinweis —
   * kein Fehler, keine Sperre. Der Kunde hat womöglich einen Sondervertrag, und die Rechnung
   * schlägt jede Tabelle (Prinzip 1). Der Hinweis sagt nur, dass beide Zahlen bekannt sind.
   */
  const enteredLeistungspreis = parseNum(f.leistungspreisEurPerKwYear)
  const defaultLeistungspreis = selection?.defaults.leistungspreisEurPerKwYear
  const deviates =
    defaultLeistungspreis != null &&
    defaultLeistungspreis > 0 &&
    Number.isFinite(enteredLeistungspreis) &&
    Math.abs(enteredLeistungspreis - defaultLeistungspreis) / defaultLeistungspreis >
      DEVIATION_THRESHOLD

  // PV-Profil ist optional (§3.1): Datei client-side parsen (Prinzip 4 — verlässt den Browser nicht).
  // Bei Fehler/uneindeutigem Format eine Warnung zeigen, aber NICHT blockieren — der Rechner läuft dann
  // ohne Brutto-PV weiter (der Netz-Lastgang allein genügt, §3.1).
  async function handlePvFile(file: File) {
    setPvName(file.name)
    setPv(null)
    setPvIssue(null)
    const outcome = parsePvProfile(await readForParsing(file))
    if (outcome.ok) {
      setPv({ fileName: file.name, profile: outcome.profile, dataQuality: outcome.dataQuality })
      return
    }
    setPvIssue(
      outcome.kind === 'needs_mapping'
        ? outcome.issues.map((i) => i.message).join(' ')
        : outcome.error.message,
    )
  }

  async function handleSubmit() {
    /*
     * B11, TEIL 4: Zu einer Kombination ohne Leistungspreis wird NICHT gerechnet. Die Sperre sitzt
     * hier UND am Knopf — der Knopf ist die sichtbare Hälfte, diese Zeile die wirksame.
     */
    if (blocked) return

    const errs: Record<string, string> = {}

    const tariffInput: Record<string, unknown> = {
      leistungspreisEurPerKwYear: parseNum(f.leistungspreisEurPerKwYear),
      billingModel: f.billingModel,
      minBillableKw: parseNum(f.minBillableKw),
      energyPriceCtPerKwh: parseNum(f.energyPriceCtPerKwh),
      einspeiseverguetungCtPerKwh: parseNum(f.einspeiseverguetungCtPerKwh),
    }
    if (netzebene !== NOT_SET) tariffInput.netzebene = `NE ${netzebene}`
    if (useNight) {
      tariffInput.energyPriceNightCtPerKwh = parseNum(f.energyPriceNightCtPerKwh)
      tariffInput.timeOfUseWindows = [
        { from: f.windowFrom, to: f.windowTo, ctPerKwh: parseNum(f.energyPriceNightCtPerKwh) },
      ]
    }

    const tRes = tariffParamsSchema.safeParse(tariffInput)
    if (!tRes.success) {
      for (const iss of tRes.error.issues) {
        const k = String(iss.path[0] ?? '')
        if (k && !errs[k]) errs[k] = 'Bitte einen gültigen Wert eingeben'
      }
    }

    // FinancialParams nur bauen, wenn mindestens ein Feld ausgefüllt ist (sonst „keine Angabe").
    const financialRaw: Record<string, number> = {}
    const financialKeys: Array<keyof FinancialParams> = [
      'fixedSubsidyEur',
      'subsidyPercent',
      'investitionsfreibetragPercent',
      'depreciationYears',
      'taxRatePercent',
    ]
    for (const k of financialKeys) {
      const raw = f[k as keyof FormState]
      if (typeof raw === 'string' && raw.trim() !== '') financialRaw[k] = parseNum(raw)
    }
    let financial: FinancialParams | undefined
    if (Object.keys(financialRaw).length > 0) {
      const fRes = financialParamsSchema.safeParse(financialRaw)
      if (!fRes.success) {
        for (const iss of fRes.error.issues) {
          const k = String(iss.path[0] ?? '')
          if (k && !errs[k]) errs[k] = 'Bitte einen gültigen Wert (Prozent 0–100) eingeben'
        }
      } else {
        financial = fRes.data
      }
    }

    setErrors(errs)
    if (Object.keys(errs).length > 0 || !tRes.success) return

    // Wurde eine PV-Datei hochgeladen, aber nicht gelesen (pv === null && pvIssue gesetzt), die
    // Ablehnung mitgeben — sonst verschwände der Upload still (nur die Schritt-2-Warnung, nichts im
    // Report). `handlePvFile` löscht `pvIssue` bei jedem neuen Versuch, ein späterer Erfolg (pv gesetzt)
    // hebt sie also auf.
    const pvError = pv == null && pvIssue != null ? pvIssue : undefined

    /*
     * Die Preisdaten werden NUR geholt, wenn der Hebel angefordert ist (Delta 4). Ohne ihn gibt es
     * keinen Netzwerkaufruf — der öffentliche Rechner bleibt für jeden, der ihn nicht braucht,
     * genau so netzfrei wie vor B21.
     *
     * Ein Fehlschlag bricht hier NICHTS ab: `loadTariffPricing` liefert dann `null` für die
     * betroffene Seite, und die Engine kennzeichnet den Hebel als nicht berechenbar (Regel C).
     * Die Peak-Shaving-Analyse läuft unverändert weiter — sie hängt an keiner dieser Zahlen.
     */
    let tariffPricing: TariffPricingInputs | undefined
    if (useTariffOptimization) {
      setPricingBusy(true)
      try {
        tariffPricing = await loadTariffPricing(
          loadProfile,
          netzbetreiber === NOT_SET ? null : netzbetreiber,
          netzebene === NOT_SET ? null : Number(netzebene),
          // Nur wo die Netzebene eine Variante ANBIETET, darf eine mitfahren — sonst gehört `null`
          // in die Abfrage (B21-1, `nulls not distinct`).
          showMeteringVariant && meteringVariant !== NOT_SET ? meteringVariant : null,
        )
      } finally {
        setPricingBusy(false)
      }
    }

    onComplete({
      tariff: tRes.data as TariffParams,
      financial,
      pv,
      pvError,
      /*
       * Delta 17 Teil 2: `undefined` statt `null`, wenn nichts bestätigt wurde — dann trägt der
       * Payload das Feld gar nicht, und der Worker verhält sich Zeile für Zeile wie vorher.
       */
      ...(batteryPreset ? { batteryPreset } : {}),
      // B11: die Herkunft der Vorgabewerte reist mit — sie steht dauerhaft im Report und im
      // Analyse-Bündel (Fassung 2). `undefined`, wenn kein Netzbetreiber gewählt wurde: dann
      // stammen die Werte direkt aus der Netzrechnung, und das ist eine eigene Aussage.
      tariffSelection: selection ?? undefined,
      tariffPricing,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tarif &amp; Ziel</CardTitle>
        <p className="text-sm text-text-muted">
          Werte aus Ihrer Netzrechnung. Sinnvolle Vorbelegung, alles editierbar.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        {/*
         * B11 — Netzbetreiber und Netzebene belegen Leistungspreis, Abrechnungsmodell und
         * Mindestbemessung vor. Steht VOR dem Leistungspreis, weil die Auswahl ihn setzt; darunter
         * wäre die Reihenfolge im Formular umgekehrt zur Wirkung.
         */}
        <Section title="Netzbetreiber & Netzebene">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <LabelWithInfo htmlFor="netzbetreiber" label="Netzbetreiber">
                Das ist das Unternehmen, dem die Leitungen bis zu Ihrem Zähler gehören — nicht Ihr
                Stromlieferant. Beide stehen auf Ihrer Rechnung, oft auf getrennten Seiten. Die
                Auswahl belegt Leistungspreis und Abrechnungsmodell vor und entscheidet, welches
                Netzentgelt in den Vergleich mit den Börsen-Strompreisen eingeht. Wissen Sie es
                nicht: „Nicht angeben" wählen und die Werte von der Rechnung eintragen — die
                Rechnung ist ohnehin massgeblich.
              </LabelWithInfo>
              <Select
                value={netzbetreiber}
                onValueChange={(v) => applySelection(v, netzebene)}
              >
                <SelectTrigger id="netzbetreiber">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_SET}>Nicht angeben — Werte aus meiner Netzrechnung</SelectItem>
                  {NETZBETREIBER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {NETZBETREIBER_LABELS[id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <LabelWithInfo htmlFor="netzebene" label="Netzebene">
                Die Netzebene sagt, wie „weit oben" im Stromnetz Ihr Anschluss hängt — je näher am
                Hochspannungsnetz, desto niedriger die Zahl und desto günstiger das Netzentgelt.
                Gewerbebetriebe liegen meist auf 5 bis 7, ein eigenes Umspannwerk auf 3 oder 4. Der
                Wert steht auf Ihrer Netzrechnung, üblicherweise als „Netzebene" oder „NE".
              </LabelWithInfo>
              <Select value={netzebene} onValueChange={(v) => applySelection(netzbetreiber, v)}>
                <SelectTrigger id="netzebene">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_SET}>Nicht angeben</SelectItem>
                  {NETZEBENEN.map((ebene) => (
                    <SelectItem key={ebene} value={String(ebene)}>
                      Netzebene {ebene}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/*
              Delta 9a — die dritte Auswahl, kontextabhängig (Delta 5). Sie wird NICHT gerendert, wo
              die Netzebene keine Variante anbietet; s. die Begründung am `meteringVariant`-State.
            */}
            {showMeteringVariant && (
              <div className="flex flex-col gap-1.5">
                <LabelWithInfo htmlFor="meteringVariant" label="Leistungsmessung">
                  Auf dieser Netzebene gibt es mehrere Anschlussarten, und sie werden verschieden
                  abgerechnet. <strong>Mit Leistungsmessung</strong> heisst: Ihr Zähler erfasst die
                  höchste Viertelstunde, und die kostet extra — nur dann bringt eine Spitzenkappung
                  überhaupt etwas. <strong>Ohne Leistungsmessung</strong> heisst: Sie zahlen nur
                  Arbeitspreis und Pauschale. <strong>Unterbrechbar</strong> ist ein eigener,
                  günstigerer Tarif für abschaltbare Anlagen (z. B. Wärmepumpen mit Sperrzeiten).
                  Welche gilt, steht auf Ihrer Netzrechnung.
                </LabelWithInfo>
                <Select value={meteringVariant} onValueChange={applyMeteringVariant}>
                  <SelectTrigger id="meteringVariant">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET}>Nicht angeben</SelectItem>
                    {METERING_VARIANTS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {METERING_VARIANT_LABELS[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/*
           * Die Herkunft steht sichtbar, aber unaufdringlich — und sie sagt in demselben Satz, dass
           * die eigene Rechnung massgeblich ist (Prinzip 1). Ein Vorgabewert ohne diesen Hinweis
           * liest sich wie eine Feststellung.
           */}
          {selection && !pending && (
            <p className="text-xs text-text-muted" data-testid="tarif-herkunft">
              Vorbelegt aus „{selection.tariffSetLabel}“ (gültig ab{' '}
              <Num>{selection.tariffSetValidFrom}</Num>). Ihre Netzrechnung schlägt diese Tabelle —
              alle Felder unten bleiben editierbar.
            </p>
          )}

          {/*
            Delta 9a: drei Aussagen, die einander ausschliessen, in der Reihenfolge ihrer Bedingung.

            Zuerst die offene Messvariante — solange sie fehlt, wissen wir nicht, welche der beiden
            anderen gilt, und die Regulierungslücke samt Warteliste hier vorwegzunehmen wäre für
            jeden Anschluss ohne Leistungsmessung schlicht die falsche Auskunft. Danach „ohne
            Leistungsmessung": es fehlt nichts, es gilt nur ein anderer Tarifaufbau. Zuletzt die
            Verweigerung, inhaltlich unverändert — nur der Zeitpunkt hat sich verschoben.
          */}
          {meteringVariantOpen ? (
            <TarifMessvarianteOffen netzebene={Number(netzebene)} />
          ) : noPowerMeasurement ? (
            <TarifOhneLeistungsmessung />
          ) : (
            pending && (
              <TarifNichtVerfuegbar
                reason={pending.reason}
                netzbetreiber={pending.netzbetreiber}
                netzebene={pending.netzebene}
                note={pending.note}
              />
            )
          )}

          {/*
            ── Delta 9a: der Tarifoptimierungs-Hebel steht JETZT HIER ──────────────────────────────
            In B21-3b sass er im Abschnitt „Energiepreise", weil er dort als blosse Verdrahtung
            entstand. Er hängt aber an genau den zwei Feldern darüber: ohne Netzbetreiber und
            Netzebene gibt es keine Netzentgelt-Seite, und ohne die ist er nicht berechenbar. Neben
            den Feldern, von denen er abhängt, ist der Zusammenhang sichtbar; einen Abschnitt weiter
            unten war er es nicht.
          */}
          <InfoHint
            label="Vergleich mit Börsen-Strompreisen"
            before={
              <label className="flex items-center gap-2 text-sm text-text">
                <Checkbox
                  checked={useTariffOptimization}
                  onCheckedChange={(v) => setUseTariffOptimization(v === true)}
                />
                Mit Börsen-Strompreisen vergleichen (optional)
              </label>
            }
          >
            Statt eines festen Arbeitspreises rechnen wir jede Viertelstunde mit dem tatsächlichen
            Börsenpreis jener Stunde plus dem Netzentgelt Ihres Netzbetreibers. Das zeigt, was ein
            Speicher zusätzlich gebracht hätte, wenn er in billigen Stunden geladen und in teuren
            entladen hätte — rückblickend auf echte Marktpreise Ihres Zeitraums, nicht als Prognose.
            Fehlen für Ihren Zeitraum Preisdaten, sagen wir das ausdrücklich und zeigen keine Zahl.
            Die Spitzenkappung bleibt davon in jedem Fall unberührt.
          </InfoHint>

          {/*
            ── Delta 17 Teil 2: der eigene Speicher, in eigenen Worten ────────────────────────────
            Steht hier und nicht im Abschnitt „Leistungspreis": es ist eine Angabe über die ANLAGE
            des Kunden, keine über seinen Tarif — und es ist nach den beiden Auswahlfeldern darüber
            die zweite Stelle, an der er etwas über sich selbst sagt statt eine Zahl von seiner
            Rechnung abzutippen. Optional; ohne Eingabe passiert nichts Neues.
          */}
          <BatteryTextPanel preset={batteryPreset} onPreset={setBatteryPreset} />
        </Section>

        <Section title="Leistungspreis">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="leistungspreis"
              label="Leistungspreis"
              unit="€/kW·a"
              value={f.leistungspreisEurPerKwYear}
              onChange={set('leistungspreisEurPerKwYear')}
              error={errors.leistungspreisEurPerKwYear}
            />
            <NumberField
              id="minBillableKw"
              label="Mindestleistung"
              unit="kW"
              value={f.minBillableKw}
              onChange={set('minBillableKw')}
              error={errors.minBillableKw}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billingModel">Abrechnungsmodell</Label>
              <Select value={f.billingModel} onValueChange={set('billingModel')}>
                <SelectTrigger id="billingModel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly_max_average">
                    Mittel der 12 Monatshöchstwerte
                  </SelectItem>
                  <SelectItem value="annual_max">Jahreshöchstwert</SelectItem>
                  <SelectItem value="monthly_max_sum">Summe der 12 Monatshöchstwerte</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {deviates && defaultLeistungspreis != null && (
            <p className="text-xs text-text-muted" data-testid="tarif-abweichung">
              Ihr Leistungspreis weicht deutlich vom Vorgabewert ab (<Num>{defaultLeistungspreis}</Num>{' '}
              €/kW·a laut hinterlegtem Stand). Das ist kein Fehler — ein Sondervertrag oder eine
              andere Netzebene erklärt das. Gerechnet wird mit Ihrem Wert.
            </p>
          )}
        </Section>

        <Section title="Energiepreise">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="energyPrice"
              label="Arbeitspreis"
              unit="ct/kWh"
              value={f.energyPriceCtPerKwh}
              onChange={set('energyPriceCtPerKwh')}
              error={errors.energyPriceCtPerKwh}
            />
            <NumberField
              id="einspeise"
              label="Einspeisevergütung"
              unit="ct/kWh"
              value={f.einspeiseverguetungCtPerKwh}
              onChange={set('einspeiseverguetungCtPerKwh')}
              error={errors.einspeiseverguetungCtPerKwh}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox checked={useNight} onCheckedChange={(v) => setUseNight(v === true)} />
            Niedertarif-/HT-NT-Fenster hinterlegen (optional)
          </label>
          {useNight && (
            <div className="grid gap-4 rounded-lg border border-border bg-surface-alt p-4 sm:grid-cols-3">
              <NumberField
                id="nightPrice"
                label="Nacht-/Niedertarif"
                unit="ct/kWh"
                value={f.energyPriceNightCtPerKwh}
                onChange={set('energyPriceNightCtPerKwh')}
                error={errors.energyPriceNightCtPerKwh}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="windowFrom">Fenster von</Label>
                <Input
                  id="windowFrom"
                  type="time"
                  value={f.windowFrom}
                  onChange={(e) => set('windowFrom')(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="windowTo">Fenster bis</Label>
                <Input
                  id="windowTo"
                  type="time"
                  value={f.windowTo}
                  onChange={(e) => set('windowTo')(e.target.value)}
                />
              </div>
            </div>
          )}
        </Section>

        <Section title="PV-Erzeugung (optional)">
          <FileDrop
            accept=".csv,.xlsx,.xls"
            fileName={pvName}
            onFile={(file) => {
              void handlePvFile(file)
            }}
            title="PV-Erzeugungsprofil hierher ziehen oder klicken"
            hint="Wechselrichter-Export (Fronius, SMA, Sungrow …) — verbessert die Eigenverbrauchs-Aussage"
            compact
          />
          {pv && (
            <p className="flex items-center gap-1.5 text-xs text-positive">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Brutto-PV-Profil erkannt ({pv.dataQuality.coveredDays} Tage) — der Report zeigt den
              PV-Eigenverbrauch als eigenen Strom.
            </p>
          )}
          {pvIssue && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>PV-Profil konnte nicht gelesen werden</AlertTitle>
              <AlertDescription>
                {pvIssue} Die Analyse läuft ohne Brutto-PV weiter (der Netz-Lastgang genügt).
              </AlertDescription>
            </Alert>
          )}
        </Section>

        <Accordion type="single" collapsible className="rounded-lg border border-border px-4">
          <AccordionItem value="foerderung" className="border-b-0">
            <AccordionTrigger>Förderung &amp; Steuer (optional)</AccordionTrigger>
            <AccordionContent>
              <p className="mb-4 text-xs text-text-muted">
                Vereinfachte Rechnung, keine Steuerberatung. Prozentwerte in % (0–100).
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="fixedSubsidyEur"
                  label="Pauschale Förderung"
                  unit="€"
                  value={f.fixedSubsidyEur}
                  onChange={set('fixedSubsidyEur')}
                  error={errors.fixedSubsidyEur}
                />
                <NumberField
                  id="subsidyPercent"
                  label="Förderung"
                  unit="%"
                  value={f.subsidyPercent}
                  onChange={set('subsidyPercent')}
                  error={errors.subsidyPercent}
                  hint={percentHint(f.subsidyPercent)}
                />
                <NumberField
                  id="investitionsfreibetragPercent"
                  label="Investitionsfreibetrag"
                  unit="%"
                  value={f.investitionsfreibetragPercent}
                  onChange={set('investitionsfreibetragPercent')}
                  error={errors.investitionsfreibetragPercent}
                  hint={percentHint(f.investitionsfreibetragPercent)}
                />
                <NumberField
                  id="taxRatePercent"
                  label="Steuersatz (Grenzsteuer/KöSt)"
                  unit="%"
                  value={f.taxRatePercent}
                  onChange={set('taxRatePercent')}
                  error={errors.taxRatePercent}
                  hint={percentHint(f.taxRatePercent)}
                />
                <NumberField
                  id="depreciationYears"
                  label="Abschreibungsdauer (AfA)"
                  unit="Jahre"
                  value={f.depreciationYears}
                  onChange={set('depreciationYears')}
                  error={errors.depreciationYears}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </Button>
          {/*
           * B11, TEIL 4: gesperrt, solange zur Auswahl kein Leistungspreis vorliegt. Die Begründung
           * steht oben im Klartext — ein Knopf, der stumm nicht reagiert, wäre eine Panne; einer,
           * der neben der Begründung deaktiviert ist, ist die Aussage selbst.
           */}
          <Button onClick={() => void handleSubmit()} disabled={blocked || pricingBusy}>
            {pricingBusy ? 'Preisdaten werden geladen …' : 'Analyse starten'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
