import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

import type { ChartRaster } from './chart-raster'
import { fitRasterToWidth } from './chart-raster'
import { registerReportFonts } from './fonts'
import { PDF_COLORS, PDF_CONTENT_WIDTH_PT, PDF_LAYOUT, PDF_TYPE } from './theme'

/**
 * B23b — das Mini-Dokument des Chart-Prüfstands: EIN Rasterbild, sonst nichts.
 *
 * ── ⚠ DIES IST NICHT DER REPORT, UND ES SOLL AUCH KEINER WERDEN ────────────────────────────────
 * `document.tsx` und `render.tsx` (B23a) sind in dieser PR mit 0 Zeilen Diff unangetastet: der
 * Zwei-/Drei-Pass-Mechanismus mit den gemessenen Agenda-Seitenzahlen hängt an einem Contract
 * (`PdfReportInput`), der erst mit B23c um das Ergebnis wächst. Diese PR baut die Pipeline und
 * beweist sie — sie hängt sich nicht in den bestehenden Fluss ein.
 *
 * Was dieses Dokument leistet, ist genau eines: das erzeugte PNG so einbetten, wie B23c es
 * einbetten wird, damit die Einbettung selbst prüfbar ist — insbesondere das Seitenverhältnis
 * (Spike §2.4, „Falle 3": 13,6 % stille Streckung, am Bildschirm unsichtbar).
 *
 * ⚠ KEIN `lineHeight` auf der `<Page>` — hier steht zwar kein `fixed`-Element mit `render`-Prop,
 * aber die Regel aus Delta D7 gilt für jede Seite dieses Verzeichnisses, und eine Ausnahme „hier
 * ist es gerade egal" ist genau die, die beim nächsten Kopieren mitwandert.
 */

/**
 * ⚠ Die Konstante wohnt seit B23c-2 in `theme.ts` — das Report-Dokument bettet seine Chart-Bilder
 * in derselben Breite ein, und zwei Satzspiegel liessen dieses Prüf-PDF eine Einbettung belegen,
 * die es im Report nicht gibt. Hier bleibt der Re-Export, damit der Prüfstand sie unverändert
 * unter ihrem Namen liest.
 */
export { PDF_CONTENT_WIDTH_PT }

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_TYPE.family,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.text,
    paddingTop: PDF_LAYOUT.pageTop,
    paddingBottom: PDF_LAYOUT.pageBottom,
    paddingLeft: PDF_LAYOUT.pageHorizontal,
    paddingRight: PDF_LAYOUT.pageHorizontal,
  },
  body: { lineHeight: 1.45 },
  h2: { fontSize: PDF_TYPE.h2, fontWeight: 600, color: PDF_COLORS.ink },
  lead: { marginTop: 3, marginBottom: 12, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  meta: { marginTop: 12, fontSize: PDF_TYPE.footer, color: PDF_COLORS.textMuted },
  note: {
    marginTop: 14,
    padding: 8,
    backgroundColor: PDF_COLORS.surfaceAlt,
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLORS.navy,
    fontSize: PDF_TYPE.footer,
    color: PDF_COLORS.textMuted,
  },
})

export type ChartProbeInput = {
  title: string
  lead: string
  raster: ChartRaster
}

/** Was der Prüfstand über die Einbettung erfährt — zum Nachrechnen, nicht zur Steuerung. */
export type ChartProbeOutcome = {
  fileName: string
  /** Bildpunkte des PNG. */
  widthPx: number
  heightPx: number
  /** `widthPx / heightPx` — gemessen am Bild. */
  rasterAspectRatio: number
  /** Die Werte, die TATSÄCHLICH am `<Image>` stehen. */
  imageWidthPt: number
  imageHeightPt: number
  /** `imageWidthPt / imageHeightPt` — muss dem Bild-Seitenverhältnis entsprechen. */
  imageAspectRatio: number
  /** Grösse der Data-URI in Zeichen — die Zahl, an der ein Rasterbild im PDF teuer wird. */
  dataUrlLength: number
}

function ChartProbeDocument({ title, lead, raster }: ChartProbeInput) {
  /* ⚠ Die Höhe kommt aus `fitRasterToWidth` und wird NIRGENDS sonst gebildet — s. Falle 3. */
  const box = fitRasterToWidth(raster, PDF_CONTENT_WIDTH_PT)
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.body}>
          <Text style={styles.h2}>{title}</Text>
          <Text style={styles.lead}>{lead}</Text>
        </View>
        <Image src={raster.dataUrl} style={{ width: box.width, height: box.height }} />
        <View style={styles.body}>
          <Text style={styles.meta}>
            Rasterbild {raster.widthPx} × {raster.heightPx} px · Seitenverhältnis{' '}
            {raster.aspectRatio.toFixed(4)} · eingebettet mit {box.width.toFixed(2)} ×{' '}
            {box.height.toFixed(2)} pt (Verhältnis {(box.width / box.height).toFixed(4)}) ·{' '}
            {Math.round((raster.widthPx / (box.width / 72)) * 1) / 1} dpi effektiv
          </Text>
          <Text style={styles.note}>
            B23b — Prüfstand der Chart-Rasterung. Dieses Dokument ist kein Report: es trägt genau
            ein Bild und die Zahlen, mit denen es eingebettet wurde. Der Kunden-Export läuft
            unverändert über den Druckdialog.
          </Text>
        </View>
      </Page>
    </Document>
  )
}

/**
 * Erzeugt das Mini-PDF und legt es als Download ab.
 *
 * ⚠ Dieselbe `blob:`-Ablage wie `download.ts` — kein zweites Download-Muster in derselben App.
 */
export async function downloadChartProbePdf(
  input: ChartProbeInput,
  fileName: string,
): Promise<ChartProbeOutcome> {
  registerReportFonts()

  const box = fitRasterToWidth(input.raster, PDF_CONTENT_WIDTH_PT)
  const blob = await pdf(<ChartProbeDocument {...input} />).toBlob()

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)

  return {
    fileName,
    widthPx: input.raster.widthPx,
    heightPx: input.raster.heightPx,
    rasterAspectRatio: input.raster.aspectRatio,
    imageWidthPt: box.width,
    imageHeightPt: box.height,
    imageAspectRatio: box.width / box.height,
    dataUrlLength: input.raster.dataUrl.length,
  }
}
