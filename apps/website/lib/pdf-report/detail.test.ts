import { describe, expect, it } from 'vitest'
import type { MonthlyTariffComparison } from 'shared'

import { SECTION_ID } from './content'
import {
  buildDetailChapter,
  buildMonthlyChapter,
  detailChartPlan,
  hasMonthlyChapter,
} from './detail'
import { reportLayoutOf } from './layout'
import { resolveReportText } from './report-text'
import { buildReportSummary } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * D7 — der Monatsvergleich als eigenes Kapitel.
 *
 * Geprüft wird die ABGRENZUNG zum Detail-Kapitel: mit Bestandsanlage steht der Vergleich dort (an
 * der Stelle des Kostenverlaufs), ohne sie hier — und dann muss der Kostenverlauf stehen bleiben,
 * weil er für diesen Leser das Bild zur offenen Kauffrage ist.
 */

const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: [120, ...Array<null>(11).fill(null)],
  spotWithoutControlEur: [110, ...Array<null>(11).fill(null)],
  spotWithBatteryEur: [95, ...Array<null>(11).fill(null)],
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

const ENTRY = {
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
  netSavingOverHorizon: -9000,
}

function analysisFor(withExisting: boolean): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 3980.16,
    },
    perBattery: [ENTRY],
    recommendation: { batteryId: BATTERY.id, rationale: '' },
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
    tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
    ...(withExisting ? { existingBatteryAnalysis: { entry: ENTRY, addonScenarios: [] } } : {}),
  }
}

/**
 * Stufe D — die Beschreibung von Kapitel 1, aus der gebauten Zusammenfassung selbst gebildet.
 * Gegen sie lösen sich die Verweise auf, die dieser Baustein trägt.
 */
function resultsLayout(analysis: PdfReportAnalysis) {
  const summary = buildReportSummary({ analysis, loadProfile: { source: 'net_signed' } })
  return reportLayoutOf(
    summary.statements.map((statement) => ({
      id: statement.id,
      section: SECTION_ID.results,
      title: statement.title,
      amount: statement.amount ? statement.amount.caption : null,
      rows: Object.fromEntries(
        statement.rows.flatMap((r) => (r.key ? [[r.key, r.label] as const] : [])),
      ),
    })),
  )
}

describe('Monatsvergleich als eigenes Kapitel (D7)', () => {
  it('ohne Bestandsanlage: eigenes Kapitel NEBEN dem Kostenverlauf, Wortlaut ohne „Ihrem Speicher"', () => {
    const analysis = analysisFor(false)

    expect(hasMonthlyChapter(analysis)).toBe(true)
    // Der Kostenverlauf bleibt — er ist das Bild zur Kaufaussage, die hier offen ist.
    expect(detailChartPlan(analysis).cost?.kind).toBe('cumulative')

    const chapter = buildMonthlyChapter(analysis)!
    const text = [chapter.figure.caption, ...chapter.statement.rows.map((r) => r.label)].join(' | ')
    expect(text).toContain('der empfohlenen Batterie')
    expect(text).not.toContain('Ihrem Speicher')

    /*
     * Seit dem Zusammenfassungs-Umbau nennt der Satz weder die Kernergebnis-Seite noch einen ihrer
     * Bausteine — die gibt es nicht mehr (Ein-Spanne-Regel D8). Was bleibt, ist die Feststellung,
     * dass die drei Summen hier absolut stehen.
     */
    const body = resolveReportText(
      chapter.statement.body,
      resultsLayout(analysis),
      'monthly_comparison',
    )
    expect(body).toContain('Hier stehen die drei Summen absolut.')
    expect(body).not.toContain('Kernergebnis')
  })

  it('mit Bestandsanlage: KEIN eigenes Kapitel — der Vergleich steht im Detail-Kapitel', () => {
    const analysis = analysisFor(true)

    expect(hasMonthlyChapter(analysis)).toBe(false)
    expect(buildMonthlyChapter(analysis)).toBeNull()
    expect(detailChartPlan(analysis).cost?.kind).toBe('monthly')

    // Regression: derselbe Schlusssatz wie im Katalog-Fall — er verzweigt nicht mehr.
    expect(
      resolveReportText(
        buildDetailChapter(analysis).cost?.statement?.body ?? '',
        resultsLayout(analysis),
        'monthly_comparison',
      ),
    ).toContain('Hier stehen die drei Summen absolut.')
  })

  it('ohne berechenbaren Hebel gibt es das Kapitel nicht', () => {
    const analysis = analysisFor(false)
    expect(hasMonthlyChapter({ ...analysis, tariffOptimization: undefined })).toBe(false)
  })
})
