import { describe, expect, it } from 'vitest'
import type { MonthlyTariffComparison } from 'shared'

import { SECTION_ID } from './content'
import { reportLayoutOf } from './layout'
import { resolveReportText } from './report-text'
import { buildReportSummary, type ReportSummary } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * `load_shift` verweist unbedingt auf die Zeile „Eigenverbrauch" — die gibt es nur in der
 * §3.7-Aufschlüsselung. Steht oben die Kassen-Fassung (Monatsvergleich, s. `buildSavings`), trägt
 * sie keine eigene Eigenverbrauchs-Zeile; der Effekt steckt dort in „Wert der Ladesteuerung" mit
 * drin. Geprüft wird über `buildReportSummary`, nicht über einen internen Helfer — der Fehler
 * betrifft den zusammengesetzten Text.
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
 * Stufe D — die Beschreibung von Kapitel 1, aus dem gebauten Kapitel selbst gebildet: dieselbe
 * Reihenfolge, dieselben Zeilen. Von Hand hingeschrieben wäre sie eine zweite Behauptung darüber,
 * was auf der Seite steht.
 */
function layoutFor(summary: ReportSummary) {
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

function loadShiftBody(withExisting: boolean): string {
  const summary = buildReportSummary(analysisFor(withExisting), { source: 'net_signed' })
  const loadShift = summary.statements.find((s) => s.id === 'load_shift')
  return resolveReportText(loadShift?.body ?? '', layoutFor(summary), 'load_shift')
}

describe('load_shift — Verweis auf die Eigenverbrauchs-Zeile', () => {
  it('verweist in der Kassen-Fassung auf „Wert der Ladesteuerung" statt auf „Eigenverbrauch"', () => {
    const body = loadShiftBody(true)

    expect(body).not.toContain('eigener Anteil („Eigenverbrauch")')
    expect(body).toContain('Wert der Ladesteuerung" in der Aufschlüsselung oben')
  })

  it('bleibt in der §3.7-Fassung unverändert bei „Eigenverbrauch"', () => {
    expect(loadShiftBody(false)).toContain('eigener Anteil („Eigenverbrauch")')
  })
})

/**
 * Delta 3 / NE7 — ein Anschluss ohne Leistungsmessung hat den Posten „Leistungspreis" überhaupt
 * nicht (`leistungspreisEurPerKwYear: 0` → `leistungspreisCostPerYear: 0`). Geprüft wird über
 * `buildReportSummary`, weil der Kasten UND der Teiljahres-Hinweis gemeinsam daran hängen.
 */
function analysisWithoutLeistungspreis(): PdfReportAnalysis {
  const base = analysisFor(false)
  return {
    ...base,
    current: { ...base.current, leistungspreisCostPerYear: 0 },
    /* Teiljahr unter einem monatsbasierten Modell — sonst entfiele der Hinweis schon deshalb. */
    dataQuality: { ...base.dataQuality, coveredMonths: 7 },
  }
}

describe('Leistungspreis-Block', () => {
  it('steht mit Leistungspreis im Tarif — Kasten samt Teiljahres-Hinweis', () => {
    const base = analysisFor(false)
    const summary = buildReportSummary(
      { ...base, dataQuality: { ...base.dataQuality, coveredMonths: 7 } },
      { source: 'net_signed' },
    )

    expect(summary.headline).not.toBeNull()
    expect(summary.headline?.costCaption).toContain('Leistungspreis-Kosten pro Jahr')
    expect(summary.notices.map((n) => n.id)).toContain('partial_year')
  })

  it('entfällt ohne Leistungspreis — beide Kacheln und der Teiljahres-Hinweis', () => {
    const summary = buildReportSummary(analysisWithoutLeistungspreis(), { source: 'net_signed' })

    expect(summary.headline).toBeNull()
    expect(summary.notices.map((n) => n.id)).not.toContain('partial_year')
  })
})

/**
 * Beide Hinweise hängen strukturell NUR an der Datenqualität (Lückenlänge bzw. Herkunft des
 * Lastgangs) und nicht am Tarif — ohne Leistungspreis feuern sie also weiterhin, und ihr Verweis
 * auf „oben" zeigte bis hierher auf einen Kasten, den `buildHeadline` gar nicht mehr liefert.
 */
function analysisWithGap(withLeistungspreis: boolean): PdfReportAnalysis {
  const base = analysisFor(false)
  return {
    ...base,
    current: {
      ...base.current,
      leistungspreisCostPerYear: withLeistungspreis ? base.current.leistungspreisCostPerYear : 0,
    },
    /* Über `LARGE_GAP_SLOTS_THRESHOLD` (4 Wochen à 96 Slots) — 30 Tage am Stück. */
    dataQuality: { ...base.dataQuality, largestGapSlots: 2880 },
  }
}

describe('Datenqualitäts-Hinweise ohne Leistungspreis', () => {
  const bodiesFor = (withLeistungspreis: boolean) =>
    buildReportSummary(analysisWithGap(withLeistungspreis), { source: 'standard_profile' }).notices

  it('feuern beide auch ohne Leistungspreis — aber ohne Verweis auf den Kasten', () => {
    const notices = bodiesFor(false)

    expect(notices.map((n) => n.id)).toEqual(['standard_profile', 'large_gap'])
    for (const notice of notices) {
      expect(`${notice.body} ${notice.hints.join(' ')}`).not.toContain('oben')
    }
  })

  it('behalten den Verweis, wo es den Kasten gibt', () => {
    const notices = bodiesFor(true)

    expect(notices.find((n) => n.id === 'large_gap')?.body).toContain(
      'der abgerechnete Leistungswert oben',
    )
    expect(notices.find((n) => n.id === 'standard_profile')?.body).toContain(
      'Die oben gezeigten Leistungswerte',
    )
  })
})
