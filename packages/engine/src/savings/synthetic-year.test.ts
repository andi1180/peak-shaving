import { describe, expect, it } from 'vitest'
import type { LoadProfile, LoadReading } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { buildSyntheticYearProfile } from './synthetic-year'

/**
 * D6 Teil 3 — der aus dem gemessenen Wochenblock gefüllte Jahres-Lastgang.
 *
 * Jeder Messwert kodiert seinen lokalen Tag und seine lokale Uhrzeit (`valueOf`): so lässt sich an
 * jedem gefüllten Wert ablesen, aus welchem Tag und welcher Uhrzeit er stammt.
 */

const TZ = 'Europe/Vienna'
const SLOT_MS = 15 * 60 * 1000

function localOf(ms: number) {
  const f = utcMsToLocalFields(ms, TZ)
  const date = `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`
  return { date, wallMinute: f.hour * 60 + f.minute, weekday: f.weekday }
}

/** Tag (Ordinalzahl seit 1970) × 10.000 + lokale Minute des Tages. */
function valueOf(date: string, wallMinute: number): number {
  return (Date.parse(`${date}T00:00:00Z`) / 86_400_000) * 10_000 + wallMinute
}

/** Viertelstundenreihe `[from, to)` in UTC, ohne die Tage in `skip`. */
function profile(
  fromIso: string,
  toIso: string,
  skip: ReadonlySet<string> = new Set(),
): LoadProfile {
  const readings: LoadReading[] = []
  for (let ms = Date.parse(fromIso); ms < Date.parse(toIso); ms += SLOT_MS) {
    const { date, wallMinute } = localOf(ms)
    if (skip.has(date)) continue
    readings.push({ ts: new Date(ms).toISOString(), gridPowerKw: valueOf(date, wallMinute) })
  }
  return { readings, intervalMinutes: 15, timezoneMeta: TZ, source: 'import_only' }
}

const bounds = (latestDate: string) => ({ earliestDate: '2025-01-01', latestDate })

/** Müldür-Konstellation: Messung 28.03.–31.08.2026 Ortszeit. */
const MUELDUER = profile('2026-03-27T23:00:00Z', '2026-08-31T22:00:00Z')

function dateOf(value: number): string {
  return new Date(Math.floor(value / 10_000) * 86_400_000).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

describe('buildSyntheticYearProfile', () => {
  it('Müldür: Block 30.03.–30.08., jeder gefüllte Tag = Quelltag d + 154·k, gleicher Wochentag, gleiche Werte', () => {
    const out = buildSyntheticYearProfile(MUELDUER, bounds('2026-08-31'))
    if (!out.ok) throw new Error(`unerwartet abgelehnt: ${out.blocker}`)
    const year = out.value

    expect(year.windowFromDate).toBe('2025-09-01')
    expect(year.windowToDate).toBe('2026-08-31')
    expect(year.block).toEqual({ fromDate: '2026-03-30', toDate: '2026-08-30', weeks: 22 })
    expect(year.measuredDays).toBe(157)
    expect(year.projectedDays).toBe(365 - 157)

    const measured = new Set(MUELDUER.readings.map((r) => localOf(Date.parse(r.ts)).date))
    const filledDates = new Set<string>()
    for (const reading of year.profile.readings) {
      const { date, wallMinute, weekday } = localOf(Date.parse(reading.ts))
      if (measured.has(date)) continue
      filledDates.add(date)
      /* Der Quelltag steht im Wert selbst — sein Wochentag muss dem Zieltag gleichen. */
      const copiedFrom = dateOf(reading.gridPowerKw)
      expect(localOf(Date.parse(`${copiedFrom}T12:00:00Z`)).weekday).toBe(weekday)
      let k = 1
      while (addDays(date, 154 * k) < year.block.fromDate) k++
      expect(addDays(date, 154 * k) <= year.block.toDate).toBe(true)
      expect(reading.gridPowerKw).toBe(valueOf(addDays(date, 154 * k), wallMinute))
    }
    expect(filledDates.size).toBe(208)

    /* Gemessene Tage ausserhalb des Blocks bleiben unverändert. */
    const kept = year.profile.readings.filter(
      (r) => localOf(Date.parse(r.ts)).date === '2026-03-28',
    )
    expect(kept).toEqual(
      MUELDUER.readings.filter((r) => localOf(Date.parse(r.ts)).date === '2026-03-28'),
    )
  })

  it('Zeitumstellung: gefüllte Umstellungstage nach lokaler Uhrzeit, ohne Lücke oder Überlappung', () => {
    const out = buildSyntheticYearProfile(MUELDUER, bounds('2026-08-31'))
    if (!out.ok) throw new Error(`unerwartet abgelehnt: ${out.blocker}`)
    const day = (date: string) =>
      out.value.profile.readings.filter((r) => localOf(Date.parse(r.ts)).date === date)

    /* 26.10.2025 (100 Viertelstunden): 02:00–02:59 zweimal, beide Male der 02:xx-Wert der Quelle. */
    const october = day('2025-10-26')
    expect(october).toHaveLength(100)
    expect(october.map((r) => r.gridPowerKw % 10_000)).toEqual(
      october.map((r) => localOf(Date.parse(r.ts)).wallMinute),
    )

    /* Gefüllter 29.03.2026 aus einer Messung ab 06.04.: 92 Viertelstunden, 03:00 bekommt 03:00. */
    const spring = buildSyntheticYearProfile(
      profile('2026-04-05T22:00:00Z', '2026-08-30T22:00:00Z'),
      bounds('2026-08-30'),
    )
    if (!spring.ok) throw new Error(`unerwartet abgelehnt: ${spring.blocker}`)
    const march = spring.value.profile.readings.filter(
      (r) => localOf(Date.parse(r.ts)).date === '2026-03-29',
    )
    expect(march).toHaveLength(92)
    expect(march.map((r) => r.gridPowerKw % 10_000)).toEqual(
      march.map((r) => localOf(Date.parse(r.ts)).wallMinute),
    )

    const stamps = out.value.profile.readings.map((r) => r.ts)
    expect(new Set(stamps).size).toBe(stamps.length)
  })

  it('Block ist die längste lückenlose Wochenfolge; unter 4 Wochen kein Jahreslauf', () => {
    /* 02.03.–31.05.2026 ohne den 22.04.: 7 Wochen davor, 5 danach. */
    const gap = buildSyntheticYearProfile(
      profile('2026-03-01T23:00:00Z', '2026-05-31T22:00:00Z', new Set(['2026-04-22'])),
      bounds('2026-05-31'),
    )
    if (!gap.ok) throw new Error(`unerwartet abgelehnt: ${gap.blocker}`)
    expect(gap.value.block).toEqual({ fromDate: '2026-03-02', toDate: '2026-04-19', weeks: 7 })
    /* Der fehlende Tag liegt NACH dem Block: Quelle ist 22.04. − 49 Tage. */
    const filled = gap.value.profile.readings.find(
      (r) => localOf(Date.parse(r.ts)).date === '2026-04-22',
    )
    expect(filled?.gridPowerKw).toBe(valueOf('2026-03-04', 0))

    /* Drei volle Wochen (02.03.–22.03.) plus zwei Tage. */
    const short = buildSyntheticYearProfile(
      profile('2026-03-01T23:00:00Z', '2026-03-24T23:00:00Z'),
      bounds('2026-03-24'),
    )
    expect(short).toEqual({ ok: false, blocker: 'insufficient_data' })
  })

  it('lehnt einen Lastgang über ein volles Jahr ab — es gibt nichts hochzurechnen', () => {
    const full = profile('2024-12-31T23:00:00.000Z', '2025-12-31T23:00:00.000Z')
    expect(buildSyntheticYearProfile(full, bounds('2026-09-21'))).toEqual({
      ok: false,
      blocker: 'full_period',
    })
  })

  it('lehnt ab, statt gemessene Tage wegzuschneiden, wenn kein Fenster in die Grenzen passt', () => {
    const out = buildSyntheticYearProfile(MUELDUER, {
      earliestDate: '2025-10-01',
      latestDate: '2026-08-31',
    })
    expect(out).toEqual({ ok: false, blocker: 'no_window' })
  })
})
