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
 *     Ist eine Tages-Rangfolge gesetzt (`priceOrder`, 02.09.2026), gilt zusätzlich deren
 *     Preis-Untergrenze: die Energie, die eine strikt TEURERE Stunde desselben Kalendertags noch
 *     nutzen könnte, bleibt liegen. Beide Untergrenzen werden über `max()` verrechnet — die
 *     Spitzen-Reserve wird dadurch nie aufgeweicht.
 *  5. Laden aus Netz. Zwei Fälle, gesteuert über `preferChargeInterval` (§3.7 Schritt-5-Ausbau):
 *     (a) GÜNSTIGES Tarif-Fenster (`preferChargeInterval[i] === true`): tarifbewusst laden —
 *         GREEDY so weit unter `cap` laden, wie Kapazität/`maxPowerKw` zulassen, um billige Energie
 *         für die teuren Fenster zu speichern (Lastverschiebung → `loadShiftSaving`). In günstigen
 *         Fenstern wird BEWUSST NICHT entladen (Netzbezug ist gerade billig; Eigenverbrauch lohnt
 *         nicht — Schritt 4 wird übersprungen). Ist eine Tages-Rangfolge gesetzt, begrenzt deren
 *         Ladeobergrenze das Greedy zusätzlich: Kapazität, die eine strikt GÜNSTIGERE Stunde
 *         desselben Kalendertags noch brauchen könnte, bleibt frei.
 *     (b) Sonst (kein/teures Fenster): nur bis zur Spitzenbereitschafts-Reserve nachladen, so weit
 *         unter `cap`, dass kein neuer Peak entsteht. Ohne PV/Tarif-Fenster lädt Schritt 5 nur bis
 *         zur Reserve → im Basisfall reiner Spitzenschutz, kein sinnloses Zyklieren.
 *  6. `soc` fortschreiben (in [0, usableCapacityKwh] geklammert).
 *
 * `socFloorKwh[i]` = Reserve, die am START von Intervall `i` vorhanden sein muss. Schritt 4 senkt
 * `soc` daher höchstens bis `socFloorKwh[i+1]` (die Reserve, mit der das nächste Intervall beginnen muss).
 *
 * `preferChargeInterval` (optional; default: alle `false`) markiert die günstigen Tarif-Fenster
 * (aus `intervalTariffRates`, §3.7). Ist es überall `false`, verhält sich der Dispatch exakt wie
 * §3.6 vor dem Schritt-5-Ausbau (reiner Spitzenschutz + PV-Eigenverbrauch).
 *
 * `priceOrder` (optional; ohne Angabe: keine Schranke) trägt die Tages-Rangfolge aus
 * `dailyPriceOrder` (§3.6 Schritt 5, 02.09.2026). Sie wirkt an GENAU ZWEI Stellen — der
 * Ladeobergrenze in Schritt 5(a) und der Entlade-Untergrenze in Schritt 4 — und ausdrücklich NICHT
 * in Schritt 2 (Spitzenkappung) und NICHT in Schritt 5(b) (Spitzenbereitschaft): der Speicher darf
 * nie aus Preisgründen eine Spitze verpassen, und er darf nie aus Preisgründen teure Energie
 * kaufen, nur um eine Preis-Untergrenze zu erreichen. Ohne den Parameter ist der Fahrplan
 * bit-identisch zum Stand davor (Regressionstest).
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
  preferChargeInterval?: boolean[],
  priceOrder?: { chargeCeilingKwh: number[]; priceFloorKwh: number[] },
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
    const preferCharge = preferChargeInterval?.[i] ?? false
    // Reserve, mit der das NÄCHSTE Intervall beginnen muss (am Jahresende 0).
    const floorNext = i + 1 < n ? (socFloorKwh[i + 1] ?? 0) : 0
    /*
     * Die Preis-Untergrenze ist bereits eine END-von-`i`-Grösse (sie summiert über die Intervalle
     * NACH `i`) und wird deshalb bei `i` gelesen, nicht bei `i + 1`. `max()` mit der Spitzen-Reserve:
     * die strengere gewinnt, die Spitzenbereitschaft kann dadurch nicht sinken.
     */
    const dischargeFloorNext = Math.max(floorNext, priceOrder?.priceFloorKwh[i] ?? 0)

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
    } else if (preferCharge) {
      // Schritt 5(a) — GÜNSTIGES Fenster: tarifbewusst greedy laden (Lastverschiebung, §3.7).
      // So weit unter `cap`, dass kein neuer Peak entsteht; begrenzt durch Leistung und freien Platz.
      // BEWUSST kein Entladen hier (billiges Netz zieht man direkt, statt teure/PV-Energie zu vergeuden).
      const headroomKw = Math.max(0, cap - Math.max(0, draw))
      // Ladeobergrenze der Tages-Rangfolge (ohne sie die volle Kapazität): was eine strikt
      // günstigere Stunde desselben Tages noch brauchen könnte, bleibt frei.
      const ceilingKwh = Math.min(usableCapacityKwh, priceOrder?.chargeCeilingKwh[i] ?? usableCapacityKwh)
      const freeKwh = Math.max(0, ceilingKwh - soc)
      const chargeKw = Math.min(maxPowerKw, headroomKw, freeKwh / (deltaH * eta))
      soc += chargeKw * deltaH * eta
      batteryKw = chargeKw
    } else if (soc > dischargeFloorNext + EPS) {
      // Schritt 4 — Eigenverbrauch aus der Restkapazität ÜBER der Reserve. Nie unter
      // `dischargeFloorNext` (Spitzen-Reserve, ggf. angehoben durch die Preis-Untergrenze), und nie
      // so viel, dass Netzbezug < 0 (kein künstlicher Export): entladen ≤ `draw`.
      const availAboveFloorKwh = soc - dischargeFloorNext
      const dischargeKw = Math.min(draw, maxPowerKw, availAboveFloorKwh / deltaH)
      soc -= dischargeKw * deltaH
      batteryKw = -dischargeKw
    } else {
      // Schritt 5 — Spitzenbereitschaft: `soc` erreicht die nächste Reserve nicht → nachladen,
      // aber nur so weit unter `cap`, dass kein neuer Peak entsteht (Ladung erhöht Bezug ≤ cap).
      // ⚠ BEWUSST `floorNext` und NICHT `dischargeFloorNext`: die Preis-Untergrenze ist eine
      // Sperre für das Entladen, kein Ladeziel. Als Ziel gelesen kaufte der Speicher in einer
      // beliebig teuren Stunde Energie, nur um sie später ebenso teuer wieder abzugeben — nach
      // Abzug der Ladeverluste ein sicheres Verlustgeschäft.
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
