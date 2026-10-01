import { describe, expect, it } from 'vitest'

import { buildSavingsDonut, largestRemainderPercents } from './savings-donut'

const plain = (value: string): string => value.replace(/\u00a0/g, ' ')

describe('Ringdiagramm „So setzt sich Ihre Ersparnis zusammen"', () => {
  it('Müldür: 79 / 10 / 11, Speicher 21 % = Summe der beiden Speicher-Segmente', () => {
    const donut = buildSavingsDonut({ switchEur: 8025, controlEur: 965, peakEur: 1160 })!
    expect(donut.segments.map((s) => s.percent)).toEqual([79, 10, 11])
    expect(donut.totalEur).toBe(10150)
    expect(donut.storageEur).toBe(2125)
    expect(donut.storagePercent).toBe(21)
    expect(plain(donut.caption)).toBe(
      'Davon durch den Speicher: € 2.125 (21 %). Spitzenkappung ist eine Obergrenze.',
    )
  })

  it('Rundungsfälle ergeben genau 100, wo einfaches Runden 99 oder 101 ergäbe', () => {
    // 50,5 / 25,5 / 24 → einfach gerundet 101; 33,3 × 3 → einfach gerundet 99.
    expect(largestRemainderPercents([505, 255, 240])).toEqual([51, 25, 24])
    expect(largestRemainderPercents([1, 1, 1])).toEqual([34, 33, 33])
    const donut = buildSavingsDonut({ switchEur: 505, controlEur: 255, peakEur: 240 })!
    expect(donut.segments.reduce((sum, s) => sum + s.percent, 0)).toBe(100)
    expect(donut.storagePercent).toBe(49)
  })

  it('kein Ring bei einem Anteil ≤ 0 €; Kappung 0 → zwei Segmente; unter 3 % nur Legende', () => {
    expect(buildSavingsDonut({ switchEur: -40, controlEur: 965, peakEur: 1160 })).toBeNull()
    expect(buildSavingsDonut({ switchEur: 8025, controlEur: 0, peakEur: 1160 })).toBeNull()

    const two = buildSavingsDonut({ switchEur: 800, controlEur: 200, peakEur: 0 })!
    expect(two.segments.map((s) => [s.key, s.percent])).toEqual([
      ['switch', 80],
      ['control', 20],
    ])
    expect(two.caption).not.toContain('Obergrenze')

    const small = buildSavingsDonut({ switchEur: 9500, controlEur: 400, peakEur: 100 })!
    expect(small.segments.map((s) => s.labelInChart)).toEqual([true, true, false])
  })
})
