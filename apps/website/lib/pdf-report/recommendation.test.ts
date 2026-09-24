import { describe, expect, it } from 'vitest'
import type { BatteryNotice, DispatchTrace, MonthlyTariffComparison } from 'shared'

import { DYNAMIC_TARIFF_HINT_NOT_COMPUTABLE } from '@/lib/report-copy'

import { comparisonChartPlan, hasComparisonChapter } from './comparison'
import { SECTION_ID } from './content'
import { detailChartPlan } from './detail'
import { insightChartPlan } from './insight'
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
  notices: [] as BatteryNotice[],
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
    recommendation: { batteryId: BATTERY.id, rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: 0, netSavingOverHorizon: 0, horizonYears: 10 } },
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

describe('Hinweis „nur mit dynamischem Tarif" ersetzt die Speicher-Strecke', () => {
  it('Heimspeicher ohne Ersparnis, Vergleich nicht berechenbar: Hinweis statt Gerät, keine Gerätekapitel', () => {
    const home = { ...ENTRY, battery: { ...BATTERY, class: 'residential' as const }, totalSavingPerYear: 0, dispatchTrace: TRACE }
    const analysis: PdfReportAnalysis = {
      ...analysisFor(false),
      perBattery: [home, { ...home, battery: { ...home.battery, id: 'kat-2' } }],
      tariffOptimization: { computable: false, side: 'grid_tariff', kind: 'unavailable', ranges: [], message: '' } as never,
    }
    expect(buildRecommendationChapter(analysis).recommendation?.body).toBe(DYNAMIC_TARIFF_HINT_NOT_COMPUTABLE)
    expect(detailChartPlan(analysis)).toEqual({ cost: null, flow: null })
    expect(insightChartPlan(analysis)).toEqual({ hourFlow: null, chargePrice: null })
    expect(comparisonChartPlan(analysis)).toBeNull()
    expect(hasComparisonChapter(analysis)).toBe(false)
  })
})

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

const TRACE: DispatchTrace = {
  capKwByPeriod: [30, 35],
  caughtPeaks: [],
  representativeDays: [],
}

/**
 * a8f1934 hat die Kapp-Schwelle und den Leistungswert vorher/nachher aus dem Kapitel entfernt, weil
 * beide Sätze am Bildlegenden-Text hingen. Sie stehen jetzt als eigene Zeilen der Aufschlüsselung,
 * im Format des alten `peak_shaving`-Zeilenpaars aus `summary.ts` (vor #290).
 */
describe('recommendation — Kapp-Zeilen', () => {
  it('erscheinen bei leistungspreisSavingPerYear > 0 mit Schwelle und Leistungswert vorher/nachher', () => {
    const analysis = analysisFor(false)
    analysis.perBattery = [{ ...ENTRY, dispatchTrace: TRACE }]

    const rows = buildRecommendationChapter(analysis).recommendation!.rows

    expect(rows).toContainEqual({
      label: 'Kapp-Schwelle',
      value: 'zwischen 30 kW und 35 kW (je Abrechnungsperiode)',
      tone: 'neutral',
    })
    expect(rows).toContainEqual({
      label: 'Abgerechneter Leistungswert heute',
      value: '48 kW',
      tone: 'neutral',
    })
    expect(rows).toContainEqual({ label: 'Mit dem Speicher', value: '40 kW', tone: 'neutral' })
  })

  /**
   * Der Grundpreis-Teil des EAG-Förderbeitrags (21.09.2026) — eine ZWEITE kW-gebundene Jahresgrösse
   * neben dem Leistungswert, und ausdrücklich eine EIGENE Zeile: sie darf mit dem Leistungspreis des
   * Netzbetreibers nicht verschmelzen (zwei verschiedene Abgaben, dieselbe Einheit).
   *
   * Zahlenbasis: der Bäckerei-Zuschnitt, Wiener Netze NE 6, Tarifjahr 2026 — 5,252 €/kW·a (EX104)
   * auf 48 kW Monatssumme des Fixtures (`monthly_max_sum`, 12 Monate, also ÷ 12) ergibt 21,01 €. Die Engine rechnet den Betrag (`eagDemandChargePerYear`);
   * hier steht er als Contract-Wert und wird nur formatiert.
   */
  it('weist den EAG-Förderbeitrag-Grundpreis als eigene Zeile aus, getrennt vom Leistungswert', () => {
    const analysis = analysisFor(false)
    analysis.perBattery = [{ ...ENTRY, dispatchTrace: TRACE }]
    analysis.current = { ...analysis.current, eagGrundpreisCostPerYear: (5.252 * 48) / 12 }

    const rows = buildRecommendationChapter(analysis).recommendation!.rows

    expect(rows).toContainEqual({
      label: 'EAG-Förderbeitrag (Grundpreis) heute',
      value: '€\u00a021 pro Jahr (€\u00a05,25 / kW·a)',
      tone: 'neutral',
    })
    // Kein doppeltes Zählen: die Zeile steht NACH den Summenzeilen und geht in keine ein.
    expect(rows.filter((r) => r.total).map((r) => r.label)).toEqual([
      'Gesamtinvestition',
      `Netto über ${analysis.assumptions.horizonYears} Jahre`,
    ])
  })

  it('fehlt ohne bezifferbaren Grundpreis (Urbanz: NE 7 ohne Leistungsmessung)', () => {
    const analysis = analysisFor(false)
    analysis.perBattery = [{ ...ENTRY, dispatchTrace: TRACE }]

    const labels = buildRecommendationChapter(analysis).recommendation!.rows.map((r) => r.label)

    expect(labels).toContain('Abgerechneter Leistungswert heute')
    expect(labels).not.toContain('EAG-Förderbeitrag (Grundpreis) heute')
  })

  it('fehlen ohne Leistungspreis-Ersparnis (leistungspreisSavingPerYear = 0)', () => {
    const analysis = analysisFor(false)
    analysis.perBattery = [{ ...ENTRY, leistungspreisSavingPerYear: 0, dispatchTrace: TRACE }]

    const labels = buildRecommendationChapter(analysis).recommendation!.rows.map((r) => r.label)

    expect(labels).not.toContain('Kapp-Schwelle')
    expect(labels).not.toContain('Abgerechneter Leistungswert heute')
    expect(labels).not.toContain('Mit dem Speicher')
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
