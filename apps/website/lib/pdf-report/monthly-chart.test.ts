import { describe, expect, it } from 'vitest'
import type { MonthlyTariffComparison } from 'shared'

import { monthlyChartData } from '@/components/report/monthly-tariff-chart'
import { formatEur } from '@/lib/format'
import { CONTROLLED_WAY_LABEL } from '@/lib/report-copy'
import { buildMonthly } from './detail'

/** Chart und Monatstabelle zeigen für „aWATTar mit Ladesteuerung" dieselbe Reihe. */

const months = (...values: number[]) => [...values, ...Array<null>(12 - values.length).fill(null)]

const SIMPLE: MonthlyTariffComparison = {
  currentTariffEur: months(120, 130),
  spotWithoutControlEur: months(110, 118),
  spotWithBatteryEur: months(95, 101),
  coveredMonths: 2,
  fixedCosts: {
    networkBaseFeeEur: 0,
    meteringFeeEur: 0,
    eagFlatFeeEur: 0,
    usageChargeOnFixedEur: 0,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 59,
  },
}
const PREDICTIVE: MonthlyTariffComparison = { ...SIMPLE, spotWithPredictiveControlEur: months(90, 97) }

const CURRENT = { annualPeakKw: 48, monthlyPeaksKw: Array<number>(12).fill(48), billedKw: 0, leistungspreisCostPerYear: 0 }

describe('monthlyChartData — dieselbe Auswahl wie die Monatstabelle', () => {
  it.each([
    ['ohne vorausschauende Reihe', SIMPLE, SIMPLE.spotWithBatteryEur!],
    ['mit vorausschauender Reihe', PREDICTIVE, PREDICTIVE.spotWithPredictiveControlEur!],
  ])('%s', (_, comparison, expectedSeries) => {
    const { rows, totals } = monthlyChartData(comparison)
    const tableRow = buildMonthly(comparison, CURRENT).statement.rows.find((r) => r.label === CONTROLLED_WAY_LABEL)

    expect(rows.map((r) => r.controlledEur)).toEqual(expectedSeries)
    expect(formatEur(totals.controlledEur)).toBe(tableRow?.value)
  })

  it('ohne Speicher entfällt die Reihe in Chart und Tabelle gemeinsam', () => {
    const none: MonthlyTariffComparison = { ...SIMPLE, spotWithBatteryEur: undefined }
    const { rows, hasControlled } = monthlyChartData(none)

    expect(hasControlled).toBe(false)
    expect(rows.every((r) => r.controlledEur === null)).toBe(true)
    expect(buildMonthly(none, CURRENT).statement.rows.some((r) => r.label === CONTROLLED_WAY_LABEL)).toBe(false)
  })
})
