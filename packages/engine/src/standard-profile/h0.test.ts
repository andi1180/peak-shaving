import { describe, expect, it } from 'vitest'
import { analysisWindow, startsBeforeSpotPriceAnchor, standardProfileYear } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import {
  H0_REFERENCE_DAILY_KWH,
  H0_WINTER_SUMMER_RATIO,
  generateStandardLoadProfile,
} from './h0'

/**
 * Delta 8 / 9b-1 — der H0-Generator gegen die Referenzparameter der Ladeoptimierungs-Studie.
 *
 * Der Prüfpunkt ist NICHT „sieht plausibel aus", sondern: die drei Zusagen des Generators sind
 * nachgerechnet — die Jahressumme trifft die Eingabe exakt, das Winter/Sommer-Verhältnis trifft die
 * Studienzahl, und die Tagesform trägt die Doppelspitze bzw. flacht am Wochenende ab.
 */

const TZ = 'Europe/Vienna'
const YEAR = 2025
// 3.650 kWh/Jahr ≈ 10 kWh/Tag — das Referenzmittel der Studie.
const REFERENCE_ANNUAL_KWH = H0_REFERENCE_DAILY_KWH * 365
const SLOT_HOURS = 0.25

function generate(annualKwh = REFERENCE_ANNUAL_KWH, year = YEAR) {
  const outcome = generateStandardLoadProfile({
    annualConsumptionKwh: annualKwh,
    customerClass: 'privat',
    year,
    timeZone: TZ,
  })
  if (!outcome.ok) throw new Error(`Generator lieferte kein Profil: ${outcome.reason}`)
  return outcome
}

/** Tagessummen (kWh) je lokalem Kalendertag, samt Monat und Wochentag des Tages. */
function dailyEnergy(readings: { ts: string; gridPowerKw: number }[]) {
  const byDay = new Map<string, { kwh: number; month: number; weekday: number }>()
  for (const r of readings) {
    const { year, month, day, weekday } = utcMsToLocalFields(Date.parse(r.ts), TZ)
    const key = `${year}-${month}-${day}`
    const entry = byDay.get(key) ?? { kwh: 0, month, weekday }
    entry.kwh += r.gridPowerKw * SLOT_HOURS
    byDay.set(key, entry)
  }
  return [...byDay.values()]
}

describe('Delta 8 — H0-Standardlastprofil', () => {
  it('trifft den eingegebenen Jahresverbrauch exakt (Σ kW × 0,25 h)', () => {
    const { profile, dataQuality } = generate()
    const total = profile.readings.reduce((s, r) => s + r.gridPowerKw * SLOT_HOURS, 0)

    // 35.040 Slots = 365 × 96 (2025 ist kein Schaltjahr); die DST-Tage gleichen sich über das Jahr aus.
    expect(profile.readings.length).toBe(35_040)
    expect(profile.intervalMinutes).toBe(15)
    expect(profile.source).toBe('standard_profile')
    expect(profile.timezoneMeta).toBe(TZ)
    expect(total).toBeCloseTo(REFERENCE_ANNUAL_KWH, 6)
    expect(dataQuality.coveredMonths).toBe(12)
    expect(dataQuality.coveredDays).toBe(365)
    expect(dataQuality.gapsInterpolated).toBe(0)

    const mittel = total / dataQuality.coveredDays
    console.log(
      `[Delta 8 H0] Jahressumme=${total.toFixed(6)} kWh · Tagesmittel=${mittel.toFixed(4)} kWh`,
    )
    expect(mittel).toBeCloseTo(H0_REFERENCE_DAILY_KWH, 6)
  })

  it('trägt das Winter/Sommer-Verhältnis der Studie (≈ 1,32), gemessen am erzeugten Profil', () => {
    const days = dailyEnergy(generate().profile.readings)
    const mean = (months: number[]) => {
      const sel = days.filter((d) => months.includes(d.month))
      return sel.reduce((s, d) => s + d.kwh, 0) / sel.length
    }
    const winter = mean([12, 1, 2])
    const sommer = mean([6, 7, 8])
    const ratio = winter / sommer

    console.log(
      `[Delta 8 H0] Winter=${winter.toFixed(4)} kWh/Tag · Sommer=${sommer.toFixed(4)} kWh/Tag · Verhältnis=${ratio.toFixed(4)}`,
    )
    /*
     * Toleranz 1 %: die Amplitude ist analytisch so gewählt, dass das SAISONFAKTOR-Verhältnis exakt
     * 1,32 ist. Das ENERGIE-Verhältnis weicht minimal ab, weil Winter- und Sommermonate nicht exakt
     * gleich viele Wochenendtage tragen (und ein Wochenendtag eine andere Tagessumme hat). Eine
     * schärfere Zahl zu behaupten hiesse, den Kalender zu ignorieren.
     */
    expect(ratio).toBeGreaterThan(H0_WINTER_SUMMER_RATIO * 0.99)
    expect(ratio).toBeLessThan(H0_WINTER_SUMMER_RATIO * 1.01)
  })

  it('trägt die Doppelspitze Morgen/Abend an einem Werktag', () => {
    const { profile } = generate()
    // Mittwoch, 15.1.2025 — Werktag, Wintermonat.
    const byHour = new Map<number, number>()
    for (const r of profile.readings) {
      const { year, month, day, hour } = utcMsToLocalFields(Date.parse(r.ts), TZ)
      if (year !== 2025 || month !== 1 || day !== 15) continue
      byHour.set(hour, Math.max(byHour.get(hour) ?? 0, r.gridPowerKw))
    }
    expect(byHour.size).toBe(24)

    const max = (from: number, to: number) =>
      Math.max(...[...byHour.entries()].filter(([h]) => h >= from && h <= to).map(([, v]) => v))
    const morgen = max(5, 9)
    const mittag = max(11, 15)
    const abend = max(17, 21)
    const nacht = max(1, 4)

    console.log(
      `[Delta 8 H0] Mi 15.1.2025 — Nacht=${nacht.toFixed(3)} · Morgen=${morgen.toFixed(3)} · Mittag=${mittag.toFixed(3)} · Abend=${abend.toFixed(3)} kW`,
    )
    // Zwei Spitzen mit einer echten Senke dazwischen — sonst wäre es eine Spitze mit Schulter.
    expect(morgen).toBeGreaterThan(mittag)
    expect(abend).toBeGreaterThan(mittag)
    expect(abend).toBeGreaterThan(morgen) // die Abendspitze dominiert (H0)
    expect(mittag).toBeGreaterThan(nacht)
  })

  it('verläuft am Wochenende flacher als am Werktag (Spitze zu Tagesmittel)', () => {
    const { profile } = generate()
    const peakOverMean = (y: number, m: number, d: number) => {
      const vals = profile.readings
        .filter((r) => {
          const f = utcMsToLocalFields(Date.parse(r.ts), TZ)
          return f.year === y && f.month === m && f.day === d
        })
        .map((r) => r.gridPowerKw)
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length
      return Math.max(...vals) / mean
    }
    // Mittwoch 15.1. gegen Sonntag 19.1. — derselbe Monat, also derselbe Saisonfaktor.
    const werktag = peakOverMean(2025, 1, 15)
    const wochenende = peakOverMean(2025, 1, 19)

    console.log(
      `[Delta 8 H0] Spitze/Mittel — Werktag=${werktag.toFixed(3)} · Wochenende=${wochenende.toFixed(3)}`,
    )
    expect(wochenende).toBeLessThan(werktag)
  })

  it('liegt im zulässigen Zeitfenster (Delta 15, Regel B) und ist damit hochladbar', () => {
    const { profile } = generate(4200, standardProfileYear(new Date('2026-08-30T00:00:00Z')))
    const window = analysisWindow(profile)
    expect(window).not.toBeNull()
    expect(startsBeforeSpotPriceAnchor(window!, TZ)).toBe(false)
    // Das zuletzt abgeschlossene Kalenderjahr — heute (2026) also 2025.
    expect(window!.startIso).toBe('2024-12-31T23:00:00.000Z')
  })

  it('ist deterministisch — zwei Läufe liefern bit-identische Werte', () => {
    const a = generate(5000)
    const b = generate(5000)
    expect(a.profile.readings).toEqual(b.profile.readings)
  })

  it('skaliert linear: doppelter Jahresverbrauch → überall doppelte Leistung', () => {
    const a = generate(3650)
    const b = generate(7300)
    for (let i = 0; i < a.profile.readings.length; i += 997) {
      expect(b.profile.readings[i]!.gridPowerKw).toBeCloseTo(
        a.profile.readings[i]!.gridPowerKw * 2,
        9,
      )
    }
  })

  it('erzeugt KEIN Profil für Kleingewerbe — das G-Profil ist offen, nicht abgeleitet', () => {
    const outcome = generateStandardLoadProfile({
      annualConsumptionKwh: 20_000,
      customerClass: 'kleingewerbe',
      year: YEAR,
      timeZone: TZ,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('no_profile_for_class')
  })

  it('weist unbrauchbare Eingaben ab, statt ein Profil aus dem Nichts zu bilden', () => {
    for (const kwh of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = generateStandardLoadProfile({
        annualConsumptionKwh: kwh,
        customerClass: 'privat',
        year: YEAR,
        timeZone: TZ,
      })
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.reason).toBe('invalid_consumption')
    }
  })

  it('bildet auch ein Schaltjahr korrekt ab (366 Tage, Summe unverändert exakt)', () => {
    const { profile, dataQuality } = generate(REFERENCE_ANNUAL_KWH, 2028)
    expect(dataQuality.coveredDays).toBe(366)
    expect(profile.readings.length).toBe(366 * 96)
    const total = profile.readings.reduce((s, r) => s + r.gridPowerKw * SLOT_HOURS, 0)
    expect(total).toBeCloseTo(REFERENCE_ANNUAL_KWH, 6)
  })

  it('kennzeichnet sich in der Datenqualität als synthetisch', () => {
    const { dataQuality } = generate()
    expect(dataQuality.warnings).toHaveLength(1)
    expect(dataQuality.warnings[0]).toMatch(/Synthetisches Standardlastprofil/)
    expect(dataQuality.warnings[0]).toMatch(/echten Lastgang/)
  })
})
