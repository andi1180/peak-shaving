import { findGridTariffRow } from './grid-tariff-row'
import type { GridTariffRowInput } from './tariff-pricing'

/**
 * Netzkosten bei Benutzungsdauer-Stufen (DE): je Abrechnungsjahr und Reihe gilt EINE Stufe, und
 * zwar die günstigere — die Schwelle ist nur informativ, keine Entscheidungsregel. Der Leistungspreis
 * jeder Stufe wird tagesanteilig über die Zeilen gemittelt (P nicht hochgerechnet), der Arbeitspreis
 * je Tag aus der Zeile dieses Tages genommen. Netzverlust, Abgaben und Gebrauchsabgabe gehören nicht
 * hierher: sie wirken auf beide Stufen gleich und bleiben beim Aufrufer.
 */

export type NetworkTierInput = {
  rows: readonly GridTariffRowInput[]
  /** Abgerechnete Leistung P (kW, ≥ 0). */
  billedKw: number
  /** Netzbezug der Reihe je lokalem Tag, ungestreckt. */
  dailyKwh: readonly { localDate: string; kwh: number }[]
  /** Hochrechnungsfaktor f eines Teiljahrs auf die Arbeitsmenge; Vorgabe 1. */
  annualizationFactor?: number
}

export type NetworkTierErrorReason = 'mixed_tier_rows' | 'missing_row' | 'invalid_tier_row'

export type NetworkTierResult =
  | { kind: 'no_tiers' }
  | { kind: 'error'; reason: NetworkTierErrorReason }
  | {
      kind: 'tiered'
      tier: 1 | 2
      costTier1Eur: number
      costTier2Eur: number
      chosenCostEur: number
      /** Σ AP₁ · kWh · f — der Arbeitsanteil, den der heutige Energieweg bereits rechnet. */
      apTier1BaselineEur: number
      /** Stufenkorrektur N = chosenCostEur − apTier1BaselineEur (ersetzt LP · P des heutigen Wegs). */
      correctionEur: number
      lpEffTier1EurPerKwYear: number
      lpEffTier2EurPerKwYear: number
      annualKwh: number
      usageHours: number | null
      thresholdHours: number
    }

type TierRates = { lp1: number; ap1: number; lp2: number; ap2: number; threshold: number }

function hasAnyTierField(row: GridTariffRowInput): boolean {
  return (
    row.tierThresholdHours != null ||
    row.tier2LeistungspreisEurPerKwYear != null ||
    row.tier2ArbeitspreisCtPerKwh != null
  )
}

/**
 * Trägt der Netzentgelt-Stand Benutzungsdauer-Stufen? Mit `localDates` genau die Prüfung, an der
 * `computeNetworkTierCost` `no_tiers` entscheidet; ohne zählt jede übergebene Zeile.
 */
export function gridTariffRowsHaveTiers(
  rows: readonly GridTariffRowInput[] | null | undefined,
  localDates?: readonly string[],
): boolean {
  if (!rows || rows.length === 0) return false
  if (localDates === undefined) return rows.some(hasAnyTierField)
  return localDates.some((localDate) => {
    const row = findGridTariffRow(rows, localDate)
    return row != null && hasAnyTierField(row)
  })
}

/** Sätze einer Stufenzeile in €/kW·a und €/kWh — `null`, wenn die Zeile nicht eindeutig lesbar ist. */
function tierRatesOf(row: GridTariffRowInput): TierRates | null {
  const { tierThresholdHours, tier2LeistungspreisEurPerKwYear, tier2ArbeitspreisCtPerKwh } = row
  if (tierThresholdHours == null || tier2LeistungspreisEurPerKwYear == null) return null
  if (tier2ArbeitspreisCtPerKwh == null) return null
  if (row.grundpreisUnit !== 'eur_per_kw_year' || row.grundpreisAmount == null) return null
  if (row.windows.length !== 1) return null
  const window = row.windows[0]!
  if (window.monthDayFrom != null || window.monthDayTo != null) return null
  return {
    lp1: row.grundpreisAmount,
    ap1: window.ctPerKwh / 100,
    lp2: tier2LeistungspreisEurPerKwYear,
    ap2: tier2ArbeitspreisCtPerKwh / 100,
    threshold: tierThresholdHours,
  }
}

export function computeNetworkTierCost(input: NetworkTierInput): NetworkTierResult {
  const f = input.annualizationFactor ?? 1
  const days = input.dailyKwh.map((day) => ({
    kwh: day.kwh,
    row: findGridTariffRow(input.rows, day.localDate),
  }))

  if (
    !gridTariffRowsHaveTiers(
      input.rows,
      input.dailyKwh.map((day) => day.localDate),
    )
  ) {
    return { kind: 'no_tiers' }
  }
  if (days.some((day) => day.row == null)) return { kind: 'error', reason: 'missing_row' }
  if (days.some((day) => !hasAnyTierField(day.row!)))
    return { kind: 'error', reason: 'mixed_tier_rows' }

  const ratesByRow = new Map<GridTariffRowInput, TierRates>()
  const daysByRow = new Map<GridTariffRowInput, number>()
  let lpSum1 = 0
  let lpSum2 = 0
  let ap1Eur = 0
  let ap2Eur = 0
  let kwhSum = 0
  for (const day of days) {
    const row = day.row!
    let rates = ratesByRow.get(row)
    if (rates === undefined) {
      const read = tierRatesOf(row)
      if (read === null) return { kind: 'error', reason: 'invalid_tier_row' }
      rates = read
      ratesByRow.set(row, rates)
    }
    daysByRow.set(row, (daysByRow.get(row) ?? 0) + 1)
    lpSum1 += rates.lp1
    lpSum2 += rates.lp2
    ap1Eur += rates.ap1 * day.kwh * f
    ap2Eur += rates.ap2 * day.kwh * f
    kwhSum += day.kwh
  }

  const lpEff1 = lpSum1 / days.length
  const lpEff2 = lpSum2 / days.length
  const P = input.billedKw
  const costTier1Eur = lpEff1 * P + ap1Eur
  const costTier2Eur = lpEff2 * P + ap2Eur
  const tier: 1 | 2 = costTier2Eur < costTier1Eur ? 2 : 1
  const chosenCostEur = tier === 1 ? costTier1Eur : costTier2Eur
  const annualKwh = kwhSum * f

  let dominantRow: GridTariffRowInput | null = null
  for (const [row, count] of daysByRow)
    if (dominantRow === null || count > daysByRow.get(dominantRow)!) dominantRow = row

  return {
    kind: 'tiered',
    tier,
    costTier1Eur,
    costTier2Eur,
    chosenCostEur,
    apTier1BaselineEur: ap1Eur,
    correctionEur: chosenCostEur - ap1Eur,
    lpEffTier1EurPerKwYear: lpEff1,
    lpEffTier2EurPerKwYear: lpEff2,
    annualKwh,
    usageHours: P > 0 ? annualKwh / P : null,
    thresholdHours: ratesByRow.get(dominantRow!)!.threshold,
  }
}
