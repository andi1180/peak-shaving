import { LoadChart } from '@/components/report/load-chart'
import { captureChart, selectRechartsSurface } from './chart-capture'
import type { ChartRaster } from './chart-raster'
import { primaryEntryOf } from './summary'
import type { PdfReportInput } from './types'

/**
 * B23c-2 — die Chart-Bilder des Reports: GENAU EINMAL je Dokument erzeugt, VOR dem Rendern.
 *
 * ── ⚠ WARUM DAS EINE ORCHESTRIERUNGS- UND KEINE DARSTELLUNGSFRAGE IST ─────────────────────────
 * Der Report wird zwei- bis dreimal gerendert (`render.tsx`: messen, mit Zahlen, im Wächterfall
 * ohne Zahlen). Ein Chart, der IM Dokumentbaum entstünde, entstünde damit zwei- bis dreimal — und
 * das ginge nicht einmal: `pdf(...).toBlob()` ist synchron gegenüber dem Dokumentbaum, während
 * Mounten und Rastern mehrere Frames brauchen (`chart-capture.ts`) und ein DOM voraussetzen.
 * Deshalb: das Bild entsteht HIER, einmal, und wandert als fertige Data-URI in alle Durchläufe.
 *
 * Der Nebeneffekt ist der wichtigere: alle Durchläufe bekommen BIT-IDENTISCHE Bilder und damit
 * denselben Umbruch. Würde je Durchlauf neu gerastert, könnte eine um ein Bildpunkt abweichende
 * Höhe den Seitenumbruch verschieben — und dann meldete der Wächter (`measurementsAgree`) eine
 * Abweichung, deren Ursache nirgends im Dokument steht.
 *
 * ── ⚠ DIESES MODUL ZIEHT RECHARTS ─────────────────────────────────────────────────────────────
 * Es mountet die UNVERÄNDERTE Produktionskomponente `LoadChart` (Contract-Entscheidung 1, D2: der
 * Chart im PDF ist derselbe, den der Kunde am Bildschirm sieht). Es darf deshalb nur aus dem
 * Lazy-Chunk heraus erreichbar sein — `render.tsx` importiert es, und dorthin führt ausschliesslich
 * der dynamische Import in `download.ts`.
 *
 * ── ⚠ EIN FEHLGESCHLAGENES BILD KOSTET NICHT DAS DOKUMENT ─────────────────────────────────────
 * Scheitert die Rasterung, bleibt `load` auf `null` und `loadError` trägt den Grund. Das Dokument
 * entsteht trotzdem und sagt an der Stelle des Bildes, dass es fehlt — die Zahlen darüber und
 * darunter sind davon unberührt. Ein geworfener Fehler nähme dem Kunden für ein fehlendes Diagramm
 * den ganzen Report; ein stilles Weglassen liesse ihn nach einem Absatz suchen, der nie kam.
 */

/** Die Bilder eines Dokuments, samt dem, was beim Erzeugen gemessen wurde. */
export type ReportChartRasters = {
  /** Lastgang mit Kapp-Linie. `null`, wenn kein Bild entstanden ist. */
  load: ChartRaster | null
  /** Warum kein Bild — gesetzt GENAU DANN, wenn `load === null`. */
  loadError: string | null
  /**
   * Stützpunkte, die die Kurve im gerenderten SVG TATSÄCHLICH trägt — am `<path>` gezählt, nicht
   * aus `downsampleMinMax` abgeleitet. Nur so ist gemessen, dass die Reduktion auf dem echten Weg
   * zum Chart durchläuft (dieselbe Prüfung wie in B23b). `null`, wenn kein Bild entstanden ist.
   */
  loadVertices: number | null
  /** Mounten, Layout und Rastern zusammen, in ms. */
  captureMs: number
}

/**
 * Mount-Breite in CSS-Pixeln. 900 wie im B23b-Prüflauf gemessen: ergibt bei `scale` 3 ein Bild von
 * 2700 px Breite, das in 499 pt Satzbreite rund 390 dpi trägt (Spike §2.4 hält 288 dpi für „im
 * Druckbild nicht störend"). Sie bestimmt zugleich, wie dicht Recharts die Achsen beschriftet — es
 * ist eine Aussage darüber, wie der Chart AUSSEHEN soll, nicht über seine Grösse auf dem Papier.
 * Letztere entsteht ausschliesslich in `fitRasterToWidth`.
 */
const LOAD_CHART_WIDTH_PX = 900

/**
 * Zählt die Stützpunkte des Lastgang-Pfads im GERENDERTEN SVG — wortgleich zum B23b-Prüfstand.
 * Recharts zeichnet eine Linie als EINEN `<path>`; die Zahl der Punkte ist die Zahl der
 * Koordinatenbefehle darin.
 */
function countLineVertices(svg: Element): number {
  const path = svg.querySelector('path.recharts-curve.recharts-line-curve')
  const d = path?.getAttribute('d') ?? ''
  if (!d) return 0
  return (d.match(/[ML]/g) ?? []).length
}

/**
 * Wie oft in dieser Sitzung gerastert wurde.
 *
 * ⚠ Ein DIAGNOSE-Zähler, und er steht hier aus einem Grund: die Zusage „einmal je Dokument, nicht
 * je Renderdurchlauf" ist der ganze architektonische Punkt dieses Schritts, und eine Zusage, die
 * niemand messen kann, ist eine Behauptung. Er sitzt bewusst an der RASTERUNG und nicht an ihrem
 * Aufrufer — zöge jemand den Aufruf in den Dokumentbaum, stiege er auf 2 oder 3, und genau das
 * soll sichtbar werden.
 */
let chartBuildCount = 0

export function reportChartBuildCount(): number {
  return chartBuildCount
}

/**
 * Erzeugt die Chart-Bilder eines Dokuments. EINMAL je Erzeugung aufrufen, vor dem ersten Rendern.
 *
 * ⚠ Der Chart hängt am PRIMÄREN Block — im Bestandsfall an der Anlage des Kunden, sonst an der
 * Empfehlung. Dieselbe Auswahl wie `report.tsx` und `recommendation.ts`, und über DIESELBE
 * Funktion: zwei Ableitungen desselben „primären" Geräts ergäben ein Bild, dessen Kapp-Linie zu
 * einer anderen Batterie gehört als die Bildunterschrift darunter.
 */
export async function buildReportCharts(input: PdfReportInput): Promise<ReportChartRasters> {
  const started = performance.now()
  const analysis = input.analysis
  const primary = primaryEntryOf(analysis)

  /*
   * [ABGELEITET, keine Contract-Zahl] Roher Leistungspreis-Satz (€/kW·a) aus den Ist-Kosten —
   * wortgleich zu `report.tsx`. `null` bei `billedKw = 0` (leeres oder rein einspeisendes Profil);
   * dann zeigt das Chart die kontrafaktische Kostengrösse je Spitze nicht, was im PDF ohnehin
   * niemand anklicken kann.
   */
  const rate =
    analysis.current.billedKw > 0
      ? analysis.current.leistungspreisCostPerYear / analysis.current.billedKw
      : null

  let vertices = 0
  try {
    chartBuildCount += 1
    const raster = await captureChart(
      <LoadChart
        loadProfile={input.loadProfile}
        dispatchTrace={primary?.dispatchTrace}
        billingModel={analysis.assumptions.billingModel}
        leistungspreisRatePerKwYear={rate}
      />,
      {
        width: LOAD_CHART_WIDTH_PX,
        /*
         * ⚠ AUSDRÜCKLICH der Recharts-Zeichenbereich und nicht der Standardwert. Ohne ihn käme die
         * ganze Karte samt Erklärtext ins Bild — in B23b gemessen: 2280 × 2643 px statt
         * 2280 × 768 px, ohne Fehler und ohne Warnung. Der Text gehört nativ neben das Bild, nicht
         * als Pixel hinein.
         */
        select: selectRechartsSurface,
        inspect: (el) => {
          vertices = countLineVertices(el)
        },
      },
    )
    return {
      load: raster,
      loadError: null,
      loadVertices: vertices,
      captureMs: performance.now() - started,
    }
  } catch (cause) {
    return {
      load: null,
      loadError: cause instanceof Error ? cause.message : 'Unbekannter Fehler',
      loadVertices: null,
      captureMs: performance.now() - started,
    }
  }
}
