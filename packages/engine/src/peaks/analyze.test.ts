import { describe, expect, it } from 'vitest'
import type { LoadProfile, TariffParams } from 'shared'

import { analyzeCurrentPeaks } from './analyze'

function isoUtc(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
}

function loadProfile(readings: Array<{ ts: string; gridPowerKw: number }>): LoadProfile {
  return { readings, intervalMinutes: 15, timezoneMeta: 'UTC', source: 'net_signed' }
}

function tariffParams(overrides: Partial<TariffParams> = {}): TariffParams {
  return {
    leistungspreisEurPerKwYear: 120,
    billingModel: 'annual_max',
    minBillableKw: 0,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 7,
    ...overrides,
  }
}

describe('analyzeCurrentPeaks (§3.4)', () => {
  it('leistungspreisCostPerYear = leistungspreisEurPerKwYear × billedKw', () => {
    const lp = loadProfile([
      { ts: isoUtc(2023, 3, 1), gridPowerKw: 40 },
      { ts: isoUtc(2023, 9, 1), gridPowerKw: 100 },
    ])
    const result = analyzeCurrentPeaks(lp, tariffParams({ leistungspreisEurPerKwYear: 120 }))
    expect(result.current.annualPeakKw).toBe(100)
    expect(result.current.billedKw).toBe(100)
    expect(result.current.leistungspreisCostPerYear).toBe(120 * 100)
  })

  it('billedKw folgt der gewählten billingModel-Strategie (§3.5), nicht pauschal dem Jahreshöchstwert', () => {
    const readings = Array.from({ length: 12 }, (_, i) => ({
      ts: isoUtc(2023, i + 1, 15),
      gridPowerKw: 20,
    }))
    readings.push({ ts: isoUtc(2023, 5, 10, 9, 0), gridPowerKw: 200 })
    const lp = loadProfile(readings)

    const annual = analyzeCurrentPeaks(lp, tariffParams({ billingModel: 'annual_max' }))
    const monthlyAvg = analyzeCurrentPeaks(lp, tariffParams({ billingModel: 'monthly_max_average' }))

    expect(annual.current.billedKw).toBe(200)
    expect(monthlyAvg.current.billedKw).toBeCloseTo(35, 6) // (11×20 + 200) / 12
    expect(annual.current.leistungspreisCostPerYear).toBeGreaterThan(
      monthlyAvg.current.leistungspreisCostPerYear,
    )
  })

  it('nur der positive Anteil von gridPowerKw zählt als Bezug', () => {
    const lp = loadProfile([
      { ts: isoUtc(2023, 6, 1), gridPowerKw: -500 }, // starke Einspeisung, zählt nicht
      { ts: isoUtc(2023, 6, 1, 0, 15), gridPowerKw: 25 },
    ])
    const result = analyzeCurrentPeaks(lp, tariffParams())
    expect(result.current.annualPeakKw).toBe(25)
    expect(result.peaks.top).toEqual([{ ts: isoUtc(2023, 6, 1, 0, 15), kw: 25 }])
  })

  it('Mindestleistung wirkt auch auf die Ist-Kosten: billedKw nie unter minBillableKw', () => {
    const lp = loadProfile([{ ts: isoUtc(2023, 4, 1), gridPowerKw: 5 }])
    const result = analyzeCurrentPeaks(lp, tariffParams({ minBillableKw: 50 }))
    expect(result.current.billedKw).toBe(50)
    expect(result.current.leistungspreisCostPerYear).toBe(120 * 50)
  })
})
