// Kombinierter Dispatch → Ersparnis (§3.7): Leistungspreis-Anteil und Energie-Anteil (volle
// Kostendifferenz der Netzreihen), inkl. controlType-Default.
export { computeBatterySavings, eagDemandSavingField } from './attribute'
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
// D6 Teil 3: der aus dem gemessenen Wochenblock gefüllte 365-Tage-Lastgang. Er ist eine EINGABE für
// `computeAnalysis` — gerechnet wird damit unverändert dort, geschätzt ist der Lastgang.
export { MIN_BLOCK_WEEKS, buildSyntheticYearProfile } from './synthetic-year'
export type {
  SyntheticYearBlock,
  SyntheticYearBlocker,
  SyntheticYearBounds,
  SyntheticYearProfile,
  SyntheticYearResult,
} from './synthetic-year'
