import { describe, expect, it } from 'vitest'
import type { BatteryRoiEntry, LoadProfile, MonthlyTariffComparison } from 'shared'

import { buildAdviceChapter } from './advice'
import { buildReportContext } from './context'
import { buildMonthlyChapter } from './detail'
import { buildReportLayout } from './layout'
import { buildOverviewStatement } from './prerequisites'
import { buildReportRegistry } from './registry'
import { resolveReportText } from './report-text'
import { statementPoints } from './statement'
import { buildReportSummary } from './summary'
import { TARIFF_SOURCE_UNTRACKED, type PdfReportAnalysis, type PdfReportInput } from './types'
import { buildWaysChapter, waysCountOf } from './ways'

/**
 * Report bei unbekanntem Liefertarif (Pflichtenheft §3.1a) — gelesen wird der TEXT, wie das
 * Dokument ihn setzt (Verweise gegen das echte Layout aufgelöst). Zuschnitt des STCE-Falls vom
 * 25.09.2026: Gewerbe, NE 7 ohne Leistungsmessung, kein Speicher, keine PV, synthetische Beträge.
 */

/** Ein Betrag, gleich verteilt auf die ersten `n` Kalendermonate; die übrigen ohne Messwert. */
const months = (total: number, n: number): (number | null)[] =>
  Array.from({ length: 12 }, (_, i) => (i < n ? total / n : null))

function comparisonOf(args: {
  current: number | null
  comparison?: number
  coveredMonths: number
}): MonthlyTariffComparison {
  const n = args.coveredMonths
  return {
    currentTariffEur: args.current === null ? null : months(args.current, n),
    spotWithoutControlEur: months(9000, n),
    spotWithBatteryEur: months(7800, n),
    ...(args.comparison === undefined
      ? {}
      : { comparisonTariffEur: months(args.comparison, n), comparisonSupplier: 'ENSTROGA' }),
    coveredMonths: n,
    fixedCosts: {
      networkBaseFeeEur: 0,
      meteringFeeEur: 0,
      eagFlatFeeEur: 0,
      usageChargeOnFixedEur: 0,
      supplierBaseFeeEur: 0,
      awattarBaseFeeEur: 57.48,
      supplierFeeEurPerMonth: 0,
      awattarFeeEurPerMonth: 4.79,
      coveredDays: 365,
    },
  }
}

const ENTRY: BatteryRoiEntry = {
  battery: {
    id: 'kat-1',
    name: 'Prüfspeicher 30',
    manufacturer: 'Fixture',
    class: 'commercial',
    usableCapacityKwh: 30,
    maxPowerKw: 15,
    roundTripEfficiency: 0.9,
    pricePerKwh: 400,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'dynamic',
  },
  newBilledKw: 40,
  leistungspreisSavingPerYear: 0,
  selfConsumptionSavingPerYear: 0,
  loadShiftSavingPerYear: 1200,
  selfConsumptionSavingOverCoveredPeriod: 0,
  loadShiftSavingOverCoveredPeriod: 1200,
  annualizationFactor: 1,
  coveredDays: 365,
  totalSavingPerYear: 1200,
  warnings: [],
  notices: [],
  totalInvestment: 12000,
  subsidyAmount: 0,
  taxBenefit: 0,
  taxEffectsIncluded: false,
  netInvestment: 12000,
  amortizationYears: 10.4,
  netSavingOverHorizon: -500,
}

function analysisOf(comparison: MonthlyTariffComparison, known: boolean): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 45,
      monthlyPeaksKw: Array<number>(12).fill(45),
      billedKw: 45,
      leistungspreisCostPerYear: 0,
    },
    perBattery: [ENTRY],
    recommendation: {
      batteryId: ENTRY.battery.id,
      rationale: {
        code: 'best_net_saving',
        totalSavingPerYear: 1200,
        amortizationYears: 10.4,
        netSavingOverHorizon: -500,
        horizonYears: 10,
      },
    },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: known ? 13.08 : null,
      einspeiseverguetungCtPerKwh: known ? 4.56 : null,
      billingModel: known ? 'monthly_max_sum' : null,
    },
    dataQuality: {
      coveredDays: 365,
      coveredMonths: comparison.coveredMonths,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    tariffOptimization: { computable: true, monthlyComparison: comparison },
  } as PdfReportAnalysis
}

const LOAD_PROFILE: LoadProfile = {
  intervals: [],
  timezone: 'Europe/Vienna',
  source: 'import_only',
} as unknown as LoadProfile

function inputOf(analysis: PdfReportAnalysis): PdfReportInput {
  return {
    title: 'Prüffall',
    subtitle: '',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '25.09.2026',
    analysis,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    netzebene: 7,
  }
}

/** `formatEur` setzt ein geschütztes Leerzeichen — für die Vergleiche als normales gelesen. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ')

/** Die Kapitel-Texte, aufgelöst gegen das Layout des zusammengestellten Dokuments. */
function textsOf(input: PdfReportInput) {
  const context = buildReportContext(input)
  const layout = buildReportLayout(input, context, buildReportRegistry(input, context))
  const summary = buildReportSummary(input, context)
  const ways = buildWaysChapter(input.analysis)
  const monthly = buildMonthlyChapter(input.analysis)
  const proposal = buildAdviceChapter(input).proposal
  const texts = {
    kpis: summary.kpis.map((kpi) => `${kpi.value} ${kpi.caption.join(' ')}`).join(' | '),
    overview: resolveReportText(summary.overview, layout, 'overview'),
    ways: ways ? ways.statements.map((s) => `${s.title}: ${String(s.body)}`).join('\n') : '',
    wayTitles: ways?.statements.map((s) => s.title) ?? [],
    bars: ways?.bars.map((bar) => bar.key) ?? [],
    monthly: monthly
      ? [
          monthly.statement.title,
          monthly.figure.caption,
          resolveReportText(monthly.statement.body, layout, 'monthly_comparison'),
          ...monthly.statement.rows.map((row) => row.label),
        ].join('\n')
      : '',
    proposal: proposal
      ? statementPoints(proposal, layout)
          .map((point) => `${point.title}: ${point.segments.map((s) => s.text).join('')}`)
          .join('\n')
      : '',
  }
  return {
    ...texts,
    kpis: plain(texts.kpis),
    overview: plain(texts.overview),
    ways: plain(texts.ways),
    monthly: plain(texts.monthly),
    proposal: plain(texts.proposal),
  }
}

describe('Liefertarif unbekannt, ohne Vergleichstarif', () => {
  const input = inputOf(analysisOf(comparisonOf({ current: null, coveredMonths: 12 }), false))
  const texts = textsOf(input)

  it('Zusammenfassung: aWATTar-Kosten statt „liess sich nicht berechnen", Urteil zitiert', () => {
    expect(texts.kpis).toContain('€ 9.000 Stromkosten mit aWATTar ohne Steuerung')
    expect(texts.kpis).toContain('€ 7.800 Mit Speicher und Ladesteuerung')
    expect(texts.overview).not.toContain('nicht berechnen')
    expect(texts.overview).toContain('Ihren heutigen Stromtarif kennen wir nicht')
    expect(texts.overview).toContain('amortisiert sich nach 10,4 Jahren')
  })

  it('Wege-Kapitel: genau zwei Wege, keine Ersparnis gegenüber heute', () => {
    expect(waysCountOf(input.analysis)).toBe(2)
    expect(texts.bars).toEqual(['uncontrolled', 'controlled'])
    expect(texts.ways).toContain('€ 1.200 weniger als ohne Steuerung')
    expect(texts.ways).not.toMatch(/Ihr Tarif heute|heutiger Tarif\.|weniger gekostet/)
  })

  it('Monatskapitel und Vorschlag: nur die gezeigten Reihen, Rechnung nachreichen', () => {
    expect(texts.monthly).toContain('Ihre Stromkosten mit aWATTar')
    expect(texts.monthly).not.toMatch(/heutiger Tarif|Ihr Tarif heute|drei Summen|drei Balken/)
    expect(texts.monthly).toContain('zwei Summen')
    /* Zwölf Monate gemessen: es fehlt keiner, also kein Satz über fehlende Monate. */
    expect(texts.monthly).not.toMatch(/fehlenden Monate|ohne Messwert/)
    expect(texts.proposal).toContain('Speicher: Prüfspeicher 30 spart voraussichtlich')
    expect(texts.proposal).toContain('Reichen Sie uns Ihre Stromrechnung nach')
  })

  it('Voraussetzungen: Netzebene aus der Angabe, nicht „nicht erfasst"', () => {
    const rows = buildOverviewStatement(input).rows.map((row) => row.value)
    expect(rows).toContain('Netzebene 7, ohne Leistungsmessung')
  })
})

describe('Liefertarif unbekannt, mit Vergleichstarif', () => {
  const texts = textsOf(
    inputOf(analysisOf(comparisonOf({ current: null, comparison: 9500, coveredMonths: 12 }), false)),
  )

  it('drei Wege, Ersparnis gegen den Vergleichstarif', () => {
    expect(texts.bars).toEqual(['comparison', 'uncontrolled', 'controlled'])
    expect(texts.ways).toContain('Gegenüber Ihrem Vergleichstarif sind das € 500 weniger.')
    expect(texts.ways).toContain('Gegenüber Ihrem Vergleichstarif sind das € 1.700 weniger.')
    expect(texts.overview).toContain('(ENSTROGA) hätte im selben Zeitraum € 9.500 gekostet')
  })
})

describe('Liefertarif bekannt (Urbanz-Zuschnitt)', () => {
  const texts = textsOf(
    inputOf(analysisOf(comparisonOf({ current: 10000, coveredMonths: 8 }), true)),
  )

  it('bleibt beim bisherigen Wortlaut, fehlende Monate werden benannt', () => {
    expect(texts.kpis).toContain('Ihre Stromkosten heute')
    expect(texts.wayTitles[0]).toBe('Ihr Tarif heute')
    expect(texts.monthly).toContain('grau Ihr heutiger Tarif, hell aWATTar ohne Steuerung')
    expect(texts.monthly).toContain('Hier stehen die drei Summen absolut.')
    expect(texts.monthly).toContain('ausdrücklich nicht auf ein Jahr hochgerechnet')
    expect(texts.monthly).toContain('Monate ohne Messwert bleiben leer.')
    expect(texts.proposal).not.toContain('Stromrechnung nach')
  })
})
