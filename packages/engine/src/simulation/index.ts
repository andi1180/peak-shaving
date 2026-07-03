// SoC-Simulation, Kapp-Schwellen-Suche & Spitzen-Reserve (§3.6/§3.6.1). Reine, deterministische
// Physik — controlType-unabhängig (static/dynamic-Zuschreibung ist §3.7), kein I/O, keine PvProfile-
// Verdrahtung. Der kombinierte Dispatch zu benannten Ersparnis-Feldern (§3.7), die Empfehlung (§3.8)
// und die Worker-/UI-Verdrahtung sind eigene, hier NICHT enthaltene Bausteine.
export { simulateBattery } from './simulate'
export type { BatterySimulationResult } from './simulate'
export { searchCaps, searchCapForPeriod } from './cap-search'
export type { CapSearchResult } from './cap-search'
export { computeSocFloor } from './reserve'
export { runCombinedDispatch } from './dispatch'
export type { DispatchResult } from './dispatch'
export { runPeakProtection } from './peak-protection'
export {
  START_SOC_FRACTION,
  startSoc,
  intervalHours,
  drawSeries,
  toPhysics,
  periodIndexByInterval,
} from './helpers'
export type { BatteryPhysics } from './helpers'
