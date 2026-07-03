import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import { peakDistribution, positiveAnnualPeakKw, positiveMonthlyPeaksKw, topPeaksKw } from './metrics'

function isoUtc(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
}

function loadProfile(
  readings: Array<{ ts: string; gridPowerKw: number }>,
  timezoneMeta = 'UTC',
): LoadProfile {
  return { readings, intervalMinutes: 15, timezoneMeta, source: 'net_signed' }
}

describe('positiveAnnualPeakKw', () => {
  it('ignoriert Einspeisung (negativ) und Nullwerte — nur der positive Anteil zählt (§3.4)', () => {
    const lp = loadProfile([
      { ts: isoUtc(2023, 1, 1), gridPowerKw: -50 },
      { ts: isoUtc(2023, 1, 2), gridPowerKw: 0 },
      { ts: isoUtc(2023, 1, 3), gridPowerKw: 12.5 },
    ])
    expect(positiveAnnualPeakKw(lp)).toBe(12.5)
  })

  it('0 bei leerem oder rein einspeisendem Profil', () => {
    expect(positiveAnnualPeakKw(loadProfile([]))).toBe(0)
    expect(positiveAnnualPeakKw(loadProfile([{ ts: isoUtc(2023, 1, 1), gridPowerKw: -10 }]))).toBe(0)
  })
})

describe('positiveMonthlyPeaksKw', () => {
  it('liefert 12 Werte, Index 0 = Jänner', () => {
    const lp = loadProfile([
      { ts: isoUtc(2023, 1, 10), gridPowerKw: 10 },
      { ts: isoUtc(2023, 1, 20), gridPowerKw: 30 },
      { ts: isoUtc(2023, 12, 5), gridPowerKw: 99 },
    ])
    const peaks = positiveMonthlyPeaksKw(lp)
    expect(peaks).toHaveLength(12)
    expect(peaks[0]).toBe(30) // Jänner-Höchstwert
    expect(peaks[11]).toBe(99) // Dezember
    expect(peaks.slice(1, 11)).toEqual(new Array(10).fill(0))
  })

  it('gruppiert nach LOKALER Zeit, nicht UTC (Monatsgrenze Europe/Vienna)', () => {
    // 31. Jan 23:30 UTC = 1. Feb 00:30 lokal (Vienna, Winter UTC+1) → gehört zu Februar.
    const lp = loadProfile([{ ts: '2023-01-31T23:30:00.000Z', gridPowerKw: 42 }], 'Europe/Vienna')
    const peaks = positiveMonthlyPeaksKw(lp)
    expect(peaks[0]).toBe(0) // Jänner
    expect(peaks[1]).toBe(42) // Februar
  })
})

describe('topPeaksKw', () => {
  it('sortiert absteigend, filtert Einspeisung/Nullwerte, respektiert n', () => {
    const lp = loadProfile([
      { ts: isoUtc(2023, 1, 1), gridPowerKw: 10 },
      { ts: isoUtc(2023, 1, 2), gridPowerKw: -99 },
      { ts: isoUtc(2023, 1, 3), gridPowerKw: 50 },
      { ts: isoUtc(2023, 1, 4), gridPowerKw: 30 },
    ])
    expect(topPeaksKw(lp, 2)).toEqual([
      { ts: isoUtc(2023, 1, 3), kw: 50 },
      { ts: isoUtc(2023, 1, 4), kw: 30 },
    ])
  })

  it('Default n=10 [ANNAHME, §3.4 im Pflichtenheft nicht beziffert]', () => {
    const readings = Array.from({ length: 15 }, (_, i) => ({
      ts: isoUtc(2023, 1, i + 1),
      gridPowerKw: i + 1,
    }))
    expect(topPeaksKw(loadProfile(readings))).toHaveLength(10)
  })
})

describe('peakDistribution', () => {
  it('je Bucket der MAXIMALE Bezug (kW) — nicht Anzahl oder Summe [ANNAHME, §3.4]', () => {
    const lp = loadProfile([
      { ts: isoUtc(2023, 1, 2, 8, 0), gridPowerKw: 10 }, // Montag, 08:00, Jänner
      { ts: isoUtc(2023, 1, 9, 8, 0), gridPowerKw: 40 }, // Montag, 08:00, Jänner (höher)
      { ts: isoUtc(2023, 1, 2, 18, 0), gridPowerKw: 5 }, // Montag, 18:00
    ])
    const dist = peakDistribution(lp)
    expect(dist.byWeekday[0]).toBe(40) // Montag = Index 0
    expect(dist.byHour[8]).toBe(40)
    expect(dist.byHour[18]).toBe(5)
    expect(dist.byMonth[0]).toBe(40) // Jänner
  })
})
