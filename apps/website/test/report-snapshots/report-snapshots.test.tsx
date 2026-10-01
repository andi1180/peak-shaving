import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { env } from 'node:process'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { mapDraftToExistingBatteryInput, mapDraftToTariffParams } from 'engine'
import type { MeteringPointAnalysisPorts } from 'extractors'
import {
  analysisForDisplay,
  type AnalysisResult,
  readDraftFinancialParams,
  readPvStage,
  type BatteryCandidate,
  type BatteryCatalogCategory,
  type BatteryCatalogMeta,
  type DisplayPriceBasis,
  type TariffPricingInputs,
} from 'shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Report } from '@/components/report/report'
import {
  buildReportInputFromRenderRequest,
  readRenderRequest,
} from '@/lib/pdf-report/build-report-input'
import type { ReportChartRasters } from '@/lib/pdf-report/charts'
import { buildReportContext } from '@/lib/pdf-report/context'
import { ReportDocument } from '@/lib/pdf-report/document'
import { buildReportLayout } from '@/lib/pdf-report/layout'
import { createPageNumberSink } from '@/lib/pdf-report/page-numbers'
import { reportInputForDisplay } from '@/lib/pdf-report/price-display'
import { buildReportRegistry } from '@/lib/pdf-report/registry'
import type { PdfReportInput } from '@/lib/pdf-report/types'

vi.mock('server-only', () => ({}))

type TariffPricingRequest = Parameters<
  NonNullable<MeteringPointAnalysisPorts['fetchTariffPricing']>
>[0]

type SnapshotCase = {
  name: string
  /** Snapshot-Datei, falls sie mit einem anderen Fall geteilt wird (Vorgabe: `name`). */
  snapshot?: string
  /** Projektsegment des Laufs — Steuerangaben gelten nur bei `gewerbe`. */
  category: BatteryCatalogCategory
  dir: string
  /** Die Uhr des Laufs — sie bestimmt das Jahresfenster und das Druckdatum. */
  runAt: string
  documents: Record<string, string>
  customerLabel: string
  priceDisplay: DisplayPriceBasis
  catalogMetaFile: string | null
  /** Zusätzliche Entwurfsfelder über dem eingefrorenen Entwurf (Varianten). */
  draftPatch?: Record<string, unknown>
  /** Zusätzliche Prüfung am Ergebnis des Laufs (netto, wie gerechnet). */
  checkResult?: (result: AnalysisResult) => void
}

const APP = path.resolve(import.meta.dirname, '../..')
const SNAPSHOTS = path.join(import.meta.dirname, '__snapshots__')

const PRIVAT: SnapshotCase = {
  name: 'privat-bestand-pv-wien',
  dir: path.resolve(APP, '../../packages/extractors/test/golden/privat-bestand-pv-wien'),
  runAt: '2026-09-24T13:04:38.994Z',
  documents: { lastgang: 'lastgang.csv', 'pv-erzeugung': 'pv-erzeugung.json' },
  customerLabel: 'Referenzfall Privat',
  category: 'heim',
  priceDisplay: 'gross',
  catalogMetaFile: null,
}

const GEWERBE: SnapshotCase = {
  name: 'gewerbe-ohne-rechnung-wien',
  dir: path.join(import.meta.dirname, 'fixtures/gewerbe-ohne-rechnung-wien'),
  runAt: '2026-09-27T08:40:00.000Z',
  documents: { lastgang: 'lastgang.csv' },
  customerLabel: 'Referenzfall Gewerbe',
  category: 'gewerbe',
  priceDisplay: 'net',
  catalogMetaFile: 'battery-catalog-meta.json',
}

// Varianten mit den Annahmen der Tarif-Station: Förderung und Horizont reisen über den Entwurf.
const CASES: SnapshotCase[] = [
  PRIVAT,
  GEWERBE,
  {
    ...GEWERBE,
    name: 'gewerbe-ohne-rechnung-wien.foerderung-50-horizont-15',
    draftPatch: { subsidyPercent: 50, horizonYears: 15 },
  },
  {
    ...PRIVAT,
    name: 'privat-bestand-pv-wien.foerderung-fix-ueber-investition',
    draftPatch: { fixedSubsidyEur: 100_000, fixedSubsidyPriceBasis: 'gross' },
  },
  {
    ...GEWERBE,
    name: 'gewerbe-ohne-rechnung-wien.foerderung-50-horizont-15-steuer',
    draftPatch: {
      subsidyPercent: 50,
      horizonYears: 15,
      taxRatePercent: 23,
      investitionsfreibetragPercent: 20,
      depreciationYears: 10,
    },
  },
  // Förderung „€ pro kWh", Programm A: 150 €/kWh, max. 10 kWh, max. 30 % (Sätze netto im Entwurf).
  {
    ...GEWERBE,
    name: 'gewerbe-ohne-rechnung-wien.foerderung-pro-kwh-horizont-15-steuer',
    draftPatch: {
      subsidyProgramsPriceBasis: 'net',
      subsidyProgram1Label: 'Wiener Landesförderung',
      subsidyProgram1EurPerKwh: 150,
      subsidyProgram1MaxKwh: 10,
      subsidyProgram1MaxPercent: 30,
      horizonYears: 15,
      taxRatePercent: 23,
      investitionsfreibetragPercent: 20,
      depreciationYears: 10,
    },
  },
  {
    ...PRIVAT,
    name: 'privat-bestand-pv-wien.foerderung-pro-kwh',
    draftPatch: {
      subsidyProgramsPriceBasis: 'gross',
      subsidyProgram1Label: 'Wiener Landesförderung',
      subsidyProgram1EurPerKwh: 125,
      subsidyProgram1MaxKwh: 10,
      subsidyProgram1MaxPercent: 30,
    },
    // Der 30-%-Deckel greift auf der angezeigten Bruttobasis: Förderung = 30 % der Bruttoinvestition.
    checkResult: (result) => {
      const capped = analysisForDisplay(result, 'gross').perBattery.filter(
        (e) => 150 * Math.min(e.battery.usableCapacityKwh, 10) > 0.3 * e.totalInvestment,
      )
      expect(capped.length).toBeGreaterThan(0)
      for (const e of capped) expect(e.subsidyAmount).toBeCloseTo(0.3 * e.totalInvestment, 6)
    },
  },
  // Privatpfad: Steuerwerte im Entwurf bleiben unbeachtet — derselbe Snapshot wie ohne.
  {
    ...PRIVAT,
    name: 'privat-bestand-pv-wien.steuerwerte-ignoriert',
    snapshot: PRIVAT.name,
    draftPatch: { taxRatePercent: 23, investitionsfreibetragPercent: 20, depreciationYears: 10 },
  },
]

/**
 * Fälle aus einer eingefrorenen Render-Anfrage (`platform.report_render_requests`) — derselbe Weg wie
 * `/report/[requestId]`, ohne Neuberechnung und ohne Bildschirm-Report (die Seite rendert nur das PDF).
 */
type RenderRequestCase = { name: string; file: string; runAt: string }

const RENDER_REQUEST_CASES: RenderRequestCase[] = [
  {
    name: 'gewerbe-leistungspreis-teiljahr-wien',
    file: path.join(
      import.meta.dirname,
      'fixtures/gewerbe-leistungspreis-teiljahr-wien/render-request.json',
    ),
    runAt: '2026-09-30T18:37:04.946Z',
  },
]

const FONT_DIR = path.join(APP, 'public/report-fonts')
Font.register({
  family: 'Inter',
  fonts: [
    { src: `${FONT_DIR}/Inter-Regular.woff`, fontWeight: 400 },
    { src: `${FONT_DIR}/Inter-SemiBold.woff`, fontWeight: 600 },
    { src: `${FONT_DIR}/Inter-Bold.woff`, fontWeight: 700 },
  ],
})
Font.registerHyphenationCallback((word) => [word])

// Die Diagramme sind Rasterbilder und tragen keinen Text — der Snapshot misst den Satz.
const NO_CHARTS: ReportChartRasters = {
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
  comparison: null,
  comparisonError: null,
  comparisonVariant: null,
  captureMs: 0,
  figureMs: {
    load: null,
    ways: null,
    peakShaving: null,
    pvSelfConsumption: null,
    cost: null,
    monthly: null,
    flow: null,
    hourFlow: null,
    chargePrice: null,
    comparison: null,
  },
}

/** Gibt die Event-Loop frei — sonst läuft vitests Worker-RPC bei langen Render-Strecken in den Timeout. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

function readJson<T>(c: SnapshotCase, name: string): T {
  return JSON.parse(readFileSync(path.join(c.dir, name), 'utf8')) as T
}

function windowKey(request: Pick<TariffPricingRequest, 'window' | 'intervalMinutes'>): string {
  return `${request.window.startIso}|${request.window.endIso}|${request.intervalMinutes}`
}

/** Der Wizard-Lauf mit eingefrorenen Ports — derselbe Aufbau wie im Golden-Test des Privatfalls. */
async function runCase(c: SnapshotCase) {
  const { runAnalysisFromMeteringPointDraft } = await import('extractors')
  const draft = { ...readJson<Record<string, unknown>>(c, 'draft.json'), ...c.draftPatch }
  const catalog = readJson<BatteryCandidate[]>(c, 'battery-catalog.json')
  const pricingByWindow = new Map(
    readJson<{ request: TariffPricingRequest; pricing: TariffPricingInputs }[]>(
      c,
      'tariff-pricing.json',
    ).map(({ request, pricing }) => [windowKey(request), pricing]),
  )
  // Wie `report-render-actions.ts`: die Netzentgelt-Zeilen des LETZTEN Preisabrufs gehen in die Übergabe.
  let lastPricing: TariffPricingInputs | null = null

  const run = await runAnalysisFromMeteringPointDraft('zaehlpunkt', {
    batteryCatalog: catalog,
    readMeteringPoint: async () => ({ draft, sourceDocumentId: 'lastgang' }),
    readDocument: async (documentId) => {
      await yieldToEventLoop()
      const filename = c.documents[documentId]
      if (filename === undefined) return null
      const bytes = readFileSync(path.join(c.dir, filename))
      return {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        filename,
      }
    },
    fetchTariffPricing: async (request) => {
      await yieldToEventLoop()
      const pricing = pricingByWindow.get(windowKey(request))
      if (pricing === undefined)
        throw new Error(`Kein eingefrorener Preisstand für ${windowKey(request)}`)
      lastPricing = pricing
      return pricing
    },
  }, { category: c.category })
  return { run, draft, catalog, lastPricing: lastPricing as TariffPricingInputs | null }
}

function pvPeakPowerKwp(draft: Record<string, unknown>): number | null {
  const arrays = Array.isArray(draft._pvArrays)
    ? (draft._pvArrays as { peakPowerKwp?: unknown }[])
    : []
  if (arrays.length === 0) return null
  let total = 0
  for (const array of arrays) {
    if (typeof array.peakPowerKwp !== 'number' || !(array.peakPowerKwp > 0)) return null
    total += array.peakPowerKwp
  }
  return total
}

async function renderPdfText(input: PdfReportInput, file: string): Promise<string> {
  const display = reportInputForDisplay(input)
  const context = buildReportContext(display)
  const registry = buildReportRegistry(display, context)
  const layout = buildReportLayout(display, context, registry)
  const pass = async (agenda: ReturnType<typeof createPageNumberSink>['pages'] | null) => {
    const sink = createPageNumberSink()
    const pdf = await renderToBuffer(
      h(ReportDocument, {
        input: display,
        charts: NO_CHARTS,
        context,
        registry,
        layout,
        agenda,
        sink,
      }) as never,
    )
    await yieldToEventLoop()
    return { pdf, sink }
  }
  // Zwei Durchläufe wie `renderReportPdf`: erst messen, dann mit Seitenzahlen in der Agenda.
  const measured = await pass(null)
  const final = await pass(measured.sink.pages)
  writeFileSync(file, final.pdf)
  return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8' })
}

export async function renderSnapshots(
  c: SnapshotCase,
): Promise<{ pdfText: string; screenHtml: string; result: AnalysisResult }> {
  const { run, draft, catalog, lastPricing } = await runCase(c)
  await yieldToEventLoop()
  const catalogMeta: Record<string, BatteryCatalogMeta> = c.catalogMetaFile
    ? readJson(c, c.catalogMetaFile)
    : {}

  // Die Übergabe so, wie `report-render-actions.ts` sie schreibt und die Report-Seite sie liest (jsonb-Rundreise).
  const gridTariffValidFrom = [
    ...new Set((lastPricing?.gridTariffRows ?? []).map((row) => row.validFrom).filter(Boolean)),
  ].sort()
  const row = JSON.parse(
    JSON.stringify({
      analysis_result: run.result,
      load_profile: run.loadProfile,
      report_input_meta: {
        customerLabel: c.customerLabel,
        netzbetreiber: draft.netzbetreiber,
        netzebene: draft.netzebene,
        supplierBaseFeeEurPerMonth:
          typeof draft.supplierBaseFeeEurPerMonth === 'number'
            ? draft.supplierBaseFeeEurPerMonth
            : null,
        hasPv: draft.hasPv === true ? true : draft.hasPv === false ? false : null,
        pvStage: readPvStage(draft),
        pvPeakPowerKwp: pvPeakPowerKwp(draft),
        pvOutageMonths: run.pvOutageMonths,
        gridTariffValidFrom,
        invoicePeriods: [],
        batteryCatalogMeta: catalogMeta,
        priceDisplay: c.priceDisplay,
      },
    }),
  ) as unknown
  const readout = readRenderRequest({ data: row, error: null })
  if (readout.status !== 'ok') throw new Error('Übergabe nicht lesbar')
  const input = buildReportInputFromRenderRequest(readout.request, new Date(c.runAt))

  const tmp = mkdtempSync(path.join(tmpdir(), 'report-snapshot-'))
  const pdfText = await renderPdfText(input, path.join(tmp, `${c.name}.pdf`))

  const screenHtml = renderToStaticMarkup(
    <Report
      origin="client"
      result={run.result}
      priceDisplay={c.priceDisplay}
      loadProfile={run.loadProfile}
      batteryCatalog={catalog}
      batteryCatalogMeta={catalogMeta}
      tariffSource={null}
      originalTariff={mapDraftToTariffParams(draft)}
      originalFinancial={readDraftFinancialParams(draft, c.category)}
      recomputing={false}
      recomputeError={null}
      isLive={false}
      existingBattery={mapDraftToExistingBatteryInput(draft).input ?? undefined}
      effectiveInputs={null}
      onRecompute={() => {}}
      onResetAssumptions={() => {}}
    />,
  ).replace(/></g, '>\n<')

  return { pdfText, screenHtml, result: run.result }
}

function firstDifferences(expected: string, actual: string, max = 30): string {
  const a = expected.split('\n')
  const b = actual.split('\n')
  const out: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
    if (a[i] !== b[i]) out.push(`Z. ${i + 1}\n  - ${a[i] ?? '(fehlt)'}\n  + ${b[i] ?? '(fehlt)'}`)
  }
  return out.join('\n')
}

function checkSnapshot(file: string, actual: string): void {
  const target = path.join(SNAPSHOTS, file)
  if (env.REPORT_SNAPSHOT_UPDATE === '1') {
    writeFileSync(target, actual)
    return
  }
  const expected = readFileSync(target, 'utf8')
  expect(expected === actual, `${file} weicht ab:\n${firstDifferences(expected, actual)}`).toBe(
    true,
  )
}

/**
 * Jeder Förderblock im PDF-Text: angezeigte Investition − angezeigte Förderzeilen (+ Kürzung auf die
 * Investition) = angezeigte Nettoinvestition, auf den Euro exakt. Liefert die Zahl geprüfter Blöcke.
 */
function checkSubsidyArithmetic(pdfText: string): number {
  const euro = (line: string) => {
    const match = /(-?)€\s?([\d.]+)\s*$/.exec(line)
    return match ? (match[1] === '-' ? -1 : 1) * Number(match[2]!.replace(/\./g, '')) : null
  }
  const lines = pdfText.split('\n')
  let blocks = 0
  lines.forEach((line, i) => {
    if (!/^\s*Gesamtinvestition\s/.test(line)) return
    const investment = euro(line)
    const end = lines.findIndex((l, j) => j > i && /Nettoinvestition nach Förderung\s+€/.test(l))
    if (investment === null || end === -1 || lines.slice(i + 1, end).some((l) => /Gesamtinvestition/.test(l))) {
      return
    }
    const between = lines.slice(i + 1, end).map(euro).filter((v): v is number => v !== null)
    expect(between.length, `Förderzeilen fehlen nach Zeile ${i + 1}`).toBeGreaterThan(0)
    expect(investment + between.reduce((a, b) => a + b, 0), `Förderblock ab Zeile ${i + 1}`).toBe(
      euro(lines[end]!),
    )
    blocks++
  })
  return blocks
}

describe('Report-Snapshots der Referenzfälle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const c of CASES) {
    it(`${c.name}: PDF-Text und Bildschirm-Markup unverändert`, async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(c.runAt) })
      const { pdfText, screenHtml, result } = await renderSnapshots(c)
      checkSnapshot(`${c.snapshot ?? c.name}.pdf.txt`, pdfText)
      // Mit Förderung trägt das PDF mindestens einen Förderblock — ausser kein Zusatzspeicher rechnet sich.
      const blocks = checkSubsidyArithmetic(pdfText)
      if (/subsidy/i.test(Object.keys(c.draftPatch ?? {}).join(' '))) {
        if (!pdfText.includes('Lohnt sich ein zusätzlicher Speicher?')) expect(blocks).toBeGreaterThan(0)
      }
      c.checkResult?.(result)
      checkSnapshot(`${c.snapshot ?? c.name}.screen.html`, screenHtml)
    })
  }

  for (const c of RENDER_REQUEST_CASES) {
    it(`${c.name}: PDF-Text aus der Render-Anfrage unverändert`, async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(c.runAt) })
      const readout = readRenderRequest({ data: JSON.parse(readFileSync(c.file, 'utf8')), error: null })
      if (readout.status !== 'ok') throw new Error('Render-Anfrage nicht lesbar')
      const input = buildReportInputFromRenderRequest(readout.request, new Date(c.runAt))
      const tmp = mkdtempSync(path.join(tmpdir(), 'report-snapshot-'))
      checkSnapshot(`${c.name}.pdf.txt`, await renderPdfText(input, path.join(tmp, `${c.name}.pdf`)))
    })
  }
})
