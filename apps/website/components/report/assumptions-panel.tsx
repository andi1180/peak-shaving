'use client'

import { useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  financialParamsSchema,
  type BatteryCandidate,
  type BatteryOverrideSource,
  type BillingModel,
  type FinancialParams,
  type TariffParams,
} from 'shared'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatEur2 } from '@/lib/format'
import { parseNum, percentHint } from '@/lib/form-utils'
import type { RecomputeInput } from '@/components/flow/types'
import { Num } from './num'

const DEBOUNCE_MS = 350

function AssumptionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <Num className="font-medium text-ink">{value}</Num>
    </div>
  )
}

/**
 * Editierbares Annahmen-Panel (§6.2): "Wirkungsgrad, Entladetiefe, Batteriepreis, Abschreibung,
 * Förderung, Abrechnungsmodell → Ergebnis rechnet live neu." Entladetiefe bewusst NICHT
 * editierbar — `BatteryCandidate.usableCapacityKwh` ist bereits die NUTZBARE (DoD-bereinigte)
 * Kapazität (packages/shared/src/battery.ts-Kommentar), eine separate DoD-Eingabe hätte keinen
 * eigenen Rechenkern-Eingang und würde nur eine zweite, konkurrierende Zahl vortäuschen (CLAUDE.md
 * „NICHT: Entladetiefe" — bewusste Scope-Entscheidung, kein stilles Weglassen).
 *
 * Jede Änderung baut die VOLLSTÄNDIGE `RecomputeInput` (Architektur-Vorgabe: immer der ganze
 * Katalog über `recommendBattery`, s. use-analysis.ts/analysis.worker.ts) und übergibt sie nach
 * oben. Zod-validiert wie im Tarif-Formular (§5) — ungültige Eingaben lösen KEINE Neuberechnung
 * aus, sondern eine Inline-Fehlermeldung.
 */
export function AssumptionsPanel({
  originalTariff,
  originalFinancial,
  originalHorizonYears,
  originalBattery,
  effectiveFinancial,
  effectiveHorizonYears,
  liveBillingModel,
  selectedBatteryName,
  batterySource,
  isEdited,
  recomputing,
  recomputeError,
  onRecompute,
  onReset,
}: {
  originalTariff: TariffParams
  originalFinancial?: FinancialParams
  originalHorizonYears: number
  originalBattery: BatteryCandidate
  /**
   * Delta 18 — der WIRKSAME Stand, ausschliesslich als VORBELEGUNG der Felder.
   *
   * ⚠ Bewusst getrennt von `original*`: die sind das Ziel von „Zurücksetzen" (§6.2
   * „Reset-auf-Original-Kontrolle") und dürfen dem wirksamen Stand nicht nachwandern, sonst gäbe
   * es nichts mehr zurückzusetzen. Beim ersten Aufbau sind beide gleich; sie fallen erst
   * auseinander, wenn die Report-Anfrage (Delta 18) etwas geändert hat und das Panel deshalb mit
   * neuem Schlüssel neu aufgebaut wird.
   */
  effectiveFinancial?: FinancialParams
  effectiveHorizonYears: number
  /** `billingModel` des aktuell angezeigten (ggf. live neu berechneten) Ergebnisses — die EINE
   * Wahrheit. Das Panel spiegelt ihn (s. Sync unten), damit der Teiljahres-Shortcut oben (report.tsx)
   * und dieses Dropdown NIE auseinanderlaufen (kein zweiter Umschalt-Zustand). */
  liveBillingModel: BillingModel
  selectedBatteryName: string
  /**
   * Herkunft der GERADE BEARBEITETEN Batterie (`originalBattery`) — vom Report gesetzt, nicht hier
   * erfunden.
   *
   * ⚠ Seit dem 01.09.2026 ist hier ausschliesslich ein KATALOG-Gerät bearbeitbar: die bestehende
   * Anlage des Kunden wird ausserhalb von `perBattery` simuliert und lässt sich im Panel gar nicht
   * auswählen. Der Report übergibt deshalb konstant `catalog_preset`; das Feld bleibt, weil das
   * Analyse-Bündel es seit Fassung 3 führt.
   *
   * ⚠ Das Panel darf sie nicht selbst raten: es sieht nur einen Katalog-Eintrag, und ob der dem
   * Kunden bereits gehört, steht ausschliesslich im Override. Gäbe es hier einen Vorgabewert,
   * verlöre eine korrigierte Bestandsanlage mit dem ersten Tastendruck ihre Herkunft und stünde
   * im Report wieder mit Investition und Amortisation da.
   */
  batterySource: BatteryOverrideSource
  isEdited: boolean
  recomputing: boolean
  recomputeError: string | null
  onRecompute: (input: RecomputeInput) => void
  onReset: () => void
}) {
  // Init aus dem ANGEZEIGTEN Ergebnis (nicht dem Original): klappt der Nutzer das Panel ERST nach
  // einem Umschalten (Teiljahres-Shortcut oben) auf, mountet es frisch und muss den aktuellen
  // `billingModel` zeigen — nicht den ursprünglichen. Der Sync unten deckt den bereits gemounteten Fall.
  const [billingModel, setBillingModel] = useState<BillingModel>(liveBillingModel)
  // Delta 18: Vorbelegung aus dem WIRKSAMEN Stand (s. `effectiveFinancial`/`effectiveHorizonYears`).
  // `handleReset` unten stellt weiterhin `original*` her — die beiden Rollen sind getrennt.
  const [horizonYears, setHorizonYears] = useState(String(effectiveHorizonYears))
  const [subsidyPercent, setSubsidyPercent] = useState(
    String(effectiveFinancial?.subsidyPercent ?? ''),
  )
  const [fixedSubsidyEur, setFixedSubsidyEur] = useState(
    String(effectiveFinancial?.fixedSubsidyEur ?? ''),
  )
  const [depreciationYears, setDepreciationYears] = useState(
    String(effectiveFinancial?.depreciationYears ?? ''),
  )
  const [taxRatePercent, setTaxRatePercent] = useState(
    String(effectiveFinancial?.taxRatePercent ?? ''),
  )
  const [efficiencyPercent, setEfficiencyPercent] = useState(
    String(originalBattery.roundTripEfficiency * 100),
  )
  const [pricePerKwh, setPricePerKwh] = useState(String(originalBattery.pricePerKwh))
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Wechselt der Nutzer die im Energiefluss-Chart ausgewählte Batterie, gehören die beiden
  // Batterie-Felder wieder zu einem ANDEREN Kandidaten — auf dessen Original-Werte zurücksetzen
  // (nur EIN Override gleichzeitig aktiv, Architektur-Vorgabe). Reiner Wertevergleich in der
  // Render-Phase statt Effect: einfacher, kein Abhängigkeits-Array zu pflegen.
  const lastBatteryIdRef = useRef(originalBattery.id)
  if (lastBatteryIdRef.current !== originalBattery.id) {
    lastBatteryIdRef.current = originalBattery.id
    setEfficiencyPercent(String(originalBattery.roundTripEfficiency * 100))
    setPricePerKwh(String(originalBattery.pricePerKwh))
  }

  // Spiegelt den `billingModel` des Ergebnisses in das lokale Dropdown — dieselbe Render-Phasen-
  // Technik wie der Batterie-Sync oben. Feuert NUR, wenn sich der ERGEBNIS-Wert ändert (Shortcut oben
  // ODER Reset), nicht bei laufender Dropdown-Auswahl (dort führt das lokale setState). Verhindert den
  // Divergenz-Bug: ohne Sync würde ein Feld-Edit NACH dem Shortcut den `billingModel` aus dem stale
  // lokalen State zurück auf `monthly` kippen (computeAndSend führt `billingModel` bei JEDEM Recompute mit).
  const lastLiveBillingModelRef = useRef(liveBillingModel)
  if (lastLiveBillingModelRef.current !== liveBillingModel) {
    lastLiveBillingModelRef.current = liveBillingModel
    setBillingModel(liveBillingModel)
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  type Fields = {
    billingModel: BillingModel
    horizonYears: string
    subsidyPercent: string
    fixedSubsidyEur: string
    depreciationYears: string
    taxRatePercent: string
    efficiencyPercent: string
    pricePerKwh: string
  }

  function computeAndSend(overrides: Partial<Fields>) {
    const f: Fields = {
      billingModel,
      horizonYears,
      subsidyPercent,
      fixedSubsidyEur,
      depreciationYears,
      taxRatePercent,
      efficiencyPercent,
      pricePerKwh,
      ...overrides,
    }

    const errs: Record<string, string> = {}

    const horizon = parseNum(f.horizonYears)
    if (!Number.isFinite(horizon) || horizon <= 0) {
      errs.horizonYears = 'Bitte einen gültigen Wert eingeben'
    }

    const eff = parseNum(f.efficiencyPercent)
    if (!Number.isFinite(eff) || eff <= 0 || eff > 100) {
      errs.efficiencyPercent = 'Wirkungsgrad zwischen 0 und 100 %'
    }

    const price = parseNum(f.pricePerKwh)
    if (!Number.isFinite(price) || price < 0) {
      errs.pricePerKwh = 'Bitte einen gültigen Preis eingeben'
    }

    const financialRaw: Record<string, unknown> = {}
    if (f.subsidyPercent.trim() !== '') financialRaw.subsidyPercent = parseNum(f.subsidyPercent)
    if (f.fixedSubsidyEur.trim() !== '') financialRaw.fixedSubsidyEur = parseNum(f.fixedSubsidyEur)
    if (f.depreciationYears.trim() !== '')
      financialRaw.depreciationYears = parseNum(f.depreciationYears)
    if (f.taxRatePercent.trim() !== '') financialRaw.taxRatePercent = parseNum(f.taxRatePercent)
    // Nicht in diesem Panel editierbare Original-Felder unverändert mitführen (§6.2-Scope: nur
    // subsidyPercent/fixedSubsidyEur/depreciationYears/taxRatePercent/billingModel/horizonYears).
    // Delta 18: aus dem WIRKSAMEN Stand, nicht aus `original*` — sonst fielen die beiden Felder
    // nach einer Änderung per Freitext still weg.
    if (effectiveFinancial?.investitionsfreibetragPercent != null) {
      financialRaw.investitionsfreibetragPercent = effectiveFinancial.investitionsfreibetragPercent
    }
    if (effectiveFinancial?.note) financialRaw.note = effectiveFinancial.note

    let financial: FinancialParams | undefined
    if (Object.keys(financialRaw).length > 0) {
      const parsed = financialParamsSchema.safeParse(financialRaw)
      if (!parsed.success) {
        for (const iss of parsed.error.issues) {
          const k = String(iss.path[0] ?? '')
          if (k && !errs[k]) errs[k] = 'Bitte einen gültigen Wert (0–100 %) eingeben'
        }
      } else {
        financial = parsed.data
      }
    }

    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    const tariff: TariffParams = { ...originalTariff, billingModel: f.billingModel }
    const efficiencyFraction = eff / 100
    const batteryOverride =
      efficiencyFraction !== originalBattery.roundTripEfficiency ||
      price !== originalBattery.pricePerKwh
        ? {
            batteryId: originalBattery.id,
            roundTripEfficiency: efficiencyFraction,
            pricePerKwh: price,
            // Korrigierte Zahlen ändern nicht, WEM das Gerät gehört — die Herkunft kommt
            // unverändert von aussen (s. `batterySource`), nicht aus den geänderten Zahlen.
            source: batterySource,
          }
        : undefined

    onRecompute({ tariff, financial, horizonYears: horizon, batteryOverride })
  }

  function scheduleRecompute(overrides: Partial<Fields>) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => computeAndSend(overrides), DEBOUNCE_MS)
  }

  function handleReset() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setBillingModel(originalTariff.billingModel)
    setHorizonYears(String(originalHorizonYears))
    setSubsidyPercent(String(originalFinancial?.subsidyPercent ?? ''))
    setFixedSubsidyEur(String(originalFinancial?.fixedSubsidyEur ?? ''))
    setDepreciationYears(String(originalFinancial?.depreciationYears ?? ''))
    setTaxRatePercent(String(originalFinancial?.taxRatePercent ?? ''))
    setEfficiencyPercent(String(originalBattery.roundTripEfficiency * 100))
    setPricePerKwh(String(originalBattery.pricePerKwh))
    setErrors({})
    onReset()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">
          Änderungen rechnen den gesamten Katalog live neu (§6.2) — kein Postback, läuft im
          Hintergrund-Worker.
        </p>
        <div className="flex items-center gap-2">
          {recomputing && <span className="text-xs text-text-muted">Rechnet neu …</span>}
          {isEdited && !recomputing && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Zurücksetzen
            </Button>
          )}
        </div>
      </div>

      {recomputeError && (
        <Alert variant="destructive">
          <AlertDescription>{recomputeError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assumption-billingModel">Abrechnungsmodell</Label>
          <Select
            value={billingModel}
            onValueChange={(v) => {
              const bm = v as BillingModel
              setBillingModel(bm)
              computeAndSend({ billingModel: bm })
            }}
          >
            <SelectTrigger id="assumption-billingModel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly_max_average">Mittel der 12 Monatshöchstwerte</SelectItem>
              <SelectItem value="annual_max">Jahreshöchstwert</SelectItem>
              <SelectItem value="monthly_max_sum">Summe der 12 Monatshöchstwerte</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <NumberField
          id="assumption-horizonYears"
          label="Betrachtungshorizont"
          unit="Jahre"
          value={horizonYears}
          onChange={(v) => {
            setHorizonYears(v)
            scheduleRecompute({ horizonYears: v })
          }}
          error={errors.horizonYears}
        />

        <NumberField
          id="assumption-efficiency"
          label={`Wirkungsgrad (${selectedBatteryName})`}
          unit="%"
          value={efficiencyPercent}
          onChange={(v) => {
            setEfficiencyPercent(v)
            scheduleRecompute({ efficiencyPercent: v })
          }}
          error={errors.efficiencyPercent}
        />

        <NumberField
          id="assumption-pricePerKwh"
          label={`Batteriepreis (${selectedBatteryName})`}
          unit="€/kWh"
          value={pricePerKwh}
          onChange={(v) => {
            setPricePerKwh(v)
            scheduleRecompute({ pricePerKwh: v })
          }}
          error={errors.pricePerKwh}
        />

        <NumberField
          id="assumption-fixedSubsidyEur"
          label="Pauschale Förderung"
          unit="€"
          value={fixedSubsidyEur}
          onChange={(v) => {
            setFixedSubsidyEur(v)
            scheduleRecompute({ fixedSubsidyEur: v })
          }}
          error={errors.fixedSubsidyEur}
        />

        <NumberField
          id="assumption-subsidyPercent"
          label="Förderung"
          unit="%"
          value={subsidyPercent}
          onChange={(v) => {
            setSubsidyPercent(v)
            scheduleRecompute({ subsidyPercent: v })
          }}
          error={errors.subsidyPercent}
          hint={percentHint(subsidyPercent)}
        />

        <NumberField
          id="assumption-depreciationYears"
          label="Abschreibungsdauer (AfA)"
          unit="Jahre"
          value={depreciationYears}
          onChange={(v) => {
            setDepreciationYears(v)
            scheduleRecompute({ depreciationYears: v })
          }}
          error={errors.depreciationYears}
        />

        <NumberField
          id="assumption-taxRatePercent"
          label="Steuersatz (Grenzsteuer/KöSt)"
          unit="%"
          value={taxRatePercent}
          onChange={(v) => {
            setTaxRatePercent(v)
            scheduleRecompute({ taxRatePercent: v })
          }}
          error={errors.taxRatePercent}
          hint={percentHint(taxRatePercent)}
        />
      </div>

      <div className="divide-y divide-border border-t border-border pt-1">
        <AssumptionRow
          label="Arbeitspreis"
          value={`${formatEur2(originalTariff.energyPriceCtPerKwh / 100)} / kWh`}
        />
        <AssumptionRow
          label="Einspeisevergütung"
          value={`${formatEur2(originalTariff.einspeiseverguetungCtPerKwh / 100)} / kWh`}
        />
      </div>
      <p className="text-xs text-text-muted">
        Arbeitspreis, Einspeisevergütung und Entladetiefe sind hier nicht editierbar — Entladetiefe
        hat keinen eigenen Rechenkern-Eingang (steckt bereits in der nutzbaren Kapazität jedes
        Katalog-Kandidaten), die Preise stammen unverändert aus Ihrer Netzrechnung (§3.1).
      </p>
    </div>
  )
}
