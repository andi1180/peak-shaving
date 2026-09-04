import { pdf } from '@react-pdf/renderer'

import { buildReportCharts, reportChartBuildCount, type ReportChartRasters } from './charts'
import { fitRasterToWidth, type ChartRaster } from './chart-raster'
import { ReportDocument } from './document'
import { registerReportFonts } from './fonts'
import {
  createPageNumberSink,
  measurementsAgree,
  type AgendaPageNumbers,
  type PageNumberSink,
} from './page-numbers'
import { PDF_CONTENT_WIDTH_PT } from './theme'
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
 *
 * ── ⚠ B23c-2: DIE CHART-BILDER ENTSTEHEN GENAU EINMAL, VOR DEM ERSTEN DURCHLAUF ────────────────
 * Sie sind Eingabe des Dokumentbaums, nicht sein Erzeugnis. Zwei Gründe, und der zweite wiegt
 * schwerer:
 *   1. Rastern braucht ein DOM und mehrere Frames (`chart-capture.ts`); der Dokumentbaum ist
 *      gegenüber `pdf(...).toBlob()` synchron und kann darauf nicht warten.
 *   2. Alle Durchläufe müssen BIT-IDENTISCHE Bilder bekommen. Je Durchlauf neu gerastert könnte
 *      eine um einen Bildpunkt abweichende Höhe den Umbruch verschieben — dann schlüge der
 *      Wächter (`measurementsAgree`) an, und die Ursache stünde nirgends im Dokument.
 *
 * Gemessen wird das über `reportChartBuildCount()`: `chartBuilds` im Ergebnis ist die Zahl der
 * Rasterungen, die für DIESE Erzeugung tatsächlich gelaufen sind. Seit B23c-3b-2 sind es bis zu
 * SECHS (Lastgang, Kostenvergleich, Tages-Energiefluss, Stunden-Heatmap, Ø-Ladepreis und
 * Grenznutzen-Kurve) — die Zahl folgt also den BILDERN, die das Dokument zeigt, und ausdrücklich
 * nicht der Zahl der Durchläufe.
 * Der Zähler sitzt an der Rasterung selbst (`charts.tsx`) und nicht hier: zöge jemand den Aufruf in
 * einen Durchlauf, verdoppelte oder verdreifachte er sich.
 *
 * ⚠ DIE DIFFERENZ WIRD ERST AM ENDE GEBILDET, NICHT GLEICH NACH DEM EINEN AUFRUF — und das ist
 * kein Schönheitsfehler, sondern der Unterschied zwischen einer Messung und einer Tautologie.
 * Unmittelbar nach `buildReportCharts` abgelesen wäre die 1 die triviale Folge des einen Aufrufs
 * daneben; in einer Wächter-Probe (Rasterung in `renderPass` verschoben) blieb sie deshalb
 * fälschlich bei 1. Gebildet über die GANZE Erzeugung fängt sie jede zusätzliche Rasterung, egal
 * an welcher Stelle sie eingebaut wird.
 */

/** Was ein Durchlauf hergibt — das PDF und, was dabei gemessen wurde. */
type Pass = { blob: Blob; sink: PageNumberSink }

async function renderPass(
  input: PdfReportInput,
  charts: ReportChartRasters,
  agenda: AgendaPageNumbers,
): Promise<Pass> {
  const sink = createPageNumberSink()
  const blob = await pdf(
    <ReportDocument input={input} charts={charts} agenda={agenda} sink={sink} />,
  ).toBlob()
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
  /**
   * Zahl der Chart-Rasterungen, die für DIESE Erzeugung gelaufen sind.
   *
   * ⚠ Muss der Zahl der Bilder entsprechen, die das Dokument zeigt (höchstens sechs), und
   * ausdrücklich NICHT mit `passes` skalieren — s. den Kopf dieser Datei. Ein Diagnosewert: die
   * Zusage „je Bild einmal pro Dokument" ist der architektonische Kern dieses Schritts, und eine
   * Zusage, die niemand messen kann, ist eine Behauptung.
   */
  chartBuilds: number
  /** Was beim Rastern herauskam — für die Anzeige im Prüfstand, nicht zur Steuerung. */
  charts: ReportChartRasters
  /**
   * Die pt-Masse, mit denen die Bilder im Dokument stehen — je über DIESELBE Funktion gebildet wie
   * dort (`fitRasterToWidth`, `PDF_CONTENT_WIDTH_PT`). `null`, wo kein Bild entstanden ist.
   *
   * ⚠ Es ist die ERWARTUNG, nicht der Nachweis. Der läuft am erzeugten PDF: die `cm`-Matrix der
   * Bildplatzierung gegen die intrinsische Grösse des Bild-XObjects (wie in B23b). Eine Zahl, die
   * aus derselben Funktion stammt wie die geprüfte, prüfte sich selbst.
   */
  chartEmbeddedPt: {
    load: EmbeddedBox | null
    cost: EmbeddedBox | null
    flow: EmbeddedBox | null
    hourFlow: EmbeddedBox | null
    chargePrice: EmbeddedBox | null
    comparison: EmbeddedBox | null
  }
}

type EmbeddedBox = { width: number; height: number }

export async function renderReportPdf(input: PdfReportInput): Promise<RenderReportResult> {
  /*
   * Vor dem ersten Rendern. Die Schrift wird per URL von der eigenen Herkunft geholt; ohne
   * Registrierung fiele das Dokument auf Helvetica zurück — sichtbar, aber ohne Fehlermeldung.
   */
  registerReportFonts()

  /*
   * Die Chart-Bilder: EINMAL, vor allen Durchläufen.
   *
   * ⚠ `buildsBefore` wird HIER genommen, die Differenz aber erst BEIM RÜCKGEBEN gebildet — sie
   * umfasst damit die ganze Erzeugung und nicht nur diesen einen Aufruf. Gleich hier abgelesen
   * wäre die 1 die triviale Folge der Zeile darunter; in der Wächter-Probe (Rasterung in
   * `renderPass` verschoben) blieb sie deshalb fälschlich bei 1, obwohl real dreimal gerastert
   * wurde.
   */
  const buildsBefore = reportChartBuildCount()
  const charts = await buildReportCharts(input)
  const embed = (raster: ChartRaster | null): EmbeddedBox | null =>
    raster ? fitRasterToWidth(raster, PDF_CONTENT_WIDTH_PT) : null
  const chartEmbeddedPt = {
    load: embed(charts.load),
    cost: embed(charts.cost),
    flow: embed(charts.flow),
    hourFlow: embed(charts.hourFlow),
    chargePrice: embed(charts.chargePrice),
    comparison: embed(charts.comparison),
  }

  // 1. Durchlauf: messen. Das erzeugte PDF trägt eine leere Zahlenspalte und wird verworfen.
  const measure = await renderPass(input, charts, null)

  // 2. Durchlauf: mit den gemessenen Zahlen — und dabei erneut messen.
  const withPages = await renderPass(input, charts, measure.sink.pages)

  if (measurementsAgree(measure.sink, withPages.sink)) {
    return {
      blob: withPages.blob,
      agendaPages: measure.sink.pages,
      totalPages: withPages.sink.totalPages,
      passes: 2,
      chartBuilds: reportChartBuildCount() - buildsBefore,
      charts,
      chartEmbeddedPt,
    }
  }

  // 3. Durchlauf: der Wächter hat angeschlagen — ohne Zahlen, s. Kopf.
  console.warn(
    '[pdf-report] Die Seitenverweise der Agenda wurden verworfen: die beiden Renderdurchläufe ' +
      'haben verschiedene Seitenzahlen gemessen. Ausgeliefert wird die Agenda ohne Zahlen.',
  )
  const withoutPages = await renderPass(input, charts, null)
  return {
    blob: withoutPages.blob,
    agendaPages: null,
    totalPages: withoutPages.sink.totalPages,
    passes: 3,
    chartBuilds: reportChartBuildCount() - buildsBefore,
    charts,
    chartEmbeddedPt,
  }
}
