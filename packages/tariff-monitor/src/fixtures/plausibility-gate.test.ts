import { describe, expect, it } from 'vitest'

import { checkPlausibility } from '../plausibility/plausibility'
import type { UserTariffInput } from '../types'
import { SAMPLE_GRID_COST_ESTIMATE } from './grid-cost-estimates'
import { bonusGuaranteeTariff, HOUSEHOLD_CONSUMPTION_KWH, noBonusNoGuaranteeTariff } from './tariffs'

/**
 * §14-DoD-Gate für `checkPlausibility` (T1-Teil 4, Muster wie `normalize-gate.test.ts` bzw.
 * `compare-gate.test.ts`): belegt die beiden konkreten §14-Kriterien anhand der SHARED,
 * benannten Tarif-Fixtures aus `./tariffs.ts` statt Ad-hoc-Zahlen (die sitzen in
 * `../plausibility/plausibility.test.ts`).
 *
 *  - „Die Plausibilitäts-Automatik fängt einen als Energiepreis eingetragenen Gesamtpreis
 *    (~28 ct) ab und warnt gezielt."
 *  - „Die Rechnungs-Rückrechnung erkennt eine widersprüchliche Extraktion."
 */
describe('T1 fixture gate — checkPlausibility against named tariff/grid-cost fixtures', () => {
  it('§14-DoD: ~28 ct entered as energy price triggers a targeted stage-2 warning', () => {
    const input: UserTariffInput = {
      annualConsumptionKwh: HOUSEHOLD_CONSUMPTION_KWH,
      energyPriceCtPerKwh: 28, // §14-DoD-Wortlaut: "~28 ct"
      baseFeeEurPerYear: noBonusNoGuaranteeTariff.baseFeeEurPerYear,
      postalCode: '1010',
    }

    const warnings = checkPlausibility(input)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ stage: 2, field: 'energyPriceCtPerKwh' })
    expect(warnings[0]!.message).toContain('Gesamtpreis')
  })

  it('stage 3 against a real fixture: a mistyped energy price is caught against the hinterlegten Tabellenpreis', () => {
    const input: UserTariffInput = {
      annualConsumptionKwh: HOUSEHOLD_CONSUMPTION_KWH,
      energyPriceCtPerKwh: 19.5, // Abweichung zu bonusGuaranteeTariff (22,5 ct): 3 ct > 2 ct Toleranz
      baseFeeEurPerYear: bonusGuaranteeTariff.baseFeeEurPerYear,
      postalCode: '1010',
    }

    const warnings = checkPlausibility(input, bonusGuaranteeTariff)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ stage: 3, field: 'energyPriceCtPerKwh' })
    expect(warnings[0]!.message).toContain('Sonnenstrom Direkt')
    expect(warnings[0]!.message).toContain('22.5')
  })

  it('§14-DoD: invoice reconciliation catches a contradictory extraction even though the energy price alone looks plausible', () => {
    // Ist-Tarif spiegelt noBonusNoGuaranteeTariff (24,9 ct/kWh, 110 €/Jahr) — für sich genommen
    // ein PLAUSIBLER Energiepreis, weder Stufe 1 noch Stufe 2 würde hier anschlagen.
    const input: UserTariffInput = {
      annualConsumptionKwh: HOUSEHOLD_CONSUMPTION_KWH,
      energyPriceCtPerKwh: noBonusNoGuaranteeTariff.energyPriceCtPerKwh,
      baseFeeEurPerYear: noBonusNoGuaranteeTariff.baseFeeEurPerYear,
      postalCode: '1010',
    }

    // Handrechnung: expected = 0,249 × 3500 + 110 + 60 + 0,08 × 3500
    //                        = 871,5 + 110 + 60 + 280 = 1321,5
    const consistent = checkPlausibility(input, undefined, 1321.5, SAMPLE_GRID_COST_ESTIMATE)
    expect(consistent).toEqual([])

    // |1321,5 − 1000| / 1000 = 0,3215 > 0,10 Toleranz — dieselben plausiblen Grunddaten, aber ein
    // Rechnungsbetrag, der nicht dazu passt: die Extraktion ist widersprüchlich.
    const contradictory = checkPlausibility(input, undefined, 1000, SAMPLE_GRID_COST_ESTIMATE)
    expect(contradictory).toHaveLength(1)
    expect(contradictory[0]).toMatchObject({ stage: 4, field: 'energyPriceCtPerKwh' })
    expect(contradictory[0]!.message).toContain('1322') // expected.toFixed(0) von 1321,5
  })
})
