import { describe, expect, it } from 'vitest'
import type { BatteryRoiEntry, LoadProfile, MonthlyTariffComparison } from 'shared'

import { formatEur } from '@/lib/format'
import { buildAdviceChapter } from './advice'
import { buildDataSources } from './basis'
import { buildComparisonChapter, comparisonChartPlan } from './comparison'
import { buildReportContext } from './context'
import { buildReportLayout } from './layout'
import { buildRecommendationChapter } from './recommendation'
import { buildReportRegistry } from './registry'
import { resolveReportText } from './report-text'
import { statementPoints } from './statement'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * Gerätekapitel nach dem STCE-Report vom 25.09.2026: 34 Katalog-Geräte, keines wirtschaftlich —
 * die volle Liste überlagerte Kurve und Text, und die Überschriften klangen nach Kaufempfehlung.
 */

const MONTHS = (first: number): (number | null)[] => [first, ...Array<null>(11).fill(null)]

const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: MONTHS(1000),
  spotWithoutControlEur: MONTHS(900),
  spotWithBatteryEur: MONTHS(800),
  coveredMonths: 1,
  fixedCosts: {
    networkBaseFeeEur: 0,
    meteringFeeEur: 0,
    eagFlatFeeEur: 0,
    usageChargeOnFixedEur: 0,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 365,
  },
}

function entry(i: number, netSavingOverHorizon: number): BatteryRoiEntry {
  return {
    battery: {
      id: `kat-${i}`,
      name: i === 0 ? 'Dyness Stack 100' : `Gerät ${i}`,
      manufacturer: 'Dyness',
      class: 'commercial',
      usableCapacityKwh: 30 + i,
      maxPowerKw: 15,
      roundTripEfficiency: 0.9,
      pricePerKwh: 350,
      inverterIncluded: true,
      requiresFoundation: false,
      controlType: 'dynamic',
    },
    newBilledKw: 40,
    leistungspreisSavingPerYear: 0,
    energySavingPerYear: 419,
    energySavingOverCoveredPeriod: 419,
    energySavingBasis: 'full_price',
    annualizationFactor: 1,
    coveredDays: 365,
    totalSavingPerYear: 419,
    warnings: [],
    notices: [],
    totalInvestment: 5790,
    subsidyAmount: 0,
    taxBenefit: 0,
    taxEffectsIncluded: false,
    netInvestment: 5790,
    amortizationYears: 13.8,
    netSavingOverHorizon,
    dispatchTrace: undefined as unknown as BatteryRoiEntry['dispatchTrace'],
  }
}

const LOAD_PROFILE: LoadProfile = {
  readings: [{ ts: '2025-02-03T07:15:00.000Z', gridPowerKw: 48 }],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'import_only',
}

/** 34 Geräte, absteigend nach Netto gereiht; die ersten `economical` davon rechnen sich. */
function inputWith(economical: number): PdfReportInput {
  const perBattery = Array.from({ length: 34 }, (_, i) =>
    entry(i, i < economical ? 3000 - i * 500 : -1600 - i * 100),
  )
  const analysis: PdfReportAnalysis = {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 0,
    },
    perBattery,
    recommendation: {
      batteryId: 'kat-0',
      rationale: {
        code: 'best_net_saving',
        totalSavingPerYear: 419,
        amortizationYears: 13.8,
        netSavingOverHorizon: perBattery[0]!.netSavingOverHorizon,
        horizonYears: 10,
      },
    },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 0,
      billingModel: 'monthly_max_sum',
    },
    tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
    dataQuality: { coveredDays: 365, coveredMonths: 12, gapsInterpolated: 0, largestGapSlots: 0, warnings: [] },
  }
  return {
    title: 'Prüffall',
    subtitle: 'Gerätekapitel',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '26.09.2026',
    analysis,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
  }
}

function proposalTitles(input: PdfReportInput): string[] {
  return (buildAdviceChapter(input).proposal?.points ?? []).map((point) => point.title)
}

describe('Gerätekapitel — Top-Alternativen, Urteil, Datenquellen', () => {
  it('zeigt höchstens drei Alternativen mit Abstand zur Empfehlung, darüber die Zählzeile', () => {
    const chapter = buildComparisonChapter(inputWith(5).analysis)

    expect(chapter.countLine).toBe('34 Geräte geprüft, davon 5 im Betrachtungszeitraum wirtschaftlich.')
    expect(chapter.table!.rows.map((row) => row.key)).toEqual(['kat-1', 'kat-2', 'kat-3'])
    expect(chapter.table!.columns.at(-1)!.label).toBe('Abstand zur Empfehlung')
    expect(chapter.table!.rows[0]!.cells.at(-1)).toBe(`${formatEur(500)} weniger über 10 Jahre`)
  })

  it('kein Gerät wirtschaftlich: „Derzeit nicht", „Bestes Gerät im Katalog", Vorschlag neutral', () => {
    const input = inputWith(0)
    const comparison = buildComparisonChapter(input.analysis)
    const proposal = buildAdviceChapter(input).proposal!.points!

    expect(comparison.statement.title).toBe('Lohnt sich ein Speicher?')
    expect(comparison.statement.amount).toEqual({ value: 'Derzeit nicht', caption: '', tone: 'negative' })
    expect(comparison.table!.columns.at(-1)!.label).toBe('Abstand zum besten Gerät')
    expect(buildRecommendationChapter(input.analysis).recommendation!.title).toBe(
      'Bestes Gerät im Katalog: Dyness Stack 100',
    )
    expect(proposalTitles(input)).not.toContain('Wollen Sie das Maximum')
    expect(proposalTitles(input)).not.toContain('Mit Speicher und Ladesteuerung')
    expect(proposal.map((p) => p.title)).toContain('Speicher')
  })

  it('kein Gerät wirtschaftlich: Vorschlag verweist aufs Gerätekapitel, ohne Beträge', () => {
    const input = inputWith(0)
    const context = buildReportContext(input)
    const layout = buildReportLayout(input, context, buildReportRegistry(input, context))
    const points = statementPoints(buildAdviceChapter(input).proposal!, layout)
    const texts = points.map((p) => `${p.title}: ${p.segments.map((s) => s.text).join('')}`)

    expect(texts).toContain(
      'Speicher: Derzeit nicht wirtschaftlich — die Antwort samt Begründung steht im Kapitel ' +
        '„Speichergrösse und Gerätewahl".',
    )
    expect(texts.join(' ')).not.toContain(formatEur(5790))
  })

  it('kein Gerät wirtschaftlich, Liefertarif unbekannt: Punkt 1 ist der Verweis, keine Kaufaussage', () => {
    const input = inputWith(0)
    input.analysis.assumptions.energyPriceCtPerKwh = null
    input.analysis.tariffOptimization = {
      computable: true,
      monthlyComparison: { ...COMPARISON, currentTariffEur: null },
    }
    const context = buildReportContext(input)
    const layout = buildReportLayout(input, context, buildReportRegistry(input, context))
    const points = statementPoints(buildAdviceChapter(input).proposal!, layout)
    const texts = points.map((p) => `${p.title}: ${p.segments.map((s) => s.text).join('')}`)

    expect(buildComparisonChapter(input.analysis).statement.amount?.value).toBe('Derzeit nicht')
    expect(texts[0]).toBe(
      'Speicher: Derzeit nicht wirtschaftlich — die Antwort samt Begründung steht im Kapitel ' +
        '„Speichergrösse und Gerätewahl".',
    )
    expect(texts.join(' ')).not.toContain('spart voraussichtlich')
  })

  it('Gerät wirtschaftlich, Liefertarif unbekannt: Punkt 1 bleibt die Kaufaussage', () => {
    const input = inputWith(5)
    input.analysis.assumptions.energyPriceCtPerKwh = null
    input.analysis.tariffOptimization = {
      computable: true,
      monthlyComparison: { ...COMPARISON, currentTariffEur: null },
    }
    const points = buildAdviceChapter(input).proposal!.points!

    expect(points[0]!.title).toBe('Speicher')
    expect(String(points[0]!.text)).not.toContain('Derzeit nicht')
  })

  it('Gerätehinweise stehen im Hinweiskasten, nicht als lose Zeile', () => {
    const input = inputWith(0)
    input.analysis.perBattery[0]!.warnings = ['Tarif ohne Leistungspreis: nichts zu kappen.']
    const statement = buildRecommendationChapter(input.analysis).recommendation!

    expect(statement.notice).toMatchObject({
      tone: 'warning',
      title: 'Hinweis zu diesem Gerät',
      body: 'Tarif ohne Leistungspreis: nichts zu kappen.',
    })
  })

  it('Streudiagramm hebt das beste Gerät hervor und nennt es in der Bildunterschrift', () => {
    const input = inputWith(0)
    const plan = comparisonChartPlan(input.analysis)!
    const figure = buildComparisonChapter(input.analysis).figure!

    expect(plan.highlight.battery.id).toBe('kat-0')
    expect(figure.caption).toContain('„Bestes Gerät" ist Dyness Stack 100')
  })

  it('struktureller Grund nur bei keinem Leistungspreis UND ausdrücklich keiner PV', () => {
    const reason = 'Ohne Leistungspreis und ohne PV-Anlage'
    const bodyOf = (input: PdfReportInput, hasPv: boolean | undefined) => {
      const context = buildReportContext(input)
      const layout = buildReportLayout(input, context, buildReportRegistry(input, context))
      const statement = buildComparisonChapter(input.analysis, undefined, hasPv).statement
      return resolveReportText(statement.body, layout, statement.id)
    }

    expect(bodyOf(inputWith(0), false)).toContain(reason)
    expect(bodyOf(inputWith(0), true)).not.toContain(reason)
    expect(bodyOf(inputWith(0), undefined)).not.toContain(reason)
    expect(bodyOf(inputWith(5), false)).not.toContain(reason)

    const withDemandCharge = inputWith(0)
    withDemandCharge.analysis.current.leistungspreisCostPerYear = 1200
    expect(bodyOf(withDemandCharge, false)).not.toContain(reason)
  })

  it('Gerät wirtschaftlich: Überschriften wie bisher', () => {
    const input = inputWith(5)

    expect(buildComparisonChapter(input.analysis).statement.title).toBe(
      'Die übrigen Geräte des Katalogs — im Vergleich',
    )
    expect(buildRecommendationChapter(input.analysis).recommendation!.title).toBe(
      'Unsere Empfehlung: Dyness Stack 100',
    )
    expect(proposalTitles(input)).toContain('Wollen Sie das Maximum')
  })

  it('nennt den Hersteller in den Datenquellen nur einmal', () => {
    const cells = buildDataSources(inputWith(0)).rows.flatMap((row) => row.cells)

    expect(cells).toContain('Dyness Stack 100')
    expect(cells.join(' ')).not.toContain('Dyness Dyness')
  })
})
