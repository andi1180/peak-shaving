import type {
  BatteryCandidate,
  LoadProfile,
  OwnTariffStorage,
  OwnTariffStorageUnavailableReason,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { feedInTariffCtPerKwh, hasFeedIn } from '../refusal'
import type { DispatchResult } from '../simulation/dispatch'
import { energyCostEur, type EnergyPriceSeries } from '../simulation/energy-cost'
import { drawSeries, intervalHours, startSoc, toPhysics } from '../simulation/helpers'
import { peakConstraints } from '../simulation/peak-constraints'
import { peakShavingBlockers } from '../simulation/peak-shaving'
import { dispatchPlanningFor, type DispatchPlanning } from '../simulation/planning'
import { runSurplusOptimizedDispatch } from '../simulation/surplus-optimization'
import { combinedIntervalPrices, hasTimeOfUseWindows } from '../simulation/tou'
import { annualizationFactor } from './annualization'

/**
 * Speicherwert im EIGENEN Tarif des Kunden („Ihr Tarif + Speicher"), zusätzlich zur aWATTar-Zahl
 * `totalSavingPerYear`. Rein & deterministisch; ändert kein bestehendes Feld und keine Reihung.
 *
 * Preisbasis: `combinedIntervalPrices` mit dem Arbeitspreis des Kunden — Energie, Netz und Abgaben
 * je Intervall, dieselbe Reihe, aus der der Monatsvergleich „Ihr Tarif heute" entsteht. Die
 * Kostenfunktion ist ebenfalls dieselbe (`energyCostEur` je Kalendermonat, Einspeisung zur
 * Einspeisevergütung, Summe über die Monate): ohne Speicher sind die Kosten bitgleich zum
 * Energieteil von „Ihr Tarif heute".
 *
 * Zielfunktion des Fahrplans: Kostenminimum über den Horizont mit genau dieser Preisreihe
 * (`runSurplusOptimizedDispatch`, Physik und Wirkungsgrad wie im bisherigen Dispatch). Der
 * bisherige Dispatch wird hier nie benutzt: bei kleiner Preisspreizung lädt er unwirtschaftlich
 * aus dem Netz. Ohne Einspeisung und ohne lohnende Arbitrage ist die Ersparnis exakt 0 und wird
 * nicht simuliert (`arbitrageImpossible`).
 *
 * `null` (mit Grund) heisst: für dieses Gerät gibt es keine Zahl mit belegter Basis — kein
 * bekannter Arbeitspreis, keine rechenbaren Preisdaten, ein HT/NT-Tarif (den „Ihr Tarif heute"
 * flach rechnet) oder aktive Spitzenkappung (deren Fahrplan bindet die Kapazität anders).
 */
export type OwnTariffStorageField =
  | { ownTariffStorage: OwnTariffStorage }
  | { ownTariffStorage: null; ownTariffStorageReason: OwnTariffStorageUnavailableReason }

/** Einmal je Analyse: Preisreihe und Kosten ohne Speicher. */
export type OwnTariffContext =
  | {
      ok: true
      prices: EnergyPriceSeries
      monthIndex: number[]
      costWithoutStorageEur: number
      feedInWithoutStorageKwh: number
      hasFeedIn: boolean
      minPriceCt: number
      maxPriceCt: number
      factor: number
    }
  | { ok: false; reason: OwnTariffStorageUnavailableReason }

/** Energiekosten im eigenen Tarif über den abgedeckten Zeitraum — wie `costByMonth` des Monatsvergleichs, summiert. */
export function ownTariffEnergyCostEur(
  gridKw: readonly number[],
  prices: EnergyPriceSeries,
  monthIndex: readonly number[],
): number {
  return energyCostEur(gridKw, prices, monthIndex).byMonthEur.reduce((a, b) => a + b, 0)
}

/**
 * Netzladung kann sich nicht lohnen: eine bezogene kWh (niedrigster Preis) ersetzt nach dem Laden
 * η kWh Bezug (höchster Preis) — Wirkungsgrad wie im Dispatch, η auf die Ladung, Entladung 1:1.
 */
export function arbitrageImpossible(minPriceCt: number, maxPriceCt: number, eta: number): boolean {
  return eta * maxPriceCt <= minPriceCt
}

export function ownTariffContext(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  pricing: TariffPricingInputs | undefined,
): OwnTariffContext {
  if (tariffParams.supplierTariff === 'unknown')
    return { ok: false, reason: 'supplier_tariff_unknown' }
  if (!pricing) return { ok: false, reason: 'no_price_data' }
  const own = combinedIntervalPrices(loadProfile, pricing, tariffParams.energyPriceCtPerKwh)
  if ('blocker' in own) return { ok: false, reason: 'no_price_data' }
  if (hasTimeOfUseWindows(tariffParams)) return { ok: false, reason: 'time_of_use_tariff' }

  const prices: EnergyPriceSeries = {
    drawCtPerKwh: own.prices,
    feedInCtPerKwh: feedInTariffCtPerKwh(loadProfile, tariffParams),
    deltaHours: intervalHours(loadProfile),
  }
  // Monatsgrenzen nach lokaler Wanduhr, wie im Monatsvergleich.
  const monthIndex = loadProfile.readings.map(
    (r) => utcMsToLocalFields(Date.parse(r.ts), loadProfile.timezoneMeta).month - 1,
  )
  const draws = drawSeries(loadProfile)
  let minPriceCt = Infinity
  let maxPriceCt = -Infinity
  for (const ct of own.prices) {
    if (ct < minPriceCt) minPriceCt = ct
    if (ct > maxPriceCt) maxPriceCt = ct
  }
  return {
    ok: true,
    prices,
    monthIndex,
    costWithoutStorageEur: ownTariffEnergyCostEur(draws, prices, monthIndex),
    feedInWithoutStorageKwh: feedInKwhOf(draws, prices.deltaHours),
    hasFeedIn: hasFeedIn(loadProfile),
    minPriceCt,
    maxPriceCt,
    factor: annualizationFactor(loadProfile),
  }
}

function feedInKwhOf(gridKw: readonly number[], deltaHours: number): number {
  let kwh = 0
  for (const g of gridKw) if (g < 0) kwh -= g * deltaHours
  return kwh
}

/** Der Fahrplan im eigenen Tarif — immer die DP, Gleichstand zugunsten des Entladens. */
export function ownTariffDispatch(
  context: Extract<OwnTariffContext, { ok: true }>,
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
  planning: DispatchPlanning | undefined,
): DispatchResult {
  const physics = toPhysics(battery)
  const draws = drawSeries(loadProfile)
  const { capForInterval, socFloorKwh } = peakConstraints(loadProfile, battery, tariffParams)
  const plan = planning ?? dispatchPlanningFor(loadProfile)
  return runSurplusOptimizedDispatch({
    loadProfile,
    draws,
    planKw: plan.basis === 'forecast' ? plan.forecast.forecastKw : draws,
    drawCtPerKwh: context.prices.drawCtPerKwh as number[],
    feedInCtPerKwh: context.prices.feedInCtPerKwh,
    capForInterval,
    socFloorKwh,
    physics,
    startSocKwh: startSoc(physics),
    deltaH: context.prices.deltaHours,
    tieBreak: 'discharge',
  })
}

export function ownTariffStorageOf(
  context: OwnTariffContext,
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
  planning: DispatchPlanning | undefined,
): OwnTariffStorageField {
  if (!context.ok) return { ownTariffStorage: null, ownTariffStorageReason: context.reason }
  if (peakShavingBlockers(loadProfile, battery, tariffParams).length === 0) {
    return { ownTariffStorage: null, ownTariffStorageReason: 'peak_shaving_active' }
  }

  const physics = toPhysics(battery)
  // Ohne Kapazität oder Leistung verschiebt der Speicher nichts (und die DP hätte keine SoC-Stufen).
  const inert = physics.usableCapacityKwh <= 0 || physics.maxPowerKw <= 0
  if (
    inert ||
    (!context.hasFeedIn &&
      arbitrageImpossible(context.minPriceCt, context.maxPriceCt, physics.roundTripEfficiency))
  ) {
    return {
      ownTariffStorage: {
        savingPerYear: 0,
        savingOverCoveredPeriod: 0,
        basis: 'full_price',
        selfConsumptionGainKwh: 0,
        gridChargeKwh: 0,
        feedInKwh: context.feedInWithoutStorageKwh,
        planner: 'none',
      },
    }
  }

  const { gridAfterKw, batteryPowerKw } = ownTariffDispatch(
    context,
    loadProfile,
    battery,
    tariffParams,
    planning,
  )
  const draws = drawSeries(loadProfile)
  const dh = context.prices.deltaHours
  let gridChargeKwh = 0
  for (let i = 0; i < draws.length; i++) {
    const charge = batteryPowerKw[i]!
    if (charge > 0) gridChargeKwh += Math.max(0, charge - Math.max(0, -draws[i]!)) * dh
  }
  const feedInKwh = feedInKwhOf(gridAfterKw, dh)
  const savingOverCoveredPeriod =
    context.costWithoutStorageEur -
    ownTariffEnergyCostEur(gridAfterKw, context.prices, context.monthIndex)
  return {
    ownTariffStorage: {
      savingPerYear: savingOverCoveredPeriod * context.factor,
      savingOverCoveredPeriod,
      basis: 'full_price',
      selfConsumptionGainKwh: context.feedInWithoutStorageKwh - feedInKwh,
      gridChargeKwh,
      feedInKwh,
      planner: 'surplus_dp',
    },
  }
}
