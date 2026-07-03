import type { AnalysisResult, BatteryCandidate, FinancialParams } from 'shared'

// ROI & Förderung (§3.9). Reine Funktion — `totalSavingPerYear` kommt als Parameter herein
// (Ergebnis des kombinierten Dispatch, §3.7) und wird hier NICHT berechnet.

/** Die ROI-Teilmenge von `AnalysisResult.perBattery[number]` — Single Source of Truth ist der Contract. */
export type RoiFields = Pick<
  AnalysisResult['perBattery'][number],
  | 'totalInvestment'
  | 'subsidyAmount'
  | 'taxBenefit'
  | 'taxEffectsIncluded'
  | 'netInvestment'
  | 'amortizationYears'
  | 'netSavingOverHorizon'
>

/** `totalInvestment` = Kapazität × Preis + ggf. Fundament + ggf. separater Wechselrichter (§3.9). */
function calculateTotalInvestment(battery: BatteryCandidate): number {
  const base = battery.usableCapacityKwh * battery.pricePerKwh
  const foundation = battery.requiresFoundation ? (battery.foundationCost ?? 0) : 0
  const inverter = !battery.inverterIncluded ? (battery.extraInverterCost ?? 0) : 0
  return base + foundation + inverter
}

/**
 * `subsidyAmount` (§3.9): „`fixedSubsidyEur` bzw. `subsidyPercent × totalInvestment`".
 * [ANNAHME] Pflichtenheft disambiguiert nicht, ob beide gleichzeitig gesetzt sein können —
 * hier bewusst ADDITIV behandelt (pauschaler Zuschuss + prozentuale Förderung sind
 * unterschiedliche Förderquellen, keine Alternativen). Fehlt ein Feld, zählt es als 0.
 */
function calculateSubsidyAmount(totalInvestment: number, financialParams?: FinancialParams): number {
  const fixed = financialParams?.fixedSubsidyEur ?? 0
  const percentBased =
    financialParams?.subsidyPercent != null ? (financialParams.subsidyPercent / 100) * totalInvestment : 0
  return fixed + percentBased
}

/**
 * `taxBenefit` (§3.9, vereinfacht, KEINE Steuerberatung):
 * `(investitionsfreibetragPercent × totalInvestment + jährliche AfA über den Horizont) × taxRatePercent`.
 * [ANNAHME] „über den Betrachtungszeitraum" bezieht sich auf die AfA (jährlich, über
 * `min(depreciationYears, horizonYears)` Jahre aufsummiert) — der IFB ist ein steuerlicher
 * Einmaleffekt im Investitionsjahr und wird NICHT mit dem Horizont multipliziert.
 *
 * `taxEffectsIncluded` (§3.9 „Ohne Angabe"-Klärung, §3.10): fehlt `taxRatePercent`, kann kein
 * €-Betrag berechnet werden — Ergebnis ist dann „keine Angabe" (`false`, `taxBenefit=0`), nicht
 * „geprüft und Null". Ist `taxRatePercent` gesetzt, aber IFB/AfA-Basis fehlt, ist `taxBenefit=0`
 * ein echtes, geprüftes Ergebnis (`true`).
 */
function calculateTaxEffect(
  totalInvestment: number,
  horizonYears: number,
  financialParams?: FinancialParams,
): { taxBenefit: number; taxEffectsIncluded: boolean } {
  const taxRatePercent = financialParams?.taxRatePercent
  if (taxRatePercent === undefined) {
    return { taxBenefit: 0, taxEffectsIncluded: false }
  }

  const ifbAmount = ((financialParams?.investitionsfreibetragPercent ?? 0) / 100) * totalInvestment

  const depreciationYears = financialParams?.depreciationYears
  const annualAfa = depreciationYears ? totalInvestment / depreciationYears : 0
  const afaYearsInHorizon = depreciationYears ? Math.min(depreciationYears, horizonYears) : 0
  const afaOverHorizon = annualAfa * afaYearsInHorizon

  const taxBenefit = (ifbAmount + afaOverHorizon) * (taxRatePercent / 100)
  return { taxBenefit, taxEffectsIncluded: true }
}

/**
 * `amortizationYears` = `netInvestment ÷ totalSavingPerYear` (§3.9).
 * [ANNAHME, Pflichtenheft schweigt dazu] Zwei Grenzfälle, die sonst NaN/±Infinity aus einer
 * Division durch/mit Null oder negativen Werten erzeugen würden:
 * - `netInvestment ≤ 0` (Förderung/Steuervorteil deckt die Investition bereits): sofort
 *   amortisiert → `0`, unabhängig von `totalSavingPerYear`.
 * - `totalSavingPerYear ≤ 0` (keine oder negative Ersparnis) bei verbleibender Investition:
 *   amortisiert sich nie → `Infinity`, kein Crash/NaN im Report.
 */
function calculateAmortizationYears(netInvestment: number, totalSavingPerYear: number): number {
  if (netInvestment <= 0) return 0
  if (totalSavingPerYear <= 0) return Infinity
  return netInvestment / totalSavingPerYear
}

/**
 * ROI & Förderung (§3.9) für einen Batterie-Kandidaten. `totalSavingPerYear` ist das Ergebnis
 * des kombinierten Dispatch (§3.7, eigener Prompt) und wird hier als gegeben angenommen.
 */
export function calculateRoi(
  battery: BatteryCandidate,
  totalSavingPerYear: number,
  horizonYears: number,
  financialParams?: FinancialParams,
): RoiFields {
  const totalInvestment = calculateTotalInvestment(battery)
  const subsidyAmount = calculateSubsidyAmount(totalInvestment, financialParams)
  const { taxBenefit, taxEffectsIncluded } = calculateTaxEffect(totalInvestment, horizonYears, financialParams)
  const netInvestment = totalInvestment - subsidyAmount - taxBenefit
  const amortizationYears = calculateAmortizationYears(netInvestment, totalSavingPerYear)
  const netSavingOverHorizon = totalSavingPerYear * horizonYears - netInvestment

  return {
    totalInvestment,
    subsidyAmount,
    taxBenefit,
    taxEffectsIncluded,
    netInvestment,
    amortizationYears,
    netSavingOverHorizon,
  }
}
