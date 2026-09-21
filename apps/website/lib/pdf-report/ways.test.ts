import { describe, expect, it } from 'vitest'
import type { MonthlyTariffComparison } from 'shared'

import { summaryWaysOf } from './summary'
import type { PdfReportAnalysis } from './types'
import { buildWaysChapter, hasWaysChapter } from './ways'

/**
 * D7 — das Kapitel „Zwei Wege zu weniger Stromkosten": drei Balken, zwei Absätze.
 *
 * Geprüft wird vor allem die BINDUNG an `summaryWaysOf`/`sumCovered` — die drei Balken und die
 * beiden Ergebnis-Beträge müssen dieselben Zahlen tragen wie Kapitel 1 (D8-Spanne) und die
 * Tabellenzeilen in `detail.ts` (`buildMonthly`), nicht eine zweite, eigene Rechnung.
 */

function comparisonWith(
  currentTariffEur: number,
  spotWithoutControlEur: number,
  spotWithBatteryEur: number,
): MonthlyTariffComparison {
  return {
    currentTariffEur: [currentTariffEur, ...Array<null>(11).fill(null)],
    spotWithoutControlEur: [spotWithoutControlEur, ...Array<null>(11).fill(null)],
    spotWithBatteryEur: [spotWithBatteryEur, ...Array<null>(11).fill(null)],
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

function analysisWith(comparison: MonthlyTariffComparison | undefined): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 3980.16,
    },
    perBattery: [],
    recommendation: { batteryId: 'kat-1', rationale: '' },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      billingModel: 'monthly_max_sum',
    },
    dataQuality: {
      coveredDays: 31,
      coveredMonths: 1,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    tariffOptimization: comparison ? { computable: true, monthlyComparison: comparison } : undefined,
  }
}

describe('„Zwei Wege zu weniger Stromkosten" (D7)', () => {
  it('ohne berechenbaren Monatsvergleich gibt es das Kapitel nicht', () => {
    const analysis = analysisWith(undefined)
    expect(hasWaysChapter(analysis)).toBe(false)
    expect(buildWaysChapter(analysis)).toBeNull()
  })

  it('beide Wege positiv: Balken bit-identisch mit `sumCovered`, Ergebnis identisch mit Kapitel 1', () => {
    const comparison = comparisonWith(120, 110, 95)
    const analysis = analysisWith(comparison)
    const ways = summaryWaysOf(analysis)!

    expect(hasWaysChapter(analysis)).toBe(true)
    const chapter = buildWaysChapter(analysis)!

    // Die drei Balken — dieselben Summen wie in `detail.ts`s Tabellenzeilen.
    expect(chapter.totals).toEqual({
      currentTariffEur: 120,
      spotWithoutControlEur: 110,
      spotWithBatteryEur: 95,
    })

    // Die zwei Ergebnisbeträge sind dieselben Werte, aus denen Kapitel 1 seine Spanne bildet.
    expect(chapter.tariffSwitch.body).toContain('10')
    expect(String(chapter.tariffSwitch.body)).not.toContain('MEHR gekostet')
    expect(chapter.loadControl.body).toContain('25')
    expect(String(chapter.loadControl.body)).not.toContain('mehr gekostet')
    expect(ways.ways[0].eur).toBe(10)
    expect(ways.ways[1].eur).toBe(25)
  })

  it('Tarifwechsel allein negativ: Absatz sagt „mehr gekostet", nicht „gespart"', () => {
    // Ident zum realen Bestandsfall (§8, Korrektur 21.09.2026): der Wechsel allein ist teurer,
    // erst die Ladesteuerung dreht das Vorzeichen.
    const comparison = comparisonWith(90, 110, 70)
    const analysis = analysisWith(comparison)
    const chapter = buildWaysChapter(analysis)!

    expect(String(chapter.tariffSwitch.body)).toContain('MEHR gekostet')
    expect(String(chapter.loadControl.body)).toContain('gespart')
  })
})
