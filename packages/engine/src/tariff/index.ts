// Tarif-Strategy-Interface (§3.5) — austauschbares Abrechnungsmodell, kein hartkodierter Jahreshöchstwert.
export type { TariffStrategy } from './strategy'
export {
  annualMaxStrategy,
  monthlyMaxAverageStrategy,
  monthlyMaxSumStrategy,
  tariffStrategies,
  getTariffStrategy,
} from './strategy'
