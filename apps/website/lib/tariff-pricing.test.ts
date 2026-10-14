import { describe, expect, it, vi } from 'vitest'

import { AWATTAR_HOURLY_AT_DYNAMIC, type LoadProfile } from 'shared'

vi.mock('./tariff-data', () => ({
  analysisWindowToPriceRange: () => ({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T01:00:00.000Z' }),
  fetchGridTariffs: async () => ({ ok: true, tariffs: [] }),
  fetchSpotPrices: async () => ({ ok: true, prices: [], complete: true, missingRanges: [] }),
}))

const { loadTariffPricing } = await import('./tariff-pricing')

function profile(readings: number): LoadProfile {
  return {
    intervalMinutes: 15,
    timezoneMeta: { timezone: 'Europe/Vienna' },
    readings: Array.from({ length: readings }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 0, 1, 0, 15 * i)).toISOString(),
      kw: 1,
    })),
  } as unknown as LoadProfile
}

describe('loadTariffPricing — Konditionen des dynamischen Tarifs (öffentlicher Rechner, AT)', () => {
  it('setzt aWATTar HOURLY AT mit Beschaffungskomponente', async () => {
    const pricing = await loadTariffPricing(profile(8), 'wiener_netze', 7, null, 'gewerbe', null)
    expect(pricing.dynamicTariff).toEqual(AWATTAR_HOURLY_AT_DYNAMIC)
  })

  it('setzt sie auch ohne auswertbaren Zeitraum', async () => {
    const pricing = await loadTariffPricing(profile(0), null, null, null, 'heim', null)
    expect(pricing.dynamicTariff).toEqual(AWATTAR_HOURLY_AT_DYNAMIC)
  })
})
