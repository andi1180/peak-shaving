import type { LoadProfile } from 'shared'

import {
  DEFAULT_CONSUMPTION_PATTERN_SCHEME,
  forecastDrawSeries,
  type ForecastDrawSeries,
} from '../foresight/consumption-pattern'
import type { DailyPriceOrder } from './daily-price-order'

/**
 * Womit die Tages-Rangfolge (§3.6 Schritt 5) plant — ausgeführt wird immer auf dem echten Lastgang.
 *
 * `forecast` ist der Fahrplan jeder Ersparnis, Reihung und Amortisation (§3.7-Revision PR 2,
 * 25.09.2026): die Leave-one-out-Erwartung vom Vorabend. `hindsight` plant mit dem gemessenen Tag
 * und ist damit perfektes Wissen — nur noch Obergrenze, ausser beim Standardprofil, das seine
 * eigene Erwartung ist (Muster und Wahrheit wären dieselbe Formel).
 *
 * ⚠ Nur die Verbrauchserwartung ist vorausschauend; Kappschwelle und Spitzen-Reserve kommen
 * weiterhin aus dem ganzen Zeitraum (`peakConstraints`), der Leistungspreis-Anteil bleibt eine
 * Obergrenze.
 */
export type DispatchPlanning =
  | { basis: 'forecast'; forecast: ForecastDrawSeries }
  | { basis: 'hindsight' }

export const HINDSIGHT_PLANNING: DispatchPlanning = { basis: 'hindsight' }

/** Einmal je Lauf zu bilden, nicht je Gerät — die Prognose hängt nur am Lastgang. */
export function dispatchPlanningFor(loadProfile: LoadProfile): DispatchPlanning {
  if (loadProfile.source === 'standard_profile') return HINDSIGHT_PLANNING
  return {
    basis: 'forecast',
    forecast: forecastDrawSeries(loadProfile, DEFAULT_CONSUMPTION_PATTERN_SCHEME),
  }
}

/**
 * Tage ohne Muster planen gar nicht (volle Ladegrenze, keine Untergrenze) statt ersatzweise mit
 * dem gemessenen Tag — das hätte eine reale Steuerung an einem solchen Tag auch nicht.
 */
export function withoutPlanOnDaysMissingPattern(
  order: DailyPriceOrder,
  hasPattern: boolean[],
  usableCapacityKwh: number,
): DailyPriceOrder {
  return {
    chargeCeilingKwh: order.chargeCeilingKwh.map((v, i) =>
      hasPattern[i] ? v : usableCapacityKwh,
    ),
    priceFloorKwh: order.priceFloorKwh.map((v, i) => (hasPattern[i] ? v : 0)),
  }
}
