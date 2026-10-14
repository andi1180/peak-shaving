import { estimateAnnualConsumption } from 'engine'
import { LEVIES_NONE } from 'shared'
import type { LoadProfile, SpotPriceSeriesInput, TariffParams, TariffPricingInputs } from 'shared'
import { describe, expect, it, vi } from 'vitest'

vi.mock('engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('engine')>()
  return { ...actual, buildMonthlyTariffComparison: vi.fn(actual.buildMonthlyTariffComparison) }
})

const { buildMonthlyTariffComparison } = await import('engine')
const { projectAnnualTariffComparison } = await import('./annual-projection')

/** Die Konditionen des dynamischen Tarifs müssen in die Preis-Eingabe der Lücken-Tage mitreisen. */

const STEP_MS = 15 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: null,
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

const load: LoadProfile = {
  readings: Array.from({ length: 30 * 96 }, (_, i) => ({
    ts: new Date(Date.parse('2024-12-31T23:00:00Z') + i * STEP_MS).toISOString(),
    gridPowerKw: 10,
  })),
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'import_only',
}

function hourly(fromMs: number, toMs: number): SpotPriceSeriesInput {
  const prices = []
  for (let ms = fromMs; ms < toMs; ms += HOUR_MS) {
    prices.push({
      tsStart: new Date(ms).toISOString(),
      tsEnd: new Date(ms + HOUR_MS).toISOString(),
      ctPerKwh: 10,
      priceBasis: 'net' as const,
    })
  }
  return { prices, complete: true, missingRanges: [] }
}

const base: TariffPricingInputs = {
  gridTariffRows: [
    {
      validFrom: '2024-01-01',
      validUntil: null,
      netzverlustCtPerKwh: 0.7,
      priceBasis: 'net',
      windows: [
        { label: 'normal', monthDayFrom: null, monthDayTo: null, timeFrom: '00:00:00', timeTo: '24:00:00', ctPerKwh: 6.98 },
      ],
    },
  ],
  spotPrices: hourly(Date.parse('2024-12-31T23:00:00Z'), Date.parse('2025-01-30T23:00:00Z')),
  levies: LEVIES_NONE,
}

async function gapPricingOf(pricing: TariffPricingInputs): Promise<TariffPricingInputs> {
  const spy = vi.mocked(buildMonthlyTariffComparison)
  spy.mockClear()
  await projectAnnualTariffComparison({
    loadProfile: load,
    tariffParams: tariff,
    pricing,
    consumption: estimateAnnualConsumption(load),
    readSpotPrices: async (fromIso, toIso) => hourly(Date.parse(fromIso), Date.parse(toIso)),
    fetchMarketWindow: async () => [],
  })
  // Aufruf 1: der bekannte Zeitraum, Aufruf 2: die Lücken-Tage.
  return spy.mock.calls[1]![2]
}

describe('projectAnnualTariffComparison — dynamicTariff', () => {
  it('reicht die Konditionen an die Lücken-Tage weiter; ohne Feld bleibt der Schlüssel weg', async () => {
    const dynamicTariff = { supplier: 'X', markupCtPerKwh: 1.5, baseFeeEurPerMonth: 10 }
    expect((await gapPricingOf({ ...base, dynamicTariff })).dynamicTariff).toEqual(dynamicTariff)
    expect('dynamicTariff' in (await gapPricingOf(base))).toBe(false)
  })
})
