// Tarif-Strategy-Interface (§3.5) — austauschbares Abrechnungsmodell, kein hartkodierter Jahreshöchstwert.
export type { TariffStrategy } from './strategy'
export {
  annualMaxStrategy,
  monthlyMaxAverageStrategy,
  monthlyMaxSumStrategy,
  tariffStrategies,
  getTariffStrategy,
} from './strategy'
// D3 (16.09.2026): der Wizard-Entwurf eines Zählpunkts wird zu `TariffParams` — rein, ohne
// Nachschlagen, und bei fehlenden Pflichtangaben mit Abbruch statt Vorgabewert.
export { mapDraftToTariffParams, DEFAULT_DRAFT_BILLING_MODEL } from './draft-mapping'
export type { DraftTariffMappingOptions } from './draft-mapping'
// Die zweite kW-gebundene Jahresgrösse neben dem Leistungspreis (21.09.2026): der GRUNDPREIS-Teil
// des EAG-Förderbeitrags. Steht bewusst AUSSERHALB der Monatsreihen — s. Modulkopf.
export { eagDemandChargePerYear } from './eag-demand-charge'
