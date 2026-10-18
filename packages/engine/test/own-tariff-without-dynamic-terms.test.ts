import { readFileSync } from 'node:fs'
import type { BatteryCandidate, TariffParams, TariffPricingInputs } from 'shared'
import { describe, expect, it } from 'vitest'

import { combinedIntervalPrices, computeAnalysis, parseLoadProfile, simulateBattery } from '../src'
import { energyCostEur } from '../src/simulation/energy-cost'
import { drawSeries, intervalHours } from '../src/simulation/helpers'

/*
 * Fehlen nur die Konditionen des dynamischen Tarifs, bewertet die Engine mit der vollen Preisreihe
 * des eigenen Tarifs. Eingaben: Bäckerei-Golden (synthetischer Lastgang, Tarif von Hand).
 */

const DIR = new URL('./golden/baeckerei/', import.meta.url)
const readJson = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T

const parsed = parseLoadProfile({
  content: readFileSync(new URL('lastgang.csv', DIR), 'utf8'),
  fileName: 'lastgang.csv',
  format: 'csv',
})
if (!parsed.ok) throw new Error('Lastgang der Bäckerei ist nicht lesbar')
const profile = parsed.profile
const { tariff } = readJson<{ tariff: TariffParams }>('tariff.json')
const withTerms = readJson<TariffPricingInputs>('tariff-pricing.json')
const withoutTerms: TariffPricingInputs = { ...withTerms, dynamicTariff: null }
const kostal = readJson<BatteryCandidate[]>('battery-catalog.json').find((b) =>
  b.id.startsWith('6845c64d'),
)!

const run = (pricing: TariffPricingInputs) =>
  computeAnalysis(
    {
      tariff,
      pv: null,
      tariffPricing: pricing,
      load: { fileName: 'lastgang.csv', profile, dataQuality: parsed.dataQuality },
    },
    10,
    [kostal],
  ).perBattery[0]!

describe('Ohne Konditionen des dynamischen Tarifs: eigene volle Preisreihe', () => {
  it('Energie-Anteil gleich der Bewertung mit eigener Preisreihe; Kappung unverändert', () => {
    const own = combinedIntervalPrices(profile, withoutTerms, 9.5)
    if ('blocker' in own) throw new Error('eigene Preisreihe nicht rechenbar')

    const without = run(withoutTerms)
    const sim = simulateBattery(profile, kostal, tariff, undefined, withoutTerms)
    const prices = { drawCtPerKwh: own.prices, feedInCtPerKwh: 0, deltaHours: intervalHours(profile) }
    const expected =
      energyCostEur(drawSeries(profile), prices).totalEur -
      energyCostEur(sim.dispatch.gridAfterKw, prices).totalEur

    expect(without.energySavingBasis).toBe('own_tariff_full_price')
    // 2025 ist die eigene Reihe flach (ein Netzfenster, ein Abgabensatz): ohne Spreizung bleiben
    // nur die Ladeverluste, jetzt zum vollen statt zum Arbeitspreis bewertet.
    expect(without.energySavingOverCoveredPeriod).toBeLessThan(0)
    expect(without.energySavingOverCoveredPeriod).toBeCloseTo(expected, 9)

    const withT = run(withTerms)
    expect(withT.energySavingBasis).toBe('full_price')
    expect(without.leistungspreisSavingPerYear).toBeCloseTo(withT.leistungspreisSavingPerYear, 9)
    expect(without.newBilledKw).toBeCloseTo(withT.newBilledKw, 9)
  })

  it('Positivkontrolle: Netzentgelt-Lücke gewinnt → Arbeitspreis-Rückfall wie bisher', () => {
    const gap: TariffPricingInputs = {
      ...withoutTerms,
      gridTariffRows: withoutTerms.gridTariffRows!.filter((r) => r.validFrom !== '2025-01-01'),
    }
    const entry = run(gap)
    expect(entry.energySavingBasis).toBe('energy_price_only')
    const result = computeAnalysis(
      {
        tariff,
        pv: null,
        tariffPricing: gap,
        load: { fileName: 'lastgang.csv', profile, dataQuality: parsed.dataQuality },
      },
      10,
      [kostal],
    )
    expect(result.tariffOptimization).toMatchObject({ computable: false, side: 'grid_tariff', kind: 'gap' })
  })
})
