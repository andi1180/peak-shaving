import type { LoadProfile } from 'shared'

/**
 * Jahres-Hochrechnung der ENERGIE-Ersparnis bei Teilzeitraum-Lastgängen (§3.7).
 *
 * ── DAS PROBLEM: ZWEI UNGLEICHARTIGE GRÖSSEN UNTER EINEM ETIKETT ───────────────────────────────
 * `leistungspreisSavingPerYear` ist RATENBASIERT: `(alt − neu) kW × €/kW·Jahr`. Der Leistungspreis
 * ist bereits ein Jahressatz, das Ergebnis also konstruktionsbedingt eine Jahresgrösse — egal, ob
 * der Lastgang 7 Tage oder 12 Monate abdeckt.
 *
 * `selfConsumptionSaving` und `loadShiftSaving` entstehen dagegen aus einer SUMMIERUNG über die
 * tatsächlich vorhandenen Intervalle: jede entladene kWh wird bewertet und aufaddiert. Bei einem
 * 209-Tage-Lastgang ist das die Ersparnis ÜBER 209 TAGE — und trug bis hierher trotzdem dasselbe
 * `...PerYear`-Etikett, floss unskaliert in dieselbe Summe und über `totalSavingPerYear` in
 * `amortizationYears` und `netSavingOverHorizon`. Ungleichartige Grössen wie gleichartige behandelt:
 * die Amortisation eines Kunden mit Teiljahres-Lastgang war dadurch systematisch zu lang, seine
 * Netto-Ersparnis über den Horizont zu klein — und zwar umso stärker, je kürzer sein Lastgang war.
 * Ein Fehler, der wie ein Ergebnis aussieht: nichts an den Zahlen wirkt falsch.
 *
 * ── DIE ANNAHME, DIE DER FIX MACHT — und sie ist eine Annahme, keine Messung ────────────────────
 * Hochgerechnet wird mit `365 / coveredDays`, also unter der Annahme eines HOMOGENEN JAHRES: die
 * nicht abgedeckten Tage verhalten sich im Mittel wie die abgedeckten. Das ist bei einem
 * Sommer-Halbjahr mit PV nachweislich zu optimistisch und bei einem Winter-Halbjahr zu
 * pessimistisch — deshalb bleibt der GEMESSENE Rohwert im Contract stehen und wird im Report
 * neben der hochgerechneten Zahl ausgewiesen (`...OverCoveredPeriod`). Der hochgerechnete Wert
 * darf den gemessenen nicht verdrängen: ein Kunde, dem eine Jahreszahl gezeigt wird, muss sehen
 * können, worauf sie beruht.
 *
 * Die Alternative — gar nicht hochrechnen — wäre KEINE ehrlichere Option, sondern dieselbe
 * Vermischung mit umgekehrtem Vorzeichen: `totalSavingPerYear` und alles, was daraus folgt, wären
 * dann teils Jahres-, teils Teilzeitraumgrössen.
 *
 * ── WARUM `coveredDays` NICHT DURCHGEREICHT WIRD ───────────────────────────────────────────────
 * Der Parser meldet `dataQuality.coveredDays = Math.round(totalSlots / 96)` (`parser/prepare.ts`),
 * und `totalSlots` IST die Länge des lückenlos gefüllten Gitters — also exakt
 * `loadProfile.readings.length`. Die Zahl ist damit eine reine Eigenschaft des `LoadProfile`, das
 * die Engine ohnehin in der Hand hat: kein neuer Parameter durch `recommendBattery` →
 * `buildPerBatteryEntry` → `computeBatterySavings`, keine Abhängigkeit auf `dataQuality` (das der
 * Standardprofil-Pfad separat erzeugt) und damit keine zweite Wahrheit über dieselbe Zahl. Die
 * Reinheit der Engine bleibt unangetastet — es kommt nichts herein, was nicht schon da war.
 * `annualization.test.ts` pinnt die Gleichheit gegen den vom Parser gemeldeten Wert, damit die
 * Ableitung nicht still auseinanderlaufen kann.
 */

/** Bezugslänge der Hochrechnung. Kalendarische Schaltjahre werden bewusst nicht unterschieden — s. `annualizationFactor`. */
export const DAYS_PER_YEAR = 365

/**
 * Abgedeckte Tage, abgeleitet aus dem lückenlosen Intervall-Gitter des Profils — dieselbe Formel
 * und derselbe Zähler wie in `parser/prepare.ts`, nur auf dem bereits aufbereiteten Profil.
 */
export function coveredDaysOf(loadProfile: LoadProfile): number {
  const slotsPerDay = (24 * 60) / loadProfile.intervalMinutes
  return Math.round(loadProfile.readings.length / slotsPerDay)
}

/**
 * Der Faktor, mit dem die beiden ENERGIE-Töpfe auf ein Jahr hochgerechnet werden. `1` heisst:
 * nicht hochgerechnet, gemessener Wert = ausgewiesener Wert.
 *
 * Drei Fälle liefern bewusst `1`:
 *  • `standard_profile` — das synthetische Profil deckt konstruktionsgemäss ein volles Kalenderjahr
 *    ab (`standard-profile/h0.ts`); eine Hochrechnung wäre dort entweder wirkungslos oder sie
 *    verstärkte einen Erzeugungsfehler. Der Fall wird deshalb an der HERKUNFT ausgeschlossen und
 *    nicht bloss über die Tageszahl — dieselbe Trennlinie, an der `peakShavingBlockers` entscheidet.
 *  • `coveredDays >= 365` — es wird nie nach UNTEN skaliert. Ein 366-Tage-Lastgang (Schaltjahr,
 *    oder ein Export mit Überhang) trägt eher etwas zu viel als zu wenig; ihn zu schrumpfen wäre
 *    eine Korrektur an einer Zahl, die auf echter Messung beruht, zugunsten einer Konvention.
 *  • `coveredDays <= 0` — leeres/unbrauchbares Profil; die Division ergäbe `Infinity`.
 */
export function annualizationFactor(loadProfile: LoadProfile): number {
  if (loadProfile.source === 'standard_profile') return 1
  const coveredDays = coveredDaysOf(loadProfile)
  if (coveredDays <= 0 || coveredDays >= DAYS_PER_YEAR) return 1
  return DAYS_PER_YEAR / coveredDays
}
