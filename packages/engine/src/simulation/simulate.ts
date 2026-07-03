import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { getTariffStrategy } from '../tariff/strategy'
import { searchCaps } from './cap-search'
import { runCombinedDispatch, type DispatchResult } from './dispatch'
import {
  capForIntervalSeries,
  drawSeries,
  intervalHours,
  periodIndexByInterval,
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
 * PV-behaftete) signierte `LoadProfile.gridPowerKw`. Kein `controlType`-Branching: §3.6/§3.6.1 sind
 * controlType-unabhängige Physik; die static/dynamic-Zuschreibung ist §3.7.
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

  // 1. Kapp-Suche (§3.6.1).
  const { capKwByPeriod } = searchCaps(loadProfile, physics, tariffParams.billingModel)
  const capForInterval = capForIntervalSeries(capKwByPeriod, periodOfInterval)

  // 2. Spitzen-Reserve (§3.6-Kasten).
  const socFloorKwh = computeSocFloor(draws, capForInterval, physics, deltaH)

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
