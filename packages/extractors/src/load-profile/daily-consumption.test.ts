import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseLoadProfile } from 'engine'
import { wienerNetzeLastgangCsv } from 'shared/fixtures'

import { readDailyConsumption } from './daily-consumption'

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

describe('readDailyConsumption', () => {
  it('die Tagessummen ergeben exakt den Netzbezug des bestehenden Parsers', () => {
    const csv = wienerNetzeLastgangCsv()
    const parsed = parseLoadProfile({ content: csv, fileName: 'lastgang.csv', format: 'csv' })
    if (!parsed.ok) throw new Error('Fixture nicht lesbar')
    const total = parsed.profile.readings.reduce((s, r) => s + Math.max(0, r.gridPowerKw) * 0.25, 0)

    const outcome = readDailyConsumption(bytesOf(csv), 'lastgang.csv')
    if (!outcome.ok) throw new Error(outcome.reason)

    const sum = outcome.days.reduce((s, d) => s + d.importKwh, 0)
    expect(sum).toBeCloseTo(total, 9)
    expect(outcome.days.reduce((s, d) => s + d.intervals, 0)).toBe(parsed.profile.readings.length)
    // Erster Messwert nach 770 Platzhalterzeilen: 09.06. 00:30 UTC = 02:30 Wiener Ortszeit.
    expect(outcome.days[0]!.day).toBe('2025-06-09')
  })

  it('eine unlesbare Datei ergibt `unreadable` statt eines Wurfs', () => {
    expect(readDailyConsumption(bytesOf('kein;lastgang\n1;2'), 'x.csv')).toEqual({
      ok: false,
      reason: 'unreadable',
    })
  })
})
