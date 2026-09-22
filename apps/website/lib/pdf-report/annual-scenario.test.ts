import { describe, expect, it } from 'vitest'
import type { AnnualScenario, BatteryResultEntry, MonthlyTariffComparison } from 'shared'

import { buildAnnualScenarioChapter, hasAnnualScenarioChapter } from './annual-scenario'
import { buildSummaryKpis, summaryWaysOf } from './summary'
import type { PdfReportAnalysis } from './types'
import { buildWaysChapter } from './ways'

/**
 * D6 Teil 3 — das Kapitel „Was wäre, wenn wir ein ganzes Jahr hätten?".
 *
 * Geprüft wird das, was am ehesten still auseinanderlaufen kann: dass die Tabelle GENAU die Wege
 * führt, die das Kapitel davor führt (nicht vier fest verdrahtete), dass das Kapitel bei einem
 * vollen Jahr entfällt, und dass keine seiner Zahlen in die Ersparnis-Spanne der Zusammenfassung
 * gerät (D8 Ein-Spanne-Regel).
 */

const MONTHS = <T,>(first: T): (T | null)[] => [first, ...Array<null>(11).fill(null)]

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
    selfConsumptionSavingPerYear: 100,
    loadShiftSavingPerYear: 50,
    selfConsumptionSavingOverCoveredPeriod: 100,
    loadShiftSavingOverCoveredPeriod: 50,
    annualizationFactor: 1,
    coveredDays: 209,
    totalSavingPerYear: leistungspreisSavingPerYear + 150,
    warnings: [],
    dispatchTrace: undefined as unknown as BatteryResultEntry['dispatchTrace'],
  }
}

/** Die Jahreszahlen des ZWEITEN Laufs — bewusst andere Grössenordnung als der gemessene Zeitraum. */
function scenarioWith(args: {
  comparisonTariffEur?: number | null
  peakShavingSavingEur?: number
  projectedDays?: number
}): AnnualScenario {
  return {
    windowFromDate: '2024-11-04',
    windowToDate: '2025-11-03',
    measuredDays: 209,
    projectedDays: args.projectedDays ?? 156,
    reference: {
      fromDate: '2025-01-13',
      toDate: '2025-01-19',
      consumptionKwh: 364,
      rateKwhPerDay: 52,
    },
    ways: {
      currentTariffEur: 2000,
      comparisonTariffEur: args.comparisonTariffEur ?? null,
      comparisonSupplier: args.comparisonTariffEur == null ? null : 'ENSTROGA',
      spotWithoutControlEur: 1900,
      controlledEur: 1500,
      controlVariant: 'simple',
      peakShavingSavingEur: args.peakShavingSavingEur ?? 0,
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
    recommendation: { batteryId: 'kat-1', rationale: '' },
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
const MEASURED_WITH_COMPARISON = comparisonWith({
  current: 120,
  spot: 110,
  battery: 95,
  comparison: 112,
})

describe('Jahres-Kapitel (D6 Teil 3)', () => {
  it('führt genau die Wege, die das Kapitel davor führt — auch den Vergleichstarif', () => {
    const analysis = analysisWith({
      comparison: MEASURED_WITH_COMPARISON,
      peakSaving: 1200,
      annualScenario: scenarioWith({ comparisonTariffEur: 1960, peakShavingSavingEur: 1450 }),
    })

    expect(hasAnnualScenarioChapter(analysis)).toBe(true)
    const chapter = buildAnnualScenarioChapter(analysis)
    const table = chapter?.statements.find((s) => s.id === 'annual_scenario_ways')

    /* Eine Zeile je BALKEN des Wege-Kapitels — nicht vier fest verdrahtete. */
    const bars = buildWaysChapter(analysis)?.bars ?? []
    expect(table?.rows.map((r) => r.label)).toEqual(bars.map((b) => b.label))
    expect(table?.rows.map((r) => plain(r.value))).toEqual([
      '€ 2.000',
      '€ 1.960',
      '€ 1.900',
      '€ 1.500',
    ])

    /*
     * Der Kasten: bester Tarifweg (2.000 − 1.500) PLUS Spitzenkappung. Addiert werden darf hier,
     * weil beide Zahlen dieselben 365 Tage meinen — im Kapitel davor gilt das ausdrücklich nicht.
     */
    expect(chapter?.totalSavingEur).toBe(500 + 1450)
    const box = chapter?.statements.find((s) => s.id === 'annual_scenario_total')
    expect(plain(box?.amount?.value ?? '')).toBe('€ 1.950')
    expect(box?.rows.map((r) => plain(r.value))).toEqual(['€ 500', '€ 1.450', '€ 1.950'])
  })

  it('ohne Vergleichstarif und ohne Leistungspreis bleiben drei Zeilen und ein Tarifweg im Kasten', () => {
    const analysis = analysisWith({
      comparison: MEASURED,
      annualScenario: scenarioWith({}),
    })

    const chapter = buildAnnualScenarioChapter(analysis)
    expect(chapter?.statements.find((s) => s.id === 'annual_scenario_ways')?.rows).toHaveLength(3)
    expect(chapter?.totalSavingEur).toBe(500)
    expect(
      chapter?.statements.find((s) => s.id === 'annual_scenario_total')?.rows.map((r) => r.label),
    ).toEqual(['Bester Tarifweg: aWATTar mit Ladesteuerung'])
  })

  it('bei einem vollen Jahr gibt es das Kapitel nicht', () => {
    const analysis = analysisWith({
      comparison: MEASURED,
      coveredDays: 365,
      annualScenario: scenarioWith({ projectedDays: 0 }),
    })

    expect(hasAnnualScenarioChapter(analysis)).toBe(false)
    expect(buildAnnualScenarioChapter(analysis)).toBeNull()
  })

  it('keine seiner Zahlen erreicht die Ersparnis-Spanne der Zusammenfassung (D8)', () => {
    const withScenario = analysisWith({
      comparison: MEASURED,
      annualScenario: scenarioWith({ peakShavingSavingEur: 1450 }),
    })
    const withoutScenario = analysisWith({ comparison: MEASURED })

    const kpisOf = (a: PdfReportAnalysis) => buildSummaryKpis(a, summaryWaysOf(a)!)
    expect(kpisOf(withScenario)).toEqual(kpisOf(withoutScenario))
    /* Die Kopfzahlen sprechen vom MESSzeitraum; keine Jahreszahl taucht in ihnen auf. */
    expect(JSON.stringify(kpisOf(withScenario))).not.toContain('2.000')
  })
})
