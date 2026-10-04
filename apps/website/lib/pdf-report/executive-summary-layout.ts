import { PDF_CONTENT_WIDTH_PT } from './theme'

/** Abstand der beiden Spalten der Vorderseite „Auf einen Blick". */
export const EXEC_COLUMN_GAP_PT = 16

const COLUMN_WIDTH_PT = (PDF_CONTENT_WIDTH_PT - EXEC_COLUMN_GAP_PT) / 2

/**
 * Die festen Diagramm-Plätze der Vorderseite, in pt. Die Höhen sind fest, damit die Seite mit und
 * ohne Diagramm-Raster gleich umbricht — die Ein-Seiten-Prüfung gilt so auch für das Kunden-PDF.
 */
export const EXEC_SLOTS = {
  load: { width: PDF_CONTENT_WIDTH_PT, height: 100 },
  ways: { width: COLUMN_WIDTH_PT, height: 90 },
  /** Ohne Speicherblock steht die Wege-Spalte über die volle Breite. */
  waysFullWidth: { width: PDF_CONTENT_WIDTH_PT, height: 90 },
  breakEven: { width: COLUMN_WIDTH_PT, height: 90 },
} as const

/** Seitenanker der Vorderseite (ohne Agenda-Eintrag; gemessen wird nur ihre Länge). */
export const EXECUTIVE_SUMMARY_SECTION_ID = 'executive_summary'
