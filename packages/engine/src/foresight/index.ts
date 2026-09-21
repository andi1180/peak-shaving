// Vorausschauende Ladesteuerung (vereinfacht), INTERNER Nachweis — kein Report, keine Oberfläche,
// kein Analyse-Bündel. `Pflichtenheft_Vorausschauende_Ladesteuerung.md` (21.09.2026): es entsteht
// kein zweiter Planer, es wird eine Eingabe getauscht — `dailyPriceOrder` sieht statt des
// gemessenen Netzbezugs die Leave-one-out-Prognose aus der eigenen Historie des Kunden.
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
export { computePredictiveControlValue, PREDICTIVE_CONTROL_VALUE_BASIS } from './predictive-control-value'
export type {
  PredictiveControlValueBlocker,
  PredictiveControlValueInputs,
  PredictiveControlValueResult,
} from './predictive-control-value'
