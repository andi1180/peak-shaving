/**
 * Vorläufige Sichtbarkeits-Schalter für den PDF-Report.
 *
 * ⚠ Kein Rechenschalter — was hier auf `false` steht, wird weiterhin vollständig gebaut
 * (Contract, Ableitung, Chart-Rasterung); nur die Anzeige im Dokument wird unterdrückt. Der
 * zugrunde liegende Bau bleibt bestehen, damit das Wiedereinschalten ein Ein-Zeilen-Commit ist.
 */

/**
 * Kapitel „Hochrechnung auf ein ganzes Jahr" (D6 Teil 3). Seit 01.10.2026 wieder an: die Füllung
 * kommt aus dem gemessenen Wochenblock statt aus der stärksten Woche, PV-Fälle sind ausgenommen.
 */
export const SHOW_ANNUAL_SCENARIO_CHAPTER = true

/**
 * [VORLÄUFIG, 24.09.2026 — Auftrag Andreas] Die €-Blöcke des PV-Kapitels („Ihre PV-Anlage") sind
 * aus, sowohl der Zeitraum- als auch der Jahreswert (365 Tage) — Letzterer hängt an derselben
 * Hochrechnung wie `SHOW_ANNUAL_SCENARIO_CHAPTER`. Befund und „Einordnung" bleiben stehen, weil
 * sie keinen Betrag behaupten. Zurück, sobald die Engine-Rekonstruktion geprüft ist.
 */
export const SHOW_PV_VALUE_AMOUNTS = false

/**
 * Vorderseite „Auf einen Blick" (Executive Summary): Modell und Kundentexte sind gebaut
 * (`executive-summary.ts`), die Seite ist noch nicht ins Dokument eingehängt.
 */
export const SHOW_EXECUTIVE_SUMMARY = false
