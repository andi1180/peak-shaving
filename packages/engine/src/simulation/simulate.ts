import type { BatteryCandidate, LoadProfile, PvProfile, TariffParams } from 'shared'

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
import { alignPvGrossToLoad } from './pv'
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
  /**
   * Brutto-PV-Erzeugung je Intervall (kW, ≥ 0) — NUR gesetzt, wenn ein `PvProfile` übergeben wurde
   * (auf die Einspeisung hochgeklemmt, §3.1-Konsistenz, s. `alignPvGrossToLoad`). Speist den echten
   * PV-Strom (`pvGenerationKw`) + den abgeleiteten Verbrauch der §6.2-Charts (`buildDispatchTrace`).
   * Ohne PvProfile `undefined` → der Trace fällt auf die am Zähler sichtbare Einspeisung zurück.
   * Ändert NICHT den Dispatch/die Ersparnis (der speicherbare Überschuss = Einspeisung ist bereits im
   * signierten `gridPowerKw` enthalten, s. Kopf-Kommentar `simulateBattery`).
   */
  grossPvKw?: number[]
}

/**
 * Vollständige SoC-Simulation eines Batterie-Kandidaten (§3.6 + §3.6.1), rein & deterministisch.
 * Ablauf:
 *   1. Kapp-Suche je Periode, sequenziell mit echtem SoC-Übertrag (§3.6.1).
 *   2. Spitzen-Reserve `socFloor(t)` aus den gefundenen Caps (§3.6-Kasten).
 *   3. Kombinierter Dispatch (die 6 Schritte, §3.6), der die Reserve respektiert.
 *   4. Neuer abgerechneter kW-Wert = TariffStrategy (§3.5) auf dem gekappten Profil (`gridAfterKw`).
 *
 * PvProfile (OPTIONAL, §3.1): liefert die BRUTTO-PV-Erzeugung. WICHTIG — es ändert den DISPATCH und
 * damit die Ersparnis NICHT: der für die Batterie speicherbare Überschuss ist die am Zähler sichtbare
 * Einspeisung `max(0, −gridPowerKw)`, und die steckt bereits im signierten Netz-Lastgang (§3.1: der
 * Netz-Lastgang „enthält den PV-Effekt bereits"). Brutto-PV, die vor Ort direkt verbraucht wird, ist
 * schon in der Last aufgegangen und kann nicht ein zweites Mal gespeichert werden — sie erhöht den
 * Eigenverbrauchs-Anteil NICHT (sonst Energie aus dem Nichts / Bilanzbruch). Die Brutto-PV wird daher
 * nur AUSGERICHTET/konsistenzgeprüft (`alignPvGrossToLoad`, §3.1) und als `grossPvKw` mitgeführt — sie
 * speist den echten 4. Strom (abgeleiteter Verbrauch) der §6.2-Charts, nicht die Physik. Ohne PvProfile:
 * unveränderter Pfad, `grossPvKw` bleibt `undefined` (bit-identisch — Regressionstest).
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
  pvProfile?: PvProfile,
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

  // Brutto-PV (optional): NUR ausgerichtet + konsistenzgeprüft, kein Physik-Eingriff (s. Kopf-Kommentar).
  const grossPvKw = pvProfile ? alignPvGrossToLoad(loadProfile, pvProfile).grossPvKw : undefined

  return { capKwByPeriod, newBilledKw, socFloorKwh, dispatch, startSocKwh: socStart, grossPvKw }
}
