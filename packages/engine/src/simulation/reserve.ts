import { type BatteryPhysics } from './helpers'

/**
 * Spitzen-Reserve `socFloor(t)` (§3.6, Definitionskasten) — „die minimale Energie, die zu jedem
 * Zeitpunkt `t` im Speicher bleiben muss, damit ALLE noch ausstehenden Kappungen der restlichen
 * Periode garantiert erreichbar sind." Schritt 4 (Eigenverbrauch) darf `soc(t)` nie darunter senken.
 *
 * Umsetzung als RÜCKWÄRTS-Pass über das Jahr (das ist die präzise Realisierung der Definition —
 * eine vorwärts laufende Trajektorie könnte die „minimale" Reserve nicht ohne Vorausschau kennen):
 *   R[N] = 0  (am Periodenende keine ausstehenden Kappungen mehr)
 *   Spitzenintervall (draw > cap): R[i] = R[i+1] + benötigte Entladeenergie   (kein Nachladen möglich)
 *   sonst:                          R[i] = max(0, R[i+1] − mögliche Nachladeenergie)
 * Der Rückblick ist BEWUSST voll (bekannte künftige Spitzen im historischen Datensatz) → der daraus
 * folgende Eigenverbrauchs-Anteil ist eine Bestmarke mit vollem Rückblick, kein Versprechen für eine
 * rein reaktive Steuerung (§3.6 „methodische Konsequenz"; Report weist das aus, §6.2). Der
 * Leistungspreis-/Spitzenschutz-Anteil ist davon NICHT betroffen.
 *
 * `socFloor(t)` erzeugt SELBST keine Ersparnis (kein zweiter Dispatch — Prinzip 2). Reiner interner
 * Hilfslauf, der ausschließlich die Untergrenze für Schritt 4 liefert.
 *
 * EIN durchgehender Rückwärts-Pass übers ganze Jahr (nicht 12 unabhängige): dadurch trägt die Reserve
 * über Monatsgrenzen — ein Monat läuft nicht „blind" leer, wenn Anfang des Folgemonats eine Spitze steht.
 */
export function computeSocFloor(
  draws: number[],
  capForInterval: number[],
  physics: BatteryPhysics,
  deltaH: number,
): number[] {
  const { usableCapacityKwh, maxPowerKw, roundTripEfficiency: eta } = physics
  const n = draws.length
  const floor = new Array<number>(n).fill(0)

  let next = 0 // R[N] = 0
  for (let i = n - 1; i >= 0; i--) {
    const draw = draws[i] ?? 0
    const cap = capForInterval[i] ?? Infinity
    let r: number
    if (draw > cap) {
      // Spitze: es MUSS entladen werden; kein Nachladen in diesem Intervall.
      const dischargeKwh = Math.min(draw - cap, maxPowerKw) * deltaH
      r = next + dischargeKwh
    } else {
      // Kein-Peak-Intervall: es KANN nachgeladen werden (unter `cap`, kein neuer Peak).
      const headroomKw = Math.max(0, cap - Math.max(0, draw))
      const chargeKwh = Math.min(maxPowerKw, headroomKw) * deltaH * eta
      r = Math.max(0, next - chargeKwh)
    }
    // Clamp: mehr als die Kapazität kann nie reserviert werden. Übersteigt die wahre Reserve die
    // Kapazität, war die `cap` zu niedrig — das verhindert die Kapp-Suche (§3.6.1) bereits; der Clamp
    // hält den Dispatch nur numerisch stabil.
    r = Math.min(r, usableCapacityKwh)
    floor[i] = r
    next = r
  }

  return floor
}
