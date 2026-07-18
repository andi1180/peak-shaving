import { describe, expect, it } from 'vitest'

import { compareTariffs } from '../compare/compare'
import type { UserTariffInput } from '../types'
import {
  bonusGuaranteeTariff,
  HOUSEHOLD_CONSUMPTION_KWH,
  noBonusNoGuaranteeTariff,
  SMALL_BUSINESS_CONSUMPTION_KWH,
} from './tariffs'

/**
 * §14-DoD-Gate für `compareTariffs` (T1-Teil 3): der Nutzer steckt im klassischen
 * `noBonusNoGuaranteeTariff` (gespiegelt als `UserTariffInput`, alle Felder inkl. Stufe 2
 * identisch zum Fixture) und vergleicht gegen BEIDE Teil-2-Fixtures als `candidates`.
 *
 * Handrechnung (Werte aus `normalize-gate.test.ts` übernommen, dort bereits gepinnt):
 *  - current = noBonusNoGuaranteeTariff  @ 3500 kWh: ongoing 981,5 / firstYear 981,5
 *  - current = noBonusNoGuaranteeTariff  @ 8000 kWh: ongoing 2102  / firstYear 2102
 *  - bonusGuaranteeTariff    @ 3500 kWh: ongoing 883,5 / firstYear 733,5
 *  - bonusGuaranteeTariff    @ 8000 kWh: ongoing 1896  / firstYear 1746
 *  - noBonusNoGuaranteeTariff @ beide: identisch zu current (0/0 saving — Tarif vs. sich selbst)
 *
 * savingOngoing/savingFirstYear = current − candidate:
 *  - @3500: bonusGuaranteeTariff → saving 98,0 (ongoing) / 248,0 (firstYear)
 *           noBonusNoGuaranteeTariff → saving 0 / 0
 *  - @8000: bonusGuaranteeTariff → saving 206,0 (ongoing) / 356,0 (firstYear)
 *           noBonusNoGuaranteeTariff → saving 0 / 0
 */
function mirrorAsUserInput(consumption: number): UserTariffInput {
  return {
    annualConsumptionKwh: consumption,
    energyPriceCtPerKwh: noBonusNoGuaranteeTariff.energyPriceCtPerKwh,
    baseFeeEurPerYear: noBonusNoGuaranteeTariff.baseFeeEurPerYear,
    postalCode: '1010',
    providerName: noBonusNoGuaranteeTariff.providerName,
    tariffName: noBonusNoGuaranteeTariff.tariffName,
    bonusEur: noBonusNoGuaranteeTariff.bonusEur,
    priceGuaranteeMonths: noBonusNoGuaranteeTariff.priceGuaranteeMonths,
    contractCommitmentMonths: noBonusNoGuaranteeTariff.contractCommitmentMonths,
    billingCycle: noBonusNoGuaranteeTariff.billingCycle,
    greenEnergy: noBonusNoGuaranteeTariff.greenEnergy,
  }
}

describe('T1 fixture gate — compareTariffs against named tariff fixtures', () => {
  it('household consumption (3500 kWh): current mirrors noBonusNoGuaranteeTariff', () => {
    const result = compareTariffs(mirrorAsUserInput(HOUSEHOLD_CONSUMPTION_KWH), [
      bonusGuaranteeTariff,
      noBonusNoGuaranteeTariff,
    ])

    expect(result.current.ongoingYearlyCostEur).toBe(981.5)
    expect(result.current.firstYearCostEur).toBe(981.5)
    expect(result.confidence).toBe('detailed') // bonusEur (0) UND contractCommitmentMonths (12) gespiegelt/gesetzt

    // alternatives kommt vollständig (2/2) und nach savingOngoing absteigend sortiert zurück.
    expect(result.alternatives).toHaveLength(2)
    const [best, worst] = result.alternatives

    expect(best!.tariff.providerName).toBe('Sonnenstrom Direkt')
    expect(best!.savingOngoingEurPerYear).toBe(98)
    expect(best!.savingFirstYearEur).toBe(248)

    expect(worst!.tariff.providerName).toBe('Basis Energie AG')
    expect(worst!.savingOngoingEurPerYear).toBe(0)
    expect(worst!.savingFirstYearEur).toBe(0)

    expect(result.recommendation?.tariff.providerName).toBe('Sonnenstrom Direkt')
    expect(result.recommendation?.rationale).toBe(
      'Wechsel zu Sonnenstrom Direkt Klick Strom Online spart ca. €98/Jahr beim Dauerpreis. ' +
        'Zusätzlich einmaliger Wechselbonus von €150 im ersten Vertragsjahr.',
    )
  })

  it('small-business consumption (8000 kWh): current mirrors noBonusNoGuaranteeTariff', () => {
    const result = compareTariffs(mirrorAsUserInput(SMALL_BUSINESS_CONSUMPTION_KWH), [
      bonusGuaranteeTariff,
      noBonusNoGuaranteeTariff,
    ])

    expect(result.current.ongoingYearlyCostEur).toBe(2102)
    expect(result.current.firstYearCostEur).toBe(2102)

    const [best, worst] = result.alternatives
    expect(best!.tariff.providerName).toBe('Sonnenstrom Direkt')
    expect(best!.savingOngoingEurPerYear).toBe(206)
    expect(best!.savingFirstYearEur).toBe(356)

    expect(worst!.tariff.providerName).toBe('Basis Energie AG')
    expect(worst!.savingOngoingEurPerYear).toBe(0)
    expect(worst!.savingFirstYearEur).toBe(0)

    expect(result.recommendation?.tariff.providerName).toBe('Sonnenstrom Direkt')
  })

  it('excludePrepayment preference filters out noBonusNoGuaranteeTariff (requiresPrepayment: true fixture)', () => {
    const result = compareTariffs(
      mirrorAsUserInput(HOUSEHOLD_CONSUMPTION_KWH),
      [bonusGuaranteeTariff, noBonusNoGuaranteeTariff],
      { excludePrepayment: true },
    )

    const noBonus = result.alternatives.find((a) => a.tariff.providerName === 'Basis Energie AG')
    const bonus = result.alternatives.find((a) => a.tariff.providerName === 'Sonnenstrom Direkt')
    expect(noBonus!.passesPreferenceFilter).toBe(false) // requiresPrepayment: true im Fixture
    expect(bonus!.passesPreferenceFilter).toBe(true) // requiresPrepayment fehlt im Fixture → nein
  })
})
