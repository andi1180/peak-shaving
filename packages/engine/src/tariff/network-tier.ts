import {
  computeNetworkTierCost,
  effectiveBillingModel,
  type LoadProfile,
  type NetworkTierResult,
  type NetworkTierSummary,
  type TariffParams,
  type TariffPricingInputs,
} from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { AnalysisRefusedError } from '../refusal'
import { annualizationFactor } from '../savings/annualization'
import { intervalHours } from '../simulation/helpers'
import { getTariffStrategy } from './strategy'

/**
 * Benutzungsdauer-Stufen der Netzentgelt-Zeile (Schritt 8b): der Leistungsteil einer Reihe ist die
 * Stufenkorrektur N aus `computeNetworkTierCost`, der Energieteil bleibt in der Preisreihe (AP Stufe 1).
 * Ohne Stufenfelder (`no_tiers`) gilt der Skalar-Leistungspreis unverändert.
 */

export type TieredNetworkResult = Extract<NetworkTierResult, { kind: 'tiered' }>

const dayKeysCache = new WeakMap<LoadProfile, string[]>()

function dayKeysOf(loadProfile: LoadProfile): string[] {
  let keys = dayKeysCache.get(loadProfile)
  if (keys === undefined) {
    keys = loadProfile.readings.map((reading) => {
      const { year, month, day } = utcMsToLocalFields(
        Date.parse(reading.ts),
        loadProfile.timezoneMeta,
      )
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    })
    dayKeysCache.set(loadProfile, keys)
  }
  return keys
}

/** Positiver Netzbezug einer Reihe je lokalem Tag (kWh), in Tagesreihenfolge. */
function dailyGridKwh(
  loadProfile: LoadProfile,
  gridKw: readonly number[],
): { localDate: string; kwh: number }[] {
  const keys = dayKeysOf(loadProfile)
  const deltaH = intervalHours(loadProfile)
  const byDay = new Map<string, number>()
  gridKw.forEach((kw, i) => {
    const key = keys[i]!
    byDay.set(key, (byDay.get(key) ?? 0) + Math.max(0, kw) * deltaH)
  })
  return [...byDay].map(([localDate, kwh]) => ({ localDate, kwh }))
}

/** Stufenergebnis einer Netzreihe bei abgerechneter Leistung `billedKw`. */
export function networkTierOf(
  loadProfile: LoadProfile,
  pricing: Pick<TariffPricingInputs, 'gridTariffRows'> | undefined,
  gridKw: readonly number[],
  billedKw: number,
): NetworkTierResult {
  const rows = pricing?.gridTariffRows
  if (!rows || rows.length === 0) return { kind: 'no_tiers' }
  return computeNetworkTierCost({
    rows,
    billedKw,
    dailyKwh: dailyGridKwh(loadProfile, gridKw),
    annualizationFactor: annualizationFactor(loadProfile),
  })
}

const currentCache = new WeakMap<
  LoadProfile,
  { rows: unknown; billedKw: number; result: NetworkTierResult }
>()

/** Das Stufenergebnis des Ist-Lastgangs — einmal je Lastgang, Zeilen und abgerechneter Leistung. */
export function currentNetworkTier(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  pricing: Pick<TariffPricingInputs, 'gridTariffRows'> | undefined,
): NetworkTierResult {
  const rows = pricing?.gridTariffRows ?? null
  if (!rows || rows.length === 0) return { kind: 'no_tiers' }
  const billedKw = getTariffStrategy(tariffParams.billingModel).billedKw(loadProfile, tariffParams)
  const cached = currentCache.get(loadProfile)
  if (cached && cached.rows === rows && cached.billedKw === billedKw) return cached.result
  const draws = loadProfile.readings.map((reading) => reading.gridPowerKw)
  const result = networkTierOf(loadProfile, pricing, draws, billedKw)
  currentCache.set(loadProfile, { rows, billedKw, result })
  return result
}

/**
 * Das gültige Stufenergebnis, `null` ohne Stufen. Ungültige Zeilen und ein Abrechnungsmodell ausser
 * `annual_max` (die Benutzungsdauer ist eine Jahresgrösse) verweigern die Analyse — nie ein stiller
 * Rückfall auf den Skalar-Leistungspreis.
 */
export function tieredOrRefuse(
  result: NetworkTierResult,
  tariffParams: TariffParams,
): TieredNetworkResult | null {
  if (result.kind === 'no_tiers') return null
  if (result.kind === 'error') {
    throw new AnalysisRefusedError({ reason: 'network_tier_invalid', detail: result.reason })
  }
  if (effectiveBillingModel(tariffParams.billingModel) !== 'annual_max') {
    throw new AnalysisRefusedError({ reason: 'network_tier_requires_annual_max' })
  }
  return result
}

/** Hat der Ist-Lastgang einen Leistungsteil aus einer Stufenzeile? (Blocker `no_demand_charge`) */
export function hasTieredDemandCharge(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  pricing: Pick<TariffPricingInputs, 'gridTariffRows'> | undefined,
): boolean {
  return currentNetworkTier(loadProfile, tariffParams, pricing).kind === 'tiered'
}

export function networkTierSummary(result: TieredNetworkResult): NetworkTierSummary {
  return {
    tier: result.tier,
    thresholdHours: result.thresholdHours,
    usageHours: result.usageHours,
    costTier1Eur: result.costTier1Eur,
    costTier2Eur: result.costTier2Eur,
    correctionEur: result.correctionEur,
  }
}
