import { AWATTAR_BASE_FEE, LEVIES_NONE } from 'shared'
import type { GridTariffRowInput, LoadProfile, TariffParams, TariffPricingInputs } from 'shared'
import { describe, expect, it } from 'vitest'

import { computeAnalysis, intervalTariffRates } from '../src'
import { buildMonthlyTariffComparison } from '../src/simulation/monthly-tariff-comparison'

/*
 * Konditionen des dynamischen Tarifs (Aufschlag + Grundgebühr) als optionales Pricing-Feld.
 * Synthetischer Lastgang: 15. und 16. Jänner 2025 (Europe/Vienna), konstant 4 kW = 1 kWh je Intervall,
 * Börsenpreis konstant 10 ct/kWh, Netz 6,98 ct + 0,70 ct Netzverlust, keine Abgaben.
 */

const STEP_MS = 15 * 60 * 1000
const START_UTC = '2025-01-14T23:00:00Z' // 15.01. 00:00 Ortszeit
const INTERVALS = 2 * 96

const load: LoadProfile = {
  readings: Array.from({ length: INTERVALS }, (_, i) => ({
    ts: new Date(Date.parse(START_UTC) + i * STEP_MS).toISOString(),
    gridPowerKw: 4,
  })),
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'import_only',
}

const row: GridTariffRowInput = {
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

const spotPrices = {
  prices: Array.from({ length: 48 }, (_, h) => ({
    tsStart: new Date(Date.parse(START_UTC) + h * 3_600_000).toISOString(),
    tsEnd: new Date(Date.parse(START_UTC) + (h + 1) * 3_600_000).toISOString(),
    ctPerKwh: 10,
    priceBasis: 'net' as const,
  })),
  complete: true,
  missingRanges: [],
}

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: null,
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

const base: TariffPricingInputs = { gridTariffRows: [row], spotPrices, levies: LEVIES_NONE }
const withoutFeld = () => buildMonthlyTariffComparison(load, tariff, base, undefined)!.spotWithoutControlEur[0]!

describe('Konditionen dynamischer Tarif', () => {
  it('DE ohne Konditionen (null) → Blocker "dynamic_tariff", Analyse läuft ohne Vergleich durch', () => {
    const pricing = { ...base, dynamicTariff: null }
    const result = computeAnalysis(
      {
        tariff,
        pv: null,
        tariffPricing: pricing,
        load: {
          fileName: 'synthetisch.csv',
          profile: load,
          dataQuality: { coveredDays: 2, coveredMonths: 1, gapsInterpolated: 0, largestGapSlots: 0, warnings: [] },
        },
      },
      10,
      [],
    )
    expect(result.tariffOptimization).toMatchObject({ computable: false, side: 'dynamic_tariff' })
    expect(result.monthlyComparison).toBeUndefined()
    // Ungültige Zahlen zählen wie fehlende.
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rates = intervalTariffRates(load, tariff, {
        ...base,
        dynamicTariff: { supplier: 'X', markupCtPerKwh: bad, baseFeeEurPerMonth: 1 },
      })
      expect(rates.tariffOptimization).toMatchObject({ computable: false, side: 'dynamic_tariff' })
    }
  })

  it('Aufschlag 1,5 ct und Grundgebühr 10 €/Monat → Handrechnung', () => {
    const pricing = { ...base, dynamicTariff: { supplier: 'X', markupCtPerKwh: 1.5, baseFeeEurPerMonth: 10 } }
    const cost = buildMonthlyTariffComparison(load, tariff, pricing, undefined)!.spotWithoutControlEur[0]!
    // 192 kWh × (10 + 1,5 + 6,98 + 0,70) ct = 192 × 19,18 ct, dazu 2 Tage × 10 € ÷ 31 Tage Jänner.
    expect(cost).toBeCloseTo((192 * 19.18) / 100 + (10 * 2) / 31, 9)
    // Ein Dispatch, eine Zahl: der Aufschlag steckt auch im Preis, nach dem der Fahrplan plant.
    expect(intervalTariffRates(load, tariff, pricing).rateCtPerKwh[0]).toBeCloseTo(19.18, 9)
  })

  it('Positivkontrolle: der Aufschlag verteuert um Σ kWh × 1,5 / 100, ohne Feld bleibt der AT-Weg', () => {
    const without = withoutFeld()
    expect(without).toBeCloseTo((192 * 17.68) / 100 + (AWATTAR_BASE_FEE.eurPerMonth * 2) / 31, 9)

    const pricing = { ...base, dynamicTariff: { supplier: 'X', markupCtPerKwh: 1.5, baseFeeEurPerMonth: AWATTAR_BASE_FEE.eurPerMonth } }
    const withMarkup = buildMonthlyTariffComparison(load, tariff, pricing, undefined)!.spotWithoutControlEur[0]!
    expect(withMarkup - without).toBeCloseTo((192 * 1.5) / 100, 9)
  })
})
