import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

/**
 * Wann wird die Spitzenkappung NICHT gerechnet und NICHT kreditiert (Delta 3, Delta 8) —
 * die eine Stelle, an der diese Frage beantwortet wird.
 *
 * ── WARUM EIN EIGENES MODUL FÜR EINEN DREIZEILER ────────────────────────────────────────────────
 * Die Antwort wird an ZWEI Stellen gebraucht, und sie müssen dieselbe geben: `simulateBattery`
 * (§3.6) wählt daran die Kappungs-Konfiguration (`cap = ∞`, `socFloor ≡ 0`), `computeBatterySavings`
 * (§3.7) daran die Zuschreibung (`leistungspreisSaving = 0`, `newBilledKw` = alter Wert). Liefen die
 * beiden auseinander, entstünde der schlimmste der möglichen Zustände: ein reserve-frei simulierter
 * Fahrplan, dessen zufällig veränderter Netzbezug als Spitzenkappungs-Ersparnis kreditiert wird.
 * Bis Delta 9b-1 stand die Bedingung an beiden Stellen ausgeschrieben (`controlType === 'static'`);
 * mit einem zweiten Grund wäre das eine Kopie zu viel.
 *
 * ── DIE GRÜNDE SIND VERSCHIEDEN, DIE WIRKUNG IST DIESELBE ───────────────────────────────────────
 *   • `static_control` (OP#5): die STEUERUNG kann nicht kappen. Eine Aussage über das Produkt —
 *     mit zusätzlicher Steuerungshardware behebbar.
 *   • `standard_profile` (Delta 8): der Lastgang ist SYNTHETISCH. Eine Aussage über die Datenlage —
 *     ein Standardlastprofil trägt die Tarif-Arbitrage (die Tagesform genügt für einen
 *     Durchschnittspreis-Vergleich), aber NICHT die Leistungspreis-Dimensionierung: eine
 *     individuelle Spitze lässt sich daraus nicht seriös schätzen, und eine geschätzte
 *     Spitzenlast-Ersparnis wäre eine erfundene Zahl (Prinzip 1, Prinzip 7).
 *     ⚠ Das gilt UNABHÄNGIG vom nominellen Vertragsstatus des Kunden — auch wenn er einen Tarif
 *     MIT Leistungsmessung gewählt hat und der Leistungspreis > 0 ist. Delta 8 sagt das wörtlich.
 *   • `no_demand_charge` (Delta 3, ERSTE Anwendung; Tarifvariante „ohne Leistungsmessung", Delta 5):
 *     der TARIF hat den Posten gar nicht. Eine Aussage über die Abrechnung — weder ein Produkt-
 *     noch ein Datenmangel, sondern schlicht nichts zu sparen. Behebbar allein durch einen anderen
 *     Tarif, und ob der günstiger wäre, entscheidet dieser Rechner nicht.
 *
 * ⚠ Der dritte Grund ist NICHT bloss eine Wiederholung der Multiplikation. Rechnerisch war die
 * Zuschreibung schon immer sicher (`(alt − neu) × 0 = 0` — es gab hier nie eine falsche Zahl); was
 * sich ändert, ist die SIMULATION. Ohne diesen Blocker sucht `simulateBattery` weiterhin eine
 * Kapp-Schwelle und bindet über `socFloor` Kapazität, um eine Spitze zu schützen, deren Senkung
 * exakt null Euro wert ist. Diese Kapazität fehlte dem Eigenverbrauch — der Kunde bekäme also ein
 * schlechteres Ergebnis als das physikalisch mögliche, und zwar zugunsten eines Postens, den seine
 * Rechnung nicht kennt.
 *
 * Geprüft wird auf exakt `=== 0`: das Schema (`tariffParamsSchema`) lässt keine negativen Werte zu,
 * und Delta 3 nennt genau diesen Wert. Ein `<= 0` erfände eine Regel für einen Fall, den es nicht
 * gibt.
 *
 * Deshalb eine LISTE und kein einzelner Grund: treffen mehrere zu, sind auch mehrere wahr, und der
 * Report soll alle sagen können statt einen davon zu unterschlagen.
 */
export type PeakShavingBlocker = 'static_control' | 'standard_profile' | 'no_demand_charge'

export function peakShavingBlockers(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
): PeakShavingBlocker[] {
  const blockers: PeakShavingBlocker[] = []
  if (battery.controlType === 'static') blockers.push('static_control')
  if (loadProfile.source === 'standard_profile') blockers.push('standard_profile')
  if (tariffParams.leistungspreisEurPerKwYear === 0) blockers.push('no_demand_charge')
  return blockers
}

/** Kurzform für die Simulation, die nur das Ob braucht (nicht das Warum). */
export function isPeakShavingDisabled(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
): boolean {
  return peakShavingBlockers(loadProfile, battery, tariffParams).length > 0
}
