'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import { findGridTariffRow, parsePvProfile } from 'engine'
import {
  NETZBETREIBER_IDS,
  NETZBETREIBER_LABELS,
  NETZEBENEN,
  METERING_VARIANTS,
  METERING_VARIANT_LABELS,
  financialParamsSchema,
  gridTariffPrefill,
  hasMeteringVariant,
  lookupTariffProfile,
  pendingAcrossAllBetreiber,
  tariffParamsSchema,
  type BillingModel,
  type FinancialParams,
  type GridTariffPrefill,
  type LoadProfile,
  type MeteringVariant,
  type Netzebene,
  type NetzbetreiberId,
  type PendingReason,
  type TariffParams,
  type TariffPricingInputs,
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
import { PvDesignPanel } from './pv-design-panel'
import { InfoHint, LabelWithInfo } from '@/components/ui/info-hint'
import { Num } from '@/components/report/num'
import { parseNum, percentHint } from '@/lib/form-utils'
import { FileDrop } from './file-drop'
import {
  NetzentgeltNichtAbrufbar,
  NetzentgeltNichtHinterlegt,
  NetzentgeltWirdGeprueft,
  TarifMessvarianteOffen,
  TarifNichtVerfuegbar,
  TarifOhneLeistungsmessung,
} from './tarif-nicht-verfuegbar'
import { loadTariffPricing } from '@/lib/tariff-pricing'
import { fetchGridTariffs } from '@/lib/tariff-data'
import type {
  EstimatedPvResult,
  ExistingBatteryInput,
  ParsedLoad,
  ParsedPv,
  TariffPrefill,
  TariffResult,
} from './types'

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
  /*
   * Delta 19: die monatliche Grundgebühr des heutigen Lieferanten. Vorgabewert '0' und ausdrücklich
   * NICHT leer — 0 heisst „keine oder nicht bekannt" und ist zugleich die konservative Richtung:
   * sie lässt den heutigen Tarif billiger aussehen als er ist und den aWATTar-Vorteil damit
   * kleiner, nicht grösser. Ein geschätzter Vorgabewert wäre die gefährliche Richtung — er sähe
   * aus wie ein Wert von der Rechnung des Kunden.
   */
  supplierBaseFeeEurPerMonth: '0',
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
 * ⚠ B21-3d (07.09.2026) — HIER STAND `catalogPrefill`, UND DASS ES SIE NICHT MEHR GIBT, IST DER
 * KERN DIESER ÄNDERUNG.
 *
 * Sie belegte die drei Tariffelder aus dem statischen Katalog (`lookupTariffProfile`, B11) vor —
 * synchron, weil ein Codemodul synchron ist. Genau daran hing der Defekt: der Katalog kennt die
 * über `/admin/netzbetreiber-tarife` gepflegten Preisblätter NICHT (er ist ein Codemodul und
 * ändert sich nur durch einen PR), und ein eingetragener Satz blieb im Rechner unsichtbar. Ein
 * Kunde auf Wiener Netze NE 6 bekam „bei uns noch kein Leistungspreis hinterlegt" zu lesen, während
 * 59,52 €/kW·a eine Abfrage entfernt in `public.grid_tariffs` standen.
 *
 * Für die Netzebenen 3–6 fragt der Rechner deshalb ab jetzt die DATENBANK (`fetchGridTariffs`,
 * B21-3a) — und weil eine Abfrage nicht synchron ist, kann die Vorbelegung keine reine Funktion
 * neben dem Render mehr sein. Sie sitzt jetzt in genau EINEM Effekt (`useEffect` in der Komponente
 * unten); die reine, geprüfte Hälfte davon — die Übersetzung Tarifzeile → Formularfelder — liegt in
 * `packages/shared/src/grid-tariff-prefill.ts`, weil `apps/website` keinen Testlauf hat.
 *
 * ── ⚠ NETZEBENE 7 IST DIE AUSDRÜCKLICHE AUSNAHME UND BLEIBT AM KATALOG ────────────────────────
 * `lookupTariffProfile`/`pendingAcrossAllBetreiber` werden weiterhin importiert und weiterhin
 * benutzt — aber NUR für Netzebene 7. Dort ist das Fehlen kein Pflegestand, sondern eine
 * regulatorische Tatsache: die Tarifverordnung (SNE-T-V) ist nicht erlassen. Diese Sperre darf
 * NICHT davon abhängen, was in der Datenbank steht; s. `REGULATION_PENDING_NETZEBENE` unten.
 */

/**
 * Delta 9b-2b — der Anfangszustand des Formulars, wenn Schritt 1 einen Rechnungs-Scan mitgibt.
 *
 * ── ⚠ ALS INITIALZUSTAND, NICHT ALS EFFEKT ────────────────────────────────────────────────────
 * Ein `useEffect`, der nach dem ersten Render Felder setzt, hätte zwei Fehler auf einmal: der
 * Nutzer sähe für einen Moment die Vorgabewerte und dann etwas anderes, und jeder spätere Lauf des
 * Effekts überschriebe, was er inzwischen getippt hat. Ein Initialwert ist genau das, was eine
 * Vorbelegung ist — ein Startpunkt, den der Nutzer ab der ersten Tastatureingabe besitzt.
 *
 * ── ⚠ SCHICHT 1 IST MIT B21-3d VON HIER WEGGEZOGEN, DIE REIHENFOLGE GILT UNVERÄNDERT ──────────
 *   1. Netzentgelt-Vorbelegung — steht ab jetzt im Effekt, weil sie aus der Datenbank kommt.
 *   2. „ohne Leistungsmessung" (Delta 9a) — setzt Leistungspreis und Sockel auf 0, weil dieser
 *      Anschluss den Posten nicht hat. Betrifft ausschliesslich NE 7, also NICHT den Datenbankweg.
 *   3. Die TATSÄCHLICH auf der Rechnung gelesenen Sätze — sie schlagen beides.
 *
 * Schicht 3 zuletzt, weil Prinzip 1 sagt: die Rechnung ist die Wahrheit.
 *
 * ⚠ DASS SCHICHT 1 JETZT SPÄTER LÄUFT ALS SCHICHT 3, KEHRT DIE REIHENFOLGE NICHT UM. Der Effekt
 * überschreibt beim ERSTEN Lauf ausdrücklich kein Feld, das der Scan geliefert hat — dafür gibt
 * `scannedRateFields` unten die Liste, und der Effekt liest sie. Ohne diesen Schutz überschriebe
 * ausgerechnet unsere Tabelle den abgelesenen Satz des Kunden.
 *
 * ── UND WAS DARAUS FÜR `overriddenFields` FOLGT ───────────────────────────────────────────────
 * `overriddenFields` wird nicht mitgeschrieben, sondern ABGELEITET: `buildTariffSourceRef`
 * vergleicht die gerechneten Werte gegen `selection.defaults`. Weil die Vorbelegung die
 * Vorgabewerte setzt UND `selection` füllt, erscheint jeder abgelesene Satz, der davon abweicht,
 * von selbst als überschrieben — was er ja auch ist: er kommt aus der Rechnung des Kunden und
 * nicht aus unserer Tabelle.
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

  /*
   * 1. Netzentgelt-Vorbelegung — steht seit B21-3d NICHT mehr hier. Sie kommt aus der Datenbank und
   *    damit aus einem Effekt (s. `netzentgelt` in der Komponente). Der Effekt läuft beim Mounten,
   *    also unmittelbar nach diesem Anfangszustand, und respektiert dabei Schicht 3.
   */

  // 2. Ohne Leistungsmessung (identisch zu `applyMeteringVariant`)
  if (meteringVariant === 'ohne_leistungsmessung') {
    form = { ...form, leistungspreisEurPerKwYear: '0', minBillableKw: '0' }
  }

  /*
   * 3. Die abgelesenen Sätze — nur, was tatsächlich dastand.
   *
   * ⚠ `scannedRateFields` hält fest, WELCHE der beiden Felder aus der Rechnung stammen, die die
   * Netzentgelt-Vorbelegung ebenfalls belegen würde. Der Effekt liest die Menge und lässt genau
   * diese Felder beim ERSTEN Lauf unangetastet — sonst überschriebe die Tabelle den abgelesenen
   * Satz, also Schicht 1 die Schicht 3, und das wäre Prinzip 1 auf den Kopf gestellt.
   */
  const scannedRateFields = new Set<'leistungspreisEurPerKwYear' | 'minBillableKw'>()
  const rates = prefill?.rates
  if (rates) {
    if (rates.leistungspreisEurPerKwYear != null) {
      form = { ...form, leistungspreisEurPerKwYear: String(rates.leistungspreisEurPerKwYear) }
      scannedRateFields.add('leistungspreisEurPerKwYear')
    }
    if (rates.minBillableKw != null) {
      form = { ...form, minBillableKw: String(rates.minBillableKw) }
      scannedRateFields.add('minBillableKw')
    }
    if (rates.energyPriceCtPerKwh != null) {
      form = { ...form, energyPriceCtPerKwh: String(rates.energyPriceCtPerKwh) }
    }
    if (rates.einspeiseverguetungCtPerKwh != null) {
      form = { ...form, einspeiseverguetungCtPerKwh: String(rates.einspeiseverguetungCtPerKwh) }
    }
    if (rates.energyPriceNightCtPerKwh != null) {
      form = { ...form, energyPriceNightCtPerKwh: String(rates.energyPriceNightCtPerKwh) }
    }
    /*
     * Delta 19 / §3.7.3 — die Grundgebühr des Lieferanten. Sie steht ausdrücklich NICHT in der
     * `blanked`-Liste oben: ihr Vorgabewert '0' ist einer der NENNBAREN, die auch nach einem Scan
     * stehen bleiben dürfen. 0 heisst dort „keine oder nicht bekannt", das Feld ist als optional
     * beschriftet und trägt seinen eigenen Infobutton — und 0 ist die konservative Richtung: sie
     * lässt den heutigen Tarif billiger aussehen als er ist und den aWATTar-Vorteil damit kleiner,
     * nicht grösser. Ein leeres Feld hätte hier den umgekehrten Preis: es würde beim Absenden als
     * Pflichtangabe eingefordert, obwohl viele Rechnungen die Gebühr gar nicht ausweisen.
     */
    if (rates.supplierBaseFeeEurPerMonth != null) {
      form = { ...form, supplierBaseFeeEurPerMonth: String(rates.supplierBaseFeeEurPerMonth) }
    }
  }

  /*
   * Der Nachttarif-Abschnitt wird nur aufgeklappt, wenn die Rechnung tatsächlich einen ausweist.
   * Ihn vorsorglich zu öffnen hiesse, dem Nutzer ein leeres Fenster-Paar (22:00–06:00) als Angabe
   * seiner Rechnung unterzuschieben — die Fenster stehen NICHT im Scan (Delta 9b-2a: Strukturen,
   * keine Beträge), sie sind unsere Vorbelegung.
   */
  const useNight = rates?.energyPriceNightCtPerKwh != null

  return { stichtag, form, scannedRateFields, netzbetreiber, netzebene, meteringVariant, useNight }
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

/**
 * Ein Betrag aus dem Preisblatt, wie ihn ein deutschsprachiger Leser erwartet.
 *
 * ⚠ Bewusst ohne feste Nachkommastellen: die Werte reichen von 0,109 (Netzverlust NE 3) bis 59,52
 * (Grundpreis NE 6), und eine gerundete Anzeige machte aus einem abgelesenen Satz eine andere Zahl
 * als die, mit der gerechnet wird. Dieselbe Lehre wie bei `formatRead` in B22c: was ABGELESEN
 * wurde, wird ungerundet gezeigt.
 */
function formatCt(value: number): string {
  return new Intl.NumberFormat('de-AT', { maximumFractionDigits: 6 }).format(value)
}

type PendingState = {
  reason: PendingReason
  netzbetreiber: NetzbetreiberId | null
  netzebene: Netzebene
  note?: string
}

/**
 * ⚠ B21-3d — DIE HARTKODIERTE AUSNAHME, und sie ist bewusst eine Zahl und keine Ableitung.
 *
 * Für Netzebene 7 gibt es bis zur Tarifverordnung (SNE-T-V) keine Leistungspreise. Das ist eine
 * REGULATORISCHE Tatsache und kein Zustand unserer Datenpflege — die Sperre darf deshalb NICHT
 * davon abhängen, ob in `public.grid_tariffs` zufällig eine NE-7-Zeile steht. Es steht dort heute
 * sogar eine (Wiener Netze, drei Messvarianten aus dem Preisblatt WN-EX0105): sie ist für den
 * kleinen, bereits lastprofilgemessenen Bestand richtig und für die Zielgruppe dieses Rechners auf
 * NE 7 die falsche Zahl — genau die Begründung, mit der `tariff-catalog.ts` sie als Vorgabewert
 * ausschliesst.
 *
 * Ausdrücklich NICHT über `hasMeteringVariant()` ausgedrückt, obwohl das heute dieselbe Menge
 * ergäbe: diese Liste beschreibt, welche Netzebenen eine Anschlussart-Dimension HABEN, nicht welche
 * regulatorisch offen sind. Käme dort eine zweite Netzebene dazu, verschöbe sich sonst still eine
 * Verweigerung mit.
 */
const REGULATION_PENDING_NETZEBENE = 7

/**
 * Der Netzentgelt-Stand zur gewählten Kombination (B21-3d) — der Zustand, der seit dem 07.09.2026
 * an die Stelle der synchronen Katalog-Abfrage tritt.
 *
 * `idle` heisst „es gibt nichts nachzuschlagen": keine Netzebene gewählt, ODER kein Netzbetreiber
 * gewählt. Der zweite Fall ist der Weg „Nicht angeben — Werte aus meiner Netzrechnung", und dort
 * gibt es nichts zu prüfen, weil es keinen Betreiber gibt, nach dessen Preisblatt man fragen könnte.
 */
type NetzentgeltState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'available'; prefill: GridTariffPrefill }
  /** Die Abfrage lief und lieferte KEINE Zeile — eine gültige Antwort, kein Fehler (B21-1). */
  | { kind: 'missing'; netzbetreiber: NetzbetreiberId; netzebene: Netzebene }
  /** Die Abfrage kam gar nicht durch — ein anderer Zustand, und deshalb eine andere Meldung. */
  | { kind: 'failed'; reason: 'not_configured' | 'request_failed' }

/** Ab welcher relativen Abweichung vom Vorgabewert ein neutraler Hinweis erscheint. */
const DEVIATION_THRESHOLD = 0.1

export function StepTariff({
  loadProfile,
  loadDataQuality,
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
  /**
   * B22b: die Datenqualität DESSELBEN Lastgangs. Gebraucht wird sie ausschliesslich für das
   * erzeugte Brutto-PV-Profil: es trägt dieselben Zeitstempel und damit dieselbe Abdeckung, und
   * sie dort neu zu berechnen wäre eine zweite Zahl über denselben Sachverhalt.
   */
  loadDataQuality: ParsedLoad['dataQuality']
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
  /*
   * B22b: die übernommene PV-Schätzung. `null` heisst „nicht geschätzt" — dann rechnet der Rechner
   * Zeile für Zeile wie vor B22.
   */
  const [estimatedPv, setEstimatedPv] = useState<EstimatedPvResult | null>(null)
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
  /*
   * Der Stichtag EINMAL bestimmt und danach festgehalten: `lookupTariffProfile` ist rein und
   * bekommt das Datum übergeben (dieselbe Regel wie im Rechenkern). Würde es bei jedem Render neu
   * gelesen, könnte eine Sitzung über Mitternacht hinweg still auf einen anderen Tarifsatz-Stand
   * wechseln — mitten in einer bereits vorbelegten Eingabe.
   *
   * ⚠ B21-3d: Er ist ab jetzt AUCH der Zeitpunkt, zu dem die Netzentgelt-Zeile gesucht wird — die
   * Abfrage läuft mit `periodStart = periodEnd = stichtag`, also über EINEN Tag: heute. Das ist
   * bewusst NICHT das Analysefenster aus Delta 15 Regel A, und die beiden beantworten verschiedene
   * Fragen. Hier geht es um eine VORBELEGUNG des Formulars: welcher Leistungspreis gilt für diesen
   * Anschluss gerade — dieselbe Frage, die der statische Katalog bisher mit demselben Stichtag
   * beantwortet hat. Der RECHNUNG liegt weiterhin der Lastgang-Zeitraum zugrunde
   * (`loadTariffPricing` unten, unverändert), und die kann über einen Tarifwechsel laufen und
   * mehrere Stände tragen. Ein Formularfeld kann das nicht — es hält genau eine Zahl.
   */
  const [stichtag] = useState(init.stichtag)

  /*
   * Delta 17 Teil 2 — der aus einer Freitext-Angabe BESTÄTIGTE Speicher.
   *
   * `null` ist der Normalfall und heisst „wie bisher": voller Katalog, Empfehlung, keine
   * Vorauswahl. Das Feld ist optional, und ohne Eingabe entsteht kein Netzaufruf.
   */
  const [existingBattery, setExistingBattery] = useState<ExistingBatteryInput | null>(null)

  const set = (k: keyof FormState) => (v: string) => setF((s) => ({ ...s, [k]: v }))

  /*
   * ── B21-3d: DER NETZENTGELT-STAND, ASYNCHRON ────────────────────────────────────────────────
   *
   * `queryKey` ist die Kombination, nach der gefragt wird — oder `null`, wenn es nichts zu fragen
   * gibt. Er wird SYNCHRON im Render gebildet und mit dem Schlüssel des gespeicherten Ergebnisses
   * verglichen (`netzentgelt` unten). Damit steht in derselben Sekunde, in der der Nutzer die
   * Auswahl ändert, der Ladezustand da — ohne dass ein Handler dafür `setState` rufen müsste und
   * ohne dass für einen Frame das Ergebnis der VORIGEN Kombination sichtbar wäre.
   *
   * ⚠ Das ersetzt zugleich jeden Wettlauf-Schutz im Effekt: eine verspätete Antwort trägt den
   * Schlüssel, unter dem sie angefordert wurde, und wird schlicht nicht mehr angezeigt. Ein
   * `cancelled`-Flag in der Aufräumfunktion wäre die schwächere Form derselben Sache — es kann
   * vergessen werden, ein Schlüsselvergleich nicht.
   */
  const netzebeneNum = netzebene === NOT_SET ? null : (Number(netzebene) as Netzebene)
  const isRegulationPending = netzebeneNum === REGULATION_PENDING_NETZEBENE
  const queryKey =
    netzebeneNum == null || isRegulationPending || netzbetreiber === NOT_SET
      ? null
      : `${netzbetreiber}|${netzebeneNum}`

  const [fetched, setFetched] = useState<{ key: string; state: NetzentgeltState } | null>(null)
  /** Hochgezählt vom „Erneut versuchen"-Knopf — die einzige Möglichkeit, eine Abfrage zu wiederholen. */
  const [retryToken, setRetryToken] = useState(0)

  const netzentgelt: NetzentgeltState =
    queryKey == null
      ? { kind: 'idle' }
      : fetched?.key === queryKey
        ? fetched.state
        : { kind: 'loading' }

  /**
   * Die Herkunftsangabe wird ABGELEITET statt als eigener Zustand geführt.
   *
   * Vorher war sie ein `useState`, das `applySelection` mitpflegen musste. Ein abgeleiteter Wert
   * kann nicht veralten: wechselt der Nutzer die Kombination, ist im selben Render auch die
   * Herkunft weg — statt für einen Moment die des vorigen Netzbetreibers zu zeigen.
   */
  const selection = netzentgelt.kind === 'available' ? netzentgelt.prefill.selection : null

  /*
   * ⚠ Das Abrechnungsmodell reist über ein Ref in die Vorbelegung, NICHT über die Abhängigkeitsliste
   * des Effekts. Als Abhängigkeit geführt liefe der Effekt bei jeder Änderung des Auswahlfelds neu
   * und überschriebe dabei den Leistungspreis, den der Nutzer inzwischen von Hand korrigiert hat.
   * Gebraucht wird der Wert ohnehin nur für einen Schnappschuss in `selection.defaults` — s. die
   * Begründung im Kopf von `gridTariffPrefill`.
   */
  const billingModelRef = useRef<BillingModel>(f.billingModel as BillingModel)
  billingModelRef.current = f.billingModel as BillingModel

  /*
   * Hat der Nutzer die Kombination selbst geändert? Solange nicht, gilt die Reihenfolge aus
   * `buildInitialTariffState`: ein aus der Rechnung GELESENER Satz schlägt die Vorbelegung
   * (Prinzip 1). Sobald er sie ändert, gilt wieder „Vorbelegen heisst ÜBERSCHREIBEN" — er will die
   * Werte des neu gewählten Stands sehen, nicht die des alten.
   */
  const selectionTouchedRef = useRef(false)

  const applyPrefillFields = useCallback((prefill: GridTariffPrefill) => {
    const protectedFields = selectionTouchedRef.current
      ? new Set<string>()
      : init.scannedRateFields
    setF((current) => ({
      ...current,
      ...(protectedFields.has('leistungspreisEurPerKwYear')
        ? {}
        : { leistungspreisEurPerKwYear: String(prefill.fields.leistungspreisEurPerKwYear) }),
      ...(protectedFields.has('minBillableKw')
        ? {}
        : { minBillableKw: String(prefill.fields.minBillableKw) }),
    }))
  }, [init.scannedRateFields])

  useEffect(() => {
    if (queryKey == null || netzbetreiber === NOT_SET || netzebeneNum == null) return

    void fetchGridTariffs(
      netzbetreiber,
      netzebeneNum,
      /*
       * ⚠ Immer `null`. Dieser Weg läuft ausschliesslich für die Netzebenen 3–6, und dort steht in
       * der Spalte `null` — die Abfrage filtert dann ausdrücklich auf `IS NULL` (B21-1,
       * `nulls not distinct`). Eine mitgeschickte Variante fände dort keine Zeile, und der Rechner
       * meldete „kein Tarifsatz hinterlegt", obwohl der Satz gepflegt ist.
       */
      null,
      stichtag,
      stichtag,
    ).then((result) => {
      if (!result.ok) {
        setFetched({ key: queryKey, state: { kind: 'failed', reason: result.reason } })
        return
      }
      /*
       * Die Datierungsregel wird NICHT hier nachgebaut: `findGridTariffRow` ist die massgebliche
       * Umsetzung (`valid_until` INKLUSIV, bei mehreren Treffern gewinnt die später beginnende) und
       * wird aus dem Rechenkern importiert. Die Abfrage filtert bereits auf den Stichtag; was
       * bleibt, ist der Gleichstand aus einem Eingriff von Hand — und den soll die Oberfläche
       * genauso entscheiden wie die Rechnung.
       */
      const row = findGridTariffRow(result.tariffs, stichtag)
      if (!row) {
        setFetched({
          key: queryKey,
          state: { kind: 'missing', netzbetreiber, netzebene: netzebeneNum },
        })
        return
      }
      const prefill = gridTariffPrefill({
        netzbetreiber,
        netzebene: netzebeneNum,
        row,
        currentBillingModel: billingModelRef.current,
      })
      setFetched({ key: queryKey, state: { kind: 'available', prefill } })
      applyPrefillFields(prefill)
    })
  }, [queryKey, netzbetreiber, netzebeneNum, stichtag, retryToken, applyPrefillFields])

  /**
   * Auswahl übernehmen.
   *
   * ⚠ Sie belegt seit B21-3d KEINE Felder mehr vor — das tut der Effekt oben, sobald die Antwort da
   * ist. Was hier bleibt, ist die Auswahl selbst und die eine Aufräumung, die nicht warten darf.
   */
  function applySelection(nextBetreiber: string, nextEbene: string) {
    if (nextBetreiber !== netzbetreiber || nextEbene !== netzebene) {
      selectionTouchedRef.current = true
    }
    setNetzbetreiber(nextBetreiber as NetzbetreiberId | typeof NOT_SET)
    setNetzebene(nextEbene)

    /*
     * Wechselt die Netzebene auf eine ohne Variante, wird die Auswahl zurückgenommen — sonst bliebe
     * ein unsichtbarer Wert stehen und liefe in die Abfrage. Das Feld ist dann nicht mehr sichtbar,
     * der Nutzer könnte ihn also gar nicht mehr korrigieren.
     */
    if (nextEbene === NOT_SET || !hasMeteringVariant(Number(nextEbene))) setMeteringVariant(NOT_SET)
  }

  /*
   * ── ⚠ NETZEBENE 7: DIE VERWEIGERUNG BLEIBT AM STATISCHEN KATALOG ────────────────────────────
   *
   * Hier steht die einzige verbliebene Benutzung von `lookupTariffProfile`/`pendingAcrossAllBetreiber`
   * in dieser Datei — und sie ist an `REGULATION_PENDING_NETZEBENE` gebunden, nicht an das Ergebnis
   * einer Abfrage. Läge in `public.grid_tariffs` eine NE-7-Zeile (und es liegt eine dort), änderte
   * das an dieser Sperre nichts: das Fehlen ist regulatorisch, nicht redaktionell.
   *
   * Ohne Netzbetreiber wird die Frage über ALLE geführten Netzbetreiber beantwortet — Netzebene 7
   * steht überall aus, und diese Aussage erst nach einer zusätzlichen Auswahl zu machen wäre eine
   * Hürde ohne Ertrag.
   *
   * ⚠ BENANNTE VERHALTENSÄNDERUNG für die Netzebenen 3–6: dort greift `pendingAcrossAllBetreiber`
   * ab jetzt NICHT mehr. Wer nur eine Netzebene wählt und beim Netzbetreiber „Nicht angeben" stehen
   * lässt, wird nicht mehr gesperrt. Das ist die Folge der Umstellung und keine Nachlässigkeit:
   * gefragt wird ab jetzt nach dem Preisblatt EINES Betreibers, und wer keinen nennt, ist auf dem
   * Weg „Werte aus meiner Netzrechnung" — dort gibt es nichts nachzuschlagen und deshalb auch
   * nichts zu verweigern. (Bis heute sperrte diese Kombination für NE 4/5/6, weil der statische
   * Katalog sie bei allen drei Betreibern als `not_yet_recorded` führt.)
   */
  const pending: PendingState | null = (() => {
    if (!isRegulationPending || netzebeneNum == null) return null

    if (netzbetreiber === NOT_SET) {
      const reason = pendingAcrossAllBetreiber(netzebeneNum, stichtag)
      return reason ? { reason, netzbetreiber: null, netzebene: netzebeneNum } : null
    }

    const result = lookupTariffProfile({ netzbetreiber, netzebene: netzebeneNum, on: stichtag })
    return result.status === 'pending_regulation'
      ? {
          reason: result.profile.reason,
          netzbetreiber,
          netzebene: netzebeneNum,
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

  /*
   * ── ⚠ WAS SPERRT, UND WARUM DER FEHLERFALL DAZUGEHÖRT ──────────────────────────────────────
   *
   * Der NE-7-Zweig ist unverändert (`pending` samt der Delta-9a-Aufhebung durch „ohne
   * Leistungsmessung"). Dazu kommen drei Zustände des Datenbankwegs, und alle drei sperren:
   *
   *   `loading`  — solange nicht feststeht, ob ein Satz vorliegt, stünde im Feld der Vorgabewert
   *                90 €/kW·a aus `initial`. Wer in dieser Sekunde startet, rechnet mit einer Zahl,
   *                die nie jemand für ihn nachgeschlagen hat.
   *   `missing`  — dieselbe Aussage wie B11 bisher: ohne belegten Satz wird nicht gerechnet.
   *   `failed`   — ⚠ und das ist die bewusste, unbequeme Entscheidung. Ein Rückfall auf den
   *                statischen Katalog wäre die gefährlichste Variante (eine Zahl, die ihren Stand
   *                nicht kennt), ein stilles Freischalten die zweitgefährlichste (der Vorgabewert
   *                90 sähe aus wie ein nachgeschlagener Satz). Es bleibt: laut sperren und den
   *                Ausweg nennen — „Nicht angeben — Werte aus meiner Netzrechnung" ist einen Klick
   *                entfernt und steht im Text der Meldung.
   *
   * Der Preis dieser Entscheidung ist benannt: fehlt die Supabase-Umgebung (lokal ohne
   * `.env.local`), ist die Netzbetreiber-Auswahl unbenutzbar. Der Rechner selbst bleibt es nicht —
   * über „Nicht angeben" läuft er vollständig, wie er es vor B11 tat.
   */
  const blocked =
    (pending != null && !noPowerMeasurement) ||
    netzentgelt.kind === 'loading' ||
    netzentgelt.kind === 'missing' ||
    netzentgelt.kind === 'failed'

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
      /*
       * B22b — EINE MESSUNG SCHLÄGT EINE SCHÄTZUNG (Prinzip 1), und der Zustand muss AUSSCHLIESSEND
       * sein: stünden beide nebeneinander, entschiede die Reihenfolge im `onComplete`, welche
       * gilt. Wer eine gemessene Brutto-PV nachreicht, verwirft die Schätzung damit ausdrücklich —
       * sichtbar, weil das Schätzformular an dieser Stelle verschwindet.
       */
      setEstimatedPv(null)
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
      /*
       * Delta 19: leer gelassen heisst „keine Angabe" — dann reist das Feld gar nicht mit und die
       * Engine rechnet mit 0. Eine 0 zu schicken wäre inhaltlich dasselbe; sie NICHT zu schicken
       * hält im Analyse-Bündel (Fassung 5) den Unterschied zwischen „mit 0 gerechnet, weil nichts
       * angegeben" und „ausdrücklich 0 angegeben" offen.
       */
      ...(f.supplierBaseFeeEurPerMonth.trim() === ''
        ? {}
        : { supplierBaseFeeEurPerMonth: parseNum(f.supplierBaseFeeEurPerMonth) }),
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
      /*
       * B22b: die geschätzte Brutto-PV tritt an die Stelle einer hochgeladenen Datei. Beides
       * zugleich kann nicht vorkommen — der Generator wird bei vorhandenem PV-Profil gar nicht
       * angeboten (s. die Verzweigung im PV-Abschnitt unten): wer ein PV-Profil hat, hat eine
       * Anlage, und deren Wirkung steckt bereits in seinem Lastgang.
       */
      pv: estimatedPv ? estimatedPv.pv : pv,
      ...(estimatedPv ? { estimatedPv } : {}),
      pvError,
      /*
       * Delta 17 Teil 2: `undefined` statt `null`, wenn nichts bestätigt wurde — dann trägt der
       * Payload das Feld gar nicht, und der Worker verhält sich Zeile für Zeile wie vorher.
       */
      ...(existingBattery ? { existingBattery } : {}),
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
          {netzentgelt.kind === 'available' && (
            <div className="flex flex-col gap-1" data-testid="tarif-herkunft">
              <p className="text-xs text-text-muted">
                Vorbelegt aus „{netzentgelt.prefill.operatorLabel}“, Netzebene{' '}
                {netzentgelt.prefill.selection.netzebene} (Preisblatt-Stand gültig ab{' '}
                <Num>{netzentgelt.prefill.validFrom}</Num>):{' '}
                {netzentgelt.prefill.grundpreisIsLeistungspreis ? (
                  <>
                    Leistungspreis <Num>{formatCt(netzentgelt.prefill.grundpreisAmount)}</Num>{' '}
                    €/kW·a
                  </>
                ) : (
                  <>
                    Grundpreis <Num>{formatCt(netzentgelt.prefill.grundpreisAmount)}</Num> €/Jahr —
                    eine Jahrespauschale und kein Leistungspreis, deshalb steht unten 0
                  </>
                )}
                . Ihre Netzrechnung schlägt diesen Stand — alle Felder unten bleiben editierbar.
              </p>
              {/*
                ⚠ Netz-Arbeitspreis und Netzverlust stehen hier als ANGABE und in KEINEM Feld.
                Das Feld „Arbeitspreis" unten ist der Preis des STROMLIEFERANTEN; eine Netz-Zahl
                dort wäre an der falschen Stelle und ginge als Eigenverbrauchswert in jede Ersparnis
                ein. Ihren Weg in die Rechnung nehmen die beiden bereits über den Vergleich mit den
                Börsen-Strompreisen (Delta 4) — sie hier zusätzlich einzutragen hiesse, sie doppelt
                zu zählen. Sie stehen trotzdem da, weil der Kunde sehen soll, mit welchem Stand
                gerechnet wird (Prinzip 5).
              */}
              {netzentgelt.prefill.netzArbeitspreisCtPerKwh != null && (
                <p className="text-xs text-text-muted">
                  Aus demselben Stand, aber ohne eigenes Feld: Netz-Arbeitspreis{' '}
                  <Num>{formatCt(netzentgelt.prefill.netzArbeitspreisCtPerKwh)}</Num> ct/kWh
                  {netzentgelt.prefill.windowCount > 1
                    ? ` (Grundfenster; der Stand trägt ${netzentgelt.prefill.windowCount} Zeitfenster)`
                    : ''}{' '}
                  und Netzverlustentgelt{' '}
                  <Num>{formatCt(netzentgelt.prefill.netzverlustCtPerKwh)}</Num> ct/kWh. Beide gehen
                  in den Vergleich mit den Börsen-Strompreisen ein, nicht in den Arbeitspreis unten.
                </p>
              )}
              {/*
                Das Abrechnungsmodell ist ausdrücklich NICHT vorbelegt: ein Preisblatt nennt Preise,
                nicht die Regel, nach der der abgerechnete kW-Wert gebildet wird (§3.5, OP#3). Es
                stillschweigend aus dem Preisblatt herzuleiten wäre eine Aussage, die das Preisblatt
                nicht macht.
              */}
              <p className="text-xs text-text-muted">
                Das Abrechnungsmodell steht nicht im Preisblatt — es kommt von Ihrer Netzrechnung.
                Bitte unten prüfen.
              </p>
            </div>
          )}

          {/*
            Delta 9a + B21-3d: Aussagen, die einander ausschliessen, in der Reihenfolge ihrer Bedingung.

            Zuerst die offene Messvariante — solange sie fehlt, wissen wir nicht, welche der beiden
            anderen gilt, und die Regulierungslücke samt Warteliste hier vorwegzunehmen wäre für
            jeden Anschluss ohne Leistungsmessung schlicht die falsche Auskunft. Danach „ohne
            Leistungsmessung": es fehlt nichts, es gilt nur ein anderer Tarifaufbau. Zuletzt die
            Verweigerung, inhaltlich unverändert — nur der Zeitpunkt hat sich verschoben.

            Die drei letzten Zweige gehören dem Datenbankweg (NE 3–6) und sind damit von den drei
            oberen disjunkt: `pending` entsteht ausschliesslich auf Netzebene 7, und dort wird gar
            nicht abgefragt. Die Reihenfolge ist trotzdem so, wie sie ist — eine Verweigerung aus
            regulatorischem Grund darf niemals hinter einem Ladezustand verschwinden.
          */}
          {meteringVariantOpen ? (
            <TarifMessvarianteOffen netzebene={Number(netzebene)} />
          ) : noPowerMeasurement ? (
            <TarifOhneLeistungsmessung />
          ) : pending ? (
            <TarifNichtVerfuegbar
              reason={pending.reason}
              netzbetreiber={pending.netzbetreiber}
              netzebene={pending.netzebene}
              note={pending.note}
            />
          ) : netzentgelt.kind === 'loading' ? (
            <NetzentgeltWirdGeprueft />
          ) : netzentgelt.kind === 'missing' ? (
            <NetzentgeltNichtHinterlegt
              netzbetreiber={netzentgelt.netzbetreiber}
              netzebene={netzentgelt.netzebene}
            />
          ) : netzentgelt.kind === 'failed' ? (
            <NetzentgeltNichtAbrufbar
              reason={netzentgelt.reason}
              onRetry={() => setRetryToken((n) => n + 1)}
            />
          ) : null}

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
          <BatteryTextPanel existing={existingBattery} onExisting={setExistingBattery} />
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
          {/*
            ── Delta 19: die Grundgebühr des heutigen Lieferanten ────────────────────────────────
            Optional und mit Vorgabewert 0. Sie geht ausdrücklich NICHT in die Batterie-Ersparnis
            ein (sie fällt mit und ohne Speicher gleich hoch an), sondern ausschliesslich in den
            Tarifvergleich — genau dort ist sie relevant, weil ein Wechsel die eine Gebühr gegen
            die andere tauscht. Der Infobutton sagt beides, damit niemand erwartet, dass sich die
            Amortisation dadurch bewegt.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <LabelWithInfo htmlFor="supplierBaseFee" label="Grundgebühr Ihres Stromlieferanten">
                Der feste Betrag, den Ihr heutiger Stromlieferant unabhängig vom Verbrauch je Monat
                verrechnet — auf Ihrer Rechnung meist als „Grundgebühr" oder „Grundpreis" des
                Lieferanten ausgewiesen, netto. Nicht gemeint ist der Grundpreis Ihres
                NETZbetreibers: der hängt am Anschluss und ändert sich durch einen Anbieterwechsel
                nicht. Diese Gebühr beeinflusst die Wirtschaftlichkeit des Speichers nicht (sie
                fällt mit und ohne Speicher gleich hoch an), wohl aber den Vergleich mit einem
                anderen Stromvertrag: dort tauschen Sie sie gegen die des neuen Anbieters. Ohne
                Angabe rechnen wir mit 0 — dann sieht Ihr heutiger Tarif eher zu günstig aus als zu
                teuer.
              </LabelWithInfo>
              <div className="relative">
                <Input
                  id="supplierBaseFee"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  value={f.supplierBaseFeeEurPerMonth}
                  onChange={(e) => set('supplierBaseFeeEurPerMonth')(e.target.value)}
                  className="pr-20"
                  aria-invalid={errors.supplierBaseFeeEurPerMonth ? true : undefined}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">
                  €/Monat
                </span>
              </div>
              {errors.supplierBaseFeeEurPerMonth && (
                <span className="text-xs text-negative">
                  {errors.supplierBaseFeeEurPerMonth}
                </span>
              )}
            </div>
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
          {/*
            ── B22b: SCHÄTZEN ODER MESSEN, NIE BEIDES ─────────────────────────────────────────
            Der Generator erscheint NUR, solange keine PV-Datei gelesen wurde — und das ist keine
            Bequemlichkeit, sondern Physik: wer ein Brutto-PV-Profil hat, HAT eine Anlage, und
            deren Erzeugung steckt bereits in seinem Lastgang (bei `import_only` unsichtbar im
            gesenkten Bezug). Eine geschätzte Kurve zusätzlich abzuziehen zöge dieselbe Energie ein
            zweites Mal ab. Umgekehrt bleibt der Datei-Upload sichtbar und benutzbar: eine Messung
            schlägt eine Schätzung (Prinzip 1), und wer die Datei nachreicht, verwirft damit die
            Schätzung ausdrücklich.
          */}
          {pv == null && (
            <PvDesignPanel
              loadProfile={loadProfile}
              dataQuality={loadDataQuality}
              applied={estimatedPv}
              onApply={setEstimatedPv}
              onClear={() => setEstimatedPv(null)}
            />
          )}
          {estimatedPv && (
            <p className="text-xs text-text-muted">
              Sie rechnen mit einer geschätzten Erzeugung. Laden Sie ein gemessenes
              Wechselrichter-Profil hoch, ersetzt es die Schätzung — eine Messung schlägt eine
              Schätzung.
            </p>
          )}
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
            {pricingBusy
              ? 'Preisdaten werden geladen …'
              : netzentgelt.kind === 'loading'
                ? 'Preisblatt wird geprüft …'
                : 'Analyse starten'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
