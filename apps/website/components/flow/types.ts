import type { FinancialParams, TariffParams } from 'shared'

// Vom Tarif-Schritt nach oben gereichtes Ergebnis.
export type TariffResult = {
  tariff: TariffParams
  financial?: FinancialParams
  pvFileName: string | null
}

// Was der Worker/Engine später bekommt. Der Lastgang selbst (fileName) wird in
// Prompt 2 zum geparsten LoadProfile — hier vorerst nur der Dateiname.
export type CalculatorPayload = TariffResult & {
  fileName: string | null
}
