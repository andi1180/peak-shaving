import { pdf } from '@react-pdf/renderer'

import { ReportDocument } from './document'
import { registerReportFonts } from './fonts'
import {
  createPageNumberSink,
  measurementsAgree,
  type AgendaPageNumbers,
  type PageNumberSink,
} from './page-numbers'
import type { PdfReportInput } from './types'

/**
 * B23a — die Erzeugung: zwei Renderdurchläufe, damit die Agenda echte Seitenverweise trägt.
 *
 * ── ⚠ DIESES MODUL ZIEHT `@react-pdf/renderer` STATISCH ────────────────────────────────────────
 * Es darf deshalb NUR dynamisch importiert werden (`download.ts`). Ein statischer Import von hier
 * aus irgendeiner Route holte den Lazy-Chunk (Spike §3: ≈ 773 kB roh / ≈ 307 kB gzip) in den First
 * Load — genau die Zahl, die der Spike als unverändert gemessen hat und die diese PR unverändert
 * lassen soll.
 *
 * ── WARUM ZWEI DURCHLÄUFE, UND WARUM DER ZWEITE NICHT EINFACH RECHNET ──────────────────────────
 * Die Agenda steht VOR den Kapiteln, auf die sie verweist; ihre Zahlen sind zur Renderzeit der
 * Agenda noch nicht bekannt. Sie liessen sich auch nicht abzählen: sobald ein Kapitel über zwei
 * Seiten läuft, verschiebt sich alles danach, und eine abgezählte Zahl wäre eine zweite Wahrheit
 * neben dem Seitenbaum des Dokuments. Deshalb wird GEMESSEN: erster Durchlauf mit Sentinels (das
 * PDF wird verworfen), zweiter Durchlauf mit den gemessenen Zahlen.
 *
 * ── ⚠ DER DRITTE DURCHLAUF IST EIN WÄCHTER, KEINE OPTIMIERUNG ──────────────────────────────────
 * Der zweite Durchlauf misst NOCH EINMAL mit. Weichen seine Messwerte von denen des ersten ab, hat
 * die Anwesenheit der Zahlen den Umbruch verändert — dann sind die gerade gedruckten Zahlen
 * nachweislich falsch, und es wird ein DRITTER Durchlauf ohne Zahlen ausgeliefert. Keine Zahl ist
 * besser als eine falsche; eine falsche fällt an einem weitergereichten Blatt niemandem auf.
 *
 * Bewusst NICHT gebaut: ein Fixpunkt-Verfahren, das solange neu rendert, bis die Zahlen stabil sind.
 * Eine Abweichung heisst gerade, dass der Umbruch von den Zahlen abhängt — dann kann die Iteration
 * pendeln, und der Preis wäre eine unbestimmte Zahl von Durchläufen für einen Fall, den das Layout
 * (feste, einzeilige Zahlenspalte) ausschliessen soll.
 */

/** Was ein Durchlauf hergibt — das PDF und, was dabei gemessen wurde. */
type Pass = { blob: Blob; sink: PageNumberSink }

async function renderPass(input: PdfReportInput, agenda: AgendaPageNumbers): Promise<Pass> {
  const sink = createPageNumberSink()
  const blob = await pdf(<ReportDocument input={input} agenda={agenda} sink={sink} />).toBlob()
  return { blob, sink }
}

export type RenderReportResult = {
  blob: Blob
  /** Die ausgelieferten Seitenverweise — `null`, wenn ohne Zahlen ausgeliefert wurde. */
  agendaPages: AgendaPageNumbers
  /** Gesamtseitenzahl des ausgelieferten Dokuments. */
  totalPages: number
  /** Zahl der Renderdurchläufe: 2 im Regelfall, 3 im Wächterfall. */
  passes: number
}

export async function renderReportPdf(input: PdfReportInput): Promise<RenderReportResult> {
  /*
   * Vor dem ersten Rendern. Die Schrift wird per URL von der eigenen Herkunft geholt; ohne
   * Registrierung fiele das Dokument auf Helvetica zurück — sichtbar, aber ohne Fehlermeldung.
   */
  registerReportFonts()

  // 1. Durchlauf: messen. Das erzeugte PDF trägt eine leere Zahlenspalte und wird verworfen.
  const measure = await renderPass(input, null)

  // 2. Durchlauf: mit den gemessenen Zahlen — und dabei erneut messen.
  const withPages = await renderPass(input, measure.sink.pages)

  if (measurementsAgree(measure.sink, withPages.sink)) {
    return {
      blob: withPages.blob,
      agendaPages: measure.sink.pages,
      totalPages: withPages.sink.totalPages,
      passes: 2,
    }
  }

  // 3. Durchlauf: der Wächter hat angeschlagen — ohne Zahlen, s. Kopf.
  console.warn(
    '[pdf-report] Die Seitenverweise der Agenda wurden verworfen: die beiden Renderdurchläufe ' +
      'haben verschiedene Seitenzahlen gemessen. Ausgeliefert wird die Agenda ohne Zahlen.',
  )
  const withoutPages = await renderPass(input, null)
  return {
    blob: withoutPages.blob,
    agendaPages: null,
    totalPages: withoutPages.sink.totalPages,
    passes: 3,
  }
}
