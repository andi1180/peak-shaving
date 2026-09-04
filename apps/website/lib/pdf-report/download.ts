import type { PdfReportInput } from './types'

/**
 * B23a — der Einstieg in die PDF-Erzeugung.
 *
 * ── ⚠ DIE EINZIGE AUFGABE DIESER DATEI IST DER DYNAMISCHE IMPORT ───────────────────────────────
 * Sie hält `@react-pdf/renderer` aus dem First Load: importiert wird erst im Klick-Handler, nicht
 * beim Laden der Seite. Genau so hat der Spike es gemessen (§5, `/rechner` First Load JS unverändert
 * 580 kB, Delta 0 kB) — und deshalb steht hier KEIN Import aus `./render`, `./document` oder
 * `./fonts` auf Modulebene. Ein solcher Import wäre die eine Zeile, die den 307-kB-Chunk in jede
 * Seite zieht, die diese Datei liest.
 *
 * `./types` ist typ-only und trägt zur Laufzeit nichts.
 */

export type { PdfReportInput }

/** Was ein Aufrufer über die Erzeugung erfährt — zur Anzeige, nicht zur Steuerung. */
export type ReportPdfOutcome = {
  fileName: string
  totalPages: number
  passes: number
  /** `false`, wenn der Wächter angeschlagen hat und ohne Seitenverweise ausgeliefert wurde. */
  agendaHasPageNumbers: boolean
  /**
   * B23c-2/B23c-3a — was beim Erzeugen der Chart-Bilder herauskam.
   *
   * ⚠ `builds` MUSS der Zahl der tatsächlich gerasterten Bilder entsprechen (höchstens sechs) und
   * darf NICHT mit `passes` skalieren: die Bilder entstehen einmal je Dokument und nicht je
   * Renderdurchlauf (s. `render.tsx`). Der Wert ist gemessen, nicht hingeschrieben.
   */
  chart: {
    builds: number
    load: ChartFigureOutcome
    /** Stützpunkte der Kurve im gerenderten SVG — am `<path>` gezählt (s. `charts.tsx`). */
    loadVertices: number | null
    cost: ChartFigureOutcome
    /**
     * Welche Fassung des Kostenvergleichs gerastert wurde — `null`, wenn keine entstanden ist.
     * Reist mit heraus, damit ein Prüflauf die ENTSCHEIDUNG messen kann (Monatsvergleich ODER
     * kumulierte Kosten) und nicht nur, dass irgendein Bild da ist.
     */
    costKind: 'monthly' | 'cumulative' | null
    flow: ChartFigureOutcome
    /**
     * Die Tagesbeschriftung, die die Energiefluss-Komponente beim Rastern getragen hat — aus dem
     * gerenderten Baum GELESEN (s. `charts.tsx`). Der Nachweis, WELCHER Tag im Bild steht.
     */
    flowDay: string | null
    /**
     * B23c-3b-1 — die Stunden-Heatmap. Der EINZIGE Chart des Reports, der über den HTML-Weg
     * (`foreignObject`) gerastert wird; ihr Ausschnitt ist das blosse Raster (s. `charts.tsx`).
     */
    hourFlow: ChartFigureOutcome
    /** B23c-3b-1 — der Ø-Ladepreis je Monat. */
    chargePrice: ChartFigureOutcome
    /** B23c-3b-2 — die Grenznutzen-Kurve. */
    comparison: ChartFigureOutcome
    /**
     * Welche Fassung der Kurve gerastert wurde (Zusatzgeräte oder Katalog) — `null`, wenn keine
     * entstanden ist. Dieselbe Rolle wie `costKind`: die ENTSCHEIDUNG messbar machen und nicht
     * bloss, dass irgendein Bild da ist.
     */
    comparisonVariant: 'addon' | 'catalog' | null
    captureMs: number
  }
}

/** Was über ein einzelnes Bild zu berichten ist. */
export type ChartFigureOutcome = {
  /** Bildpunkte des Rasters — `null`, wenn kein Bild entstanden ist. */
  px: { width: number; height: number } | null
  /** Seitenverhältnis des Bildes. */
  aspectRatio: number | null
  /** Die pt-Masse, mit denen es eingebettet wurde. */
  embeddedPt: { width: number; height: number } | null
  /** Warum kein Bild — `null` heisst entweder „Bild entstanden" oder „für diesen Fall keines vorgesehen". */
  error: string | null
}

/**
 * Der Dateiname. Kein Kundenname darin: der Report wird weitergereicht, und ein Dateiname ist die
 * eine Angabe, die auch dann sichtbar bleibt, wenn niemand das Dokument öffnet.
 */
export function reportPdfFileName(now: Date): string {
  const day = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return `coolin-report-${day}.pdf`
}

/**
 * Erzeugt das PDF und legt es als Download ab. Läuft vollständig im Browser.
 *
 * ⚠ Der Lazy-Chunk lädt beim ERSTEN Aufruf (Spike §6 (e): lokal unter 200 ms, über eine echte
 * Leitung nicht). Wer diese Funktion an einen Knopf hängt, zeigt währenddessen einen Ladezustand —
 * sonst sieht ein Klick, der ein paar hundert Millisekunden nichts tut, wie ein toter Knopf aus.
 */
export async function downloadReportPdf(
  input: PdfReportInput,
  now: Date,
): Promise<ReportPdfOutcome> {
  const { renderReportPdf } = await import('./render')
  const result = await renderReportPdf(input)

  const fileName = reportPdfFileName(now)

  /*
   * Ablage über eine `blob:`-URL — wortgleich zum bestehenden `downloadTextFile`
   * (`lib/csv-export.ts`), einschliesslich des Anhängens an das Dokument vor dem Klick und des
   * sofortigen Freigebens danach. Ein zweites, abweichendes Download-Muster in derselben App wäre
   * die Sorte Unterschied, die beim nächsten Browser-Eigenwillen nur an einer der beiden Stellen
   * auffällt.
   */
  const url = URL.createObjectURL(result.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)

  /* Aus `render.tsx` durchgereicht — dort entsteht die Höhe mit DERSELBEN Funktion, die auch das
     Dokument benutzt. Hier nachzurechnen wäre ein zweiter Rechenweg für dieselbe Zahl. */
  const figure = (
    raster: { widthPx: number; heightPx: number; aspectRatio: number } | null,
    embeddedPt: { width: number; height: number } | null,
    error: string | null,
  ): ChartFigureOutcome => ({
    px: raster ? { width: raster.widthPx, height: raster.heightPx } : null,
    aspectRatio: raster ? raster.aspectRatio : null,
    embeddedPt,
    error,
  })

  return {
    fileName,
    totalPages: result.totalPages,
    passes: result.passes,
    agendaHasPageNumbers: result.agendaPages !== null,
    chart: {
      builds: result.chartBuilds,
      load: figure(result.charts.load, result.chartEmbeddedPt.load, result.charts.loadError),
      loadVertices: result.charts.loadVertices,
      cost: figure(result.charts.cost, result.chartEmbeddedPt.cost, result.charts.costError),
      costKind: result.charts.costKind,
      flow: figure(result.charts.flow, result.chartEmbeddedPt.flow, result.charts.flowError),
      flowDay: result.charts.flowDay,
      hourFlow: figure(
        result.charts.hourFlow,
        result.chartEmbeddedPt.hourFlow,
        result.charts.hourFlowError,
      ),
      chargePrice: figure(
        result.charts.chargePrice,
        result.chartEmbeddedPt.chargePrice,
        result.charts.chargePriceError,
      ),
      comparison: figure(
        result.charts.comparison,
        result.chartEmbeddedPt.comparison,
        result.charts.comparisonError,
      ),
      comparisonVariant: result.charts.comparisonVariant,
      captureMs: result.charts.captureMs,
    },
  }
}
