import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { utcMsToLocalFields, zonedWallToUtcMs } from './datetime'
import { parseLoadProfile } from './parse'
import { prepareSeries } from './prepare'
import { ZERO_DAY_FILLED_WARNING_PREFIX } from './zero-days'

const TZ = 'Europe/Vienna'
const STEP = 15 * 60 * 1000

/** 15-min-Reihe ab lokaler Mitternacht von `startDate` über `days` Ortszeit-Tage; `kw(dayIndex, slotMs)`. */
function series(startDate: string, days: number, kw: (day: number, ms: number) => number) {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number]
  const start = zonedWallToUtcMs(y, m, d, 0, 0, 0, TZ)
  const end = zonedWallToUtcMs(y, m, d + days, 0, 0, 0, TZ)
  const readings = []
  for (let ms = start; ms < end; ms += STEP) {
    const f = utcMsToLocalFields(ms, TZ)
    const day = Math.round(
      (Date.UTC(f.year, f.month - 1, f.day) - Date.UTC(y, m - 1, d)) / 86_400_000,
    )
    readings.push({ ms, value: kw(day, ms) })
  }
  return readings
}

const dateOf = (ms: number) => {
  const f = utcMsToLocalFields(ms, TZ)
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`
}
const wallOf = (ms: number) => {
  const f = utcMsToLocalFields(ms, TZ)
  return `${f.hour}:${f.minute}`
}
/** Werte eines Ortszeit-Tags, in Reihenfolge. */
const dayValues = (slots: { ms: number; value: number }[], date: string) =>
  slots.filter((s) => dateOf(s.ms) === date)
/** Unterscheidbarer, nie 0: Tag und Uhrzeit stecken im Wert. */
const signal = (day: number, ms: number) =>
  day + 1 + (utcMsToLocalFields(ms, TZ).hour * 4 + utcMsToLocalFields(ms, TZ).minute / 15) / 1000

describe('prepareSeries — ganztägig 0 als Datenlücke', () => {
  it('Nulltag am Mittwoch → Mittwoch der Vorwoche, Warnung „ergänzt aus Vorwoche"', () => {
    // 05.01.2026 ist ein Montag; Tag 9 = Mittwoch 14.01., Vorwoche = 07.01.
    const prepared = prepareSeries(
      series('2026-01-05', 21, (day, ms) => (day === 9 ? 0 : signal(day, ms))),
      8,
      TZ,
    )
    expect(dayValues(prepared.slots, '2026-01-14').map((s) => s.value)).toEqual(
      dayValues(prepared.slots, '2026-01-07').map((s) => s.value),
    )
    expect(prepared.zeroDays).toEqual([{ date: '2026-01-14', source: 'prev_week' }])
    expect(prepared.warnings).toContain(
      `${ZERO_DAY_FILLED_WARNING_PREFIX} 14.01.2026 (ergänzt aus Vorwoche).`,
    )
    expect(prepared.gapsInterpolated).toBe(96)
  })

  it('Vor- und Folgewoche ebenfalls Nulltag (oder außerhalb) → interpoliert; sonst Folgewoche', () => {
    // Mittwoche 07./14./21./28.01. sind Nulltage; nur 28.01. hat eine gemessene Nachbarwoche (04.02.).
    const zero = new Set([2, 9, 16, 23])
    const prepared = prepareSeries(
      series('2026-01-05', 35, (day, ms) => (zero.has(day) ? 0 : signal(day, ms))),
      8,
      TZ,
    )
    expect(prepared.zeroDays).toEqual([
      { date: '2026-01-07', source: 'interpolated' },
      { date: '2026-01-14', source: 'interpolated' },
      { date: '2026-01-21', source: 'interpolated' },
      { date: '2026-01-28', source: 'next_week' },
    ])
    const interpolated = dayValues(prepared.slots, '2026-01-14').map((s) => s.value)
    expect(interpolated.every((v) => v > 0)).toBe(true)
    expect(dayValues(prepared.slots, '2026-01-28').map((s) => s.value)).toEqual(
      dayValues(prepared.slots, '2026-02-04').map((s) => s.value),
    )
  })

  it('Nulltag in der ersten Woche mit gemessener Folgewoche → Folgewoche', () => {
    const prepared = prepareSeries(
      series('2026-01-05', 14, (day, ms) => (day === 1 ? 0 : signal(day, ms))),
      8,
      TZ,
    )
    expect(prepared.zeroDays).toEqual([{ date: '2026-01-06', source: 'next_week' }])
    expect(dayValues(prepared.slots, '2026-01-06').map((s) => s.value)).toEqual(
      dayValues(prepared.slots, '2026-01-13').map((s) => s.value),
    )
  })

  it('95 Nullslots + 1 Wert > 0 bleiben unverändert, keine Warnung; ohne Zeitzone (PV) keine Erkennung', () => {
    let slot = 0
    const readings = series('2026-01-05', 14, (day, ms) => {
      if (day !== 3) return signal(day, ms)
      return slot++ === 50 ? 0.4 : 0
    })
    const prepared = prepareSeries(readings, 8, TZ)
    expect(prepared.zeroDays).toEqual([])
    expect(prepared.slots.map((s) => s.value)).toEqual(readings.map((r) => r.value))
    expect(prepared.warnings.some((w) => w.startsWith(ZERO_DAY_FILLED_WARNING_PREFIX))).toBe(false)

    const zeroDay = series('2026-01-05', 14, (day, ms) => (day === 9 ? 0 : signal(day, ms)))
    expect(prepareSeries(zeroDay, 8).zeroDays).toEqual([])
    expect(prepareSeries(zeroDay, 8).slots.map((s) => s.value)).toEqual(zeroDay.map((r) => r.value))
  })

  it('Sommerzeit-Tag (92 Slots) und Winterzeit-Tag (100 Slots) erkannt und nach Ortszeit gefüllt', () => {
    // 29.03.2026 und 26.10.2025 sind Sonntage; Vorwoche jeweils 7 Tage davor.
    const spring = prepareSeries(
      series('2026-03-16', 21, (day, ms) => (dateOf(ms) === '2026-03-29' ? 0 : signal(day, ms))),
      8,
      TZ,
    )
    const target = dayValues(spring.slots, '2026-03-29')
    const source = new Map(
      dayValues(spring.slots, '2026-03-22').map((s) => [wallOf(s.ms), s.value]),
    )
    expect(target).toHaveLength(92)
    expect(spring.zeroDays).toEqual([{ date: '2026-03-29', source: 'prev_week' }])
    for (const s of target) expect(s.value).toBe(source.get(wallOf(s.ms)))

    const autumn = prepareSeries(
      series('2025-10-13', 21, (day, ms) => (dateOf(ms) === '2025-10-26' ? 0 : signal(day, ms))),
      8,
      TZ,
    )
    const fall = dayValues(autumn.slots, '2025-10-26')
    const fallSource = new Map(
      dayValues(autumn.slots, '2025-10-19').map((s) => [wallOf(s.ms), s.value]),
    )
    expect(fall).toHaveLength(100)
    expect(autumn.zeroDays).toEqual([{ date: '2025-10-26', source: 'prev_week' }])
    expect(fall.every((s) => s.value > 0)).toBe(true)
    // Erste 02:00 aus der Vorwoche, die Winterzeit-Wiederholung interpoliert.
    expect(fall.find((s) => wallOf(s.ms) === '2:0')!.value).toBe(fallSource.get('2:0'))
    expect(fall.find((s) => wallOf(s.ms) === '4:0')!.value).toBe(fallSource.get('4:0'))
  })

  it('net_signed-Lastgang mit Nulltag → ebenso gefüllt, Warnung in dataQuality', () => {
    const readings = series('2026-01-05', 14, (day, ms) =>
      day === 9 ? 0 : day % 2 === 0 ? -signal(day, ms) : signal(day, ms),
    )
    const rows = readings.map(({ ms, value }) => {
      const f = utcMsToLocalFields(ms, TZ)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${f.year}-${p(f.month)}-${p(f.day)}T${p(f.hour)}:${p(f.minute)},${value}`
    })
    const out = parseLoadProfile({ content: ['Zeit,Last (kW)', ...rows].join('\n'), format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('net_signed')
    expect(out.dataQuality.warnings).toContain(
      `${ZERO_DAY_FILLED_WARNING_PREFIX} 14.01.2026 (ergänzt aus Vorwoche).`,
    )
    const filled = out.profile.readings.filter((r) => dateOf(Date.parse(r.ts)) === '2026-01-14')
    const prev = out.profile.readings.filter((r) => dateOf(Date.parse(r.ts)) === '2026-01-07')
    expect(filled.map((r) => r.gridPowerKw)).toEqual(prev.map((r) => r.gridPowerKw))
  })

  it.each([
    ['Bäckerei (Engine-Golden)', '../../test/golden/baeckerei/lastgang.csv'],
    [
      'privat-bestand-pv-wien (Wizard-Golden)',
      '../../../extractors/test/golden/privat-bestand-pv-wien/lastgang.csv',
    ],
    [
      'gewerbe-ohne-rechnung-wien (Report-Fixture)',
      '../../../../apps/website/test/report-snapshots/fixtures/gewerbe-ohne-rechnung-wien/lastgang.csv',
    ],
  ])('AT-Referenzlastgang %s: 0 erkannte Nulltage', (_name, path) => {
    const content = readFileSync(new URL(path, import.meta.url), 'utf8')
    const out = parseLoadProfile({ content, format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(
      out.dataQuality.warnings.filter((w) => w.startsWith(ZERO_DAY_FILLED_WARNING_PREFIX)),
    ).toEqual([])
  })
})
