// Verbrauchserwartung vom Vorabend (Leave-one-out aus der eigenen Historie des Kunden) — seit dem
// 25.09.2026 die Planungsgrundlage JEDES Fahrplans (`simulation/planning.ts`).
export {
  consumptionPatternForDay,
  forecastDrawSeries,
  localDayKeyOf,
  DEFAULT_CONSUMPTION_PATTERN_SCHEME,
  MIN_PEER_DAYS,
} from './consumption-pattern'
export type {
  ConsumptionPatternScheme,
  ConsumptionPatternOutcome,
  ForecastDrawSeries,
} from './consumption-pattern'
