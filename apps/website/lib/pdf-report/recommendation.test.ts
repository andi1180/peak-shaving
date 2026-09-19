import { describe, expect, it } from 'vitest'
import type { MonthlyTariffComparison } from 'shared'

import { SECTION_ID } from './content'
import { reportLayoutOf, type ReportPlacement } from './layout'
import { buildRecommendationChapter } from './recommendation'
import { resolveReportText } from './report-text'
import { statementPoints } from './statement'
import type { PdfReportAnalysis } from './types'

/**
 * `load_control` zeigte bis zum Zusammenfassungs-Umbau auf zwei Zeilen der Ersparnis-
 * Aufschlüsselung von Kapitel 1. Die gibt es nicht mehr (Ein-Spanne-Regel D8) — und mit ihnen ist
 * der Betrag der Ladesteuerung aus dem Dokument verschwunden. Er steht seither als KOPFZAHL an
 * dieser Aussage, weil sie sonst die Herkunft einer Zahl erklärte, die nirgends vorkommt.
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

describe('load_control — der Betrag steht hier, und der Satz zeigt nirgendwohin', () => {
  it.each([true, false])('trägt die Kopfzahl (Bestandsanlage: %s)', (withExisting) => {
    const statement = buildRecommendationChapter(analysisFor(withExisting)).loadControl!

    /* `loadShiftSavingPerYear` der primären Anlage — 100 € in beiden Fixtures. */
    expect(statement.amount?.value).toBe('€\u00a0100')
    expect(statement.amount?.tone).toBe('positive')
  })

  it('nennt keine Zeile einer Aufschlüsselung mehr, die es nicht gibt', () => {
    const analysis = analysisFor(true)
    const body = resolveReportText(
      buildRecommendationChapter(analysis).loadControl?.body ?? '',
      reportLayoutOf([]),
      'load_control',
    )

    expect(body).not.toContain('tarifbewusstes Laden')
    expect(body).not.toContain('Eigenverbrauch')
    expect(body).not.toContain('Kernergebnis')
    expect(body).toContain('steckt in der Gesamtersparnis dieses Speichers bereits mit drin')
  })
})

/**
 * B3-3 (20a) — die Empfehlung steht als NUMMERIERTE LISTE statt als Absatz. Gemessen wurde die
 * Umstellung gegen den Stand davor (`4fd2426`): in allen acht Kombinationen aus Bestands-/
 * Katalog-Fall, Steuerangabe und vorhandenem `addon` ergeben die verbundenen Punkte zeichengleich
 * den früheren Absatz. Was hier steht, ist derselbe Wortlaut je Punkt.
 */
const RECOMMENDATION_PLACEMENT: ReportPlacement = {
  id: 'recommendation',
  section: SECTION_ID.recommendation,
  title: 'Falls Sie stattdessen neu kaufen würden: Katalog 1',
  amount: null,
  rows: {},
}
const ADDON_PLACEMENT: ReportPlacement = {
  id: 'addon',
  section: SECTION_ID.results,
  title: 'Ausserdem schon geklärt',
  amount: null,
  rows: {},
}

function recommendationPoints(placements: ReportPlacement[]): string[] {
  return resolvedPoints(placements).map((point) =>
    point.segments.map((segment) => segment.text).join(''),
  )
}

function resolvedPoints(placements: ReportPlacement[]) {
  const statement = buildRecommendationChapter(analysisFor(true)).recommendation!
  return statementPoints(statement, reportLayoutOf(placements))
}

describe('recommendation — Listenform', () => {
  it('setzt den Bestandsfall als drei Punkte, im Wortlaut des früheren Absatzes', () => {
    expect(recommendationPoints([ADDON_PLACEMENT, RECOMMENDATION_PLACEMENT])).toEqual([
      'Sie haben bereits einen Speicher — diese Aussage beantwortet deshalb nicht „soll ich ' +
        'überhaupt?", sondern „was bekäme ich, wenn ich Ihre Anlage durch ein neues Gerät ersetzte?".',
      'Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht auf der Zusammenfassung; ' +
        'die dortigen Beträge sind Differenzen und nicht mit den Zahlen hier vergleichbar.',
      'Förderung und Steuervorteil sind nicht angegeben und deshalb in keiner dieser Zahlen ' +
        'enthalten — mit ihnen fiele die Investition niedriger aus.',
    ])
  })

  /* Kante E: ohne `addon` entfällt der Punkt GANZ — der Steuersatz rückt auf Nummer 2 nach. */
  it('`addon` abgewählt: der zweite Punkt fällt weg, die Zählung schliesst sich', () => {
    const ohne = recommendationPoints([RECOMMENDATION_PLACEMENT])

    expect(ohne).toHaveLength(2)
    expect(ohne[0]).toContain('ersetzte?".')
    expect(ohne[1]).toContain('Förderung und Steuervorteil')
  })

  /* B3-4: der Titel gehört zum Punkt — mit `addon` fällt er ganz weg, nicht als Leadzeile übrig. */
  it('jeder Punkt trägt seinen festen Titel, und der Zusatzspeicher-Titel fällt mit ihm', () => {
    expect(resolvedPoints([ADDON_PLACEMENT, RECOMMENDATION_PLACEMENT]).map((p) => p.title)).toEqual([
      'Ersatz Ihrer bestehenden Anlage',
      'Zusätzlicher Speicher',
      'Ohne Steuervorteil gerechnet',
    ])
    expect(resolvedPoints([RECOMMENDATION_PLACEMENT]).map((p) => p.title)).toEqual([
      'Ersatz Ihrer bestehenden Anlage',
      'Ohne Steuervorteil gerechnet',
    ])
  })
})
