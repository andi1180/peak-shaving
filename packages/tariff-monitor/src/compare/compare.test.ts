import { describe, expect, it } from 'vitest'

import type { TariffCostObject, UserTariffInput } from '../types'
import { compareTariffs } from './compare'

function userInput(overrides: Partial<UserTariffInput> = {}): UserTariffInput {
  return {
    annualConsumptionKwh: 4000,
    energyPriceCtPerKwh: 25,
    baseFeeEurPerYear: 100,
    postalCode: '1010',
    ...overrides,
  }
}

function tariff(overrides: Partial<TariffCostObject> = {}): TariffCostObject {
  return {
    providerName: 'Testversorger',
    tariffName: 'Test Strom Fix',
    energyPriceCtPerKwh: 24,
    baseFeeEurPerYear: 100,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: true,
    ...overrides,
  }
}

describe('compareTariffs', () => {
  it('savingOngoing is based on ongoing cost, never on firstYear (invariant 1)', () => {
    // current: 0.25*4000+100 = 1100 (kein Bonus, firstYear == ongoing)
    // candidate: 0.24*4000+100 = 1060, firstYear = 1060-200 = 860
    const result = compareTariffs(userInput(), [tariff({ bonusEur: 200 })])
    const [alt] = result.alternatives

    expect(alt!.savingOngoingEurPerYear).toBe(40) // 1100 - 1060
    expect(alt!.savingFirstYearEur).toBe(240) // 1100 - 860
    // Der Bonus lässt firstYear-Saving deutlich über ongoing-Saving steigen — die Headline
    // (ongoing) bleibt davon unberührt.
    expect(alt!.savingFirstYearEur).toBeGreaterThan(alt!.savingOngoingEurPerYear)
  })

  it('alternatives.length equals candidates.length and is sorted by savingOngoing descending (invariant 2)', () => {
    const candidates = [
      tariff({ providerName: 'A', energyPriceCtPerKwh: 26 }), // teurer als current
      tariff({ providerName: 'B', energyPriceCtPerKwh: 20 }), // deutlich günstiger
      tariff({ providerName: 'C', energyPriceCtPerKwh: 23 }), // etwas günstiger
    ]
    const result = compareTariffs(userInput(), candidates)

    expect(result.alternatives).toHaveLength(3)
    for (let i = 1; i < result.alternatives.length; i++) {
      expect(result.alternatives[i]!.savingOngoingEurPerYear).toBeLessThanOrEqual(
        result.alternatives[i - 1]!.savingOngoingEurPerYear,
      )
    }
    expect(result.alternatives.map((a) => a.tariff.providerName)).toEqual(['B', 'C', 'A'])
  })

  it('greenEnergyOnly excludes non-green candidates (invariant 3a)', () => {
    const result = compareTariffs(userInput(), [tariff({ greenEnergy: false })], { greenEnergyOnly: true })
    expect(result.alternatives[0]!.passesPreferenceFilter).toBe(false)
  })

  it('maxContractCommitmentMonths excludes candidates with longer commitment (invariant 3b)', () => {
    const result = compareTariffs(userInput(), [tariff({ contractCommitmentMonths: 24 })], {
      maxContractCommitmentMonths: 12,
    })
    expect(result.alternatives[0]!.passesPreferenceFilter).toBe(false)
  })

  it('excludePrepayment excludes candidates requiring prepayment/Kaution (invariant 3c)', () => {
    const result = compareTariffs(userInput(), [tariff({ requiresPrepayment: true })], {
      excludePrepayment: true,
    })
    expect(result.alternatives[0]!.passesPreferenceFilter).toBe(false)
  })

  it('a candidate missing requiresPrepayment is treated as "no" and passes excludePrepayment', () => {
    const result = compareTariffs(userInput(), [tariff()], { excludePrepayment: true })
    expect(result.alternatives[0]!.passesPreferenceFilter).toBe(true)
  })

  it('preferences are AND-combined — one failing dimension fails the whole candidate (invariant 3d)', () => {
    const candidate = tariff({ greenEnergy: true, contractCommitmentMonths: 6, requiresPrepayment: true })
    const result = compareTariffs(userInput(), [candidate], {
      greenEnergyOnly: true,
      maxContractCommitmentMonths: 12,
      excludePrepayment: true, // einzige verletzte Dimension
    })
    expect(result.alternatives[0]!.passesPreferenceFilter).toBe(false)
  })

  it('a candidate passing all preference dimensions passes the combined filter', () => {
    const candidate = tariff({ greenEnergy: true, contractCommitmentMonths: 6, requiresPrepayment: false })
    const result = compareTariffs(userInput(), [candidate], {
      greenEnergyOnly: true,
      maxContractCommitmentMonths: 12,
      excludePrepayment: true,
    })
    expect(result.alternatives[0]!.passesPreferenceFilter).toBe(true)
  })

  it('recommendation is the topmost candidate that both passes preferences and saves (invariant 4)', () => {
    const cheaperButNotGreen = tariff({
      providerName: 'BilligNichtGrün',
      energyPriceCtPerKwh: 15, // größte Ersparnis im Feld
      greenEnergy: false,
    })
    const greenerButLessSaving = tariff({
      providerName: 'GrünGünstiger',
      energyPriceCtPerKwh: 22, // kleinere, aber echte Ersparnis
      greenEnergy: true,
    })
    const result = compareTariffs(userInput(), [cheaperButNotGreen, greenerButLessSaving], {
      greenEnergyOnly: true,
    })

    // BilligNichtGrün liegt vorne im sortierten Array (höhere Ersparnis), fällt aber durch den
    // Filter — die Empfehlung überspringt es und geht an den nächsten passierenden Kandidaten.
    expect(result.alternatives[0]!.tariff.providerName).toBe('BilligNichtGrün')
    expect(result.alternatives[0]!.passesPreferenceFilter).toBe(false)
    expect(result.recommendation?.tariff.providerName).toBe('GrünGünstiger')
  })

  it('recommendation is undefined when every alternative is more expensive (invariant 4)', () => {
    const result = compareTariffs(userInput(), [
      tariff({ energyPriceCtPerKwh: 30 }),
      tariff({ energyPriceCtPerKwh: 40 }),
    ])
    expect(result.alternatives.every((a) => a.savingOngoingEurPerYear <= 0)).toBe(true)
    expect(result.recommendation).toBeUndefined()
  })

  it('recommendation is undefined when the only saving candidate fails the preference filter', () => {
    const result = compareTariffs(userInput(), [tariff({ energyPriceCtPerKwh: 15, greenEnergy: false })], {
      greenEnergyOnly: true,
    })
    expect(result.recommendation).toBeUndefined()
  })

  it('§3 core proof: field depth changes only the confidence label, never savingOngoing (invariant 5)', () => {
    const candidates = [
      tariff({ providerName: 'X', energyPriceCtPerKwh: 20, bonusEur: 50 }),
      tariff({ providerName: 'Y', energyPriceCtPerKwh: 23, bonusEur: 0 }),
    ]
    const roughInput = userInput() // keine Stufe-2-Felder
    // Stufe-2-Felder gesetzt, aber bonusEur wirkt NUR auf firstYear (§5.4) — ongoing bleibt gleich.
    const detailedInput = userInput({ bonusEur: 30, contractCommitmentMonths: 6 })

    const roughResult = compareTariffs(roughInput, candidates)
    const detailedResult = compareTariffs(detailedInput, candidates)

    expect(roughResult.confidence).toBe('rough')
    expect(detailedResult.confidence).toBe('detailed')

    expect(roughResult.alternatives.map((a) => a.tariff.providerName)).toEqual(
      detailedResult.alternatives.map((a) => a.tariff.providerName),
    )
    for (let i = 0; i < roughResult.alternatives.length; i++) {
      expect(detailedResult.alternatives[i]!.savingOngoingEurPerYear).toBe(
        roughResult.alternatives[i]!.savingOngoingEurPerYear,
      )
    }
    // savingFirstYear DARF sich unterscheiden (current.firstYear sinkt um den Bonus) —
    // nur die Headline (ongoing) ist unveränderlich. Konkreter Gegenbeweis, kein reines Fehlen:
    expect(detailedResult.alternatives[0]!.savingFirstYearEur).not.toBe(
      roughResult.alternatives[0]!.savingFirstYearEur,
    )
  })

  it('confidence boundary: only stage-1 fields yields "rough" (invariant 6)', () => {
    expect(compareTariffs(userInput(), [tariff()]).confidence).toBe('rough')
  })

  it('confidence boundary: bonusEur alone (without contractCommitmentMonths) stays "rough" (invariant 6)', () => {
    expect(compareTariffs(userInput({ bonusEur: 50 }), [tariff()]).confidence).toBe('rough')
  })

  it('confidence boundary: contractCommitmentMonths alone (without bonusEur) stays "rough" (invariant 6)', () => {
    expect(compareTariffs(userInput({ contractCommitmentMonths: 12 }), [tariff()]).confidence).toBe('rough')
  })

  it('confidence boundary: bonusEur AND contractCommitmentMonths together yields "detailed" (invariant 6)', () => {
    const input = userInput({ bonusEur: 0, contractCommitmentMonths: 0 }) // explizit 0 == gesetzt
    expect(compareTariffs(input, [tariff()]).confidence).toBe('detailed')
  })

  it('is deterministic — same input yields the same output (invariant 7)', () => {
    const input = userInput({ bonusEur: 20, contractCommitmentMonths: 6 })
    const candidates = [tariff({ providerName: 'A' }), tariff({ providerName: 'B', energyPriceCtPerKwh: 18 })]
    const preferences = { greenEnergyOnly: true }

    const a = compareTariffs(input, candidates, preferences)
    const b = compareTariffs(input, candidates, preferences)
    expect(a).toEqual(b)
  })
})
