import { describe, expect, it } from 'vitest'
import type { BatteryRoiEntry, MonthlyTariffComparison } from 'shared'

import { reportLayoutOf } from './layout'
import { resolveReportText } from './report-text'
import { buildReportSummary, type SummaryInput } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * Die Zusammenfassung — die zwei Kopfzahlen, der Fliesstext und die Bedingungen, unter denen sie
 * entstehen.
 *
 * ⚠ Gemessen wird über `buildReportSummary` und nicht über die Helfer darunter: was auf der Seite
 * steht, ist das Zusammenspiel — eine Kopfzahl ohne den Absatz, der sie einordnet, wäre in jedem
 * Einzeltest grün und im Dokument falsch.
 */

/** Zahlen wie im Zielbild: 1.061 heute, 53 durch den reinen Wechsel, 207 mit Steuerung. */
const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: [1061, ...Array<null>(11).fill(null)],
  spotWithoutControlEur: [1008, ...Array<null>(11).fill(null)],
  spotWithBatteryEur: [854, ...Array<null>(11).fill(null)],
  coveredMonths: 8,
  fixedCosts: {
    networkBaseFeeEur: 0,
    meteringFeeEur: 0,
    eagFlatFeeEur: 0,
    usageChargeOnFixedEur: 0,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 210,
  },
}

const BATTERY = {
  id: 'kat-1',
  name: 'Katalog 1',
  manufacturer: 'Fixture',
  class: 'commercial' as const,
  usableCapacityKwh: 19.2,
  maxPowerKw: 10.6,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic' as const,
}

const ENTRY: BatteryRoiEntry = {
  battery: BATTERY,
  newBilledKw: 40,
  /* 0 = der Speicher senkt den abgerechneten Leistungswert nicht (Urbanz: NE 7 ohne Messung). */
  leistungspreisSavingPerYear: 0,
  energySavingPerYear: 400,
  energySavingOverCoveredPeriod: 400,
  energySavingBasis: 'full_price' as const,
  annualizationFactor: 1,
  coveredDays: 209,
  totalSavingPerYear: 400,
  warnings: [],
  notices: [],
  totalInvestment: 21000,
  subsidyAmount: 0,
  taxBenefit: 0,
  taxEffectsIncluded: false,
  netInvestment: 21000,
  amortizationYears: 17.5,
  netSavingOverHorizon: -9000,
}

function analysisFor(over: Partial<PdfReportAnalysis> = {}): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 13.5,
      monthlyPeaksKw: Array<number>(12).fill(13.5),
      billedKw: 13.5,
      /* Netzebene 7 ohne Leistungsmessung — den Posten gibt es nicht. */
      leistungspreisCostPerYear: 0,
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
      coveredDays: 209,
      coveredMonths: 8,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
    existingBatteryAnalysis: { entry: ENTRY, addonScenarios: [] },
    ...over,
  }
}

function summaryFor(over: Partial<SummaryInput> = {}) {
  return buildReportSummary({
    analysis: analysisFor(),
    loadProfile: { source: 'net_signed' },
    ...over,
  })
}

/** Der Fliesstext, ohne Verweisziele aufgelöst — die Ersatzfassungen greifen dann. */
function proseOf(summary: ReturnType<typeof summaryFor>): string {
  return resolveReportText(summary.overview, reportLayoutOf([]), 'overview')
}

describe('die zwei Kopfzahlen', () => {
  it('nennt Ist-Kosten und Ersparnis-Spanne über die gemessenen Tage', () => {
    const kpis = summaryFor().kpis

    expect(kpis.map((k) => [k.id, k.value, k.tone])).toEqual([
      ['cost_today', '€ 1.061', 'ink'],
      ['possible_saving', '€ 53 – € 207', 'accent'],
    ])
    expect(kpis[0]!.caption).toEqual(['Ihre Stromkosten heute', 'über 209 gemessene Tage, netto'])
    expect(kpis[1]!.caption[1]).toBe('je nach gewähltem Weg, im selben Zeitraum')
  })

  /**
   * ⚠ Der reine Wechsel ist im gemessenen Realfall NEGATIV (`real-saving.ts`) — dann gibt es keine
   * Spanne, sondern eine Zahl, und die Bezugszeile muss sagen, wodurch sie entsteht. Eine Spanne
   * „€ −53 – € 101" behauptete einen Weg, der die Kosten erhöht, als Ersparnis.
   */
  it('zeigt bei nur einem tragenden Weg eine Zahl statt einer Spanne', () => {
    const kpis = summaryFor({
      analysis: analysisFor({
        tariffOptimization: {
          computable: true,
          monthlyComparison: {
            ...COMPARISON,
            spotWithoutControlEur: [1114, ...Array<null>(11).fill(null)],
          },
        },
      }),
    }).kpis

    expect(kpis[1]!.value).toBe('€ 207')
    expect(kpis[1]!.caption[1]).toBe('mit gezielter Ladesteuerung, im selben Zeitraum')
  })

  /**
   * ⚠ OHNE MONATSVERGLEICH GIBT ES BEIDE ZAHLEN NICHT — auch die Ist-Kosten nicht: der Contract
   * führt sie an keiner anderen Stelle. Der Absatz muss das dann sagen, statt die Seite leer zu
   * lassen.
   */
  it('lässt beide Zahlen weg, wenn der Tarifvergleich nicht gerechnet wurde', () => {
    const summary = summaryFor({
      analysis: analysisFor({ tariffOptimization: undefined }),
    })

    expect(summary.kpis).toEqual([])
    expect(proseOf(summary)).toContain('liess sich für diesen Zeitraum nicht berechnen')
  })

  /**
   * ⚠ Der Monatsvergleich führt den Leistungspreis ausdrücklich NICHT. Wo es den Posten gibt, muss
   * die Bezugszeile das sagen — sonst stünde unter „Ihre Stromkosten heute" eine Zahl, die bei
   * einem Gewerbekunden einen erheblichen Teil seiner Rechnung auslässt.
   */
  it('nennt die Grenze der Ist-Kosten, wo es einen Leistungspreis gibt', () => {
    const mit = summaryFor({
      analysis: analysisFor({
        current: { ...analysisFor().current, leistungspreisCostPerYear: 3980 },
        existingBatteryAnalysis: {
          entry: { ...ENTRY, leistungspreisSavingPerYear: 800 },
          addonScenarios: [],
        },
      }),
    })

    expect(mit.kpis[0]!.caption[1]).toBe('über 209 gemessene Tage, netto, ohne Leistungspreis')
    /* Und die Kappung wird im Absatz benannt, statt still aus der Spanne zu fallen. */
    expect(proseOf(mit)).toContain('Die Kappung Ihrer Lastspitzen ist in dieser Spanne nicht')
    expect(proseOf(summaryFor())).not.toContain('Kappung Ihrer Lastspitzen')
  })
})

describe('der Fliesstext', () => {
  it('nennt Batterie und PV-Anlage mit ihren erfassten Werten', () => {
    expect(proseOf(summaryFor({ hasPv: true, pvPeakPowerKwp: 10.2 }))).toContain(
      'Sie haben bereits eine Batterie (19,2 kWh) und eine PV-Anlage (10,2 kWp). Es gibt zwei ' +
        'unterschiedlich aufwändige Wege',
    )
  })

  /**
   * ⚠ `hasPv === undefined` IST NICHT `false`: der Entwurf kennt „nein" und „nicht gefragt"
   * getrennt. Auf `false` gerundet stünde eine Aussage über den Kunden im Report, die niemand
   * gemacht hat.
   */
  it('verneint die PV-Anlage nur, wo sie ausdrücklich verneint wurde', () => {
    expect(proseOf(summaryFor({ hasPv: false }))).toContain(
      'Sie haben bereits eine Batterie (19,2 kWh), aber noch keine PV-Anlage.',
    )
    expect(proseOf(summaryFor())).toContain('Sie haben bereits eine Batterie (19,2 kWh).')
    expect(proseOf(summaryFor())).not.toContain('PV-Anlage')
  })

  it('sagt ohne Bestandsanlage, dass die Steuerung einen Speicher voraussetzt', () => {
    const text = proseOf(
      summaryFor({ analysis: analysisFor({ existingBatteryAnalysis: undefined }) }),
    )

    expect(text).toContain('Sie haben bislang keinen Batteriespeicher.')
    expect(text).toContain('gezielter Ladesteuerung eines Speichers')
  })
})

/**
 * Die Positiv-Kontrolle zum Auftrag: der PV-Verweissatz steht NUR bei angegebener Anlage — und
 * fehlt sonst ganz, statt leer oder verwaist dazustehen.
 */
describe('der PV-Satz', () => {
  it('steht nur mit angegebener PV-Anlage', () => {
    expect(summaryFor({ hasPv: true }).pvPointer).not.toBeNull()
    expect(summaryFor({ hasPv: false }).pvPointer).toBeNull()
    expect(summaryFor().pvPointer).toBeNull()
  })
})

/**
 * Die Hinweiskästen bleiben — ihre Verweise auf „den abgerechneten Leistungswert oben" nicht: die
 * Kopfzahl, auf die sie zeigten, gibt es seit dem Umbau nicht mehr.
 */
describe('die Hinweise zur Datengrundlage', () => {
  it('feuern unverändert, nennen aber keinen Ort mehr', () => {
    const summary = summaryFor({
      analysis: analysisFor({
        current: { ...analysisFor().current, leistungspreisCostPerYear: 3980 },
        dataQuality: { ...analysisFor().dataQuality, largestGapSlots: 2880 },
      }),
      loadProfile: { source: 'standard_profile' },
    })

    expect(summary.notices.map((n) => n.id)).toEqual([
      'standard_profile',
      'partial_year',
      'large_gap',
    ])
    for (const notice of summary.notices) {
      expect(`${notice.title} ${notice.body} ${notice.hints.join(' ')}`).not.toContain(' oben')
    }
  })
})
