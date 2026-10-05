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

/** Die zwei Boxen oben auf der Seite: Ersparnis und Rückzahlzeit, feste Höhe. */
export const EXEC_HERO = {
  gap: 12,
  boxWidth: (PDF_CONTENT_WIDTH_PT - 12) / 2,
  height: 85,
  padding: 10,
  paddingVertical: 7,
  edge: 2.6,
  valueMaxPt: 32,
  /** Unterzeile höchstens 9 pt, kleiner nur wenn sie sonst umbräche (die Box hat eine feste Höhe). */
  subMaxPt: 9,
  /** Innenbreite einer halben Box. */
  innerWidth: (PDF_CONTENT_WIDTH_PT - 12) / 2 - 2 * 10 - 2.6,
} as const
