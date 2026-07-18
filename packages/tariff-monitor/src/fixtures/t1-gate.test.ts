import { describe, expect, it } from 'vitest'

import { compareTariffs } from '../compare/compare'
import { checkPlausibility } from '../plausibility/plausibility'
import type { ComparisonPreferences, TariffCostObject, UserTariffInput } from '../types'
import {
  HOUSEHOLD_CANDIDATES,
  HOUSEHOLD_CURRENT_DETAILED,
  HOUSEHOLD_CURRENT_ROUGH,
  SMALL_BUSINESS_CANDIDATES,
  SMALL_BUSINESS_CURRENT_DETAILED,
  SMALL_BUSINESS_CURRENT_ROUGH,
} from './scenarios'

/**
 * T1-Gate (§14-DoD, T1-Teil 5/5) — der INTEGRIERTE Überbau über `compareTariffs` UND
 * `checkPlausibility` GEMEINSAM, Muster wie `engine/src/fixtures/m1-gate.test.ts`: die
 * bestehenden Einzel-Gates (`normalize-gate.test.ts`/`compare-gate.test.ts`/
 * `plausibility-gate.test.ts`) testen je EINE Funktion isoliert und BLEIBEN bestehen — dieses
 * Gate fährt zwei realistische End-to-End-Szenarien (`./scenarios.ts`) durch die volle öffentliche
 * Oberfläche und beweist die §14-DoD-Kriterien, die T1 betreffen, im Zusammenhang.
 *
 * `checkPlausibility` ist NICHT in `compareTariffs` verdrahtet (`plausibility.warnings` bleibt
 * `[]`, s. T1-Teil 4) — "gemeinsam" heißt hier: beide öffentlichen Funktionen laufen im selben
 * Szenario, nicht dass eine Funktion die andere aufruft.
 */

describe('T1-Gate DoD-1 — Normalisierung + Bonus-Trennung: Headline-Ehrlichkeit (§1.3)', () => {
  it('HAUSHALT: current + jede Alternative auf Jahreskosten normalisiert; Bonus-Kandidat weicht in savingFirstYear sichtbar vom (bonusfreien) savingOngoing ab', () => {
    const result = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES)

    expect(result.current.ongoingYearlyCostEur).toBeCloseTo(981.5, 6)

    const sparStrom = result.alternatives.find((a) => a.tariff.tariffName === 'SparStrom Bonus')!
    expect(sparStrom.cost.ongoingYearlyCostEur).toBeCloseTo(856.5, 6)
    expect(sparStrom.cost.firstYearCostEur).toBeCloseTo(736.5, 6)
    expect(sparStrom.savingOngoingEurPerYear).toBeCloseTo(125, 6)
    expect(sparStrom.savingFirstYearEur).toBeCloseTo(245, 6)
    // Headline (ongoing) ignoriert den Bonus vollständig — die Abweichung zu savingFirstYear ist
    // EXAKT der Bonusbetrag des Kandidaten, kein Rundungsartefakt.
    expect(sparStrom.savingFirstYearEur - sparStrom.savingOngoingEurPerYear).toBeCloseTo(
      sparStrom.tariff.bonusEur,
      6,
    )

    // Ein bonusfreier Kandidat: savingOngoing == savingFirstYear exakt (keine Abweichung).
    const blitz = result.alternatives.find((a) => a.tariff.tariffName === 'Blitz Prepaid')!
    expect(blitz.tariff.bonusEur).toBe(0)
    expect(blitz.savingOngoingEurPerYear).toBeCloseTo(blitz.savingFirstYearEur, 6)
  })
})

describe('T1-Gate DoD-2 — Plausibilität fängt den als Energiepreis eingetragenen Gesamtpreis ab (§5.3)', () => {
  it('HAUSHALT: ~28 ct (Gesamtpreis statt Energiepreis) löst eine gezielte Stufe-2-Warnung aus; der korrekte Energiepreis (24,9 ct) bleibt sauber', () => {
    const wrongInput: UserTariffInput = { ...HOUSEHOLD_CURRENT_DETAILED, energyPriceCtPerKwh: 28 }
    const wrongWarnings = checkPlausibility(wrongInput)
    expect(wrongWarnings).toHaveLength(1)
    expect(wrongWarnings[0]).toMatchObject({ stage: 2, field: 'energyPriceCtPerKwh' })
    expect(wrongWarnings[0]!.message).toContain('Gesamtpreis')

    // Kein `matchedTariff`/`invoiceTotalEur` übergeben → Stufe 3/4 bleiben still (DI-Schaltung).
    const correctWarnings = checkPlausibility(HOUSEHOLD_CURRENT_DETAILED)
    expect(correctWarnings).toEqual([])
  })
})

describe('T1-Gate DoD-3 — kein Abo-Wissen: Feld-Tiefe ist nur ein Label, kein Rechenzweig (§3)', () => {
  it('HAUSHALT: grob vs. detailliert → identische savingOngoing-Rangfolge UND identische Empfehlung, nur confidence kippt rough→detailed', () => {
    const rough = compareTariffs(HOUSEHOLD_CURRENT_ROUGH, HOUSEHOLD_CANDIDATES)
    const detailed = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES)

    expect(rough.confidence).toBe('rough')
    expect(detailed.confidence).toBe('detailed')

    const roughSavings = rough.alternatives.map((a) => [a.tariff.tariffName, a.savingOngoingEurPerYear])
    const detailedSavings = detailed.alternatives.map((a) => [a.tariff.tariffName, a.savingOngoingEurPerYear])
    expect(roughSavings).toEqual(detailedSavings)

    expect(rough.recommendation?.tariff.tariffName).toBe('Blitz Prepaid')
    expect(detailed.recommendation?.tariff.tariffName).toBe('Blitz Prepaid')
  })

  it('KLEINBETRIEB: grob vs. detailliert → identische savingOngoing-Rangfolge UND identische Empfehlung, nur confidence kippt rough→detailed', () => {
    const rough = compareTariffs(SMALL_BUSINESS_CURRENT_ROUGH, SMALL_BUSINESS_CANDIDATES)
    const detailed = compareTariffs(SMALL_BUSINESS_CURRENT_DETAILED, SMALL_BUSINESS_CANDIDATES)

    expect(rough.confidence).toBe('rough')
    expect(detailed.confidence).toBe('detailed')

    const roughSavings = rough.alternatives.map((a) => [a.tariff.tariffName, a.savingOngoingEurPerYear])
    const detailedSavings = detailed.alternatives.map((a) => [a.tariff.tariffName, a.savingOngoingEurPerYear])
    expect(roughSavings).toEqual(detailedSavings)

    expect(rough.recommendation?.tariff.tariffName).toBe('Blitz Gewerbe Prepaid')
    expect(detailed.recommendation?.tariff.tariffName).toBe('Blitz Gewerbe Prepaid')
  })
})

describe('T1-Gate DoD-4 — Empfehlung ist ehrlich: nie ein Verlust-Wechsel, Präferenzen verschieben sie nachweisbar (§9)', () => {
  it('HAUSHALT: ohne excludePrepayment ist der billigste (Vorauskasse-)Kandidat die Empfehlung; MIT excludePrepayment rückt sie auf den nächstbesten prepaymentfreien Kandidaten', () => {
    const withoutFilter = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES)
    expect(withoutFilter.recommendation?.tariff.tariffName).toBe('Blitz Prepaid')
    expect(withoutFilter.recommendation?.tariff.requiresPrepayment).toBe(true)

    const withFilter = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES, {
      excludePrepayment: true,
    })
    expect(withFilter.recommendation?.tariff.tariffName).toBe('SparStrom Bonus')
    expect(withFilter.recommendation?.tariff.requiresPrepayment).toBeUndefined()
  })

  it('HAUSHALT: greenEnergyOnly verschiebt die Empfehlung von Blitz Prepaid auf Öko Vorkasse (analoger Präferenz-Fall)', () => {
    const withoutFilter = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES)
    expect(withoutFilter.recommendation?.tariff.tariffName).toBe('Blitz Prepaid')

    const withFilter = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES, {
      greenEnergyOnly: true,
    })
    expect(withFilter.recommendation?.tariff.tariffName).toBe('Öko Vorkasse')
    expect(withFilter.recommendation?.tariff.greenEnergy).toBe(true)
  })

  it('KLEINBETRIEB: ohne excludePrepayment ist der billigste (Vorauskasse-)Kandidat die Empfehlung; MIT excludePrepayment rückt sie auf den nächstbesten prepaymentfreien Kandidaten', () => {
    const withoutFilter = compareTariffs(SMALL_BUSINESS_CURRENT_DETAILED, SMALL_BUSINESS_CANDIDATES)
    expect(withoutFilter.recommendation?.tariff.tariffName).toBe('Blitz Gewerbe Prepaid')
    expect(withoutFilter.recommendation?.tariff.requiresPrepayment).toBe(true)

    const withFilter = compareTariffs(SMALL_BUSINESS_CURRENT_DETAILED, SMALL_BUSINESS_CANDIDATES, {
      excludePrepayment: true,
    })
    expect(withFilter.recommendation?.tariff.tariffName).toBe('Gewerbe Spar Bonus')
    expect(withFilter.recommendation?.tariff.requiresPrepayment).toBeUndefined()
  })

  it('KLEINBETRIEB: greenEnergyOnly verschiebt die Empfehlung von Blitz Gewerbe Prepaid auf Öko Gewerbe Vorkasse (analoger Präferenz-Fall)', () => {
    const withFilter = compareTariffs(SMALL_BUSINESS_CURRENT_DETAILED, SMALL_BUSINESS_CANDIDATES, {
      greenEnergyOnly: true,
    })
    expect(withFilter.recommendation?.tariff.tariffName).toBe('Öko Gewerbe Vorkasse')
    expect(withFilter.recommendation?.tariff.greenEnergy).toBe(true)
  })

  it('über beide Szenarien und alle Präferenz-Kombinationen: eine erzeugte Empfehlung hat IMMER savingOngoingEurPerYear > 0', () => {
    const scenarios: Array<[UserTariffInput, TariffCostObject[]]> = [
      [HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES],
      [SMALL_BUSINESS_CURRENT_DETAILED, SMALL_BUSINESS_CANDIDATES],
    ]
    const preferenceSets: Array<ComparisonPreferences | undefined> = [
      undefined,
      { excludePrepayment: true },
      { greenEnergyOnly: true },
    ]

    let recommendationCount = 0
    for (const [current, candidates] of scenarios) {
      for (const preferences of preferenceSets) {
        const result = compareTariffs(current, candidates, preferences)
        if (!result.recommendation) continue
        recommendationCount++
        const matched = result.alternatives.find((a) => a.tariff === result.recommendation!.tariff)!
        expect(matched.savingOngoingEurPerYear).toBeGreaterThan(0)
      }
    }
    // Sanity: die Schleife hat tatsächlich Empfehlungen geprüft, kein leerer Durchlauf.
    expect(recommendationCount).toBe(6)
  })
})

describe('T1-Gate DoD-5 — Determinismus + Vollständigkeit', () => {
  it('alternatives.length == candidates.length in beiden Szenarien (keine stille Vorfilterung)', () => {
    expect(compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES).alternatives).toHaveLength(
      HOUSEHOLD_CANDIDATES.length,
    )
    expect(
      compareTariffs(SMALL_BUSINESS_CURRENT_DETAILED, SMALL_BUSINESS_CANDIDATES).alternatives,
    ).toHaveLength(SMALL_BUSINESS_CANDIDATES.length)
  })

  it('zweifacher Aufruf mit identischen Argumenten liefert ein identisches Ergebnis (Determinismus)', () => {
    const first = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES, {
      excludePrepayment: true,
    })
    const second = compareTariffs(HOUSEHOLD_CURRENT_DETAILED, HOUSEHOLD_CANDIDATES, {
      excludePrepayment: true,
    })
    expect(second).toEqual(first)

    const firstPlausibility = checkPlausibility(HOUSEHOLD_CURRENT_DETAILED)
    const secondPlausibility = checkPlausibility(HOUSEHOLD_CURRENT_DETAILED)
    expect(secondPlausibility).toEqual(firstPlausibility)
  })
})
