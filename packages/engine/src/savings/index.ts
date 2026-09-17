// Kombinierter Dispatch → benannte Ersparnis-Felder (§3.7). Verwandelt die §3.6-Simulation eines
// Batterie-Kandidaten in die drei disjunkten Ersparnis-Anteile des `AnalysisResult.perBattery`-
// Contracts (Leistungspreis / Eigenverbrauch / Lastverschiebung), inkl. controlType-Default.
export { computeBatterySavings } from './attribute'
export type { BatterySavings } from './attribute'
// D6 Teil 1: die Jahres-Hochrechnung. `annualizationFactor` gab es bereits, war aber über den
// Paket-Index nicht erreichbar (Bestandsaufnahme §5.2) — hier ohne Verhaltensänderung nachgezogen.
// `estimateAnnualConsumption` ist die zweite, GENAUERE Rechnung daneben, nicht ihr Ersatz.
export { DAYS_PER_YEAR, annualizationFactor, coveredDaysOf } from './annualization'
export { WINTER_REFERENCE_MONTHS, estimateAnnualConsumption } from './annual-consumption'
export type {
  AnnualConsumptionEstimate,
  AnnualConsumptionMethod,
  ReferenceSegment,
} from './annual-consumption'
// D6 Teil 2a: flache Stundenverteilung einer Tagesmenge — der Eingang, mit dem eine
// hochgerechnete Menge gegen Stundenpreise bewertet werden kann.
export { spreadDailyConsumptionHourly } from './hourly-spread'
