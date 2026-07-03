import type { DataQuality } from 'engine'
import type { FinancialParams, LoadProfile, TariffParams } from 'shared'

// Vom Tarif-Schritt nach oben gereichtes Ergebnis.
export type TariffResult = {
  tariff: TariffParams
  financial?: FinancialParams
  pvFileName: string | null
}

// Ergebnis von Schritt 1 (parseLoadProfile, §3.2/§3.3) — die echte, getypte Nutzlast.
export type ParsedLoad = {
  fileName: string
  profile: LoadProfile
  dataQuality: DataQuality
}

// Was der Worker/Engine bekommt. Die Berechnung selbst ist vorerst weiter gemockt
// (Prompt 4 dockt in analysis.worker.ts an) — der Lastgang ist jetzt aber echt geparst.
export type CalculatorPayload = TariffResult & {
  load: ParsedLoad
}
