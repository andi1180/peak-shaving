import { describe, expect, it } from 'vitest'

import type { TariffCostObject, UserTariffInput } from '../types'
import {
  ENERGY_PRICE_MAX_CT,
  ENERGY_PRICE_MIN_CT,
  TOTAL_PRICE_SUSPECT_MAX_CT,
  TOTAL_PRICE_SUSPECT_MIN_CT,
} from './constants'
import { checkPlausibility } from './plausibility'

function userInput(overrides: Partial<UserTariffInput> = {}): UserTariffInput {
  return {
    annualConsumptionKwh: 3500,
    energyPriceCtPerKwh: 22.5,
    baseFeeEurPerYear: 96,
    postalCode: '1010',
    ...overrides,
  }
}

function tariff(overrides: Partial<TariffCostObject> = {}): TariffCostObject {
  return {
    providerName: 'Testversorger',
    tariffName: 'Test Strom Fix',
    energyPriceCtPerKwh: 22.5,
    baseFeeEurPerYear: 96,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: true,
    ...overrides,
  }
}

const GRID_COST_ESTIMATE = { baseFeeEur: 60, taxesCtPerKwh: 8 }

describe('checkPlausibility', () => {
  it('a clean, plausible input yields no warnings (invariant 1)', () => {
    // 22,5 ct/kWh: im Korridor (5–40), außerhalb des Verdachtsbands (25–35).
    expect(checkPlausibility(userInput())).toEqual([])
  })

  it('§14-DoD: a total price (~28 ct) entered as energy price triggers the stage-2 warning (invariant 2)', () => {
    const warnings = checkPlausibility(userInput({ energyPriceCtPerKwh: 28 }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ stage: 2, field: 'energyPriceCtPerKwh' })
    expect(warnings[0]!.message).toContain('Gesamtpreis')
  })

  it('stage 1 fires below the corridor', () => {
    const warnings = checkPlausibility(userInput({ energyPriceCtPerKwh: ENERGY_PRICE_MIN_CT - 0.5 }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.stage).toBe(1)
  })

  it('stage 1 fires above the corridor', () => {
    const warnings = checkPlausibility(userInput({ energyPriceCtPerKwh: 45 }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.stage).toBe(1)
  })

  it('the corridor boundaries themselves are still plausible (inclusive, no warning)', () => {
    expect(checkPlausibility(userInput({ energyPriceCtPerKwh: ENERGY_PRICE_MIN_CT }))).toEqual([])
    expect(checkPlausibility(userInput({ energyPriceCtPerKwh: ENERGY_PRICE_MAX_CT }))).toEqual([])
  })

  it('stage 2 fires inside the suspect band, inclusive of both boundaries', () => {
    expect(checkPlausibility(userInput({ energyPriceCtPerKwh: TOTAL_PRICE_SUSPECT_MIN_CT }))[0]!.stage).toBe(2)
    expect(checkPlausibility(userInput({ energyPriceCtPerKwh: TOTAL_PRICE_SUSPECT_MAX_CT }))[0]!.stage).toBe(2)
  })

  it('overlap: stage 1 and 2 fire independently, never deduplicated (invariant 6)', () => {
    // 33 ct: innerhalb des Korridors (nicht Stufe 1), innerhalb des Verdachtsbands (Stufe 2).
    expect(checkPlausibility(userInput({ energyPriceCtPerKwh: 33 })).map((w) => w.stage)).toEqual([2])

    // 45 ct: außerhalb des Korridors (Stufe 1), außerhalb des Verdachtsbands (nicht Stufe 2).
    expect(checkPlausibility(userInput({ energyPriceCtPerKwh: 45 })).map((w) => w.stage)).toEqual([1])

    // Mit den AKTUELLEN Default-Grenzwerten ist das Verdachtsband eine echte Teilmenge des
    // Korridors — ein Wert kann also nie gleichzeitig außerhalb [MIN,MAX] UND innerhalb
    // [SUSPECT_MIN,SUSPECT_MAX] liegen ("beide feuern" ist aktuell nicht konstruierbar). Das ist
    // eine Eigenschaft der KONSTANTEN (s. `checkRange`-Kommentar in `plausibility.ts`), nicht der
    // Prüf-Logik — hier als Regressionsanker für genau diese Annahme gepinnt. Ändert Martin
    // (§12 #4) die Grenzwerte so, dass sie sich überlappen, feuern Stufe 1 und 2 unverändert
    // gemeinsam (die beiden Checks fragen ihre Schwelle unabhängig ab, kein `else`).
    expect(TOTAL_PRICE_SUSPECT_MIN_CT).toBeGreaterThanOrEqual(ENERGY_PRICE_MIN_CT)
    expect(TOTAL_PRICE_SUSPECT_MAX_CT).toBeLessThanOrEqual(ENERGY_PRICE_MAX_CT)
  })

  it('stages 3 and 4 stay silent when their injected arguments are all missing — even for an extreme mismatch (invariant 3)', () => {
    const input = userInput({ energyPriceCtPerKwh: 22 }) // plausibel, kein Stufe 1/2

    // Ohne die Argumente bleibt es still — checkPlausibility weiß nichts von einem Mismatch,
    // wenn matchedTariff/invoiceTotalEur/gridCostEstimate gar nicht übergeben werden.
    expect(checkPlausibility(input)).toEqual([])

    // Gegenprobe mit DENSELBEN Grundzahlen, jetzt mit Argumenten: derselbe Mismatch feuert
    // tatsächlich Stufe 3 UND Stufe 4 — beweist, dass das Schweigen oben am fehlenden Argument
    // liegt, nicht an einem anderen Effekt.
    const withArgs = checkPlausibility(
      input,
      tariff({ energyPriceCtPerKwh: 35 }), // Abweichung 13 ct >> 2 ct Toleranz
      1000, // Rechnungsbetrag, weit weg vom rückgerechneten Erwartungswert
      GRID_COST_ESTIMATE,
    )
    expect(withArgs.some((w) => w.stage === 3)).toBe(true)
    expect(withArgs.some((w) => w.stage === 4)).toBe(true)
  })

  it('stage 3 in isolation: >2 ct deviation from the matched tariff fires, exactly 2 ct does not (invariant 4)', () => {
    const input = userInput({ energyPriceCtPerKwh: 22 }) // plausibel, kein Stufe 1/2

    const farOff = checkPlausibility(input, tariff({ energyPriceCtPerKwh: 19 })) // Abweichung 3 ct
    expect(farOff).toHaveLength(1)
    expect(farOff[0]).toMatchObject({ stage: 3, field: 'energyPriceCtPerKwh' })
    expect(farOff[0]!.message).toContain('19')

    const atTolerance = checkPlausibility(input, tariff({ energyPriceCtPerKwh: 20 })) // Abweichung exakt 2 ct
    expect(atTolerance).toEqual([])
  })

  it('stage 4 in isolation: a consistent reconstruction is silent, an inconsistent one warns (invariant 5, §14-DoD)', () => {
    // expected = 0,22 × 3500 + 90 + 60 + 0,08 × 3500 = 770 + 90 + 60 + 280 = 1200
    const input = userInput({ energyPriceCtPerKwh: 22, baseFeeEurPerYear: 90 })

    const consistent = checkPlausibility(input, undefined, 1200, GRID_COST_ESTIMATE)
    expect(consistent).toEqual([])

    // |1200 − 1000| / 1000 = 0,20 > 0,10 Toleranz
    const inconsistent = checkPlausibility(input, undefined, 1000, GRID_COST_ESTIMATE)
    expect(inconsistent).toHaveLength(1)
    expect(inconsistent[0]).toMatchObject({ stage: 4, field: 'energyPriceCtPerKwh' })
    expect(inconsistent[0]!.message).toContain('1200')
  })

  it('stage 4 needs BOTH invoiceTotalEur and gridCostEstimate — either alone stays silent', () => {
    const input = userInput({ energyPriceCtPerKwh: 22, baseFeeEurPerYear: 90 })

    expect(checkPlausibility(input, undefined, 1000, undefined)).toEqual([])
    expect(checkPlausibility(input, undefined, undefined, GRID_COST_ESTIMATE)).toEqual([])
  })

  it('warnings are ordered ascending by stage (invariant 7)', () => {
    const input = userInput({ energyPriceCtPerKwh: 45 }) // Stufe 1
    const warnings = checkPlausibility(
      input,
      tariff({ energyPriceCtPerKwh: 20 }), // Stufe 3 (Abweichung 25 ct)
      100, // Stufe 4 (Rechnungsbetrag weit weg vom Erwartungswert)
      GRID_COST_ESTIMATE,
    )
    const stages = warnings.map((w) => w.stage)
    expect(stages).toEqual([1, 3, 4])
    expect(stages).toEqual([...stages].sort((a, b) => a - b))
  })

  it('is deterministic — same input yields the same output (invariant 7)', () => {
    const input = userInput({ energyPriceCtPerKwh: 45 })
    const a = checkPlausibility(input, tariff({ energyPriceCtPerKwh: 20 }), 100, GRID_COST_ESTIMATE)
    const b = checkPlausibility(input, tariff({ energyPriceCtPerKwh: 20 }), 100, GRID_COST_ESTIMATE)
    expect(a).toEqual(b)
  })
})
