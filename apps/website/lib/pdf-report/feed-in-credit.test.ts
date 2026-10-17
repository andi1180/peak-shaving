import { describe, expect, it } from 'vitest'
import { LEVIES_NONE } from 'shared'
import type { GridTariffRowInput, LoadProfile, TariffParams, TariffPricingInputs } from 'shared'

import { formatEur } from '@/lib/format'
import { EXECUTIVE_SUMMARY_CASES as CASES } from '@/test/executive-summary-cases'
// Nicht öffentlich exportiert; der Test vergleicht gegen genau die Engine-Reihe.
import { buildMonthlyTariffComparison } from '../../../../packages/engine/src/simulation/monthly-tariff-comparison'
import { buildReportContext } from './context'
import { buildExecutiveSummary, type ExecutiveSummary } from './executive-summary'
import { feedInCreditEur } from './feed-in-credit'
import { buildReportSummary } from './summary'
import type { PdfReportInput } from './types'

const plain = (value: string) => value.replace(/\u00a0/g, ' ')
const STEP_MS = 15 * 60 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

/** Bezug und Einspeisung im Wechsel, 15.01.2025 ab 00:00 Ortszeit, 48 Viertelstunden. */
function mixedProfile(): LoadProfile {
  const t0 = Date.parse('2025-01-14T23:00:00Z')
  const kw = Array.from({ length: 48 }, (_, i) => (i % 3 === 0 ? -2.75 - i / 10 : 3.1 + i / 7))
  return {
    readings: kw.map((gridPowerKw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw })),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'measured_feed_in',
  }
}

const ROW: GridTariffRowInput = {
  validFrom: '2024-01-01',
  validUntil: null,
  netzverlustCtPerKwh: 0.7,
  priceBasis: 'net',
  windows: [
    {
      label: 'normal',
      monthDayFrom: null,
      monthDayTo: null,
      timeFrom: '00:00:00',
      timeTo: '24:00:00',
      ctPerKwh: 6.98,
    },
  ],
}

const pricing: TariffPricingInputs = {
  gridTariffRows: [ROW],
  spotPrices: {
    prices: Array.from({ length: 12 }, (_, h) => ({
      tsStart: iso(Date.parse('2025-01-14T23:00:00Z') + h * 3_600_000),
      tsEnd: iso(Date.parse('2025-01-14T23:00:00Z') + (h + 1) * 3_600_000),
      ctPerKwh: 10,
      priceBasis: 'net',
    })),
    complete: true,
    missingRanges: [],
  },
  levies: LEVIES_NONE,
}

describe('feedInCreditEur', () => {
  it('ist auf den Cent die Differenz der Engine-Reihe „Ihr Tarif heute" mit Satz 8,13 und 0', () => {
    const load = mixedProfile()
    const tariffWith = (ct: number): TariffParams => ({
      leistungspreisEurPerKwYear: 0,
      billingModel: 'annual_max',
      minBillableKw: 0,
      energyPriceCtPerKwh: 25,
      einspeiseverguetungCtPerKwh: ct,
    })
    const sum = (ct: number) =>
      buildMonthlyTariffComparison(
        load,
        tariffWith(ct),
        pricing,
        undefined,
      )!.currentTariffEur!.reduce<number>((total, v) => total + (v ?? 0), 0)
    const engineCredit = sum(0) - sum(8.13)
    expect(engineCredit).toBeGreaterThan(0)
    expect(Math.round(feedInCreditEur(load, 8.13) * 100)).toBe(Math.round(engineCredit * 100))
    expect(feedInCreditEur(load, 0)).toBe(0)
  })
})

describe('„Ihre Stromkosten heute" mit Vorderseite', () => {
  const kpiOf = (input: PdfReportInput, front?: ExecutiveSummary | null) =>
    buildReportSummary(
      input,
      front === undefined ? undefined : { ...buildReportContext(input), executiveSummary: front },
    ).kpis.find((k) => k.id === 'cost_today')!

  it('Basis linear (352 Tage): Wert der Vorderseite, hochgerechnet, mit Einspeise-Zusatz', () => {
    const base = CASES['jahr (Müldür)']!
    const input: PdfReportInput = {
      ...base,
      loadProfile: mixedProfile(),
      analysis: {
        ...base.analysis,
        assumptions: { ...base.analysis.assumptions, einspeiseverguetungCtPerKwh: 8 },
      },
    }
    const front0 = buildExecutiveSummary(base)!
    const front: ExecutiveSummary = {
      ...front0,
      todayCostPerYearEur: 12_323,
      header: { ...front0.header, basis: 'linear', measuredDays: 352, projectedDays: 0 },
    }
    const kpi = kpiOf(input, front)
    const credit = (feedInCreditEur(mixedProfile(), 8) * 365) / 352
    expect(kpi.value).toBe(formatEur(12_323))
    expect(plain(kpi.caption[1])).toBe(
      'pro Jahr, hochgerechnet aus 352 gemessenen Tagen, netto, ohne Leistungspreis, ' +
        `nach Abzug Ihrer Einspeisevergütung (ca. ${plain(formatEur(credit))} pro Jahr)`,
    )
  })

  it('Basis annual und ohne Vorderseite: Wert und Untertitel exakt wie bisher', () => {
    const input = CASES['volles Jahr (konstruiert)']!
    const front = buildExecutiveSummary(input)!
    expect(front.header.basis).toBe('annual')
    const before = kpiOf(input)
    expect(kpiOf(input, front)).toEqual(before)
    expect(kpiOf(input, null)).toEqual(before)
    expect(plain(before.caption[1])).toBe('über 365 gemessene Tage, netto, ohne Leistungspreis')
  })
})
