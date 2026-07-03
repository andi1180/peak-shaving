import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { getTariffStrategy } from '../tariff/strategy'
import { searchCaps } from './cap-search'
import { runCombinedDispatch, type DispatchResult } from './dispatch'
import {
  capForIntervalSeries,
  drawSeries,
  intervalHours,
  periodIndexByInterval,
  periodSlotCount,
  startSoc,
  toPhysics,
} from './helpers'
import { computeSocFloor } from './reserve'
import { intervalTariffRates } from './tou'

/**
 * Gesamt-Ergebnis der Batterie-Simulation für EINEN Kandidaten (§3.6/§3.6.1). Trägt die
 * physikalischen Größen, aus denen §3.7 (benannte Ersparnis-Felder) und §6.2 (Charts) schöpfen —
 * hier werden noch KEINE Ersparnis-/ROI-Felder gerechnet (eigene Prompts §3.7/§3.9).
 */
export type BatterySimulationResult = {
  /** Kapp-Schwelle je Contract-Slot (§3.10): Länge 1 (`annual_max`) / 12 (`monthly_*`). 0 = Monat nicht abgedeckt. */
  capKwByPeriod: number[]
  /** Neuer ABGERECHNETER kW-Wert — via TariffStrategy (§3.5) auf dem gekappten Profil, inkl. Mindestleistung. */
  newBilledKw: number
  /** Spitzen-Reserve-Trajektorie `socFloor(t)` (§3.6, kWh je Intervall). */
  socFloorKwh: number[]
  /** Der kombinierte Dispatch-Fahrplan (SoC/Netz-nach-Batterie/Batterieleistung je Intervall). */
  dispatch: DispatchResult
  /** Start-SoC am 1.1. (§3.6.1 [ANNAHME] = 50 % nutzbare Kapazität) — für Transparenz mitgeführt. */
  startSocKwh: number
}

/**
 * Vollständige SoC-Simulation eines Batterie-Kandidaten (§3.6 + §3.6.1), rein & deterministisch.
 * Ablauf:
 *   1. Kapp-Suche je Periode, sequenziell mit echtem SoC-Übertrag (§3.6.1).
 *   2. Spitzen-Reserve `socFloor(t)` aus den gefundenen Caps (§3.6-Kasten).
 *   3. Kombinierter Dispatch (die 6 Schritte, §3.6), der die Reserve respektiert.
 *   4. Neuer abgerechneter kW-Wert = TariffStrategy (§3.5) auf dem gekappten Profil (`gridAfterKw`).
 *
 * PV wird hier NICHT über ein separates `PvProfile` verdrahtet — es zählt allein der (ggf. bereits
 * PV-behaftete) signierte `LoadProfile.gridPowerKw`.
 *
 * `controlType` (Martins bestätigte Semantik, OP#5) ist eine Frage der STEUERUNGS-Konfiguration,
 * nicht der Batteriezelle, und wählt hier — im Orchestrator — die Kappungs-Konfiguration:
 *   • `dynamic` → Spitzenkappung (reaktiv/prädiktiv): Kapp-Suche (§3.6.1) + Spitzen-Reserve (§3.6).
 *   • `static`  → NUR Eigenverbrauch/Lastverschiebung, KEINE Spitzenkappung → keine Kapp-Schwelle
 *     (`cap = ∞` je Slot) und damit reserve-frei (`socFloor ≡ 0`): die volle Kapazität steht dem
 *     Eigenverbrauch zur Verfügung (nicht durch eine Spitzen-Reserve gebunden).
 * Die Kern-Physik-Primitiven (`searchCaps`/`computeSocFloor`/`runCombinedDispatch`) bleiben
 * controlType-agnostisch — sie bekommen Caps/Reserve als Eingabe; NUR dieser Orchestrator entscheidet,
 * welche er ihnen für `static` vs. `dynamic` reicht. Die Ersparnis-Zuschreibung folgt in §3.7.
 */
export function simulateBattery(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
): BatterySimulationResult {
  const physics = toPhysics(battery)
  const deltaH = intervalHours(loadProfile)
  const draws = drawSeries(loadProfile)
  const periodOfInterval = periodIndexByInterval(loadProfile, tariffParams.billingModel)
  const isStatic = battery.controlType === 'static'

  // 1. Kapp-Suche (§3.6.1). `static` kappt keine Spitzen → `cap = ∞` je Contract-Slot (nie eine Spitze
  //    gekappt); `dynamic` sucht die niedrigste machbare Schwelle je Periode.
  const capKwByPeriod = isStatic
    ? new Array<number>(periodSlotCount(tariffParams.billingModel)).fill(Infinity)
    : searchCaps(loadProfile, physics, tariffParams.billingModel).capKwByPeriod
  const capForInterval = capForIntervalSeries(capKwByPeriod, periodOfInterval)

  // 2. Spitzen-Reserve (§3.6-Kasten). Bei `cap = ∞` ergäbe `computeSocFloor` ohnehin überall 0; für
  //    `static` setzen wir die reserve-freie Trajektorie direkt (kein Rückwärts-Pass nötig).
  const socFloorKwh = isStatic
    ? new Array<number>(draws.length).fill(0)
    : computeSocFloor(draws, capForInterval, physics, deltaH)

  // 3. Kombinierter Dispatch (§3.6). Günstige Tarif-Fenster (§3.7 Schritt 5a) steuern das
  //    tarifbewusste Laden; ohne Fenster ist `isCheapWindow` überall false → reiner Spitzenschutz.
  const { isCheapWindow } = intervalTariffRates(loadProfile, tariffParams)
  const socStart = startSoc(physics)
  const dispatch = runCombinedDispatch(
    draws,
    capForInterval,
    socFloorKwh,
    physics,
    socStart,
    deltaH,
    isCheapWindow,
  )

  // 4. Neuer abgerechneter kW-Wert via die bereits gebaute TariffStrategy (§3.5) auf dem gekappten Profil.
  const cappedProfile: LoadProfile = {
    ...loadProfile,
    readings: loadProfile.readings.map((r, i) => ({
      ts: r.ts,
      gridPowerKw: dispatch.gridAfterKw[i] ?? r.gridPowerKw,
    })),
  }
  const newBilledKw = getTariffStrategy(tariffParams.billingModel).billedKw(cappedProfile, tariffParams)

  return { capKwByPeriod, newBilledKw, socFloorKwh, dispatch, startSocKwh: socStart }
}
