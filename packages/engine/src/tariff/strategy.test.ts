import { describe, expect, it } from 'vitest'
import type { LoadProfile, TariffParams } from 'shared'

import {
  annualMaxStrategy,
  getTariffStrategy,
  monthlyMaxAverageStrategy,
  monthlyMaxSumStrategy,
} from './strategy'

function isoUtc(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
}

function loadProfile(readings: Array<{ ts: string; gridPowerKw: number }>): LoadProfile {
  return { readings, intervalMinutes: 15, timezoneMeta: 'UTC', source: 'net_signed' }
}

function tariffParams(overrides: Partial<TariffParams> = {}): TariffParams {
  return {
    leistungspreisEurPerKwYear: 100,
    billingModel: 'annual_max',
    minBillableKw: 0,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 7,
    ...overrides,
  }
}

describe('annualMaxStrategy', () => {
  it('billedKw = Jahreshöchstwert des Bezugs (Einspeisung zählt nicht)', () => {
    const lp = loadProfile([
      { ts: isoUtc(2023, 1, 5), gridPowerKw: 30 },
      { ts: isoUtc(2023, 6, 10), gridPowerKw: 80 },
      { ts: isoUtc(2023, 6, 10, 12, 15), gridPowerKw: -20 },
    ])
    expect(annualMaxStrategy.billedKw(lp, tariffParams())).toBe(80)
  })
})

describe('monthlyMaxAverageStrategy', () => {
  it('billedKw = Mittelwert der 12 Monatshöchstwerte', () => {
    const readings = Array.from({ length: 12 }, (_, i) => ({
      ts: isoUtc(2023, i + 1, 15),
      gridPowerKw: 20,
    }))
    readings.push({ ts: isoUtc(2023, 3, 15, 14, 0), gridPowerKw: 200 }) // dominanter Peak im März
    const lp = loadProfile(readings)
    // Monatswerte: 11× 20 kW + 1× 200 kW = 420 / 12 = 35 kW
    expect(monthlyMaxAverageStrategy.billedKw(lp, tariffParams())).toBeCloseTo(35, 6)
  })
})

describe('monthlyMaxSumStrategy', () => {
  it('billedKw = Summe der 12 Monatshöchstwerte', () => {
    const readings = Array.from({ length: 12 }, (_, i) => ({
      ts: isoUtc(2023, i + 1, 15),
      gridPowerKw: 20,
    }))
    readings.push({ ts: isoUtc(2023, 3, 15, 14, 0), gridPowerKw: 200 })
    const lp = loadProfile(readings)
    expect(monthlyMaxSumStrategy.billedKw(lp, tariffParams())).toBe(420)
  })
})

describe('Mindestleistung (§3.5): billedKw = max(computed, minBillableKw) — IMMER zuletzt', () => {
  const lp = loadProfile([{ ts: isoUtc(2023, 4, 1), gridPowerKw: 5 }])
  const params = tariffParams({ minBillableKw: 50 })

  it('annual_max: 5 kW berechnet, 50 kW Sockel → 50 (eine perfekte Batterie unterschreitet den Sockel nicht)', () => {
    expect(annualMaxStrategy.billedKw(lp, params)).toBe(50)
  })
  it('monthly_max_average: dito → 50', () => {
    expect(monthlyMaxAverageStrategy.billedKw(lp, params)).toBe(50)
  })
  it('monthly_max_sum: dito → 50', () => {
    expect(monthlyMaxSumStrategy.billedKw(lp, params)).toBe(50)
  })
})

describe('Regressionstest (§3.5/§3.11) — Kern der Tarif-Korrektheits-These', () => {
  it('ein einzelner dominanter Jahres-Peak: annual_max billedKw >> monthly_max_average billedKw', () => {
    const readings = Array.from({ length: 12 }, (_, i) => ({
      ts: isoUtc(2023, i + 1, 15),
      gridPowerKw: 20, // Baseline-Bezug in jedem Monat
    }))
    readings.push({ ts: isoUtc(2023, 8, 20, 15, 0), gridPowerKw: 200 }) // ein dominanter Peak im August

    const lp = loadProfile(readings)
    const params = tariffParams()

    const annualMaxKw = getTariffStrategy('annual_max').billedKw(lp, params)
    const monthlyAvgKw = getTariffStrategy('monthly_max_average').billedKw(lp, params)

    console.log(
      `[§3.5 Regressionstest] annual_max billedKw=${annualMaxKw} kW · ` +
        `monthly_max_average billedKw=${monthlyAvgKw} kW`,
    )

    expect(annualMaxKw).toBe(200)
    expect(monthlyAvgKw).toBeCloseTo(35, 6) // (11×20 + 200) / 12 — die Spitze verdünnt sich auf ~1/12
    // Bestätigt die zentrale §3.5-These im Code: wer hier annual_max annimmt, verspricht ein
    // Vielfaches der unter monthly_max_average tatsächlich abgerechneten Wirkung.
    expect(annualMaxKw).toBeGreaterThan(monthlyAvgKw * 5)
  })
})
