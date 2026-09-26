import { describe, expect, it, vi } from 'vitest'

/**
 * Die Spotpreis-Abfrage des öffentlichen Rechners gegen einen Stub, der die Filter WIRKLICH
 * anwendet. Zwilling der Randstunden-Tests in `apps/web/lib/admin/analysis-tariff-inputs.test.ts`.
 */

const HOUR_MS = 3_600_000
let table: Record<string, unknown>[] = []

/** Stundenpreise 2025-12-31 22:00 bis 2026-01-01 06:00 UTC, optional ohne eine Stunde. */
function fillTable(skipHourIso?: string) {
  const startMs = Date.parse('2025-12-31T22:00:00.000Z')
  table = Array.from({ length: 8 }, (_, i) => ({
    provider: 'awattar_at',
    ts_start: new Date(startMs + i * HOUR_MS).toISOString(),
    ts_end: new Date(startMs + (i + 1) * HOUR_MS).toISOString(),
    ct_per_kwh: '9.5',
    price_basis: 'net',
  })).filter((row) => row.ts_start !== skipHourIso)
}

const time = (value: unknown) => Date.parse(String(value))

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  createTariffDataClient: () => ({
    from: () => {
      const filters: ((row: Record<string, unknown>) => boolean)[] = []
      let range: [number, number] = [0, Infinity]
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        gt: (c: string, v: unknown) => (filters.push((r) => time(r[c]) > time(v)), builder),
        gte: (c: string, v: unknown) => (filters.push((r) => time(r[c]) >= time(v)), builder),
        lt: (c: string, v: unknown) => (filters.push((r) => time(r[c]) < time(v)), builder),
        range: (from: number, to: number) => ((range = [from, to]), builder),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: table.filter((r) => filters.every((f) => f(r))).slice(range[0], range[1] + 1),
            error: null,
          }).then(resolve),
      }
      return builder
    },
  }),
}))

const { analysisWindowToPriceRange, fetchSpotPrices } = await import('./spot-prices')

async function fetchFor(startIso: string, endIso: string) {
  const range = analysisWindowToPriceRange({ startIso, endIso }, 15)
  const result = await fetchSpotPrices(range.from, range.to)
  if (!result.ok) throw new Error(result.message)
  return result
}

describe('fetchSpotPrices — angebrochene Randstunden', () => {
  it.each([
    ['Beginn :15 — die angebrochene erste Stunde fehlt nicht', '2026-01-01T00:15:00.000Z', '2026-01-01T02:30:00.000Z'],
    ['Ende :45 — die angebrochene letzte Stunde ist dabei', '2026-01-01T00:00:00.000Z', '2026-01-01T02:30:00.000Z'],
    ['Beginn zur vollen Stunde — die Stunde davor bleibt draussen', '2026-01-01T00:00:00.000Z', '2026-01-01T02:45:00.000Z'],
  ])('%s', async (_, startIso, endIso) => {
    fillTable()
    const result = await fetchFor(startIso, endIso)

    expect(result.prices.map((price) => price.tsStart)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
      '2026-01-01T02:00:00.000Z',
    ])
    expect(result.complete).toBe(true)
    expect(result.missingRanges).toEqual([])
  })

  it('eine echte fehlende Stunde in der Mitte bleibt eine benannte Lücke', async () => {
    fillTable('2026-01-01T01:00:00.000Z')
    const result = await fetchFor('2026-01-01T00:15:00.000Z', '2026-01-01T02:30:00.000Z')

    expect(result.complete).toBe(false)
    expect(result.missingRanges).toEqual([
      { fromIso: '2026-01-01T01:00:00.000Z', toIso: '2026-01-01T02:00:00.000Z' },
    ])
  })
})
