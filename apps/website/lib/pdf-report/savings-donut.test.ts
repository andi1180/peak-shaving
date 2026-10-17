import { describe, expect, it } from 'vitest'
import { formatEur } from '@/lib/format'

import {
  buildSavingsDonut,
  largestRemainderPercents,
  savingsDonutNegativeText,
} from './savings-donut'

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

  it('Anteil 0 € entfällt still; Kappung 0 → zwei Segmente; unter 3 % nur Legende', () => {
    const noControl = buildSavingsDonut({ switchEur: 8025, controlEur: 0, peakEur: 1160 })!
    expect(noControl.segments.map((s) => s.key)).toEqual(['switch', 'peak'])
    expect(noControl.negatives).toEqual([])

    const two = buildSavingsDonut({ switchEur: 800, controlEur: 200, peakEur: 0 })!
    expect(two.segments.map((s) => [s.key, s.percent])).toEqual([
      ['switch', 80],
      ['control', 20],
    ])
    expect(two.caption).not.toContain('Obergrenze')

    const small = buildSavingsDonut({ switchEur: 9500, controlEur: 400, peakEur: 100 })!
    expect(small.segments.map((s) => s.labelInChart)).toEqual([true, true, false])
  })

  it('D1: alle Anteile positiv → bit-identisch zum Stand vor den negativen Anteilen', () => {
    // Erwartung mit dem alten Code erzeugt (vor fix/negative-savings-shares).
    expect(buildSavingsDonut({ switchEur: 8025, controlEur: 965, peakEur: 1160 })).toEqual({
      title: 'So setzt sich Ihre Ersparnis zusammen',
      totalEur: 10150,
      segments: [
        { key: 'switch', label: 'Tarifwechsel', eur: 8025, percent: 79, labelInChart: true },
        { key: 'control', label: 'Ladesteuerung', eur: 965, percent: 10, labelInChart: true },
        {
          key: 'peak',
          label: 'Spitzenkappung (Obergrenze)',
          eur: 1160,
          percent: 11,
          labelInChart: true,
        },
      ],
      negatives: [],
      storageEur: 2125,
      storagePercent: 21,
      caption: 'Davon durch den Speicher: €\u00a02.125 (21 %). Spitzenkappung ist eine Obergrenze.',
    })
  })

  it('D2: Tarifwechsel negativ → Hinweis, Prozente über die positiven, Mitte netto', () => {
    const donut = buildSavingsDonut({ switchEur: -107, controlEur: 1572, peakEur: 175 })!
    expect(donut.segments.map((s) => [s.key, s.eur, s.percent])).toEqual([
      ['control', 1572, 90],
      ['peak', 175, 10],
    ])
    expect(donut.totalEur).toBe(1640)
    expect(donut.storageEur).toBe(1747)
    expect(donut.storagePercent).toBe(100)
    expect(donut.negatives).toEqual([{ key: 'switch', label: 'Tarifwechsel', eur: -107 }])
    // Dieselbe Schreibweise wie jeder andere negative Betrag im Report.
    expect(savingsDonutNegativeText('Tarifwechsel', -107)).toBe(
      `Tarifwechsel allein: ${formatEur(-107)} pro Jahr, in der Gesamtzahl berücksichtigt.`,
    )
  })

  it('D3: negative Stufenkorrektur der Kappung → Hinweis, Mitte netto', () => {
    const donut = buildSavingsDonut({ switchEur: 300, controlEur: 500, peakEur: -80 })!
    expect(donut.segments.map((s) => s.key)).toEqual(['switch', 'control'])
    expect(donut.negatives).toEqual([
      { key: 'peak', label: 'Spitzenkappung (Obergrenze)', eur: -80 },
    ])
    expect(donut.totalEur).toBe(720)
    expect(donut.caption).not.toContain('Obergrenze')
  })

  it('D4: kein Anteil > 0 € → kein Ring', () => {
    expect(buildSavingsDonut({ switchEur: -40, controlEur: 0, peakEur: -5 })).toBeNull()
    expect(buildSavingsDonut({ switchEur: 0, controlEur: 0, peakEur: 0 })).toBeNull()
  })
})
