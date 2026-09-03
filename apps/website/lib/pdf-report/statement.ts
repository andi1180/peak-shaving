/**
 * B23c-2 — die Darstellungsform einer Kernaussage, geteilt von allen Kapitel-Ableitungen.
 *
 * ── ⚠ WARUM DIESE DREI TYPEN AUS `summary.ts` HERAUSGEWANDERT SIND ─────────────────────────────
 * Bis B23c-1 gab es genau EINE Ableitung (die Executive Summary), und die Typen konnten dort
 * wohnen. Mit B23c-2 kommt eine zweite hinzu (`recommendation.ts`), und `document.tsx` rendert
 * beide durch DIESELBEN Bausteine. Zwei strukturgleiche Typdefinitionen wären die Sorte Doppelung,
 * die man erst bemerkt, wenn eine der beiden ein Feld bekommt und der Renderer es nur für die eine
 * Hälfte zeigt.
 *
 * Es ist ausdrücklich eine DARSTELLUNGS-Form und kein fachlicher Typ: was in einer Aussage steht,
 * entscheidet die jeweilige Ableitung; wie es aussieht, entscheidet `document.tsx`. Deshalb sind
 * alle Werte hier FERTIG formatierte Zeichenketten — die Rundung fällt in der Ableitung, an einer
 * Stelle, und nicht verstreut im JSX.
 */

/** Farbe ist Information, kein Dekor (DESIGN.md) — s. `PDF_COLORS` in `theme.ts`. */
export type ReportTone = 'positive' | 'warning' | 'neutral'

/** Eine Zeile einer Aufschlüsselung. */
export type ReportRow = {
  label: string
  /** Zweite, kleinere Zeile unter der Beschriftung. Fehlt, wo die Beschriftung für sich steht. */
  hint?: string
  value: string
  tone: ReportTone
  /** `true` = Abschlusszeile der Aufschlüsselung (abgesetzt, halbfett). */
  total?: boolean
}

/**
 * Eine Kernaussage: Überschrift, optional die eine grosse Zahl, optional eine Aufschlüsselung,
 * und der Satz, ohne den ein Leser die Zahl falsch verwendet.
 *
 * ⚠ `amount` ist `null`-fähig, weil es Aussagen gibt, die KEINE Zahl tragen — der
 * Zusatzspeicher-Klarsatz („lohnt sich derzeit nicht") ist eine davon. Eine erfundene 0 an dieser
 * Stelle wäre eine Zahl, die etwas anderes behauptet als der Satz darunter.
 */
export type ReportStatement = {
  /** Stabil — zur Wiedererkennung in Prüfläufen, nicht im Dokument sichtbar. */
  id: string
  title: string
  amount: { value: string; caption: string; tone: Exclude<ReportTone, 'neutral'> } | null
  rows: ReportRow[]
  body: string
  /**
   * Kurze Zusatzsätze unter dem Fliesstext — je Eintrag eine Zeile.
   *
   * ⚠ Dafür da, dass die §3.8-WARNUNGEN eines Kandidaten (Betonsockel, separater Wechselrichter,
   * „Leistung reicht nicht für alle Spitzen") sichtbar bleiben statt in einem Absatz zu
   * verschwinden. Sie sind Kosten- und Eignungsaussagen und gehören neben die Investition, nicht
   * hinter sie. Leer oder fehlend heisst: es gibt keine — nicht „wir zeigen sie hier nicht".
   */
  notes?: string[]
}
