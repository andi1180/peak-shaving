/**
 * Energiekosten einer Netzreihe — die EINE Bewertung, aus der der Monatsvergleich (§3.7.3) und die
 * Energie-Ersparnis (§3.7) entstehen. Bezug zum Intervallpreis, Einspeisung zur Einspeisevergütung;
 * Grundgebühren und Leistungspreis stehen nicht darin.
 */
export type EnergyPriceSeries = {
  /** Bezugspreis je Intervall (ct/kWh), gleich lang wie die Netzreihe. */
  drawCtPerKwh: readonly number[]
  /** Einspeisevergütung (ct/kWh), zeitunabhängig. */
  feedInCtPerKwh: number
  deltaHours: number
}

export type EnergyCost = {
  totalEur: number
  /** Je Kalendermonat (Index 0–11), nur wenn `monthIndex` übergeben wurde — sonst leer. */
  byMonthEur: number[]
}

/** Kosten eines Intervalls in € — signierte Netzleistung, `+` = Bezug. */
export function intervalEnergyCostEur(
  gridKw: number,
  deltaHours: number,
  drawCtPerKwh: number,
  feedInCtPerKwh: number,
): number {
  const ct = gridKw >= 0 ? gridKw * drawCtPerKwh : gridKw * feedInCtPerKwh
  return (ct * deltaHours) / 100
}

export function energyCostEur(
  gridKw: readonly number[],
  prices: EnergyPriceSeries,
  monthIndex?: readonly number[],
): EnergyCost {
  const byMonthEur = monthIndex ? new Array<number>(12).fill(0) : []
  let totalEur = 0
  for (let i = 0; i < gridKw.length; i++) {
    const eur = intervalEnergyCostEur(
      gridKw[i]!,
      prices.deltaHours,
      prices.drawCtPerKwh[i]!,
      prices.feedInCtPerKwh,
    )
    totalEur += eur
    if (monthIndex) byMonthEur[monthIndex[i]!]! += eur
  }
  return { totalEur, byMonthEur }
}
