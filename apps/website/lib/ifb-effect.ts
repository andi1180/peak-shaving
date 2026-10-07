import { calculateRoi } from 'engine'
import type { AnalysisTaxAssumptions, BatteryRoiEntry } from 'shared'

/** Die Wirkung des Investitionsfreibetrags auf Amortisation und Netto nach Steuern. */
export type IfbEffect = {
  /** Jahre, um die der IFB die Amortisation nach Steuern verkürzt — `null`, wenn nicht endlich oder < 0,05. */
  deltaYears: number | null
  /** Amortisation nach Steuern (mit IFB) liegt über der vor Steuern — Anlass für den Erklärsatz. */
  taxedLonger: boolean
}

const MIN_DELTA_YEARS = 0.05

/**
 * Differenz zweier `calculateRoi`-Läufe mit identischen Eingaben, einmal mit dem eingetragenen IFB-%,
 * einmal mit 0 % (die Steuerrechnung bleibt dabei aktiv, weil 0 ≠ `undefined`). `null`, wo es keine
 * Wirkung geben soll: kein IFB eingetragen oder kein Netto-Gewinn daraus (z. B. Steuersatz 0).
 */
export function ifbEffectOf(
  entry: Pick<BatteryRoiEntry, 'battery' | 'subsidyAmount'>,
  tax: AnalysisTaxAssumptions | undefined,
  horizonYears: number,
  savingPerYearEur: number,
): IfbEffect | null {
  const ifb = tax?.investitionsfreibetragPercent
  if (tax === undefined || ifb == null || !(ifb > 0)) return null
  const run = (ifbPercent: number) =>
    calculateRoi(entry.battery, savingPerYearEur, horizonYears, {
      fixedSubsidyEur: entry.subsidyAmount,
      taxRatePercent: tax.taxRatePercent,
      investitionsfreibetragPercent: ifbPercent,
      depreciationYears: tax.depreciationYears ?? undefined,
    })
  const withIfb = run(ifb)
  const without = run(0)
  if (withIfb.taxEffect === undefined || without.taxEffect === undefined) return null

  const deltaNetEur =
    withIfb.taxEffect.netSavingOverHorizonAfterTax - without.taxEffect.netSavingOverHorizonAfterTax
  if (!(deltaNetEur > 0)) return null

  const deltaYears =
    without.taxEffect.amortizationYearsAfterTax - withIfb.taxEffect.amortizationYearsAfterTax
  return {
    deltaYears: Number.isFinite(deltaYears) && deltaYears >= MIN_DELTA_YEARS ? deltaYears : null,
    taxedLonger: withIfb.taxEffect.amortizationYearsAfterTax > withIfb.amortizationYears,
  }
}
