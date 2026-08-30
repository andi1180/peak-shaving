import type { BatteryCandidate, LoadProfile } from 'shared'

/**
 * Wann wird die Spitzenkappung NICHT gerechnet und NICHT kreditiert (Delta 3, Delta 8) —
 * die eine Stelle, an der diese Frage beantwortet wird.
 *
 * ── WARUM EIN EIGENES MODUL FÜR EINEN ZWEIZEILER ────────────────────────────────────────────────
 * Die Antwort wird an ZWEI Stellen gebraucht, und sie müssen dieselbe geben: `simulateBattery`
 * (§3.6) wählt daran die Kappungs-Konfiguration (`cap = ∞`, `socFloor ≡ 0`), `computeBatterySavings`
 * (§3.7) daran die Zuschreibung (`leistungspreisSaving = 0`, `newBilledKw` = alter Wert). Liefen die
 * beiden auseinander, entstünde der schlimmste der möglichen Zustände: ein reserve-frei simulierter
 * Fahrplan, dessen zufällig veränderter Netzbezug als Spitzenkappungs-Ersparnis kreditiert wird.
 * Bis Delta 9b-1 stand die Bedingung an beiden Stellen ausgeschrieben (`controlType === 'static'`);
 * mit einem zweiten Grund wäre das eine Kopie zu viel.
 *
 * ── DIE GRÜNDE SIND VERSCHIEDEN, DIE WIRKUNG IST DIESELBE ───────────────────────────────────────
 *   • `static_control` (OP#5): die STEUERUNG kann nicht kappen. Eine Aussage über das Produkt.
 *   • `standard_profile` (Delta 8): der Lastgang ist SYNTHETISCH. Eine Aussage über die Datenlage —
 *     ein Standardlastprofil trägt die Tarif-Arbitrage (die Tagesform genügt für einen
 *     Durchschnittspreis-Vergleich), aber NICHT die Leistungspreis-Dimensionierung: eine
 *     individuelle Spitze lässt sich daraus nicht seriös schätzen, und eine geschätzte
 *     Spitzenlast-Ersparnis wäre eine erfundene Zahl (Prinzip 1, Prinzip 7).
 *     ⚠ Das gilt UNABHÄNGIG vom nominellen Vertragsstatus des Kunden — auch wenn er einen Tarif
 *     MIT Leistungsmessung gewählt hat und der Leistungspreis > 0 ist. Delta 8 sagt das wörtlich.
 *
 * Deshalb eine LISTE und kein einzelner Grund: treffen beide zu, sind auch beide wahr, und der
 * Report soll beide sagen können statt einen davon zu unterschlagen.
 *
 * ── WAS HIER (NOCH) NICHT STEHT ─────────────────────────────────────────────────────────────────
 * Delta 3 nennt als ERSTE Anwendung `tariffParams.leistungspreisEurPerKwYear === 0` (Tarifvariante
 * „ohne Leistungsmessung", Delta 5). Die ist bewusst nicht Teil dieses Bauabschnitts: sie ist
 * rechnerisch heute schon folgenlos (`(alt − neu) × 0 = 0`), ändert aber die SIMULATION (die
 * Reserve gäbe die Kapazität für den Eigenverbrauch frei) und gehört damit in einen eigenen Schritt
 * mit eigener Messung. Wer sie nachträgt, tut es HIER und an keiner zweiten Stelle.
 */
export type PeakShavingBlocker = 'static_control' | 'standard_profile'

export function peakShavingBlockers(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
): PeakShavingBlocker[] {
  const blockers: PeakShavingBlocker[] = []
  if (battery.controlType === 'static') blockers.push('static_control')
  if (loadProfile.source === 'standard_profile') blockers.push('standard_profile')
  return blockers
}

/** Kurzform für die Simulation, die nur das Ob braucht (nicht das Warum). */
export function isPeakShavingDisabled(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
): boolean {
  return peakShavingBlockers(loadProfile, battery).length > 0
}
