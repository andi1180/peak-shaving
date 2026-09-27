import type {
  AnalysisResult,
  AnalysisTaxAssumptions,
  BatteryCandidate,
  BatteryTaxEffect,
  FinancialParams,
} from 'shared'

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
  | 'taxEffect'
>

/** `totalInvestment` = Kapazität × Preis + ggf. Fundament + ggf. separater Wechselrichter + ggf. Installationspauschale (§3.9). */
function calculateTotalInvestment(battery: BatteryCandidate): number {
  const base = battery.usableCapacityKwh * battery.pricePerKwh
  const foundation = battery.requiresFoundation ? (battery.foundationCost ?? 0) : 0
  const inverter = !battery.inverterIncluded ? (battery.extraInverterCost ?? 0) : 0
  return base + foundation + inverter + (battery.installationCost ?? 0)
}

/**
 * `subsidyAmount` (§3.9): „`fixedSubsidyEur` bzw. `subsidyPercent × totalInvestment`".
 * [ANNAHME] Pflichtenheft disambiguiert nicht, ob beide gleichzeitig gesetzt sein können —
 * hier bewusst ADDITIV behandelt (pauschaler Zuschuss + prozentuale Förderung sind
 * unterschiedliche Förderquellen, keine Alternativen). Fehlt ein Feld, zählt es als 0.
 * Begrenzt auf die Investition: gefördert wird höchstens, was angeschafft wird.
 */
function calculateSubsidyAmount(totalInvestment: number, financialParams?: FinancialParams): number {
  const fixed = financialParams?.fixedSubsidyEur ?? 0
  const percentBased =
    financialParams?.subsidyPercent != null ? (financialParams.subsidyPercent / 100) * totalInvestment : 0
  return Math.min(totalInvestment, fixed + percentBased)
}

/**
 * Die Steuerangaben, mit denen gerechnet wird — nur bei Steuersatz UND (IFB oder Abschreibungsdauer),
 * sonst `null` (§3.9, Revision 27.09.2026).
 */
export function taxAssumptionsOf(financialParams?: FinancialParams): AnalysisTaxAssumptions | null {
  const taxRatePercent = financialParams?.taxRatePercent
  const ifb = financialParams?.investitionsfreibetragPercent
  const depreciationYears = financialParams?.depreciationYears
  if (taxRatePercent === undefined || (ifb === undefined && depreciationYears === undefined)) {
    return null
  }
  return {
    taxRatePercent,
    investitionsfreibetragPercent: ifb ?? null,
    depreciationYears: depreciationYears ?? null,
  }
}

/**
 * Cashflow nach Steuern im Jahr `year` (ab 1): Einsparung × (1 − t) + AfA-Wirkung in den Jahren 1…n
 * + IFB-Wirkung im Jahr 1. `basis` ist die Investition nach Förderung. KEINE Steuerberatung.
 */
export function afterTaxCashflow(
  year: number,
  basis: number,
  savingPerYear: number,
  tax: AnalysisTaxAssumptions,
): number {
  const rate = tax.taxRatePercent / 100
  const n = tax.depreciationYears
  const depreciation = n !== null && year <= n ? (basis / n) * rate : 0
  const ifb = year === 1 ? ((tax.investitionsfreibetragPercent ?? 0) / 100) * basis * rate : 0
  return savingPerYear * (1 - rate) + depreciation + ifb
}

/**
 * Das Jahr, in dem die kumulierten Nach-Steuer-Cashflows die Basis erreichen (innerhalb des Jahres
 * linear). Nach den AfA-Jahren ist der Cashflow konstant — ist er dann nicht positiv, `Infinity`.
 */
function amortizationYearsAfterTax(
  basis: number,
  savingPerYear: number,
  tax: AnalysisTaxAssumptions,
): number {
  if (basis <= 0) return 0
  const variableYears = Math.max(1, Math.floor(tax.depreciationYears ?? 0))
  let cumulative = 0
  for (let year = 1; year <= variableYears; year++) {
    const cashflow = afterTaxCashflow(year, basis, savingPerYear, tax)
    if (cashflow > 0 && cumulative + cashflow >= basis) {
      return year - 1 + (basis - cumulative) / cashflow
    }
    cumulative += cashflow
  }
  const steady = afterTaxCashflow(variableYears + 1, basis, savingPerYear, tax)
  return steady > 0 ? variableYears + (basis - cumulative) / steady : Infinity
}

function calculateTaxEffect(
  basis: number,
  totalSavingPerYear: number,
  horizonYears: number,
  tax: AnalysisTaxAssumptions,
): { effect: BatteryTaxEffect; benefitInHorizon: number } {
  const rate = tax.taxRatePercent / 100
  const n = tax.depreciationYears
  const annualDepreciationEffect = n !== null ? (basis / n) * rate : 0
  const depreciationYearsInHorizon = n !== null ? Math.min(Math.floor(n), horizonYears) : 0
  const ifbEffect = ((tax.investitionsfreibetragPercent ?? 0) / 100) * basis * rate
  const benefitInHorizon = ifbEffect + annualDepreciationEffect * depreciationYearsInHorizon
  return {
    effect: {
      ifbEffect,
      annualDepreciationEffect,
      amortizationYearsAfterTax: amortizationYearsAfterTax(basis, totalSavingPerYear, tax),
      netSavingOverHorizonAfterTax:
        totalSavingPerYear * (1 - rate) * horizonYears + benefitInHorizon - basis,
    },
    benefitInHorizon,
  }
}

/**
 * `amortizationYears` = `netInvestment ÷ totalSavingPerYear` (§3.9).
 * [ANNAHME, Pflichtenheft schweigt dazu] Zwei Grenzfälle, die sonst NaN/±Infinity aus einer
 * Division durch/mit Null oder negativen Werten erzeugen würden:
 * - `netInvestment = 0` (Förderung deckt die Investition, `calculateRoi` klemmt
 *   bei 0): sofort amortisiert → `0`, unabhängig von `totalSavingPerYear`.
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
  // Die Steuerwirkung senkt die Investition nie; sie ist ein eigener Nach-Steuer-Richtwert.
  const netInvestment = Math.max(0, totalInvestment - subsidyAmount)
  const amortizationYears = calculateAmortizationYears(netInvestment, totalSavingPerYear)
  const netSavingOverHorizon = totalSavingPerYear * horizonYears - netInvestment
  const tax = taxAssumptionsOf(financialParams)
  const taxResult =
    tax === null ? null : calculateTaxEffect(netInvestment, totalSavingPerYear, horizonYears, tax)

  return {
    totalInvestment,
    subsidyAmount,
    taxBenefit: taxResult?.benefitInHorizon ?? 0,
    taxEffectsIncluded: taxResult !== null,
    netInvestment,
    amortizationYears,
    netSavingOverHorizon,
    ...(taxResult === null ? {} : { taxEffect: taxResult.effect }),
  }
}
