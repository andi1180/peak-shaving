import { describe, expect, it } from 'vitest'
import type {
  AnnualScenario,
  BatteryResultEntry,
  LoadProfile,
  MonthlyTariffComparison,
} from 'shared'

import { buildAnnualScenarioChapter, hasAnnualScenarioChapter } from './annual-scenario'
import { buildSummaryKpis, summaryWaysOf } from './summary'
import { TARIFF_SOURCE_UNTRACKED, type PdfReportAnalysis, type PdfReportInput } from './types'

/**
 * D6 Teil 3 — das Kapitel „Hochrechnung auf ein ganzes Jahr".
 *
 * Geprüft wird: die Zahlen kommen aus dem Contract und addieren exakt, das Kapitel entfällt bei
 * PV, ohne Gerät und bei vollem Jahr, und keine Zahl gerät in die Ersparnis-Spanne (D8).
 */

const MONTHS = <T>(first: T): (T | null)[] => [first, ...Array<null>(11).fill(null)]

function comparisonWith(args: {
  current: number
  spot: number
  battery: number
  comparison?: number
  comparisonSupplier?: string
}): MonthlyTariffComparison {
  return {
    currentTariffEur: MONTHS(args.current),
    spotWithoutControlEur: MONTHS(args.spot),
    spotWithBatteryEur: MONTHS(args.battery),
    ...(args.comparison === undefined
      ? {}
      : {
          comparisonTariffEur: MONTHS(args.comparison),
          comparisonSupplier: args.comparisonSupplier ?? 'ENSTROGA',
        }),
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
      coveredDays: 31,
    },
  }
}

function entryWith(leistungspreisSavingPerYear: number): BatteryResultEntry {
  return {
    battery: {
      id: 'kat-1',
      name: 'Test',
      manufacturer: 'Test',
      class: 'commercial',
      usableCapacityKwh: 30,
      maxPowerKw: 10,
      roundTripEfficiency: 0.9,
      pricePerKwh: 500,
      inverterIncluded: true,
      requiresFoundation: false,
      controlType: 'dynamic',
    },
    newBilledKw: 40,
    leistungspreisSavingPerYear,
    energySavingPerYear: 150,
    energySavingOverCoveredPeriod: 150,
    energySavingBasis: 'full_price' as const,
    annualizationFactor: 1,
    coveredDays: 209,
    totalSavingPerYear: leistungspreisSavingPerYear + 150,
    warnings: [],
    dispatchTrace: undefined as unknown as BatteryResultEntry['dispatchTrace'],
  }
}

/** Die Jahreszahlen des ZWEITEN Laufs — bewusst andere Grössenordnung als der gemessene Zeitraum. */
/** Die Zahlen des eingefrorenen Referenzfalls `gewerbe-leistungspreis-teiljahr-jahr-wien`. */
function scenarioWith(args: { projectedDays?: number; withDevice?: boolean } = {}): AnnualScenario {
  return {
    windowFromDate: '2025-09-01',
    windowToDate: '2026-08-31',
    ratesAsOf: '2026-08-31',
    ...(args.withDevice === false
      ? {}
      : { device: { batteryId: 'kat-1', name: 'Test-Speicher 30' } }),
    measuredDays: 157,
    projectedDays: args.projectedDays ?? 208,
    fill: { blockFromDate: '2026-03-30', blockToDate: '2026-08-30', blockWeeks: 22 },
    ways: {
      currentTariffEur: 34793.76,
      comparisonTariffEur: null,
      comparisonSupplier: null,
      spotWithoutControlEur: 26768.61,
      controlledEur: 25804.09,
      controlVariant: 'predictive',
      peakShavingSavingEur: 1160.42,
      peakShavingEagEur: 69.11,
    },
  }
}

function analysisWith(args: {
  comparison?: MonthlyTariffComparison
  peakSaving?: number
  annualScenario?: AnnualScenario
  coveredDays?: number
}): PdfReportAnalysis {
  const entry = entryWith(args.peakSaving ?? 0)
  return {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 3980.16,
    },
    perBattery: [entry as never],
    recommendation: {
      batteryId: 'kat-1',
      rationale: {
        code: 'best_net_saving',
        totalSavingPerYear: 0,
        amortizationYears: 0,
        netSavingOverHorizon: 0,
        horizonYears: 10,
      },
    },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      billingModel: 'monthly_max_sum',
    },
    dataQuality: {
      coveredDays: args.coveredDays ?? 209,
      coveredMonths: 8,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    tariffOptimization: args.comparison
      ? { computable: true, monthlyComparison: args.comparison }
      : undefined,
    ...(args.annualScenario ? { annualScenario: args.annualScenario } : {}),
  }
}

/** `formatEur` setzt ein geschütztes Leerzeichen — hier für die Erwartungen normalisiert. */
const plain = (value: string): string => value.replace(/\u00a0/g, ' ')

const MEASURED = comparisonWith({ current: 120, spot: 110, battery: 95 })

const LOAD_PROFILE: LoadProfile = {
  readings: [],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'import_only',
}

function inputFor(
  analysis: PdfReportAnalysis,
  overrides?: Partial<PdfReportInput>,
): PdfReportInput {
  return {
    title: 'Prüffall',
    subtitle: 'Hochrechnung',
    period: '28.03.2026 – 31.08.2026',
    printedAt: '01.10.2026',
    analysis,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    ...overrides,
  }
}

const euroOf = (value: string): number => Number(plain(value).replace(/[^\d-]/g, ''))

describe('Kapitel „Hochrechnung auf ein ganzes Jahr"', () => {
  it('zeigt die Jahreszahlen des Contracts; die gerundeten Zeilen ergeben exakt die Summe', () => {
    const input = inputFor(analysisWith({ comparison: MEASURED, annualScenario: scenarioWith() }))
    expect(hasAnnualScenarioChapter(input)).toBe(true)
    const chapter = buildAnnualScenarioChapter(input)!
    const byId = (id: string) => chapter.statements.find((s) => s.id === id)!

    const rows = byId('annual_scenario_savings').rows
    expect(rows.map((r) => [r.label, euroOf(r.value)])).toEqual([
      ['Tarifwechsel zu aWATTar', 8025],
      ['Ladesteuerung des Speichers', 965],
      ['Spitzenkappung durch den Speicher (Obergrenze)', 1160],
      ['Summe', 10150],
    ])
    const parts = rows.filter((r) => !r.total).reduce((sum, r) => sum + euroOf(r.value), 0)
    expect(parts).toBe(euroOf(rows.find((r) => r.total)!.value))
    expect(chapter.totalSavingEur).toBe(10150)
    expect(chapter.assumption.title).toBe('Annahme')
    expect(chapter.donut?.segments.map((s) => [s.eur, s.percent])).toEqual([
      [8025, 79],
      [965, 10],
      [1160, 11],
    ])

    const basis = plain(String(byId('annual_scenario_basis').body))
    expect(basis).toContain('Für 157 von 365 Tagen (43 %) liegen Messdaten vor')
    expect(basis).toContain('01.09.2025 bis 31.08.2026')
    expect(basis).toContain('Stand vom 31.08.2026')
    expect(String(byId('annual_scenario_costs').body)).toContain('„Test-Speicher 30"')
  })

  it('keine seiner Zahlen erreicht die Ersparnis-Spanne der Zusammenfassung (D8)', () => {
    const withScenario = analysisWith({ comparison: MEASURED, annualScenario: scenarioWith() })
    const withoutScenario = analysisWith({ comparison: MEASURED })
    const kpisOf = (a: PdfReportAnalysis) => buildSummaryKpis(a, summaryWaysOf(a)!)
    expect(kpisOf(withScenario)).toEqual(kpisOf(withoutScenario))
    expect(JSON.stringify(kpisOf(withScenario))).not.toContain('10.150')
  })

  it('entfällt bei PV, ohne Gerät und ohne fehlende Tage', () => {
    const analysis = analysisWith({ comparison: MEASURED, annualScenario: scenarioWith() })
    expect(hasAnnualScenarioChapter(inputFor(analysis, { hasPv: true }))).toBe(false)
    expect(
      hasAnnualScenarioChapter(
        inputFor(analysis, { loadProfile: { ...LOAD_PROFILE, source: 'net_signed' } }),
      ),
    ).toBe(false)
    const noDevice = analysisWith({
      comparison: MEASURED,
      annualScenario: scenarioWith({ withDevice: false }),
    })
    expect(hasAnnualScenarioChapter(inputFor(noDevice))).toBe(false)
    const fullYear = analysisWith({
      comparison: MEASURED,
      annualScenario: scenarioWith({ projectedDays: 0 }),
    })
    expect(hasAnnualScenarioChapter(inputFor(fullYear))).toBe(false)
  })
})
