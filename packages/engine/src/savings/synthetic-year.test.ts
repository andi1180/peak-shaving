import { describe, expect, it } from 'vitest'
import type { LoadProfile, LoadReading } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { findReferenceWeek } from './reference-week'
import { buildSyntheticYearProfile } from './synthetic-year'

/** Preisanker bis heute — die Grenzen, die `packages/extractors` im Produktionspfad setzt. */
const BOUNDS = { earliestDate: '2025-01-01', latestDate: '2026-09-21' }

/**
 * D6 Teil 3 — Referenzwoche und synthetischer Jahres-Lastgang.
 *
 * Die Fixture setzt den TAGESVERBRAUCH je lokalem Kalendertag, damit die erwartete Referenzwoche
 * vorgegeben und nicht nachgerechnet ist.
 */

const TZ = 'Europe/Vienna'
const SLOT_MS = 15 * 60 * 1000

/** Viertelstundenreihe `[from, to)`; die Leistung entscheidet der LOKALE Kalendertag. */
function series(fromUtcIso: string, toUtcIso: string, kwhPerDayOf: (date: string) => number) {
  const readings: LoadReading[] = []
  for (let ms = Date.parse(fromUtcIso); ms < Date.parse(toUtcIso); ms += SLOT_MS) {
    const { year, month, day } = utcMsToLocalFields(ms, TZ)
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    readings.push({ ts: new Date(ms).toISOString(), gridPowerKw: kwhPerDayOf(date) / 24 })
  }
  return readings
}

function profileOf(
  readings: LoadReading[],
  source: LoadProfile['source'] = 'net_signed',
): LoadProfile {
  return { readings, intervalMinutes: 15, timezoneMeta: TZ, source }
}

const BASE_KWH_PER_DAY = 30
const PEAK_KWH_PER_DAY = 80
/** Die sieben Tage, die die Fixture überhöht — Mo 03.02. bis So 09.02.2025. */
const PEAK_WEEK = new Set([
  '2025-02-03',
  '2025-02-04',
  '2025-02-05',
  '2025-02-06',
  '2025-02-07',
  '2025-02-08',
  '2025-02-09',
])

/** 01.02.2025 00:00 bis 01.06.2025 00:00 Ortszeit — 120 Tage, mit der Spitzenwoche im Februar. */
function partialYear() {
  return profileOf(
    series('2025-01-31T23:00:00.000Z', '2025-05-31T22:00:00.000Z', (date) =>
      PEAK_WEEK.has(date) ? PEAK_KWH_PER_DAY : BASE_KWH_PER_DAY,
    ),
  )
}

describe('findReferenceWeek', () => {
  it('findet die verbrauchsstärkste Woche, nicht die kälteste oder die erste', () => {
    const week = findReferenceWeek(partialYear())

    expect(week?.fromDate).toBe('2025-02-03')
    expect(week?.toDate).toBe('2025-02-09')
    expect(week?.rateKwhPerDay).toBeCloseTo(PEAK_KWH_PER_DAY, 6)
    /* Jeder Wochentag genau einmal — die Zuordnung der gefüllten Tage hängt daran. */
    expect(new Set(week?.days.map((d) => d.weekday)).size).toBe(7)
  })
})

describe('buildSyntheticYearProfile', () => {
  it('füllt auf 365 Tage und eicht die gefüllten Tage auf die Referenzwoche', () => {
    const out = buildSyntheticYearProfile(partialYear(), BOUNDS)
    if (!out.ok) throw new Error(`unerwartet abgelehnt: ${out.blocker}`)

    /*
     * Die Preise reichen weit über den Lastgang hinaus, also liegt das SPÄTESTMÖGLICHE Fenster
     * vorne am ersten Messtag — die Lücke folgt hinter den Messwerten.
     */
    expect(out.value.windowFromDate).toBe('2025-02-01')
    expect(out.value.windowToDate).toBe('2026-01-31')
    expect(out.value.measuredDays + out.value.projectedDays).toBe(365)
    expect(out.value.measuredDays).toBe(120)

    /*
     * Die gefüllte Menge ist `Referenzrate × gefüllte Tage` — bis auf EINE Stunde: der 27.10.2024
     * liegt in der Lücke und hat 100 statt 96 Viertelstunden (Zeitumstellung). Der Zieltag wird auf
     * seine TATSÄCHLICHE Länge gefüllt, und genau das steht im Modulkopf. Die Abweichung ist hier
     * festgeschrieben, damit sie nicht unbemerkt zu einer Lücke in der Reihe umgebaut wird.
     */
    const measuredKwh = partialYear().readings.reduce((s, r) => s + Math.max(0, r.gridPowerKw), 0) / 4
    const totalKwh = out.value.profile.readings.reduce((s, r) => s + Math.max(0, r.gridPowerKw), 0) / 4
    const oneExtraHourKwh = PEAK_KWH_PER_DAY / 24
    expect(totalKwh - measuredKwh).toBeCloseTo(
      PEAK_KWH_PER_DAY * out.value.projectedDays + oneExtraHourKwh,
      3,
    )

    /* Lückenlos und chronologisch: jeder Zeitstempel kommt genau einmal vor. */
    const stamps = out.value.profile.readings.map((r) => r.ts)
    expect(new Set(stamps).size).toBe(stamps.length)
    expect([...stamps].sort()).toEqual(stamps)
  })

  it('lehnt einen Lastgang über ein volles Jahr ab — es gibt nichts hochzurechnen', () => {
    const full = profileOf(
      series('2024-12-31T23:00:00.000Z', '2025-12-31T23:00:00.000Z', () => BASE_KWH_PER_DAY),
    )
    expect(buildSyntheticYearProfile(full, BOUNDS)).toEqual({ ok: false, blocker: 'full_period' })
  })

  it('rückt das Fenster nur so weit zurück wie nötig, wenn es sonst in die Zukunft liefe', () => {
    /* Preise nur bis zum 31.12.2025 — das Fenster ab dem ersten Messtag (01.02.) liefe darüber. */
    const out = buildSyntheticYearProfile(partialYear(), {
      earliestDate: '2025-01-01',
      latestDate: '2025-12-31',
    })
    if (!out.ok) throw new Error(`unerwartet abgelehnt: ${out.blocker}`)

    /* Genau einen Monat zurück, nicht weiter — und nicht bis an den Anker. */
    expect(out.value.windowFromDate).toBe('2025-01-01')
    expect(out.value.windowToDate).toBe('2025-12-31')
  })

  it('lehnt ab, statt gemessene Tage wegzuschneiden, wenn kein Fenster in die Grenzen passt', () => {
    /* Der Anker liegt NACH dem ersten Messtag — jedes Fenster darüber liesse Messwerte weg. */
    const out = buildSyntheticYearProfile(partialYear(), {
      earliestDate: '2025-02-15',
      latestDate: '2026-09-21',
    })
    expect(out).toEqual({ ok: false, blocker: 'no_window' })
  })
})
