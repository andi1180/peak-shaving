import { describe, expect, it } from 'vitest'

import {
  MAX_PEAK_SHAVING_POINTS,
  peakShavingChartCaption,
  peakShavingChartData,
} from './peak-shaving-chart'
import type { PdfReportAnalysis } from './types'
import type { WaysChapter } from './ways'

const WITH_WAY_5 = { statements: [{ id: 'ways_peak_shaving' }] } as unknown as WaysChapter
const WITHOUT_WAY_5 = { statements: [{ id: 'ways_today' }] } as unknown as WaysChapter

/** Nur die Felder, die `primaryEntryOf` und die Ableitung lesen. */
function analysisWithCaps(capKwByPeriod: number[]): PdfReportAnalysis {
  return {
    perBattery: [{ battery: { id: 'b' }, dispatchTrace: { capKwByPeriod, caughtPeaks: [], representativeDays: [] } }],
    recommendation: { batteryId: 'b' },
    assumptions: { billingModel: 'monthly_max_sum' },
  } as unknown as PdfReportAnalysis
}

const profile = (readings: Array<[string, number]>) => ({
  readings: readings.map(([ts, gridPowerKw]) => ({ ts, gridPowerKw })),
  timezoneMeta: 'Europe/Vienna',
})

// Schwellen: März 40 kW, April 30 kW, Mai 0 (belegt, aber ohne Schwelle), Juni unendlich, Juli nicht belegt.
const CAPS = [0, 0, 40, 30, 0, Infinity, 25, 0, 0, 0, 0, 0]

describe('peakShavingChartData', () => {
  it('setzt Punkte nur über der Schwelle des eigenen Ortszeit-Monats', () => {
    const data = peakShavingChartData(
      analysisWithCaps(CAPS),
      profile([
        ['2026-03-15T10:00:00.000Z', 45], // März, über 40
        ['2026-03-15T10:15:00.000Z', 35], // März, unter 40
        // 01.04. 00:00 Ortszeit (CEST) = 31.03. 22:00 UTC — zählt zum April (Schwelle 30)
        ['2026-03-31T22:00:00.000Z', 35],
        ['2026-04-10T10:00:00.000Z', 29], // April, unter 30
        ['2026-05-10T10:00:00.000Z', 99], // Mai: Schwelle 0 → kein Punkt
        ['2026-06-10T10:00:00.000Z', 99], // Juni: Schwelle unendlich → kein Punkt
      ]),
      WITH_WAY_5,
    )!

    expect(data.points.map((p) => [p.ts, p.capKw])).toEqual([
      ['2026-03-15T10:00:00.000Z', 40],
      ['2026-03-31T22:00:00.000Z', 30],
    ])
    expect(data.totalPoints).toBe(2)
    // Juli trägt 25 kW, hat aber keinen Messwert — keine Schwelle, keine Linie.
    expect(data.capKwByPeriod.slice(2, 7)).toEqual([40, 30, Infinity, Infinity, Infinity])
    expect(data.capSegments.map((s) => s.capKw)).toEqual([40, 30])
  })

  it('entsteht nur mit Weg 5 und mindestens einer Schwelle > 0', () => {
    const readings = profile([['2026-03-15T10:00:00.000Z', 45]])
    expect(peakShavingChartData(analysisWithCaps(CAPS), readings, WITHOUT_WAY_5)).toBeNull()
    expect(peakShavingChartData(analysisWithCaps(CAPS), readings, null)).toBeNull()
    expect(peakShavingChartData(analysisWithCaps(new Array(12).fill(0)), readings, WITH_WAY_5)).toBeNull()
  })

  it('begrenzt auf die höchsten Punkte und sagt das in der Bildunterschrift', () => {
    const readings: Array<[string, number]> = []
    for (let i = 0; i < MAX_PEAK_SHAVING_POINTS + 10; i++) {
      readings.push([new Date(Date.UTC(2026, 2, 2) + i * 900_000).toISOString(), 41 + i / 1000])
    }
    const data = peakShavingChartData(analysisWithCaps(CAPS), profile(readings), WITH_WAY_5)!

    expect(data.totalPoints).toBe(MAX_PEAK_SHAVING_POINTS + 10)
    expect(data.points).toHaveLength(MAX_PEAK_SHAVING_POINTS)
    expect(Math.min(...data.points.map((p) => p.kw))).toBeCloseTo(41.01)
    const n = (value: number) => new Intl.NumberFormat('de-AT').format(value)
    expect(peakShavingChartCaption(data)).toContain(
      `${n(1510)} Viertelstunden liegen über der Schwelle. Gezeichnet sind die ${n(1500)} höchsten.`,
    )
  })
})
