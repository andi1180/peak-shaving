// Kombinierter Dispatch → benannte Ersparnis-Felder (§3.7). Verwandelt die §3.6-Simulation eines
// Batterie-Kandidaten in die drei disjunkten Ersparnis-Anteile des `AnalysisResult.perBattery`-
// Contracts (Leistungspreis / Eigenverbrauch / Lastverschiebung), inkl. controlType-Default.
export { computeBatterySavings } from './attribute'
export type { BatterySavings } from './attribute'
