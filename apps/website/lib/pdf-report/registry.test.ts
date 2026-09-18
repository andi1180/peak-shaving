import { describe, expect, it } from 'vitest'
import type { PvOutageMonth } from 'engine'
import type {
  AddonBatteryScenario,
  BatteryCandidate,
  BatteryRoiEntry,
  DispatchTrace,
  EstimatedPvSummary,
  LoadProfile,
  MonthlyTariffComparison,
} from 'shared'

import { buildBasisChapter } from './basis'
import { buildComparisonChapter } from './comparison'
import { buildReportContext } from './context'
import { buildDetailChapter, buildMonthlyChapter } from './detail'
import { buildInsightChapter } from './insight'
import { buildRecommendationChapter } from './recommendation'
import { SECTION_ID } from './content'
import { buildReportLayout } from './layout'
import { buildReportRegistry, REPORT_BAUKASTEN_IDS, type ReportBaukastenId } from './registry'
import { resolveReportText, type ReportText } from './report-text'
import { buildReportSummary } from './summary'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * Report-Baukasten B2 — die Registry liefert je Kennung EXAKT das, was das Dokument heute zeigt.
 *
 * ── ⚠ DIE ERWARTUNG KOMMT AUS DEN KAPITEL-FASSADEN, NICHT AUS NOTIERTEN WERTEN ────────────────
 * `expectedFor` baut dieselben sieben Kapitel, die `document.tsx` baut (samt der drei
 * Kapitel-Schalter), und greift den Baustein daraus heraus. Ein notierter Erwartungswert prüfte
 * nur, ob jemand ihn beim Umformulieren mitgezogen hat; hier prüft der Vergleich, ob die Registry
 * und der ausgelieferte Rendering-Pfad auseinanderlaufen — und genau das ist die Zusage dieses
 * Schritts, solange beide Wege nebeneinander stehen.
 */

const KAT1: BatteryCandidate = {
  id: 'kat-1',
  name: 'Katalog 1',
  manufacturer: 'Fixture',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 20,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

const KAT2: BatteryCandidate = { ...KAT1, id: 'kat-2', name: 'Katalog 2', usableCapacityKwh: 90 }

const BESTAND: BatteryCandidate = {
  ...KAT1,
  id: 'bestand',
  name: 'Ihre Anlage',
  usableCapacityKwh: 19.2,
  maxPowerKw: 10,
}

/** Genug Spur für Heatmap und Ø-Ladepreis — beide Bilder hängen allein hieran. */
const TRACE: DispatchTrace = {
  capKwByPeriod: [40],
  caughtPeaks: [{ ts: '2025-02-03T07:15:00.000Z', originalKw: 48, residualKw: 40, caught: true }],
  representativeDays: [
    {
      date: '2025-02-03',
      label: 'worst_caught_peak',
      intervals: [
        {
          ts: '2025-02-03T07:15:00.000Z',
          gridPowerKw: 40,
          pvGenerationKw: 0,
          batteryPowerKw: -8,
          socKwh: 12,
        },
      ],
    },
  ],
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

function roiEntry(battery: BatteryCandidate, over: Partial<BatteryRoiEntry> = {}): BatteryRoiEntry {
  return {
    battery,
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
    netSavingOverHorizon: -9000,
    dispatchTrace: TRACE,
    ...over,
  }
}

function addonScenario(
  battery: BatteryCandidate,
  netSavingOverHorizon: number,
): AddonBatteryScenario {
  return {
    ...roiEntry(battery, { netSavingOverHorizon }),
    combined: {
      ...BESTAND,
      usableCapacityKwh: BESTAND.usableCapacityKwh + battery.usableCapacityKwh,
    },
  }
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

const ESTIMATED_PV: EstimatedPvSummary = {
  postalCode: '1100',
  locationName: 'Wien',
  latitudeDeg: 48.2,
  longitudeDeg: 16.37,
  totalPeakPowerKwp: 22,
  arrayCount: 2,
  weatherYears: { from: 2013, to: 2022 },
  spread: { minKwh: 19800, maxKwh: 23100, meanKwh: 21400, spreadPercent: 7.7 },
  echoedAzimuthDeg: [0, 90],
  echoedSlopeDeg: [30, 30],
}

function analysisBase(over: Partial<PdfReportAnalysis>): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 3980.16,
    },
    perBattery: [roiEntry(KAT1), roiEntry(KAT2)],
    recommendation: { batteryId: KAT1.id, rationale: '' },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      billingModel: 'monthly_max_sum',
    },
    dataQuality: {
      coveredDays: 365,
      coveredMonths: 12,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    ...over,
  }
}

function inputFor(analysis: PdfReportAnalysis, over: Partial<PdfReportInput> = {}): PdfReportInput {
  return {
    title: 'Prüffall',
    subtitle: 'Report-Baukasten B2',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '17.09.2026',
    analysis,
    loadProfile: LOAD_PROFILE,
    tariffSource: null,
    tariffVintage: null,
    ...over,
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die fünf Referenzfälle
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Bestandsanlage, Hebel rechenbar, EIN Zusatzgerät rechnet sich → Tabellen-Zweig (`addon_table`). */
const BESTAND_FALL = inputFor(
  analysisBase({
    tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
    existingBatteryAnalysis: {
      entry: roiEntry(BESTAND),
      addonScenarios: [addonScenario(KAT1, 4200), addonScenario(KAT2, -3100)],
    },
  }),
)

/** Ohne Bestandsanlage, zwei Kandidaten → `catalog_alternatives` und Kapitel 4. */
const KATALOG_POSITIV = inputFor(
  analysisBase({ tariffOptimization: { computable: true, monthlyComparison: COMPARISON } }),
)

/**
 * Ohne Bestandsanlage, EIN Kandidat, kein Hebel, keine Spur — der Fall, in dem am meisten fehlt:
 * kein Kapitel 4/5/6, keine Spitzenkappung, keine Methodik-Absätze.
 */
const KATALOG_NEGATIV = inputFor(
  analysisBase({
    perBattery: [roiEntry(KAT1, { leistungspreisSavingPerYear: 0, dispatchTrace: undefined })],
  }),
)

/** Bestandsanlage, Börsenpreis-Lücke → `tariff_blocker`; kein Zusatzgerät rechnet sich. */
const BLOCKER_FALL = inputFor(
  analysisBase({
    dataQuality: {
      coveredDays: 365,
      coveredMonths: 12,
      gapsInterpolated: 42,
      largestGapSlots: 0,
      warnings: ['Lücke in den Börsenpreisen'],
    },
    tariffOptimization: {
      computable: false,
      side: 'spot_price',
      kind: 'gap',
      ranges: [{ fromIso: '2025-03-01T00:00:00.000Z', toIso: '2025-03-08T00:00:00.000Z' }],
      message: 'Börsenpreise unvollständig',
    },
    existingBatteryAnalysis: {
      entry: roiEntry(BESTAND),
      addonScenarios: [addonScenario(KAT1, -2000), addonScenario(KAT2, -3100)],
    },
  }),
)

/** PV-Ausfall — und zugleich der einzige Fall, der alle vier Hinweise der Kernergebnis-Seite trägt. */
const PV_AUSFALL = inputFor(
  analysisBase({
    tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      billingModel: 'monthly_max_average',
    },
    dataQuality: {
      coveredDays: 240,
      coveredMonths: 8,
      gapsInterpolated: 3000,
      largestGapSlots: 30 * 96,
      warnings: ['30 Tage interpoliert'],
    },
  }),
  {
    loadProfile: { ...LOAD_PROFILE, source: 'standard_profile' },
    estimatedPv: ESTIMATED_PV,
    hasPv: true,
    pvOutageMonths: PV_OUTAGE_MONTHS,
  },
)

const FAELLE: ReadonlyArray<[string, PdfReportInput]> = [
  ['Bestand', BESTAND_FALL],
  ['Katalog positiv', KATALOG_POSITIV],
  ['Katalog negativ', KATALOG_NEGATIV],
  ['Blocker', BLOCKER_FALL],
  ['PV-Ausfall', PV_AUSFALL],
]

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die Erwartung: der heutige Rendering-Pfad
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Was `document.tsx` für diese Kennung zeigt — über dieselben Kapitel-Fassaden und dieselben drei
 * Kapitel-Schalter, die der Seitenbaum auswertet (`document.tsx`: `hasMonthly`/`hasInsight`/
 * `hasComparison` aus dem Kontext). `null` heisst: der Baustein steht in diesem Fall nirgends.
 */
function expectedFor(id: ReportBaukastenId, input: PdfReportInput): unknown {
  const analysis = input.analysis
  const context = buildReportContext(input)

  const summary = buildReportSummary(analysis, input.loadProfile, input.estimatedPv, context)
  const recommendation = buildRecommendationChapter(analysis, context)
  const detail = buildDetailChapter(analysis, { flowDay: null }, context)
  const monthly = context.hasMonthly ? buildMonthlyChapter(analysis) : null
  const insight = context.hasInsight ? buildInsightChapter(analysis, context) : null
  const comparison = context.hasComparison ? buildComparisonChapter(analysis, context) : null
  const basis = buildBasisChapter(input, context)

  switch (id) {
    case 'savings':
    case 'peak_shaving':
    case 'load_shift':
    case 'addon':
      return summary.statements.find((s) => s.id === id) ?? null
    case 'standard_profile':
    case 'estimated_pv':
    case 'partial_year':
    case 'large_gap':
      return summary.notices.find((n) => n.id === id) ?? null
    case 'recommendation':
      return recommendation.recommendation
    case 'load_control':
      return recommendation.loadControl
    case 'monthly_comparison': {
      const inDetail = detail.cost?.statement
      return inDetail?.id === 'monthly_comparison' ? inDetail : (monthly?.statement ?? null)
    }
    case 'hour_flow':
      return insight?.hourFlow?.statement ?? null
    case 'charge_price':
      return insight?.chargePrice?.statement ?? null
    case 'addon_none':
    case 'addon_table':
    case 'catalog_alternatives':
      return comparison && comparison.statement.id === id ? comparison.statement : null
    case 'table_candidates':
      return comparison?.table ?? null
    case 'assumptions':
      return basis.assumptions
    case 'data_quality':
      return basis.dataQuality
    case 'tariff_blocker':
      return basis.blocker
    case 'pv_outage':
      return basis.pvOutage
    case 'limitations':
      return basis.limitations
    case 'table_tariff_components':
      return basis.tariffComponents
    case 'table_data_sources':
      return basis.dataSources
    case 'method_current_tariff':
    case 'method_spot_uncontrolled':
    case 'method_load_control':
    case 'method_pv_outage':
      return basis.methodPerMetric.find((m) => m.id === id) ?? null
  }
}

function registryFor(input: PdfReportInput) {
  return buildReportRegistry(input, buildReportContext(input))
}

describe('Report-Baukasten-Registry (B2)', () => {
  it('deckt die 28 Kennungen genau einmal ab', () => {
    const entries = registryFor(BESTAND_FALL).entries
    expect(entries).toHaveLength(28)
    expect([...entries.map((e) => e.id)].sort()).toEqual([...REPORT_BAUKASTEN_IDS].sort())
  })

  describe.each(FAELLE)('%s', (_label, input) => {
    it.each(REPORT_BAUKASTEN_IDS)('%s liefert denselben Wert wie der Rendering-Pfad', (id) => {
      expect(registryFor(input).get(id).build()).toEqual(expectedFor(id, input))
    })
  })

  /*
   * ⚠ Ein Erzeuger, zwei Quellen — und der Vergleich mit dem Rendering-Pfad oben allein zeigte
   * nicht, dass BEIDE Quellen erreicht werden: ein Eintrag, der immer `null` gäbe, wäre dort in
   * jedem Fall zufällig richtig, in dem der Baustein ohnehin fehlt.
   */
  it('monthly_comparison: mit Bestandsanlage aus Kapitel 3, ohne sie aus Kapitel 4', () => {
    const mitBestand = registryFor(BESTAND_FALL).get('monthly_comparison').build()
    const ohneBestand = registryFor(KATALOG_POSITIV).get('monthly_comparison').build()

    expect(mitBestand).not.toBeNull()
    expect(ohneBestand).not.toBeNull()
    /* Die Fallunterscheidung des Erzeugers (`isExisting`) schlägt im Wortlaut durch. */
    const textOf = (built: unknown, input: PdfReportInput) =>
      resolveReportText(
        (built as { body: ReportText }).body,
        buildReportLayout(input, buildReportContext(input), registryFor(input)),
        'monthly_comparison',
      )
    expect(textOf(mitBestand, BESTAND_FALL)).toContain('DIFFERENZEN zwischen diesen drei Summen')
    expect(textOf(ohneBestand, KATALOG_POSITIV)).toContain('Wert der Ladesteuerung')

    /* Ohne rechenbaren Hebel gibt es ihn an keiner der beiden Stellen. */
    expect(registryFor(BLOCKER_FALL).get('monthly_comparison').build()).toBeNull()
  })

  /*
   * ⚠ Die beiden Kennungen schliessen einander aus, weil `candidatesOf` allein an
   * `existingBatteryAnalysis` verzweigt (`comparison.ts`) — es gibt keinen Zustand, in dem beide
   * zuträfen. Gemessen wird das über alle fünf Fälle und nicht nur über die zwei, die je einen
   * treffen: eine Variante, die sich später doch überlappen liesse, fiele sonst nicht auf.
   */
  it('addon_table und catalog_alternatives: nie beide zugleich, je einmal erreicht', () => {
    const paare = FAELLE.map(([label, input]) => {
      const registry = registryFor(input)
      return {
        label,
        addon: registry.get('addon_table').build(),
        catalog: registry.get('catalog_alternatives').build(),
      }
    })

    for (const { label, addon, catalog } of paare) {
      expect(addon === null || catalog === null, `beide zugleich in „${label}"`).toBe(true)
    }
    expect(paare.filter((p) => p.addon !== null).map((p) => p.label)).toEqual(['Bestand'])
    expect(paare.filter((p) => p.catalog !== null).map((p) => p.label)).toEqual([
      'Katalog positiv',
      'PV-Ausfall',
    ])
    /* Der dritte Zweig desselben Kapitels: ohne wirtschaftliches Zusatzgerät der Klarsatz. */
    expect(registryFor(BLOCKER_FALL).get('addon_none').build()).not.toBeNull()
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Stufe D — die Leseordnung
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ DIE RICHTUNG WIRD GEGEN DIE ECHTE `entries`-FOLGE GEMESSEN, NICHT GEGEN DEN WORTLAUT.
 *
 * Ein Wortlaut-Vergleich sagt nur, dass heute dasselbe herauskommt — er sagt nicht, ob es aus dem
 * RICHTIGEN Grund herauskommt. Der Fall `limitations` war genau das: der Eintrag stand in `entries`
 * vor den beiden Tabellen und im Dokument dahinter, und weil niemand auf ihn zeigte, fiel es nicht
 * auf. Hier wird deshalb die Ortsangabe selbst geprüft, Baustein gegen Baustein.
 */
describe('Stufe D — `entries` ist die Leseordnung des Dokuments', () => {
  const layoutFor = (input: PdfReportInput) =>
    buildReportLayout(input, buildReportContext(input), registryFor(input))

  it('Kapitel 1: die Hinweise stehen in `entries` VOR den Aussagen — wie im JSX', () => {
    const ids = registryFor(BESTAND_FALL)
      .entries.filter((e) => e.section === SECTION_ID.results)
      .map((e) => e.id)

    expect(ids).toEqual([
      'standard_profile',
      'estimated_pv',
      'partial_year',
      'large_gap',
      'savings',
      'peak_shaving',
      'load_shift',
      'addon',
    ])
  })

  it('Kapitel 1: die zwei migrierten Verweise zeigen zurück auf `savings`', () => {
    const layout = layoutFor(BESTAND_FALL)

    expect(layout.place('peak_shaving', { kind: 'amount', id: 'savings' })).toBe('oben')
    expect(layout.place('load_shift', { kind: 'row', id: 'savings', row: 'control_value' })).toBe(
      'oben',
    )
    /* Gegenprobe: umgekehrt gelesen dreht sich die Richtung. */
    expect(layout.place('savings', { kind: 'block', id: 'load_shift' })).toBe('weiter unten')
  })

  it('Kapitel 8: `entries` folgt dem JSX, `limitations` steht zuletzt', () => {
    const ids = registryFor(BESTAND_FALL)
      .entries.filter((e) => e.section === SECTION_ID.basis)
      .map((e) => e.id)

    expect(ids).toEqual([
      'assumptions',
      'data_quality',
      'tariff_blocker',
      'pv_outage',
      'table_tariff_components',
      'table_data_sources',
      'method_current_tariff',
      'method_spot_uncontrolled',
      'method_load_control',
      'method_pv_outage',
      'limitations',
    ])
  })

  it('Kante L: `assumptions` liest die Tarifkomponenten-Tabelle als „weiter unten"', () => {
    const layout = layoutFor(BESTAND_FALL)

    expect(layout.place('assumptions', { kind: 'block', id: 'table_tariff_components' })).toBe(
      'weiter unten',
    )
    /* Und `limitations`, das dahinter steht, liest dieselbe Tabelle als „oben". */
    expect(layout.place('limitations', { kind: 'block', id: 'table_tariff_components' })).toBe(
      'oben',
    )
  })

  it('über Kapitelgrenzen hinweg nennt die Ortsangabe das Kapitel statt einer Richtung', () => {
    const layout = layoutFor(KATALOG_POSITIV)

    expect(layout.place('catalog_alternatives', { kind: 'block', id: 'recommendation' })).toBe(
      'im Kapitel „Empfehlung und Lastverlauf"',
    )
  })
})
