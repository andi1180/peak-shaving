import { buildLevySchedule, type LoadProfile, type TariffPricingInputs } from 'shared'
import { describe, expect, it } from 'vitest'

import { usageLevyFactor } from './usage-levy'

/** Ein Messwert je Tag um 12:00 UTC, `days` Tage ab `fromUtc`. */
function daily(fromUtc: string, days: number): LoadProfile {
  return {
    readings: Array.from({ length: days }, (_, i) => ({
      ts: new Date(Date.parse(fromUtc) + i * 86_400_000).toISOString(),
      gridPowerKw: 1,
    })),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

const wien = (from: string, to: string): TariffPricingInputs => ({
  gridTariffRows: null,
  spotPrices: null,
  levies: buildLevySchedule('wiener_netze', 7, from, to, 'mit_leistungsmessung', { category: 'gewerbe' }),
})

describe('usageLevyFactor — Gebrauchsabgabe auf den Leistungspreis', () => {
  it('Kalenderjahr 2026 in Wien: 59 Tage 6 %, 306 Tage 7 %, tagesgewichtet', () => {
    const factor = usageLevyFactor(daily('2026-01-01T12:00:00Z', 365), wien('2026-01-01', '2026-12-31'))
    expect(factor).toBeCloseTo((59 * 1.06 + 306 * 1.07) / 365, 12)
  })

  it('ohne Abgabensätze bleibt der Leistungspreis unverändert (Faktor 1)', () => {
    expect(usageLevyFactor(daily('2026-01-01T12:00:00Z', 30), undefined)).toBe(1)
  })
})
