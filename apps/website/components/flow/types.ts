import type { DataQuality } from 'engine'
import type { FinancialParams, LoadProfile, PvProfile, TariffParams } from 'shared'
import type { BatteryOverride } from '@/lib/analysis-protocol'

// Vom Tarif-Schritt nach oben gereichtes Ergebnis. `pv` ist optional (§3.1/§5 Schritt 2) — liegt es
// vor, trägt es die Brutto-PV in Engine/Trace (echter 4. Strom + Konsistenzprüfung).
export type TariffResult = {
  tariff: TariffParams
  financial?: FinancialParams
  pv: ParsedPv | null
  // Eine PV-Datei wurde hochgeladen, konnte aber NICHT gelesen werden (parsePvProfile → error/
  // needs_mapping) → `pv` bleibt null. Die Meldung wandert in den Report (dataQuality), damit der
  // Upload nicht still verpufft (§3.1). Nur gesetzt, wenn tatsächlich eine Datei abgelehnt wurde.
  pvError?: string
}

// Ergebnis von Schritt 1 (parseLoadProfile, §3.2/§3.3) — die echte, getypte Nutzlast.
export type ParsedLoad = {
  fileName: string
  profile: LoadProfile
  dataQuality: DataQuality
}

// Ergebnis der optionalen PV-Datei (parsePvProfile, §3.1) — Brutto-PV-Erzeugung.
export type ParsedPv = {
  fileName: string
  profile: PvProfile
  dataQuality: DataQuality
}

// Was der Worker/Engine bekommt. Seit Prompt 4 (abgeschlossen) berechnet der Worker das
// komplette `AnalysisResult` echt daraus — `current`/`peaks` (§3.4/§3.5) und
// `perBattery`/`recommendation` (§3.6-3.8, gegen den `DEMO_BATTERY_CATALOG`).
export type CalculatorPayload = TariffResult & {
  load: ParsedLoad
}

// Vom editierbaren Annahmen-Panel (§6.2) nach oben gereichte, vollständige Eingabe für eine
// Live-Neuberechnung — `tariff`/`financial` sind bereits mit den editierten Feldern gemergte
// Kopien der Originalwerte (nur `billingModel` bzw. Förderung/Steuer/Abschreibung editierbar,
// s. CLAUDE.md „NICHT: Entladetiefe"-Vermerk zur bewussten Auslassung).
export type RecomputeInput = {
  tariff: TariffParams
  financial?: FinancialParams
  horizonYears: number
  batteryOverride?: BatteryOverride
}
