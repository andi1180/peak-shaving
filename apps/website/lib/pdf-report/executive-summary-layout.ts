import { PDF_CONTENT_WIDTH_PT } from './theme'

const BOX_GAP_PT = 12
const BOX_PADDING_PT = 10
const BOX_EDGE_PT = 2.6
const HALF_BOX_PT = (PDF_CONTENT_WIDTH_PT - BOX_GAP_PT) / 2
/** Innenbreite einer Box (Padding beidseitig, Akzentbalken links). */
const innerOf = (boxWidth: number) => boxWidth - 2 * BOX_PADDING_PT - BOX_EDGE_PT

/**
 * Die festen Diagramm-Plätze der Vorderseite, in pt. Die Höhen sind fest, damit die Seite mit und
 * ohne Diagramm gleich umbricht; die Ein-Seiten-Prüfung gilt so auch für das Kunden-PDF. Das
 * Break-even-Band steht in der Box „Ihr Speicher": halbe Breite neben dem Ring, sonst volle.
 */
export const EXEC_SLOTS = {
  load: { width: PDF_CONTENT_WIDTH_PT, height: 90 },
  ways: { width: PDF_CONTENT_WIDTH_PT, height: 90 },
  breakEven: { width: innerOf(PDF_CONTENT_WIDTH_PT), height: 90 },
  breakEvenHalf: { width: innerOf(HALF_BOX_PT), height: 85 },
  donut: { width: innerOf(HALF_BOX_PT), height: 85 },
} as const

/** Seitenanker der Vorderseite (ohne Agenda-Eintrag; gemessen wird nur ihre Länge). */
export const EXECUTIVE_SUMMARY_SECTION_ID = 'executive_summary'

/** Schriftgrösse des Fliesstexts der Vorderseite. */
export const EXEC_TEXT_PT = 10.5

/**
 * Abstand über und unter der Trennlinie zwischen den vier Bereichen (Hero, Lastgang, Stromkosten,
 * Speicher); Fuge gesamt 2 × 7,75 + 0,5 = 16 pt, gemessen von Textunterkante bis Überschrift.
 */
export const EXEC_DIVIDER_GAP_PT = 7.75

/** Die zwei Boxen oben auf der Seite: Ersparnis und Rückzahlzeit, feste Höhe. */
export const EXEC_HERO = {
  gap: BOX_GAP_PT,
  boxWidth: HALF_BOX_PT,
  /** Innen 66 pt: Label 10,45 + „bis zu"-Zeile 13 + Zahl 32 + Unterzeile 10,35. */
  height: 76,
  padding: BOX_PADDING_PT,
  paddingVertical: 5,
  edge: BOX_EDGE_PT,
  valueMaxPt: 26,
  /** Feste Zeilen über und mit der Zahl, damit die Zahlen beider Boxen auf einer Höhe stehen. */
  prefixRowPt: 13,
  valueRowPt: 32,
  /** Unterzeile höchstens 9 pt, kleiner nur wenn sie sonst umbräche (die Box hat eine feste Höhe). */
  subMaxPt: 9,
  /** Innenbreite einer halben Box. */
  innerWidth: innerOf(HALF_BOX_PT),
} as const

/**
 * Block „Ihr Speicher": mit Ring zwei Boxen gleicher fester Höhe (Titel, Ersparnis-Zeile, Band),
 * ohne Ring eine Box über die volle Breite.
 */
export const EXEC_STORAGE = {
  titlePt: 12,
  linePt: 10,
  /** Titel 15 + Abstand 3 + Ersparnis-Zeile (bis zu zwei Zeilen) 25 + Abstand 3 + Band 85 + Padding 2 × 10. */
  height: 2 * BOX_PADDING_PT + 15 + 3 + 25 + 3 + 85,
} as const
