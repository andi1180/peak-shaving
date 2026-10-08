/**
 * Vorläufige Sichtbarkeits-Schalter für den PDF-Report.
 *
 * ⚠ Kein Rechenschalter — was hier auf `false` steht, wird weiterhin vollständig gebaut
 * (Contract, Ableitung, Chart-Rasterung); nur die Anzeige im Dokument wird unterdrückt. Der
 * zugrunde liegende Bau bleibt bestehen, damit das Wiedereinschalten ein Ein-Zeilen-Commit ist.
 */

/**
 * Kapitel „Hochrechnung auf ein ganzes Jahr" (D6 Teil 3). Seit E2 in `shared`: der Wizard-Lauf
 * entscheidet daran die Reihung (Jahres- oder lineare Basis) — hier nur weitergereicht.
 */
export { SHOW_ANNUAL_SCENARIO_CHAPTER } from 'shared'

/**
 * [VORLÄUFIG, 24.09.2026 — Auftrag Andreas] Die €-Blöcke des PV-Kapitels („Ihre PV-Anlage") sind
 * aus, sowohl der Zeitraum- als auch der Jahreswert (365 Tage) — Letzterer hängt an derselben
 * Hochrechnung wie `SHOW_ANNUAL_SCENARIO_CHAPTER`. Befund und „Einordnung" bleiben stehen, weil
 * sie keinen Betrag behaupten. Zurück, sobald die Engine-Rekonstruktion geprüft ist.
 */
export const SHOW_PV_VALUE_AMOUNTS = false

/**
 * Vorderseite „Auf einen Blick" (Executive Summary) zwischen Deckblatt und Agenda, nur wo
 * `buildExecutiveSummary` sie liefert. Diagramm-Plätze vorerst leer (`EXEC_SLOTS`).
 */
export const SHOW_EXECUTIVE_SUMMARY = true
