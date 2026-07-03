import { clamp, EPS, type BatteryPhysics } from './helpers'

/**
 * Ergebnis des kombinierten Dispatch-Laufs (§3.6) — die drei Simulations-Zeitreihen, aus denen
 * §3.7 (Ersparnis-Aufschlüsselung) und §6.2 (Charts, `dispatchTrace.representativeDays`) später
 * schöpfen. Länge jeweils = Anzahl Intervalle. Hier werden BEWUSST noch keine Ersparnis-Felder
 * gerechnet (das ist §3.7) — nur der physikalische Fahrplan.
 */
export type DispatchResult = {
  /** SoC (kWh) am ENDE jedes Intervalls, stets in [0, usableCapacityKwh]. */
  socKwh: number[]
  /** Netzbezug NACH Batterie (signiert, + = Bezug, − = Einspeisung). Es gilt gridAfter = draw + batteryPowerKw. */
  gridAfterKw: number[]
  /** Batterieleistung, Vorzeichen **+ = laden, − = entladen** (Contract-Konvention `DispatchTrace`). */
  batteryPowerKw: number[]
}

/**
 * Kombinierter Dispatch (§3.6) — EIN chronologischer Durchlauf über alle 15-min-Intervalle mit
 * mitgeführtem `soc`. Pro Intervall die sechs Schritte, Priorität Spitzenschutz (`peak_first`):
 *
 *  1. Ausgangslast `draw = gridPowerKw` (signiert) lesen.
 *  2. Entladen (Spitzenkappung, PRIORITÄT): `draw > cap` → so viel entladen wie nötig, begrenzt
 *     durch `maxPowerKw` und `soc`.
 *  3. Laden aus PV-Überschuss (Eigenverbrauch): `draw < 0` (Einspeisung) → Überschuss laden,
 *     begrenzt durch `maxPowerKw` und freien Platz, Wirkungsgrad `eta` auf die Ladung.
 *  4. Entladen (Eigenverbrauch, Restkapazität): `0 ≤ draw ≤ cap` und `soc` über der Reserve →
 *     Bezug substituieren, aber `soc` NIE unter `socFloor` senken (Spitzen-Reserve, §3.6-Kasten).
 *  5. Laden aus Netz (Spitzenbereitschaft): reicht `soc` die Reserve nicht → so weit unter `cap`
 *     nachladen, dass kein neuer Peak über `cap` entsteht. (Tarif-BEVORZUGUNG in günstigen Fenstern
 *     = Lastverschiebung/`loadShiftSaving` ist §3.7 und hier bewusst NICHT verdrahtet; ohne
 *     PV/Tarif-Fenster lädt Schritt 5 nur bis zur Reserve → im Basisfall reiner Spitzenschutz,
 *     kein sinnloses Netz-lade-dann-entlade-Zyklieren, Eigenverbrauchsersparnis bleibt 0.)
 *  6. `soc` fortschreiben (in [0, usableCapacityKwh] geklammert).
 *
 * `socFloorKwh[i]` = Reserve, die am START von Intervall `i` vorhanden sein muss. Schritt 4 senkt
 * `soc` daher höchstens bis `socFloorKwh[i+1]` (die Reserve, mit der das nächste Intervall beginnen muss).
 *
 * Constraints (hart, in mehreren Tests abgesichert): Lade-/Entladeleistung ≤ `maxPowerKw`; Energie
 * ≤ `soc` bzw. freier Platz; `soc` stets in [0, usableCapacityKwh]; Wirkungsgradverluste beim Laden.
 */
export function runCombinedDispatch(
  draws: number[],
  capForInterval: number[],
  socFloorKwh: number[],
  physics: BatteryPhysics,
  startSocKwh: number,
  deltaH: number,
): DispatchResult {
  const { usableCapacityKwh, maxPowerKw, roundTripEfficiency: eta } = physics
  const n = draws.length
  const socKwh = new Array<number>(n).fill(0)
  const gridAfterKw = new Array<number>(n).fill(0)
  const batteryPowerKw = new Array<number>(n).fill(0)

  let soc = clamp(startSocKwh, 0, usableCapacityKwh)

  for (let i = 0; i < n; i++) {
    const draw = draws[i] ?? 0
    const cap = capForInterval[i] ?? Infinity
    // Reserve, mit der das NÄCHSTE Intervall beginnen muss (am Jahresende 0).
    const floorNext = i + 1 < n ? (socFloorKwh[i + 1] ?? 0) : 0

    let batteryKw = 0 // + = laden, − = entladen

    if (draw > cap) {
      // Schritt 2 — Spitzenkappung (Priorität).
      const dischargeKw = Math.min(draw - cap, maxPowerKw, soc / deltaH)
      soc -= dischargeKw * deltaH
      batteryKw = -dischargeKw
    } else if (draw < 0) {
      // Schritt 3 — PV-Überschuss laden (Eigenverbrauch). Wirkungsgrad auf die Ladung.
      const freeKwh = usableCapacityKwh - soc
      const chargeKw = Math.min(-draw, maxPowerKw, freeKwh / (deltaH * eta))
      soc += chargeKw * deltaH * eta
      batteryKw = chargeKw
    } else if (soc > floorNext + EPS) {
      // Schritt 4 — Eigenverbrauch aus der Restkapazität ÜBER der Reserve. Nie unter `floorNext`,
      // und nie so viel, dass Netzbezug < 0 (kein künstlicher Export): entladen ≤ `draw`.
      const availAboveFloorKwh = soc - floorNext
      const dischargeKw = Math.min(draw, maxPowerKw, availAboveFloorKwh / deltaH)
      soc -= dischargeKw * deltaH
      batteryKw = -dischargeKw
    } else {
      // Schritt 5 — Spitzenbereitschaft: `soc` erreicht die nächste Reserve nicht → nachladen,
      // aber nur so weit unter `cap`, dass kein neuer Peak entsteht (Ladung erhöht Bezug ≤ cap).
      const deficitKwh = floorNext - soc
      if (deficitKwh > EPS) {
        const headroomKw = Math.max(0, cap - Math.max(0, draw))
        const freeKwh = usableCapacityKwh - soc
        const neededChargeKw = deficitKwh / (deltaH * eta)
        const chargeKw = Math.min(maxPowerKw, headroomKw, neededChargeKw, freeKwh / (deltaH * eta))
        soc += chargeKw * deltaH * eta
        batteryKw = chargeKw
      }
    }

    soc = clamp(soc, 0, usableCapacityKwh)
    socKwh[i] = soc
    batteryPowerKw[i] = batteryKw
    gridAfterKw[i] = draw + batteryKw
  }

  return { socKwh, gridAfterKw, batteryPowerKw }
}
