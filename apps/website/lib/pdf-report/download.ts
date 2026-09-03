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
   * B23c-2 — was beim Erzeugen der Chart-Bilder herauskam.
   *
   * ⚠ `builds` MUSS 1 sein, unabhängig von `passes`: die Bilder entstehen einmal je Dokument und
   * nicht je Renderdurchlauf (s. `render.tsx`). Der Wert ist gemessen, nicht hingeschrieben.
   */
  chart: {
    builds: number
    /** Bildpunkte des Lastgang-Rasters — `null`, wenn kein Bild entstanden ist. */
    loadPx: { width: number; height: number } | null
    /** Seitenverhältnis des Bildes und die pt-Masse, mit denen es eingebettet wurde. */
    loadAspectRatio: number | null
    loadEmbeddedPt: { width: number; height: number } | null
    /** Stützpunkte der Kurve im gerenderten SVG — am `<path>` gezählt (s. `charts.ts`). */
    loadVertices: number | null
    loadError: string | null
    captureMs: number
  }
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

  const raster = result.charts.load

  return {
    fileName,
    totalPages: result.totalPages,
    passes: result.passes,
    agendaHasPageNumbers: result.agendaPages !== null,
    chart: {
      builds: result.chartBuilds,
      loadPx: raster ? { width: raster.widthPx, height: raster.heightPx } : null,
      loadAspectRatio: raster ? raster.aspectRatio : null,
      /* Aus `render.tsx` durchgereicht — dort entsteht die Höhe mit DERSELBEN Funktion, die auch
         das Dokument benutzt. Hier nachzurechnen wäre ein zweiter Rechenweg für dieselbe Zahl. */
      loadEmbeddedPt: result.chartEmbeddedPt,
      loadVertices: result.charts.loadVertices,
      loadError: result.charts.loadError,
      captureMs: result.charts.captureMs,
    },
  }
}
