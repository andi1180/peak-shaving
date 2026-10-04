import path from 'node:path'
import { createElement as h } from 'react'
import { Font, renderToBuffer } from '@react-pdf/renderer'

import type { ReportChartRasters } from '@/lib/pdf-report/charts'
import { buildReportContext } from '@/lib/pdf-report/context'
import { ReportDocument } from '@/lib/pdf-report/document'
import { EXECUTIVE_SUMMARY_SECTION_ID } from '@/lib/pdf-report/executive-summary-layout'
import { buildReportLayout } from '@/lib/pdf-report/layout'
import { createPageNumberSink } from '@/lib/pdf-report/page-numbers'
import { buildReportRegistry } from '@/lib/pdf-report/registry'
import type { PdfReportInput } from '@/lib/pdf-report/types'

const FONT_DIR = path.resolve(import.meta.dirname, '../public/report-fonts')
Font.register({
  family: 'Inter',
  fonts: [
    { src: `${FONT_DIR}/Inter-Regular.woff`, fontWeight: 400 },
    { src: `${FONT_DIR}/Inter-SemiBold.woff`, fontWeight: 600 },
    { src: `${FONT_DIR}/Inter-Bold.woff`, fontWeight: 700 },
  ],
})
Font.registerHyphenationCallback((word) => [word])

/* Ohne Diagramm-Raster wie der Snapshot-Harness; die Plätze der Vorderseite haben feste Höhen. */
const CHARTS: ReportChartRasters = {
  load: null,
  loadError: null,
  loadVertices: null,
  ways: null,
  waysError: null,
  peakShaving: null,
  peakShavingError: null,
  cost: null,
  costError: null,
  costKind: null,
  monthly: null,
  monthlyError: null,
  flow: null,
  flowError: null,
  flowDay: null,
  hourFlow: null,
  hourFlowError: null,
  chargePrice: null,
  chargePriceError: null,
  pvSelfConsumption: null,
  pvSelfConsumptionError: null,
  savingsDonut: null,
  savingsDonutError: null,
  comparison: null,
  comparisonError: null,
  comparisonVariant: null,
  captureMs: 0,
  figureMs: {
    load: null,
    ways: null,
    peakShaving: null,
    pvSelfConsumption: null,
    savingsDonut: null,
    cost: null,
    monthly: null,
    flow: null,
    hourFlow: null,
    chargePrice: null,
    comparison: null,
  },
}

/** Seiten zwischen Vorderseite und Agenda, gemessen an den Seitenankern des gerenderten Dokuments. */
export async function executiveSummaryPages(input: PdfReportInput): Promise<number> {
  const context = buildReportContext(input)
  const registry = buildReportRegistry(input, context)
  const sink = createPageNumberSink()
  await renderToBuffer(
    h(ReportDocument, {
      input,
      charts: CHARTS,
      context,
      registry,
      layout: buildReportLayout(input, context, registry),
      agenda: null,
      sink,
    }) as never,
  )
  return sink.pages.agenda! - sink.pages[EXECUTIVE_SUMMARY_SECTION_ID]!
}
