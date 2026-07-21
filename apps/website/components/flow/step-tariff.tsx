'use client'

import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import { parsePvProfile } from 'engine'
import {
  NETZBETREIBER_IDS,
  NETZBETREIBER_LABELS,
  NETZEBENEN,
  financialParamsSchema,
  lookupTariffProfile,
  pendingAcrossAllBetreiber,
  tariffParamsSchema,
  tariffSelectionFrom,
  type FinancialParams,
  type Netzebene,
  type NetzbetreiberId,
  type PendingReason,
  type TariffParams,
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
import { Num } from '@/components/report/num'
import { parseNum, percentHint } from '@/lib/form-utils'
import { FileDrop } from './file-drop'
import { TarifNichtVerfuegbar } from './tarif-nicht-verfuegbar'
import type { ParsedPv, TariffResult } from './types'

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
  onBack,
  onComplete,
}: {
  onBack: () => void
  onComplete: (result: TariffResult) => void
}) {
  const [f, setF] = useState<FormState>(initial)
  const [useNight, setUseNight] = useState(false)
  const [pvName, setPvName] = useState<string | null>(null)
  const [pv, setPv] = useState<ParsedPv | null>(null)
  const [pvIssue, setPvIssue] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── B11: Netzbetreiber & Netzebene ────────────────────────────────────────────────────────────
  const [netzbetreiber, setNetzbetreiber] = useState<NetzbetreiberId | typeof NOT_SET>(NOT_SET)
  const [netzebene, setNetzebene] = useState<string>(NOT_SET)
  /** Gesetzt, sobald eine Kombination MIT Sätzen vorbelegt hat — trägt die Vorgabewerte von damals. */
  const [selection, setSelection] = useState<TariffSelection | null>(null)
  /*
   * Der Stichtag EINMAL bestimmt und danach festgehalten: `lookupTariffProfile` ist rein und
   * bekommt das Datum übergeben (dieselbe Regel wie im Rechenkern). Würde es bei jedem Render neu
   * gelesen, könnte eine Sitzung über Mitternacht hinweg still auf einen anderen Tarifsatz-Stand
   * wechseln — mitten in einer bereits vorbelegten Eingabe.
   */
  const [stichtag] = useState(() => new Date().toISOString().slice(0, 10))

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

    if (nextBetreiber === NOT_SET || nextEbene === NOT_SET) {
      setSelection(null)
      return
    }

    const result = lookupTariffProfile({
      netzbetreiber: nextBetreiber as NetzbetreiberId,
      netzebene: Number(nextEbene) as Netzebene,
      on: stichtag,
    })

    if (result.status !== 'available') {
      setSelection(null)
      return
    }

    setF((s) => ({
      ...s,
      leistungspreisEurPerKwYear: String(result.profile.leistungspreisEurPerKwYear),
      minBillableKw: String(result.profile.minBillableKw),
      billingModel: result.profile.billingModel,
    }))
    setSelection(tariffSelectionFrom(result.set, result.profile))
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

  function handleSubmit() {
    /*
     * B11, TEIL 4: Zu einer Kombination ohne Leistungspreis wird NICHT gerechnet. Die Sperre sitzt
     * hier UND am Knopf — der Knopf ist die sichtbare Hälfte, diese Zeile die wirksame.
     */
    if (pending) return

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
    onComplete({
      tariff: tRes.data as TariffParams,
      financial,
      pv,
      pvError,
      // B11: die Herkunft der Vorgabewerte reist mit — sie steht dauerhaft im Report und im
      // Analyse-Bündel (Fassung 2). `undefined`, wenn kein Netzbetreiber gewählt wurde: dann
      // stammen die Werte direkt aus der Netzrechnung, und das ist eine eigene Aussage.
      tariffSelection: selection ?? undefined,
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
              <Label htmlFor="netzbetreiber">Netzbetreiber</Label>
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
              <Label htmlFor="netzebene">Netzebene</Label>
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

          {pending && (
            <TarifNichtVerfuegbar
              reason={pending.reason}
              netzbetreiber={pending.netzbetreiber}
              netzebene={pending.netzebene}
              note={pending.note}
            />
          )}
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
          <Button onClick={handleSubmit} disabled={pending != null}>
            Analyse starten
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
