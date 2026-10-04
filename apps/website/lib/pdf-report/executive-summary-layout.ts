import { PDF_CONTENT_WIDTH_PT } from './theme'

/**
 * Die festen Diagramm-Plätze der Vorderseite, in pt — alle über die volle Breite. Die Höhen sind
 * fest, damit die Seite mit und ohne Diagramm gleich umbricht; die Ein-Seiten-Prüfung gilt so auch
 * für das Kunden-PDF.
 */
export const EXEC_SLOTS = {
  load: { width: PDF_CONTENT_WIDTH_PT, height: 105 },
  ways: { width: PDF_CONTENT_WIDTH_PT, height: 95 },
  breakEven: { width: PDF_CONTENT_WIDTH_PT, height: 105 },
} as const

/** Seitenanker der Vorderseite (ohne Agenda-Eintrag; gemessen wird nur ihre Länge). */
export const EXECUTIVE_SUMMARY_SECTION_ID = 'executive_summary'

/** Schriftgrösse des Fliesstexts der Vorderseite. */
export const EXEC_TEXT_PT = 10.5
