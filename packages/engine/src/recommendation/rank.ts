import type {
  AnalysisResult,
  BatteryCandidate,
  FinancialParams,
  LoadProfile,
  PvProfile,
  TariffParams,
} from 'shared'

import { topPeaksKw } from '../peaks/metrics'
import { calculateRoi } from '../roi/roi'
import { computeBatterySavings } from '../savings/attribute'
import { drawSeries, intervalIndicesByPeriod, maxPositiveDraw, periodIndexByInterval } from '../simulation/helpers'
import { simulateBattery } from '../simulation/simulate'
import { buildDispatchTrace } from '../simulation/trace'

/**
 * Empfehlung & Ranking über den Katalog (§3.8). Reine Engine-Logik, keine Worker-/UI-
 * Verdrahtung. Verkettet für JEDEN Katalog-Kandidaten dieselben, bereits gebauten Bausteine —
 * `simulateBattery` (§3.6) → `computeBatterySavings` (§3.7) → `calculateRoi` (§3.9) — zu einem
 * vollständigen `AnalysisResult.perBattery`-Eintrag. KEINE Vorfilterung: auch offensichtlich
 * ungeeignete Kandidaten (z. B. zu schwach) bekommen eine echte Simulation samt erklärender
 * Warnung — Transparenz statt stilles Weglassen (Prinzip 5).
 */
export type RecommendationResult = Pick<AnalysisResult, 'perBattery' | 'recommendation'>

/** Toleranz für den "Leistung reicht nicht"-Heuristikvergleich (kW) — s. `isPowerLimited`. */
const POWER_LIMIT_TOLERANCE_KW = 1e-2

/**
 * Erkennt, ob `maxPowerKw` (statt SoC-Erschöpfung) der limitierende Faktor der Kapp-Suche
 * (§3.6.1) war: die je Periode gefundene `cap` entspricht (bis auf Numerik) dem
 * Perioden-Höchstbezug abzüglich `maxPowerKw` — genau der Wert, den die Batterie mit
 * unbegrenzter Energie, aber begrenzter Leistung erreichen würde. Prüft JEDE Periode einzeln,
 * da bei `monthly_*` einzelne Monate leistungslimitiert sein können und andere nicht.
 */
function isPowerLimited(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
  capKwByPeriod: number[],
): boolean {
  const draws = drawSeries(loadProfile)
  const periodOfInterval = periodIndexByInterval(loadProfile, tariffParams.billingModel)
  const indicesByPeriod = intervalIndicesByPeriod(periodOfInterval)

  for (const [periodId, indices] of indicesByPeriod) {
    const periodPeak = maxPositiveDraw(indices.map((i) => draws[i] ?? 0))
    if (periodPeak <= 0) continue // keine Spitze in dieser Periode → nichts zu kappen

    const cap = capKwByPeriod[periodId] ?? 0
    const powerLimitedCap = periodPeak - battery.maxPowerKw
    const isTight = Math.abs(cap - powerLimitedCap) <= POWER_LIMIT_TOLERANCE_KW
    if (powerLimitedCap > POWER_LIMIT_TOLERANCE_KW && isTight) return true
  }
  return false
}

/** §3.8-Warnungen: Betonsockel, separater Wechselrichter, unzureichende Leistung — ergänzend zu `savingsWarnings` (§3.7, z. B. static-Steuerung). */
function buildWarnings(battery: BatteryCandidate, savingsWarnings: string[], powerLimited: boolean): string[] {
  const warnings = [...savingsWarnings]

  if (battery.requiresFoundation) {
    warnings.push(`Betonsockel nötig (+€${(battery.foundationCost ?? 0).toFixed(0)}).`)
  }
  if (!battery.inverterIncluded && battery.extraInverterCost != null) {
    warnings.push(`Separater Wechselrichter nötig (+€${battery.extraInverterCost.toFixed(0)}).`)
  }
  if (powerLimited) {
    warnings.push(
      `Leistung des Kandidaten reicht nicht für alle Spitzen (${battery.maxPowerKw} kW maximale ` +
        'Lade-/Entladeleistung) — die Kappung ist leistungs-, nicht energiebegrenzt.',
    )
  }

  return warnings
}

function buildPerBatteryEntry(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
  horizonYears: number,
  financialParams: FinancialParams | undefined,
  topPeaks: Array<{ ts: string; kw: number }>,
  pvProfile: PvProfile | undefined,
): AnalysisResult['perBattery'][number] {
  // PvProfile ändert Dispatch/Ersparnis NICHT (s. `simulateBattery`) — es reichert nur den Trace um die
  // echte Brutto-PV an. `computeBatterySavings` nutzt denselben `sim` (dessen Dispatch pv-unabhängig ist).
  const sim = simulateBattery(loadProfile, battery, tariffParams, pvProfile)
  const savings = computeBatterySavings(loadProfile, battery, tariffParams, sim)
  const roi = calculateRoi(battery, savings.totalSavingPerYear, horizonYears, financialParams)
  const powerLimited = isPowerLimited(loadProfile, battery, tariffParams, sim.capKwByPeriod)

  return {
    battery,
    newBilledKw: savings.newBilledKw,
    leistungspreisSavingPerYear: savings.leistungspreisSavingPerYear,
    selfConsumptionSavingPerYear: savings.selfConsumptionSavingPerYear,
    loadShiftSavingPerYear: savings.loadShiftSavingPerYear,
    totalSavingPerYear: savings.totalSavingPerYear,
    ...roi,
    warnings: buildWarnings(battery, savings.warnings, powerLimited),
    // §6.2-Charts: aus demselben `sim`-Lauf extrahiert (keine Zweitsimulation). `topPeaks` ist
    // profil- (nicht batterie-)abhängig → in `recommendBattery` einmal gerechnet, hier injiziert.
    dispatchTrace: buildDispatchTrace(loadProfile, tariffParams, sim, topPeaks),
  }
}

function formatAmortization(amortizationYears: number): string {
  return Number.isFinite(amortizationYears)
    ? `nach ${amortizationYears.toFixed(1)} Jahren`
    : 'innerhalb des Betrachtungszeitraums nicht'
}

/** Deterministischer Template-Satz — KEIN KI-Layer (das ist ein separat geplanter, späterer Baustein). */
function buildRationale(entry: AnalysisResult['perBattery'][number], horizonYears: number): string {
  return (
    `${entry.battery.name} spart voraussichtlich €${entry.totalSavingPerYear.toFixed(0)} pro Jahr und ` +
    `amortisiert sich ${formatAmortization(entry.amortizationYears)} — Netto-Ersparnis über ` +
    `${horizonYears} Jahre: €${entry.netSavingOverHorizon.toFixed(0)}.`
  )
}

/**
 * Empfehlung & Ranking (§3.8) über den gesamten Katalog. Für JEDEN Kandidaten: `simulateBattery`
 * (§3.6) → `computeBatterySavings` (§3.7) → `calculateRoi` (§3.9), verkettet zu einem
 * vollständigen `perBattery`-Eintrag. KEINE Vorfilterung.
 *
 * [ANNAHME, fixiert] Sortierung: primär `netSavingOverHorizon` absteigend, Tie-Break
 * `amortizationYears` aufsteigend. `perBattery` ist das VOLLSTÄNDIG sortierte Array — kein
 * separates "alternatives"-Feld (der §3.10-Contract hat keins); eine spätere UI kann den Rest
 * des Arrays direkt als Alternativen anzeigen.
 *
 * Parameterreihenfolge bewusst `horizonYears` VOR `financialParams?`: ein optionaler Parameter
 * kann in TypeScript keinem nachfolgenden Pflichtparameter vorausgehen — dieselbe Reihenfolge
 * wie bei `calculateRoi` (§3.9).
 */
export function recommendBattery(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  catalog: BatteryCandidate[],
  horizonYears: number,
  financialParams?: FinancialParams,
  pvProfile?: PvProfile,
): RecommendationResult {
  // Top-Peaks (§3.4) sind profil-, nicht batterieabhängig — einmal für den ganzen Katalog rechnen und
  // je Kandidat in `buildDispatchTrace` injizieren (dieselbe Menge, die `AnalysisResult.peaks.top` zeigt).
  const topPeaks = topPeaksKw(loadProfile)
  const perBattery = catalog.map((battery) =>
    buildPerBatteryEntry(loadProfile, battery, tariffParams, horizonYears, financialParams, topPeaks, pvProfile),
  )

  perBattery.sort((a, b) =>
    b.netSavingOverHorizon !== a.netSavingOverHorizon
      ? b.netSavingOverHorizon - a.netSavingOverHorizon
      : a.amortizationYears - b.amortizationYears,
  )

  // Invariante: ein leerer Katalog kann keine Empfehlung erzeugen — `recommendBattery` setzt
  // (wie der §3.8-Prompt) mindestens einen Kandidaten voraus.
  const top = perBattery[0]!
  const recommendation = { batteryId: top.battery.id, rationale: buildRationale(top, horizonYears) }

  return { perBattery, recommendation }
}
