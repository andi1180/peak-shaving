import { describe, expect, it } from 'vitest'

import type { TariffCostObject } from '../types'
import { normalizeTariffCost } from './normalize'

function tariff(overrides: Partial<TariffCostObject> = {}): TariffCostObject {
  return {
    providerName: 'Testversorger',
    tariffName: 'Test Strom Fix',
    energyPriceCtPerKwh: 20,
    baseFeeEurPerYear: 100,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: true,
    ...overrides,
  }
}

describe('normalizeTariffCost', () => {
  it('never folds the bonus into ongoingYearlyCostEur (invariant 1)', () => {
    const result = normalizeTariffCost(tariff({ bonusEur: 200 }), 4000)
    // ongoing = 0.20 * 4000 + 100 = 900, unabhängig vom Bonus
    expect(result.ongoingYearlyCostEur).toBe(900)
  })

  it('firstYearCostEur = max(0, ongoing - bonus) (invariant 2)', () => {
    const result = normalizeTariffCost(tariff({ bonusEur: 200 }), 4000)
    expect(result.firstYearCostEur).toBe(700)
  })

  it('clamps firstYearCostEur at 0 when the bonus exceeds ongoing cost, without touching ongoing (invariant 2)', () => {
    const result = normalizeTariffCost(tariff({ bonusEur: 5000 }), 4000)
    expect(result.firstYearCostEur).toBe(0)
    expect(result.ongoingYearlyCostEur).toBe(900)
  })

  it('firstYearCostEur equals ongoing exactly when bonusEur is 0 (invariant 3)', () => {
    const result = normalizeTariffCost(tariff({ bonusEur: 0 }), 4000)
    expect(result.firstYearCostEur).toBe(result.ongoingYearlyCostEur)
  })

  it('is deterministic — same input yields same output (invariant 4)', () => {
    const input = tariff({ bonusEur: 150, priceGuaranteeMonths: 12 })
    const a = normalizeTariffCost(input, 5000)
    const b = normalizeTariffCost(input, 5000)
    expect(a).toEqual(b)
  })

  it('priceGuaranteeMonths changes neither ongoing nor firstYear (invariant 5)', () => {
    const withGuarantee = normalizeTariffCost(tariff({ bonusEur: 100, priceGuaranteeMonths: 12 }), 4000)
    const withoutGuarantee = normalizeTariffCost(tariff({ bonusEur: 100, priceGuaranteeMonths: undefined }), 4000)
    expect(withGuarantee.ongoingYearlyCostEur).toBe(withoutGuarantee.ongoingYearlyCostEur)
    expect(withGuarantee.firstYearCostEur).toBe(withoutGuarantee.firstYearCostEur)
  })

  it('passes priceGuaranteeMonths through unchanged as metadata', () => {
    expect(normalizeTariffCost(tariff({ priceGuaranteeMonths: 24 }), 4000).priceGuaranteeMonths).toBe(24)
    expect(normalizeTariffCost(tariff({ priceGuaranteeMonths: undefined }), 4000).priceGuaranteeMonths).toBeUndefined()
  })

  it('passes bonusEur through unchanged, separate from the cost figures', () => {
    expect(normalizeTariffCost(tariff({ bonusEur: 150 }), 4000).bonusEur).toBe(150)
  })

  it('scales ongoingYearlyCostEur with annualConsumptionKwh', () => {
    const t = tariff({ energyPriceCtPerKwh: 25, baseFeeEurPerYear: 96, bonusEur: 0 })
    expect(normalizeTariffCost(t, 3500).ongoingYearlyCostEur).toBe(971)
    expect(normalizeTariffCost(t, 8000).ongoingYearlyCostEur).toBe(2096)
  })
})
