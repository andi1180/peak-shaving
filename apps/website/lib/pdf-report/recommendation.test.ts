import { describe, expect, it } from 'vitest'
import type { MonthlyTariffComparison } from 'shared'

import { SECTION_ID } from './content'
import { reportLayoutOf } from './layout'
import { buildRecommendationChapter } from './recommendation'
import { resolveReportText } from './report-text'
import { buildReportSummary } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * `load_control` verweist unbedingt auf „tarifbewusstes Laden" (Zeile der §3.7-Aufschlüsselung)
 * und auf „Eigenverbrauch" (dieselbe Fassung) — beide gibt es in der Kassen-Fassung (Monatsvergleich
 * mit Bestandsanlage) nicht; dort steht stattdessen „Wert der Ladesteuerung". Identisches Problem
 * wie bei `load_shift` in `summary.ts`, eine Ebene weiter.
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
  const summary = buildReportSummary(analysis, { source: 'net_signed' })
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

function loadControlBody(withExisting: boolean): string {
  const analysis = analysisFor(withExisting)
  return resolveReportText(
    buildRecommendationChapter(analysis).loadControl?.body ?? '',
    resultsLayout(analysis),
    'load_control',
  )
}

describe('load_control — Verweis auf „tarifbewusstes Laden" und „Eigenverbrauch"', () => {
  it('verweist in der Kassen-Fassung auf die Zeile „Wert der Ladesteuerung" statt auf beide Zeilen der §3.7-Aufschlüsselung', () => {
    const body = loadControlBody(true)

    expect(body).not.toContain('tarifbewusstes Laden')
    expect(body).not.toContain('eigener Anteil („Eigenverbrauch")')
    expect(body).toContain('Wert der Ladesteuerung" in der Aufschlüsselung')
  })

  it('bleibt in der §3.7-Fassung unverändert bei „tarifbewusstes Laden" und „Eigenverbrauch"', () => {
    const body = loadControlBody(false)

    expect(body).toContain('tarifbewusstes Laden')
    expect(body).toContain('eigener Anteil („Eigenverbrauch")')
  })
})
