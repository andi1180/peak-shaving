import { describe, expect, it, vi } from 'vitest'
import type { SpotPricePointInput, SpotPriceSeriesInput } from 'shared'

import {
  resolveGapMarketPrices,
  type MarketPriceWindowEntry,
} from './gap-market-prices'

/**
 * D6 Teil 2a. In KEINEM Fall wird ein Schreib-Port gereicht — es gibt keinen: die Funktion nimmt
 * ausschliesslich die zwei Leser entgegen (s. ihre Signatur), `spot_prices` bleibt unberührt.
 */

const FROM = '2025-09-01T00:00:00.000Z'
const MID = '2025-09-02T00:00:00.000Z'
const TO = '2025-09-03T00:00:00.000Z'

/** Stundenpreise ab `fromIso`, alle mit demselben Wert. */
function hourly(fromIso: string, hours: number, ctPerKwh: number): SpotPricePointInput[] {
  const startMs = Date.parse(fromIso)
  return Array.from({ length: hours }, (_, i) => ({
    tsStart: new Date(startMs + i * 3_600_000).toISOString(),
    tsEnd: new Date(startMs + (i + 1) * 3_600_000).toISOString(),
    ctPerKwh,
    priceBasis: 'net',
  }))
}

/** Was aWATTar liefern würde: Epoch-Millisekunden, EUR/MWh. */
function awattar(fromIso: string, hours: number, eurPerMwh: number): MarketPriceWindowEntry[] {
  const startMs = Date.parse(fromIso)
  return Array.from({ length: hours }, (_, i) => ({
    start_timestamp: startMs + i * 3_600_000,
    end_timestamp: startMs + (i + 1) * 3_600_000,
    marketprice: eurPerMwh,
    unit: 'Eur/MWh',
  }))
}

function stored(prices: SpotPricePointInput[], missing: { fromIso: string; toIso: string }[] = []): SpotPriceSeriesInput {
  return { prices, complete: missing.length === 0, missingRanges: missing }
}

describe('resolveGapMarketPrices', () => {
  it('rührt die Nachlade-Quelle nicht an, wenn der Bestand vollständig ist', async () => {
    const fetchMarketWindow = vi.fn(async () => [] as MarketPriceWindowEntry[])

    const result = await resolveGapMarketPrices({
      fromIso: FROM,
      toIso: TO,
      readSpotPrices: async () => stored(hourly(FROM, 48, 10)),
      fetchMarketWindow,
    })

    expect(fetchMarketWindow).toHaveBeenCalledTimes(0)
    expect(result.complete).toBe(true)
    expect(result.prices).toHaveLength(48)
    expect(result.hoursByOrigin).toEqual({ database: 48, fetched: 0, assumed: 0 })
    expect(result.coverage).toEqual([
      { origin: 'database', fromIso: FROM, toIso: TO, hours: 48 },
    ])
  })

  it('lädt genau die gemeldete Lücke nach und rechnet EUR/MWh in ct/kWh um', async () => {
    const fetchMarketWindow = vi.fn(async () => awattar(MID, 24, 177.97))

    const result = await resolveGapMarketPrices({
      fromIso: FROM,
      toIso: TO,
      readSpotPrices: async () => stored(hourly(FROM, 24, 10), [{ fromIso: MID, toIso: TO }]),
      fetchMarketWindow,
    })

    expect(fetchMarketWindow).toHaveBeenCalledTimes(1)
    expect(fetchMarketWindow).toHaveBeenCalledWith(Date.parse(MID), Date.parse(TO))
    expect(result.complete).toBe(true)
    expect(result.missingRanges).toEqual([])
    expect(result.prices).toHaveLength(48)
    expect(result.prices[24]).toEqual({
      tsStart: MID,
      tsEnd: '2025-09-02T01:00:00.000Z',
      ctPerKwh: 17.797,
      priceBasis: 'net',
    })
    expect(result.hoursByOrigin).toEqual({ database: 24, fetched: 24, assumed: 0 })
    expect(result.coverage).toEqual([
      { origin: 'database', fromIso: FROM, toIso: MID, hours: 24 },
      { origin: 'fetched', fromIso: MID, toIso: TO, hours: 24 },
    ])
  })

  it('nähert eine nicht nachladbare Lücke mit dem Schnitt des nächstgelegenen Monats — sichtbar', async () => {
    const fetchMarketWindow = vi.fn(async () => [] as MarketPriceWindowEntry[])

    const result = await resolveGapMarketPrices({
      fromIso: FROM,
      toIso: TO,
      // 12 h zu 8 ct, 12 h zu 12 ct → Septemberschnitt 10 ct.
      readSpotPrices: async () =>
        stored([...hourly(FROM, 12, 8), ...hourly('2025-09-01T12:00:00.000Z', 12, 12)], [
          { fromIso: MID, toIso: TO },
        ]),
      fetchMarketWindow,
    })

    expect(fetchMarketWindow).toHaveBeenCalledTimes(1)
    expect(result.complete).toBe(true)
    expect(result.prices).toHaveLength(48)
    expect(result.prices[24]).toEqual({
      tsStart: MID,
      tsEnd: '2025-09-02T01:00:00.000Z',
      ctPerKwh: 10,
      priceBasis: 'net',
    })
    expect(result.coverage[1]).toEqual({
      origin: 'assumed',
      fromIso: MID,
      toIso: TO,
      hours: 24,
      assumption: { year: 2025, month: 9, ctPerKwh: 10 },
    })
    expect(result.hoursByOrigin.assumed).toBe(24)
  })

  it('erfindet ohne jeden echten Preis nichts — die Lücke bleibt stehen', async () => {
    const result = await resolveGapMarketPrices({
      fromIso: FROM,
      toIso: TO,
      readSpotPrices: async () => stored([], [{ fromIso: FROM, toIso: TO }]),
      fetchMarketWindow: async () => {
        throw new Error('aWATTar antwortete mit HTTP 502.')
      },
    })

    expect(result.prices).toEqual([])
    expect(result.complete).toBe(false)
    expect(result.missingRanges).toEqual([{ fromIso: FROM, toIso: TO }])
    expect(result.hoursByOrigin).toEqual({ database: 0, fetched: 0, assumed: 0 })
  })
})
