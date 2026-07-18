import { describe, expect, it } from 'vitest'

import { normalizeTariffCost } from '../normalize/normalize'
import {
  bonusGuaranteeTariff,
  HOUSEHOLD_CONSUMPTION_KWH,
  noBonusNoGuaranteeTariff,
  SMALL_BUSINESS_CONSUMPTION_KWH,
} from './tariffs'

/**
 * §14-DoD-Gate: "Die Engine normalisiert zwei reale Beispiel-Tarife korrekt auf Jahreskosten
 * und trennt Bonus (Erstjahr) sauber vom Dauerpreis." Rechnet die zwei Fixture-Tarife gegen
 * zwei Referenzverbräuche von Hand vor und pinnt die konkreten Zahlen (Muster wie
 * `engine/src/fixtures/m1-gate.test.ts`).
 *
 * Handrechnung (ongoing = energyPriceCtPerKwh/100 × kWh + baseFeeEurPerYear; firstYear = ongoing − bonus):
 *  - bonusGuaranteeTariff  @ 3500 kWh: 0,225 × 3500 + 96  = 883,5  → firstYear 883,5 − 150 = 733,5
 *  - bonusGuaranteeTariff  @ 8000 kWh: 0,225 × 8000 + 96  = 1896   → firstYear 1896   − 150 = 1746
 *  - noBonusNoGuaranteeTariff @ 3500 kWh: 0,249 × 3500 + 110 = 981,5 → firstYear = ongoing (kein Bonus)
 *  - noBonusNoGuaranteeTariff @ 8000 kWh: 0,249 × 8000 + 110 = 2102  → firstYear = ongoing (kein Bonus)
 */
describe('T1 fixture gate — normalizeTariffCost against named tariff fixtures', () => {
  it('bonusGuaranteeTariff @ household consumption (3500 kWh)', () => {
    const result = normalizeTariffCost(bonusGuaranteeTariff, HOUSEHOLD_CONSUMPTION_KWH)
    expect(result).toEqual({
      ongoingYearlyCostEur: 883.5,
      firstYearCostEur: 733.5,
      bonusEur: 150,
      priceGuaranteeMonths: 12,
    })
  })

  it('bonusGuaranteeTariff @ small-business consumption (8000 kWh)', () => {
    const result = normalizeTariffCost(bonusGuaranteeTariff, SMALL_BUSINESS_CONSUMPTION_KWH)
    expect(result).toEqual({
      ongoingYearlyCostEur: 1896,
      firstYearCostEur: 1746,
      bonusEur: 150,
      priceGuaranteeMonths: 12,
    })
  })

  it('noBonusNoGuaranteeTariff @ household consumption (3500 kWh)', () => {
    const result = normalizeTariffCost(noBonusNoGuaranteeTariff, HOUSEHOLD_CONSUMPTION_KWH)
    expect(result).toEqual({
      ongoingYearlyCostEur: 981.5,
      firstYearCostEur: 981.5,
      bonusEur: 0,
      priceGuaranteeMonths: undefined,
    })
  })

  it('noBonusNoGuaranteeTariff @ small-business consumption (8000 kWh)', () => {
    const result = normalizeTariffCost(noBonusNoGuaranteeTariff, SMALL_BUSINESS_CONSUMPTION_KWH)
    expect(result).toEqual({
      ongoingYearlyCostEur: 2102,
      firstYearCostEur: 2102,
      bonusEur: 0,
      priceGuaranteeMonths: undefined,
    })
  })

  it('the bonus never appears in ongoingYearlyCostEur across both fixtures (invariant 1, cross-check)', () => {
    for (const consumption of [HOUSEHOLD_CONSUMPTION_KWH, SMALL_BUSINESS_CONSUMPTION_KWH]) {
      const result = normalizeTariffCost(bonusGuaranteeTariff, consumption)
      const ongoingWithoutBonusLogic =
        (bonusGuaranteeTariff.energyPriceCtPerKwh / 100) * consumption + bonusGuaranteeTariff.baseFeeEurPerYear
      expect(result.ongoingYearlyCostEur).toBe(ongoingWithoutBonusLogic)
    }
  })
})
