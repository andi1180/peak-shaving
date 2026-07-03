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

// Was der Worker/Engine bekommt. Seit Prompt 4 (abgeschlossen) berechnet der Worker das
// komplette `AnalysisResult` echt daraus — `current`/`peaks` (§3.4/§3.5) und
// `perBattery`/`recommendation` (§3.6-3.8, gegen den `DEMO_BATTERY_CATALOG`).
export type CalculatorPayload = TariffResult & {
  load: ParsedLoad
}
