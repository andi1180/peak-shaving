import { describe, expect, it } from 'vitest'

import { easterSunday } from './holidays'
import { dayTypeOf, reconstructLoad, type ReconstructionInput } from './reconstruct'
import { utcMsToLocalFields } from '../parser/datetime'

const TZ = 'Europe/Vienna'
const START = Date.UTC(2025, 0, 1, 0, 0)
const N = 365 * 96
const TS = Array.from({ length: N }, (_, i) => new Date(START + i * 15 * 60 * 1000).toISOString())

/** Synthetischer Ertrag je kWp (kWh/15 min): Tageslänge 8 h im Winter bis 16 h im Sommer, Mitte 11 UTC. */
const YIELD = TS.map((ts) => {
  const d = new Date(ts)
  const doy = Math.floor((d.getTime() - START) / 86_400_000)
  const dayLen = 12 + 4 * Math.cos((2 * Math.PI * (doy - 172)) / 365)
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + 0.125 - (11 - dayLen / 2)
  return h > 0 && h < dayLen ? 0.25 * Math.sin((Math.PI * h) / dayLen) : 0
})
/** Last (kWh/15 min): 2 Grundlast, werktags 7–17 Uhr Ortszeit +1. */
const LOAD = TS.map((ts) => {
  const f = utcMsToLocalFields(Date.parse(ts), TZ)
  return 2 + (dayTypeOf(f) === 'workday' && f.hour >= 7 && f.hour < 17 ? 1 : 0)
})
const TRUE_KWP = 6
const BEZUG = LOAD.map((l, i) => Math.max(0, l - TRUE_KWP * YIELD[i]!))

const input = (overrides: Partial<ReconstructionInput> = {}): ReconstructionInput => ({
  intervals: TS.map((ts, i) => ({ ts, kwh: BEZUG[i]! })),
  timeZone: TZ,
  pvArrays: [{ kwp: TRUE_KWP, kwpMax: 1.5 * TRUE_KWP, upperYieldKwhPerKwp: YIELD }],
  ...overrides,
})

describe('reconstructLoad — Lastspanne [Bezug, Obergrenze]', () => {
  it('ohne deklarierte Anlage ist die Spanne bitgleich der Bezug', () => {
    for (const pvArrays of [[], [{ kwp: 0, kwpMax: 0, upperYieldKwhPerKwp: YIELD }]]) {
      const r = reconstructLoad(input({ pvArrays }))
      if (r.status !== 'ok') throw new Error(r.status)
      for (const series of [r.series.loadLow, r.series.loadMid, r.series.loadHigh]) {
        expect(series.every((v, i) => Object.is(v, BEZUG[i]))).toBe(true)
      }
    }
  })

  it('Invarianten je Intervall: Bezug = tief ≤ Mitte ≤ hoch ≤ Bezug + PV-Obergrenze; Wahrheit liegt darin', () => {
    const r = reconstructLoad(input())
    if (r.status !== 'ok') throw new Error(r.status)
    const { loadLow, loadMid, loadHigh, pvUpper } = r.series
    for (let i = 0; i < N; i++) {
      expect(loadLow[i]).toBe(BEZUG[i])
      expect(loadMid[i]!).toBeGreaterThanOrEqual(loadLow[i]!)
      expect(loadHigh[i]!).toBeGreaterThanOrEqual(loadMid[i]!)
      expect(loadHigh[i]!).toBeLessThanOrEqual(BEZUG[i]! + pvUpper[i]!)
    }
    const truth = LOAD.reduce((a, b) => a + b, 0)
    expect(truth).toBeGreaterThanOrEqual(r.annualLoadKwh.low)
    expect(truth).toBeLessThanOrEqual(r.annualLoadKwh.high)
    expect(r.annualLoadKwh.mid).toBe((r.annualLoadKwh.low + r.annualLoadKwh.high) / 2)
  })

  it('das Basisprofil klemmt die Obergrenze, wo es eins gibt; sonst gilt Bezug + PV-Obergrenze', () => {
    const r = reconstructLoad(input())
    if (r.status !== 'ok') throw new Error(r.status)
    const { loadHigh, pvUpper } = r.series
    const clamped = loadHigh.some((h, i) => h > BEZUG[i]! && h < BEZUG[i]! + pvUpper[i]! - 1e-9)
    const atUpper = loadHigh.some((h, i) => pvUpper[i]! > 0 && h === BEZUG[i]! + pvUpper[i]!)
    expect(clamped).toBe(true)
    expect(atUpper).toBe(true)
  })

  it('insufficient_data bei Lücke, Sprung im Raster und zu kurzer Reihe', () => {
    const gap = input().intervals.map((x, i) => (i === 1000 ? { ...x, kwh: null } : x))
    expect(reconstructLoad(input({ intervals: gap }))).toEqual({
      status: 'insufficient_data',
      reasons: ['data_gaps'],
    })
    const jump = input().intervals.filter((_, i) => i !== 1000)
    const jumpYield = YIELD.filter((_, i) => i !== 1000)
    expect(
      reconstructLoad(
        input({
          intervals: jump,
          pvArrays: [{ kwp: 6, kwpMax: 9, upperYieldKwhPerKwp: jumpYield }],
        }),
      ),
    ).toEqual({ status: 'insufficient_data', reasons: ['data_gaps'] })
    const short = input().intervals.slice(0, 300 * 96)
    expect(reconstructLoad(input({ intervals: short, pvArrays: [] }))).toEqual({
      status: 'insufficient_data',
      reasons: ['too_short'],
    })
  })

  it('deterministisch', () => {
    expect(reconstructLoad(input())).toEqual(reconstructLoad(input()))
  })
})

describe('Tagestyp und Feiertage', () => {
  const typeOf = (y: number, m: number, d: number) =>
    dayTypeOf(utcMsToLocalFields(Date.UTC(y, m - 1, d, 10), TZ))

  it('Ostersonntag nach der gregorianischen Formel', () => {
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 })
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 })
  })

  it('Werktag, Samstag, Sonntag und bewegliche wie feste Feiertage', () => {
    expect(typeOf(2025, 4, 16)).toBe('workday')
    expect(typeOf(2025, 4, 19)).toBe('saturday')
    expect(typeOf(2025, 4, 20)).toBe('sunday_holiday')
    expect(typeOf(2025, 4, 21)).toBe('sunday_holiday') // Ostermontag
    expect(typeOf(2025, 6, 19)).toBe('sunday_holiday') // Fronleichnam
    expect(typeOf(2025, 10, 26)).toBe('sunday_holiday') // Nationalfeiertag (Sonntag)
    expect(typeOf(2025, 12, 8)).toBe('sunday_holiday') // Mariä Empfängnis
  })
})
