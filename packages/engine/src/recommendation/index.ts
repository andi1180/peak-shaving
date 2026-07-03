// Empfehlung & Ranking über den Katalog (§3.8). Verkettet die bereits gebauten Bausteine
// simulateBattery (§3.6) → computeBatterySavings (§3.7) → calculateRoi (§3.9) zu vollständigen
// `AnalysisResult.perBattery`-Einträgen samt Sortierung und Empfehlung. Keine Worker-/UI-
// Verdrahtung — das ist ein eigener, hier NICHT enthaltener Baustein.
export { recommendBattery } from './rank'
export type { RecommendationResult } from './rank'
