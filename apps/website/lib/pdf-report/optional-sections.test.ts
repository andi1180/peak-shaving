import path from 'node:path'
import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import type { PvOutageMonth } from 'engine'
import type {
  BatteryRoiEntry,
  DispatchTrace,
  LoadProfile,
  MonthlyTariffComparison,
  ReportOptionalSection,
} from 'shared'

import { buildBasisChapter, DATA_SOURCES_TABLE_ID } from './basis'
import { buildComparisonChapter, CANDIDATE_TABLE_ID } from './comparison'
import { SECTION_ID } from './content'
import type { ChartRaster } from './chart-raster'
import { buildReportContext } from './context'
import { ReportDocument } from './document'
import { createPageNumberSink } from './page-numbers'
import { buildReportLayout, reportLayoutOf } from './layout'
import { block, column, resolveReportText } from './report-text'
import { buildReportRegistry } from './registry'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type { PdfReportAnalysis, PdfReportInput } from './types'
import type { ReportChartRasters } from './charts'

/**
 * Report-Baukasten C — die abwählbaren Bausteine.
 *
 * ── ⚠ GEMESSEN WIRD AM ERZEUGTEN PDF, NICHT AN DER ABLEITUNG ──────────────────────────────────
 * Die Auswahl greift an vier verschiedenen Orten (Kontext, Kapitel, Dokument, Rasterung). Ein Test
 * gegen die Ableitungsschicht allein bewiese, dass die Werte stimmen — nicht, dass das BLATT sich
 * ändert; und genau dazwischen liegen die zwei Fehler, die dieser Schritt vermeiden soll (ein Bild
 * ohne seine Aussage, eine Agenda auf ein leeres Kapitel).
 *
 * ⚠ DIE SCHRIFT WIRD HIER AUS DEM DATEISYSTEM REGISTRIERT. Im Browser holt `registerReportFonts`
 * sie per URL von der eigenen Herkunft (`/report-fonts/…`); in Node gibt es die Herkunft nicht, und
 * ohne Registrierung bricht react-pdf mit „Font family not registered". Es sind dieselben drei
 * WOFF-Dateien.
 */
const FONT_DIR = path.resolve(import.meta.dirname, '../../public/report-fonts')
Font.register({
  family: 'Inter',
  fonts: [
    { src: `${FONT_DIR}/Inter-Regular.woff`, fontWeight: 400 },
    { src: `${FONT_DIR}/Inter-SemiBold.woff`, fontWeight: 600 },
    { src: `${FONT_DIR}/Inter-Bold.woff`, fontWeight: 700 },
  ],
})
Font.registerHyphenationCallback((word) => [word])

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Der Prüffall: er trägt ALLE abwählbaren Bausteine gleichzeitig
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Genug Spur für Heatmap UND Ø-Ladepreis — beide hängen allein hieran (s. `insight.ts`). */
const TRACE: DispatchTrace = {
  capKwByPeriod: [40],
  caughtPeaks: [{ ts: '2025-02-03T07:15:00.000Z', originalKw: 48, residualKw: 40, caught: true }],
  representativeDays: [],
  batteryFlowByHourMonth: Array.from({ length: 24 }, (_, hour) =>
    Array.from({ length: 12 }, (_, month) => (hour === 3 ? 4 + month : null)),
  ),
  monthlyChargePrice: {
    chargeCtPerKwh: [8, ...Array<null>(11).fill(null)],
    dischargeCtPerKwh: [22, ...Array<null>(11).fill(null)],
    averageCtPerKwh: [14, ...Array<null>(11).fill(null)],
    chargedKwh: [500, ...Array<null>(11).fill(null)],
    dischargedKwh: [420, ...Array<null>(11).fill(null)],
  },
}

const BATTERY = {
  id: 'kat-1',
  name: 'Katalog 1',
  manufacturer: 'Fixture',
  class: 'commercial' as const,
  usableCapacityKwh: 60,
  maxPowerKw: 20,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic' as const,
}

const ENTRY: BatteryRoiEntry = {
  battery: BATTERY,
  newBilledKw: 40,
  leistungspreisSavingPerYear: 800,
  selfConsumptionSavingPerYear: 300,
  loadShiftSavingPerYear: 100,
  selfConsumptionSavingOverCoveredPeriod: 300,
  loadShiftSavingOverCoveredPeriod: 100,
  annualizationFactor: 1,
  coveredDays: 365,
  totalSavingPerYear: 1200,
  warnings: [],
  totalInvestment: 21000,
  subsidyAmount: 0,
  taxBenefit: 0,
  taxEffectsIncluded: false,
  netInvestment: 21000,
  amortizationYears: 17.5,
  netSavingOverHorizon: 4200,
  dispatchTrace: TRACE,
}

const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: [1200, ...Array<null>(11).fill(null)],
  spotWithoutControlEur: [1100, ...Array<null>(11).fill(null)],
  spotWithBatteryEur: [950, ...Array<null>(11).fill(null)],
  coveredMonths: 1,
  fixedCosts: {
    networkBaseFeeEur: 0,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 31,
  },
}

const ANALYSIS: PdfReportAnalysis = {
  current: {
    annualPeakKw: 48,
    monthlyPeaksKw: Array<number>(12).fill(48),
    billedKw: 48,
    leistungspreisCostPerYear: 3980.16,
  },
  perBattery: [ENTRY, { ...ENTRY, battery: { ...BATTERY, id: 'kat-2', name: 'Katalog 2' } }],
  recommendation: { batteryId: BATTERY.id, rationale: '' },
  assumptions: {
    roundTripEfficiency: 0.9,
    horizonYears: 10,
    energyPriceCtPerKwh: 24.5,
    einspeiseverguetungCtPerKwh: 7.2,
    billingModel: 'monthly_max_sum',
  },
  tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
  /* Nicht leer — sonst gäbe es den Datenqualitäts-Hinweis gar nicht und die Probe liefe ins Leere. */
  dataQuality: {
    coveredDays: 240,
    coveredMonths: 8,
    gapsInterpolated: 3000,
    largestGapSlots: 2880,
    warnings: ['30 Tage interpoliert'],
  },
}

const LOAD_PROFILE: LoadProfile = {
  readings: [{ ts: '2025-02-03T07:15:00.000Z', gridPowerKw: 48 }],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'net_signed',
}

const PV_OUTAGE_MONTHS: PvOutageMonth[] = [
  { year: 2025, month: 5, daysWithDayWindowData: 28, minDayWindowKw: 9.4 },
  { year: 2025, month: 6, daysWithDayWindowData: 30, minDayWindowKw: 8.1 },
]

function inputFor(optionalSections?: readonly ReportOptionalSection[]): PdfReportInput {
  return {
    title: 'Prüffall',
    subtitle: 'Report-Baukasten C',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '17.09.2026',
    analysis: ANALYSIS,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    hasPv: true,
    pvOutageMonths: PV_OUTAGE_MONTHS,
    ...(optionalSections === undefined ? {} : { optionalSections }),
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die Bilder: zwei winzige PNGs mit VERSCHIEDENER Breite
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ Die Breiten (7 px / 11 px) sind der Messpunkt: react-pdf schreibt sie als `/Width 7` bzw.
 * `/Width 11` in das PDF. Damit lässt sich sagen, WELCHES Bild fehlt — eine blosse Zählung der
 * Bild-Objekte könnte das nicht (und react-pdf legt je PNG zusätzlich eine Alphamaske ab).
 */
function raster(dataUrl: string, widthPx: number): ChartRaster {
  return { dataUrl, widthPx, heightPx: 5, aspectRatio: widthPx / 5 }
}

const HOUR_FLOW_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAIAAAAG+GGPAAAAEUlEQVR4nGM4ISeHiRho' +
  'JAoAuykjjT2f0dIAAAAASUVORK5CYII='
const CHARGE_PRICE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAFCAIAAAAcxIEBAAAAEUlEQVR4nGOQkzuBHzEM' +
  'EhUAaT433Tm9T+QAAAAASUVORK5CYII='

const CHARTS: ReportChartRasters = {
  load: null,
  loadError: null,
  loadVertices: null,
  cost: null,
  costError: null,
  costKind: null,
  monthly: null,
  monthlyError: null,
  flow: null,
  flowError: null,
  flowDay: null,
  hourFlow: raster(HOUR_FLOW_PNG, 7),
  hourFlowError: null,
  chargePrice: raster(CHARGE_PRICE_PNG, 11),
  chargePriceError: null,
  comparison: null,
  comparisonError: null,
  comparisonVariant: null,
  captureMs: 0,
  figureMs: {
    load: null,
    cost: null,
    monthly: null,
    flow: null,
    hourFlow: null,
    chargePrice: null,
    comparison: null,
  },
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Das erzeugte PDF
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

async function pdfFor(optionalSections?: readonly ReportOptionalSection[]): Promise<Buffer> {
  const input = inputFor(optionalSections)
  const context = buildReportContext(input)
  const registry = buildReportRegistry(input, context)
  return renderToBuffer(
    h(ReportDocument, {
      input,
      charts: CHARTS,
      context,
      registry,
      layout: buildReportLayout(input, context, registry),
      agenda: null,
      sink: createPageNumberSink(),
    }) as never,
  )
}

/**
 * ⚠ Zwei Läufe DESSELBEN Dokuments sind nie byte-gleich: der Datei-Bezeichner im Trailer
 * (`/ID [<…> <…>]`) und der Erzeugungszeitpunkt sind je Lauf neu. Gemessen wird deshalb alles
 * ausser diesen beiden — sie hängen an der Uhr, nicht am Inhalt.
 */
function withoutRunSpecifics(pdf: Buffer): string {
  return pdf
    .toString('latin1')
    .replace(/\/ID \[[^\]]*\]/g, '/ID []')
    .replace(/\(D:[^)]*\)/g, '(D:)')
}

/** Seitenzahl aus dem Seitenbaum — dieselbe Zahl, die die Agenda-Verweise tragen. */
function pageCount(pdf: Buffer): number {
  const match = pdf.toString('latin1').match(/\/Count (\d+)/)
  return match ? Number(match[1]) : -1
}

function hasImageWidth(pdf: Buffer, widthPx: number): boolean {
  return pdf.toString('latin1').includes(`/Width ${widthPx}\n`)
}

const ALL_OPTIONAL: ReportOptionalSection[] = [
  /* ⚠ `addon` steht in dieser Liste, entsteht in DIESEM Prüffall aber gar nicht: er hat keine
     Bestandsanlage. Gemessen wird er im Bestandsfall (`existing-case.test.ts`, B3-2b). */
  'addon',
  'hour_flow',
  'charge_price',
  'table_candidates',
  'data_quality',
  'pv_outage',
]

describe('Report-Baukasten C — die Admin-Auswahl am erzeugten PDF', () => {
  it('ohne Auswahl entsteht Blatt für Blatt dasselbe Dokument wie mit allen', async () => {
    const [ohneFeld, alle] = await Promise.all([pdfFor(undefined), pdfFor(ALL_OPTIONAL)])

    /*
     * ⚠ DAS IST DIE RÜCKWÄRTSKOMPATIBILITÄT, und sie ist nicht bloss eine Feinheit: eine Übergabe
     * lebt 24 Stunden, es liegen zum Zeitpunkt jedes Deployments also Zeilen ohne das Feld in
     * `platform.report_render_requests`. Fiele die Abwesenheit auf „nichts zeigen", verlöre ein
     * bereits verschickter Report beim Öffnen jeden davon.
     */
    expect(withoutRunSpecifics(ohneFeld)).toBe(withoutRunSpecifics(alle))
  }, 60_000)

  it('hour_flow abgewählt: das Bild verschwindet mit, der Ø-Ladepreis bleibt', async () => {
    const [alle, ohneHourFlow] = await Promise.all([
      pdfFor(ALL_OPTIONAL),
      pdfFor(['charge_price', 'table_candidates', 'data_quality', 'pv_outage']),
    ])

    expect(hasImageWidth(alle, 7)).toBe(true)
    expect(hasImageWidth(alle, 11)).toBe(true)

    /* Nur den Satz abzuschalten liesse ein Bild ohne seine Aussage stehen — genau das nicht. */
    expect(hasImageWidth(ohneHourFlow, 7)).toBe(false)
    expect(hasImageWidth(ohneHourFlow, 11)).toBe(true)
    expect(ohneHourFlow.length).toBeLessThan(alle.length)
  }, 60_000)

  it('beide Ladeverhalten-Bausteine abgewählt: das Kapitel entfällt samt seiner Seite', async () => {
    const [alle, ohneKapitel] = await Promise.all([
      pdfFor(ALL_OPTIONAL),
      pdfFor(['table_candidates', 'data_quality', 'pv_outage']),
    ])

    /*
     * ⚠ Seiten weniger, nicht bloss weniger Text: bliebe die `<Page>` stehen, stünde ein
     * Agenda-Eintrag auf einem Kapitel mit Überschrift, Vorspann und sonst nichts (D14).
     *
     * ⚠ Gemessen 15 → 13, also ZWEI Seiten: das Ladeverhalten-Kapitel läuft in diesem Prüffall
     * über zwei Blätter (zwei Bilder samt Aussagen). Die Zahl ist deshalb nicht fest gepinnt —
     * sie hinge am Umbruch und würde bei jeder Textänderung rot, ohne dass etwas kaputt wäre.
     */
    expect(pageCount(ohneKapitel)).toBeLessThan(pageCount(alle))
    expect(hasImageWidth(ohneKapitel, 7)).toBe(false)
    expect(hasImageWidth(ohneKapitel, 11)).toBe(false)
  }, 60_000)

  /**
   * B3-1 — die Stichprobe zur Freigabe der Kandidatentabelle. Sie misst BEIDES in einem Lauf: dass
   * das Blatt die Tabelle nicht mehr trägt (und damit auch nicht ihre Navy-Kopfzeile und ihr
   * Zebra — beide leben in `StatementTable`), und dass der Klarsatz daneben sie nicht mehr beim
   * Namen nennt. Das Zweite ist der eigentliche Fund von `Report_Baukasten_Block3_Plan.md` §1.5:
   * eine Tabelle wegzulassen ist leicht, einen Satz über sie stehen zu lassen der Fehler.
   */
  it('table_candidates abgewählt: die Tabelle verschwindet, und kein Satz nennt sie mehr', async () => {
    const ohneAuswahl: ReportOptionalSection[] = [
      'hour_flow',
      'charge_price',
      'data_quality',
      'pv_outage',
    ]
    const input = inputFor(ohneAuswahl)
    const context = buildReportContext(input)
    const registry = buildReportRegistry(input, context)
    const layout = buildReportLayout(input, context, registry)

    /* Gegen DIESE Beschreibung löst jeder Verweis auf — nicht gegen eine von Hand gebaute. */
    expect(layout.present(block(CANDIDATE_TABLE_ID))).toBe(false)
    expect(layout.present(column(CANDIDATE_TABLE_ID, 'saving_per_year'))).toBe(false)

    const statement = buildComparisonChapter(input.analysis, context).statement
    const text = resolveReportText(statement.body, layout, statement.id)
    expect(text).not.toContain('Tabelle')
    expect(text).not.toContain('je Zeile')
    expect(text).toContain('Verglichen wird nach der Netto-Ersparnis')

    const [alle, ohneTabelle] = await Promise.all([pdfFor(ALL_OPTIONAL), pdfFor(ohneAuswahl)])
    expect(ohneTabelle.length).toBeLessThan(alle.length)
  }, 60_000)
})

describe('Report-Baukasten C — die zwei Abhängigen des Schlusskapitels', () => {
  const DATA_QUALITY_REFERENCE = 'wie im Datenqualitäts-Hinweis oben'

  /**
   * Die Tabelle als Text — mit Stufe D AUFGELÖST, denn der Verweis steht jetzt als `ReportRef` in
   * der Zelle und nicht mehr als fertiger Satz. Die Beschreibung trägt genau das, worauf es
   * ankommt: steht der Datenqualitäts-Hinweis über der Tabelle oder nicht?
   */
  function dataSourcesText(chapter: ReturnType<typeof buildBasisChapter>): string {
    const layout = reportLayoutOf([
      ...(chapter.dataQuality
        ? [
            {
              id: 'data_quality' as const,
              section: SECTION_ID.basis,
              title: chapter.dataQuality.title,
              amount: null,
              rows: {},
            },
          ]
        : []),
      { id: DATA_SOURCES_TABLE_ID, section: SECTION_ID.basis, title: '', amount: null, rows: {} },
    ])
    return chapter.dataSources.rows
      .flatMap((row) =>
        row.cells.map((cell) => resolveReportText(cell, layout, DATA_SOURCES_TABLE_ID)),
      )
      .join(' | ')
  }

  it('data_quality abgewählt: die Datenquellen-Tabelle verweist NICHT mehr auf den Hinweis', () => {
    const mit = buildBasisChapter(inputFor(ALL_OPTIONAL))
    expect(mit.dataQuality).not.toBeNull()
    expect(dataSourcesText(mit)).toContain(DATA_QUALITY_REFERENCE)

    /*
     * ⚠ DAS IST DER MIT PR #273 BEHOBENE FEHLER, nur über die Auswahl wieder erreichbar: die Zelle
     * mass bis Baukasten C `dq.warnings.length > 0` nach, also eine NACHBILDUNG der Bedingung von
     * `buildDataQuality`. Die Warnungen bleiben hier bestehen — abgewählt ist der HINWEIS.
     */
    const ohne = buildBasisChapter(inputFor(['hour_flow', 'charge_price', 'pv_outage']))
    expect(ohne.dataQuality).toBeNull()
    expect(ANALYSIS.dataQuality.warnings.length).toBeGreaterThan(0)
    expect(dataSourcesText(ohne)).not.toContain(DATA_QUALITY_REFERENCE)
  })

  it('pv_outage abgewählt: method_pv_outage verschwindet über die bestehende Kopplung mit', () => {
    const mit = buildBasisChapter(inputFor(ALL_OPTIONAL))
    expect(mit.pvOutage).not.toBeNull()
    expect(mit.methodPerMetric.map((item) => item.id)).toContain('method_pv_outage')

    /*
     * ⚠ Es gibt für den Methodik-Absatz KEINE eigene Auswahl-Prüfung. Er hängt seit D9 am HINWEIS
     * („am HINWEIS gemessen, nicht an seinen Vorbedingungen: eine Bedingung, ein Ort"), und die
     * Auswahl greift genau dort. Der Befund selbst (`pvOutageMonths`) bleibt unverändert übergeben.
     */
    const ohne = buildBasisChapter(inputFor(['hour_flow', 'charge_price', 'data_quality']))
    expect(ohne.pvOutage).toBeNull()
    expect(ohne.methodPerMetric.map((item) => item.id)).not.toContain('method_pv_outage')
    /* Die übrigen Methodik-Absätze bleiben — abgewählt ist ein Baustein, nicht der Abschnitt. */
    expect(ohne.methodPerMetric.length).toBeGreaterThan(0)
  })
})

describe('Report-Baukasten C — was die Auswahl nicht erreicht', () => {
  it('die Registry liefert die übrigen Bausteine unabhängig von der Auswahl', () => {
    const mit = inputFor(ALL_OPTIONAL)
    const ohne = inputFor([])
    const a = buildReportRegistry(mit, buildReportContext(mit))
    const b = buildReportRegistry(ohne, buildReportContext(ohne))

    expect(b.get('assumptions').build()).toEqual(a.get('assumptions').build())
    expect(b.get('limitations').build()).toEqual(a.get('limitations').build())

    /*
     * Gegenprobe — und sie umfasst bewusst nur ZWEI der fünf: `data_quality` und `pv_outage`
     * entstehen im KONTEXT (dort hängen ihre zwei Abhängigen daran), die Registry gibt deshalb
     * bereits `null`. `hour_flow`/`charge_price`/`table_candidates` gehören weiterhin zum Katalog
     * — bei ihnen heisst `null` „für diesen Fall gibt es das nicht", und das Dokument SAGT das
     * dann auch; ein abgewählter Baustein hat diesen Grund nicht und wird im Dokument
     * weggelassen (s. `charts.tsx`, `selectedTable`).
     */
    expect(b.get('data_quality').build()).toBeNull()
    expect(b.get('pv_outage').build()).toBeNull()
    expect(b.get('hour_flow').build()).toEqual(a.get('hour_flow').build())
    expect(b.get('table_candidates').build()).toEqual(a.get('table_candidates').build())
    /* `addon` ist seit B3-2b abwählbar und verhält sich wie die drei darüber: die Registry baut
       ihn unabhängig von der Auswahl, weggelassen wird er im Dokument (`ResultsChapter`). */
    expect(b.get('addon').build()).toEqual(a.get('addon').build())
  })
})
