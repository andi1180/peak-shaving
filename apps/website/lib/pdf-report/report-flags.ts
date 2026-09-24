/**
 * Vorläufige Sichtbarkeits-Schalter für den PDF-Report.
 *
 * ⚠ Kein Rechenschalter — was hier auf `false` steht, wird weiterhin vollständig gebaut
 * (Contract, Ableitung, Chart-Rasterung); nur die Anzeige im Dokument wird unterdrückt. Der
 * zugrunde liegende Bau bleibt bestehen, damit das Wiedereinschalten ein Ein-Zeilen-Commit ist.
 */

/**
 * [VORLÄUFIG, 24.09.2026 — Auftrag Andreas] Kapitel „Was wäre, wenn wir ein ganzes Jahr hätten?"
 * (D6 Teil 3) bleibt aus, inklusive Inhaltsverzeichnis und aller Verweise darauf: die
 * Hochrechnung füllt jeden fehlenden Tag mit der verbrauchsstärksten Woche und überhöht das
 * Ergebnis dadurch strukturell. Zurück, sobald die Engine das behebt (Regel 12 — Engine wird
 * dafür hier NICHT angefasst).
 */
export const SHOW_ANNUAL_SCENARIO_CHAPTER = false

/**
 * [VORLÄUFIG, 24.09.2026 — Auftrag Andreas] Die €-Blöcke des PV-Kapitels („Ihre PV-Anlage") sind
 * aus, sowohl der Zeitraum- als auch der Jahreswert (365 Tage) — Letzterer hängt an derselben
 * Hochrechnung wie `SHOW_ANNUAL_SCENARIO_CHAPTER`. Befund und „Einordnung" bleiben stehen, weil
 * sie keinen Betrag behaupten. Zurück, sobald die Engine-Rekonstruktion geprüft ist.
 */
export const SHOW_PV_VALUE_AMOUNTS = false
