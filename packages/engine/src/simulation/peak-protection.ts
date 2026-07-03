import { clamp, EPS, type BatteryPhysics } from './helpers'

/**
 * Reiner Peak-Protection-Lauf (§3.6-Kasten, §3.6.1) — der Vorwärtslauf, gegen den die
 * Kapp-Suche prüft: „Musste die Batterie je über `cap` hinaus Bezug zulassen, weil `soc`
 * erschöpft oder `maxPowerKw` überschritten war?" (§3.6.1). Enthält NUR:
 *  - Schritt 2: Entladen bei Bezug > `cap` (Spitzenkappung), begrenzt durch `maxPowerKw` und `soc`.
 *  - Bereitschafts-Nachladung unter `cap` (staying ≤ cap, kein neuer Peak) — die „Spitzen-
 *    bereitschaft" aus Schritt 5, damit die Batterie für die nächste Spitze wieder Energie hat.
 * KEIN Eigenverbrauch (Schritt 4) und KEINE PV-Ladung (Schritt 3): das ist der „reine"
 * Peak-Protection-Lauf. Greedy-Nachladung (so viel wie möglich unter `cap`) maximiert die
 * Bereitschaft → die Kapp-Suche findet so die WIRKLICH niedrigste machbare Schwelle.
 *
 * `feasible` = die Schwelle `cap` konnte über die ganze Reihe gehalten werden (Bezug nie über
 * `cap` erzwungen). `endSocKwh` = der ECHTE End-SoC — für die sequenzielle Perioden-Übergabe
 * (§3.6.1: „den daraus resultierenden echten End-SoC nach Monat 1 übernehmen").
 */
export function runPeakProtection(
  draws: number[],
  capKw: number,
  physics: BatteryPhysics,
  startSocKwh: number,
  deltaH: number,
): { feasible: boolean; endSocKwh: number } {
  const { usableCapacityKwh, maxPowerKw, roundTripEfficiency: eta } = physics
  let soc = clamp(startSocKwh, 0, usableCapacityKwh)
  let feasible = true

  for (const draw of draws) {
    if (draw > capKw) {
      // Schritt 2: entladen, um den Bezug auf `cap` zu drücken.
      const neededKw = draw - capKw
      // Leistungsgrenze: mehr als maxPowerKw geht nie — dann ist `cap` schon aus Leistungsgründen unerreichbar.
      if (neededKw > maxPowerKw + EPS) feasible = false
      const dischargeKw = Math.min(neededKw, maxPowerKw, soc / deltaH)
      soc -= dischargeKw * deltaH
      // Energiegrenze: reichte `soc`/`maxPowerKw` nicht, bleibt Restbezug über `cap` → nicht machbar.
      if (draw - dischargeKw > capKw + EPS) feasible = false
    } else {
      // Bereitschafts-Nachladung unter `cap` (kein neuer Peak). Ladung erhöht den Bezug höchstens bis `cap`.
      const headroomKw = Math.max(0, capKw - Math.max(0, draw))
      const chargeKw = Math.min(maxPowerKw, headroomKw)
      const storedKwh = Math.min(chargeKw * deltaH * eta, usableCapacityKwh - soc)
      soc += storedKwh
    }
    soc = clamp(soc, 0, usableCapacityKwh)
  }

  return { feasible, endSocKwh: soc }
}
