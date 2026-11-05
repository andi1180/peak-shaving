import { describe, expect, it } from 'vitest'

import type { LoadProfile, MonthlyTariffComparison } from 'shared'

import { tariffSwitchPlanOf } from './analysis-switch-plan'
import { computeSwitchPlan, DEFAULT_SWITCH_RULES } from './switch-plan'

const flat = (eur: number) => Array.from({ length: 12 }, () => eur)
// Okt–Mär (Monate 9, 10, 11, 0, 1, 2) gegen Apr–Sep (Monate 3..8).
const seasonal = (winterEur: number, summerEur: number) =>
  Array.from({ length: 12 }, (_, month) => (month >= 3 && month <= 8 ? summerEur : winterEur))

const plan = (comparison: (number | null)[], spot: (number | null)[]) =>
  computeSwitchPlan([
    { id: 'comparison', monthlyEur: comparison },
    { id: 'spot', monthlyEur: spot },
  ])

function okPlan(comparison: (number | null)[], spot: (number | null)[]) {
  const result = plan(comparison, spot)
  if (result.status !== 'ok') throw new Error('Plan erwartet')
  return result
}

describe('computeSwitchPlan', () => {
  it('Fix überall billiger: ganzjährig Fix, jeder Wechsel kostet mehr', () => {
    const result = okPlan(flat(100), flat(120))
    expect(result.result).toEqual({ kind: 'single', tariffId: 'comparison' })
    expect(result.bestSingle).toEqual({ tariffId: 'comparison', annualEur: 1200 })
    expect(result.savingVsBestSingleEur).toBe(-120)
  })

  it('Börse überall billiger: ganzjährig Börse', () => {
    expect(okPlan(flat(120), flat(100)).result).toEqual({ kind: 'single', tariffId: 'spot' })
  })

  it('Fix im Winter, Börse im Sommer: Wechsel mit Start April', () => {
    const result = okPlan(seasonal(100, 130), seasonal(130, 100))

    expect(result.bestSwitch.startMonth).toBe(3)
    expect(result.bestSwitch.annualEur).toBe(1200)
    expect(result.savingVsBestSingleEur).toBe(180)
    expect(result.savingShare).toBeCloseTo(180 / 1380, 12)
    expect(result.result).toEqual({
      kind: 'switch',
      blocks: [
        { tariffId: 'spot', months: [3, 4, 5, 6, 7, 8] },
        { tariffId: 'comparison', months: [9, 10, 11, 0, 1, 2] },
      ],
    })
  })

  it.each([
    ['30 € (über 5 %)', seasonal(10, 15), seasonal(15, 10)],
    ['3 % (über 50 €)', seasonal(1000, 1030), seasonal(1030, 1000)],
  ])('Wechsel gewinnt nur knapp, %s: Einzeltarif, bestSwitch bleibt befüllt', (_, fix, spot) => {
    const result = okPlan(fix, spot)
    expect(result.result.kind).toBe('single')
    expect(result.bestSwitch.startMonth).toBe(3)
    expect(result.savingVsBestSingleEur).toBeGreaterThan(0)
  })

  it('beide Schwellen gelten einschliesslich', () => {
    const fix = seasonal(100, 110)
    const spot = seasonal(110, 100)
    const result = computeSwitchPlan(
      [
        { id: 'comparison', monthlyEur: fix },
        { id: 'spot', monthlyEur: spot },
      ],
      { ...DEFAULT_SWITCH_RULES, minSavingEur: 60, minSavingShare: 60 / 1260 },
    )
    expect(result.status === 'ok' && result.savingVsBestSingleEur).toBe(60)
    expect(result.status === 'ok' && result.result.kind).toBe('switch')
  })

  it('zählt 14 Varianten bei 2 Tarifen und 39 bei 3', () => {
    expect(okPlan(flat(1), flat(2)).variants).toHaveLength(14)
    const three = computeSwitchPlan([
      { id: 'a', monthlyEur: flat(1) },
      { id: 'b', monthlyEur: flat(2) },
      { id: 'c', monthlyEur: flat(3) },
    ])
    expect(three.status === 'ok' && three.variants).toHaveLength(39)
  })

  it('ein fehlender Monat macht den Plan unmöglich, ohne Varianten', () => {
    const fix: (number | null)[] = flat(100)
    fix[7] = null
    expect(plan(fix, flat(90))).toEqual({
      status: 'insufficient_data',
      reason: 'missing_months',
    })
  })

  it('Gleichstand Einzeltarif = Wechsel bleibt Einzeltarif, auch ohne Schwellen', () => {
    const result = computeSwitchPlan(
      [
        { id: 'comparison', monthlyEur: flat(100) },
        { id: 'spot', monthlyEur: flat(100) },
      ],
      { ...DEFAULT_SWITCH_RULES, minSavingEur: 0, minSavingShare: 0 },
    )
    expect(result.status === 'ok' && result.result).toEqual({
      kind: 'single',
      tariffId: 'comparison',
    })
  })

  it('Gleichstand unter Wechseln: niedrigster Startmonat, dann Eingabereihenfolge', () => {
    const result = okPlan(flat(100), flat(100))
    expect(result.bestSwitch.startMonth).toBe(0)
    expect(result.bestSwitch.blocks[0].tariffId).toBe('comparison')
  })

  it('ohne positive Jahreskosten gibt es keinen Anteil und keinen Wechsel', () => {
    const result = okPlan(seasonal(-100, 100), seasonal(100, -100))
    expect(result.savingShare).toBeNull()
    expect(result.result.kind).toBe('single')
  })
})

describe('tariffSwitchPlanOf — Abdeckung', () => {
  const profileOf = (days: number) =>
    ({
      readings: [
        { ts: '2025-01-05T00:00:00.000Z', gridImportKw: 1 },
        {
          ts: new Date(
            Date.parse('2025-01-05T00:00:00.000Z') + days * 86_400_000 - 900_000,
          ).toISOString(),
          gridImportKw: 1,
        },
      ],
      intervalMinutes: 15,
    }) as unknown as LoadProfile

  const comparison = {
    comparisonTariffEur: flat(100),
    spotWithoutControlEur: flat(90),
  } as unknown as MonthlyTariffComparison

  it.each([
    [364, { status: 'insufficient_data', reason: 'short_period' }],
    [365, { status: 'ok' }],
    [366, { status: 'ok' }],
    [367, { status: 'ok' }],
    [368, { status: 'insufficient_data', reason: 'overlap' }],
  ])('%i Tage', (days, expected) => {
    expect(tariffSwitchPlanOf(profileOf(days), comparison)).toMatchObject(expected)
  })

  it('kurzer Zeitraum geht vor fehlenden Monaten', () => {
    const partial = {
      comparisonTariffEur: [null, ...flat(100).slice(1)],
      spotWithoutControlEur: flat(90),
    } as unknown as MonthlyTariffComparison
    expect(tariffSwitchPlanOf(profileOf(209), partial)).toEqual({
      status: 'insufficient_data',
      reason: 'short_period',
    })
  })

  it('ohne Vergleichstarif entsteht kein Plan', () => {
    const noComparison = { spotWithoutControlEur: flat(90) } as unknown as MonthlyTariffComparison
    expect(tariffSwitchPlanOf(profileOf(365), noComparison)).toBeUndefined()
    expect(tariffSwitchPlanOf(profileOf(365), undefined)).toBeUndefined()
  })
})
