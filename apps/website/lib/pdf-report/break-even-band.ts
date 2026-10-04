import type { ExecutiveSummaryStorage } from './executive-summary'

/**
 * Das Break-even-Band der Vorderseite: kumulierte Ersparnis als Gerade je Jahr gegen die
 * Investition nach Förderung. Nur Multiplikation/Division der Werte des Speicherblocks — bewusst
 * nicht `storage.breakEven`, dessen Grundlinie den Leistungspreis enthält.
 */
export type BreakEvenLine = {
  perYearEur: number
  /** Schnittpunkt mit der Investitionslinie; `null`, wenn er jenseits des Horizonts liegt. */
  paybackYears: number | null
}

export type BreakEvenBand = {
  horizonYears: number
  investmentEur: number
  /** Ersparnis samt Stromspitzen (Höchstwert, wenn `upperBound`), sonst die ganze Ersparnis. */
  upper: BreakEvenLine
  upperBound: boolean
  /** Allein durch günstiges Laden — nur, wenn die Seite dafür eine Rückzahlzeit nennt. */
  lower: BreakEvenLine | null
  /** Obere Kante der y-Achse. */
  yMaxEur: number
}

function lineOf(perYearEur: number, investmentEur: number, horizonYears: number): BreakEvenLine {
  const payback = investmentEur <= 0 ? 0 : investmentEur / perYearEur
  return { perYearEur, paybackYears: payback <= horizonYears ? payback : null }
}

export function breakEvenBandOf(storage: ExecutiveSummaryStorage | null): BreakEvenBand | null {
  if (!storage) return null
  const { horizonYears } = storage
  const investmentEur = storage.investment.netEur
  const upper = lineOf(storage.savingPerYearEur, investmentEur, horizonYears)
  const lower =
    storage.paybackWithoutPeaksYears === null
      ? null
      : lineOf(storage.loadShiftEur, investmentEur, horizonYears)
  return {
    horizonYears,
    investmentEur,
    upper,
    upperBound: storage.upperBound,
    lower,
    yMaxEur: Math.max(investmentEur, storage.savingPerYearEur * horizonYears) * 1.05,
  }
}

/** „ca. 4 Jahre" — dieselbe Zahl wie die Rückzahlzeit im Text der Seite (eine Nachkommastelle). */
export function aboutYears(value: number): string {
  const n = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(value)
  return `ca. ${n} ${n === '1' ? 'Jahr' : 'Jahre'}`
}
