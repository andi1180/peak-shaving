import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BatteryResultEntry, MonthlyTariffComparison } from 'shared'

import { TariffOptimizationCard } from '@/components/report/tariff-optimization-card'
import { formatEur } from '@/lib/format'

/** Die Bildschirmkarte „Wert der Ladesteuerung" zeigt dieselbe Zahl wie die Differenz der Wege. */

const months = (...values: number[]) => [...values, ...Array<null>(12 - values.length).fill(null)]

const COMPARISON: MonthlyTariffComparison = {
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

const entry = (over: Partial<BatteryResultEntry>) =>
  ({
    energySavingPerYear: 400,
    energySavingOverCoveredPeriod: 32,
    annualizationFactor: 1,
    coveredDays: 365,
    ...over,
  }) as BatteryResultEntry

const text = (recommended: BatteryResultEntry) =>
  renderToStaticMarkup(
    createElement(TariffOptimizationCard, {
      status: { computable: true, monthlyComparison: COMPARISON },
      recommended,
      timeZone: 'Europe/Vienna',
      isExisting: false,
    }),
  ).replace(/<[^>]+>/g, '')

describe('TariffOptimizationCard — ein Wert der Ladesteuerung', () => {
  /* Wege-Differenz: (110 + 118) − (95 + 101) = 32. */
  it('ohne Hochrechnung: die Wege-Differenz über die gemessenen Tage', () => {
    const t = text(entry({}))

    expect(t).toContain(formatEur(32))
    expect(t).not.toContain(formatEur(400))
    expect(t).toContain('über die 365 gemessenen Tage')
  })

  it('bei kürzerem Lastgang: Jahreswert als hochgerechnet gekennzeichnet, Wege-Differenz daneben', () => {
    const t = text(entry({ annualizationFactor: 365 / 59, coveredDays: 59, energySavingPerYear: 197.97 }))

    expect(t).toContain(formatEur(197.97))
    expect(t).toContain('auf ein Jahr hochgerechnet')
    expect(t).toContain(`Über die 59 gemessenen Tage: ${formatEur(32)}`)
  })
})
