import type { LoadProfile, PvProfile } from 'shared'
import { describe, expect, it } from 'vitest'

import {
  addPvToGridDraw,
  monthlyPvGeneration,
  PV_DAY_MIN_DEMAND_KWH,
  zeroPvDaysWithoutMiddayDemand,
  zeroPvOutageMonths,
  zeroPvWhereNoDemand,
} from './reconstruct'

/**
 * Drei Kalendermonate, Ortszeit Wien: Jänner und Februar mit Mittagseinbruch, März ohne. Die
 * Erzeugungsreihe ist über alle drei gleich — der Unterschied entsteht erst durch die
 * Ausfall-Nullung, und genau das ist hier zu messen.
 */
const STEP_MS = 15 * 60 * 1000
/** 01.01.2025 00:00 Ortszeit Wien (UTC+1). */
const T0 = Date.parse('2024-12-31T23:00:00Z')
/*
 * ⚠ 85 statt 90 Tage: der Zeitraum endet am 26.03. und damit VOR der Zeitumstellung (30.03.2025).
 * Über sie hinaus verschöbe sich die Ortszeit um eine Stunde, ein 96-Slot-Tag deckte nicht mehr
 * denselben Kalendertag, und im Ergebnis stünde ein vierter Monat — eine Eigenschaft des Fixtures,
 * nicht der Rechnung.
 */
const DAYS = 85
const PV_KW = 12

/** Die Stunden, in denen die Anlage liefert — UTC 9–15 deckt das Tagfenster 10–16 Ortszeit ab. */
const isSunHour = (ms: number): boolean => {
  const hour = new Date(ms).getUTCHours()
  return hour >= 9 && hour < 15
}

/** Der Monat in Ortszeit — im Winterhalbjahr (UTC+1) ist er hier der UTC-Monat. */
const monthOf = (ms: number): number => new Date(ms + 3_600_000).getUTCMonth() + 1

function load(): LoadProfile {
  return {
    readings: Array.from({ length: DAYS * 96 }, (_, i) => {
      const ms = T0 + i * STEP_MS
      /* März: kein Einbruch — der Bezug bleibt über Mittag bei 20 kW. */
      const working = monthOf(ms) !== 3 && isSunHour(ms)
      return { ts: new Date(ms).toISOString(), gridPowerKw: working ? 0 : 20 }
    }),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

function pv(): PvProfile {
  return {
    readings: Array.from({ length: DAYS * 96 }, (_, i) => {
      const ms = T0 + i * STEP_MS
      return { ts: new Date(ms).toISOString(), pvGenerationKw: isSunHour(ms) ? PV_KW : 0 }
    }),
  }
}

const OUTAGE = [{ year: 2025, month: 3 }]

describe('Rekonstruktion „ohne PV"', () => {
  it('addiert die Erzeugung — ausser in einem Ausfallmonat, der unverändert bleibt', () => {
    const profile = load()
    const generation = zeroPvOutageMonths(pv(), OUTAGE, profile.timezoneMeta)
    const reconstructed = addPvToGridDraw(profile, generation)

    expect(reconstructed.readings).toHaveLength(profile.readings.length)
    /* Der Lastgang bleibt, was er ist — `source`/`pvSource` sind Herkunftsangaben. */
    expect(reconstructed.source).toBe('import_only')

    let checkedNormal = 0
    let checkedOutage = 0
    for (let i = 0; i < profile.readings.length; i++) {
      const before = profile.readings[i]!
      const after = reconstructed.readings[i]!
      const ms = Date.parse(before.ts)
      if (!isSunHour(ms)) continue
      if (monthOf(ms) === 3) {
        /* Ausfallmonat: kein Delta — nicht eine geschätzte Erzeugung, nicht eine 0 daneben. */
        expect(after.gridPowerKw).toBe(before.gridPowerKw)
        checkedOutage++
      } else {
        expect(after.gridPowerKw).toBeCloseTo(before.gridPowerKw + PV_KW, 9)
        checkedNormal++
      }
    }
    expect(checkedNormal).toBeGreaterThan(0)
    expect(checkedOutage).toBeGreaterThan(0)
  })

  it('summiert je Kalendermonat — ein Ausfallmonat trägt `null` und keine 0', () => {
    const profile = load()
    const generation = zeroPvOutageMonths(pv(), OUTAGE, profile.timezoneMeta)
    const months = monthlyPvGeneration(profile, generation, OUTAGE)

    expect(months.map((m) => m.month)).toEqual([1, 2, 3])
    /* 6 Sonnenstunden × 12 kW × 31 Tage. */
    expect(months[0]!.selfConsumptionKwh).toBeCloseTo(6 * PV_KW * 31, 6)
    expect(months[1]!.selfConsumptionKwh).toBeCloseTo(6 * PV_KW * 28, 6)
    expect(months[2]).toEqual({ year: 2025, month: 3, selfConsumptionKwh: null, outage: true })
  })
})

/**
 * Die TAGESschwelle (`PV_DAY_MIN_DEMAND_KWH`) — ein eigenes Fixture, weil das obige im Tagfenster
 * bewusst auf 0 kW steht und damit jeden Jänner-/Februartag unter die Schwelle fiele.
 *
 * Zwei Tage, die sich AUSSCHLIESSLICH im Mittagsfenster unterscheiden: 1,002 kWh gegen 0,996 kWh.
 * Die Nachtlast ist bei beiden gleich hoch — damit ist gemessen, dass das Fenster das Kriterium
 * ist und nicht der Tagesverbrauch.
 */
const DAY2_T0 = Date.parse('2025-01-05T23:00:00Z') // 06.01.2025 00:00 Ortszeit Wien
/** UTC 9–15 = 10–16 Ortszeit (UTC+1) — dasselbe Fenster, das die Schwelle prüft. */
const inWindow = (ms: number): boolean => {
  const hour = new Date(ms).getUTCHours()
  return hour >= 9 && hour < 15
}
/** Erzeugung auch AUSSERHALB des Fensters, damit die Nullung des ganzen Tages prüfbar ist. */
const generates = (ms: number): boolean => {
  const hour = new Date(ms).getUTCHours()
  return hour >= 7 && hour < 17
}
const dayIndexOf = (ms: number): number => Math.floor((ms - DAY2_T0) / (24 * 3_600_000))

/** 24 Slots × 0,25 h × kW ⇒ 6 × kW kWh im Fenster: 0,167 → 1,002 · 0,166 → 0,996. */
const WINDOW_KW = [0.167, 0.166]

function twoDayLoad(): LoadProfile {
  return {
    readings: Array.from({ length: 2 * 96 }, (_, i) => {
      const ms = DAY2_T0 + i * STEP_MS
      return {
        ts: new Date(ms).toISOString(),
        gridPowerKw: inWindow(ms) ? WINDOW_KW[dayIndexOf(ms)]! : 9,
      }
    }),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

function twoDayPv(): PvProfile {
  return {
    readings: Array.from({ length: 2 * 96 }, (_, i) => {
      const ms = DAY2_T0 + i * STEP_MS
      return { ts: new Date(ms).toISOString(), pvGenerationKw: generates(ms) ? PV_KW : 0 }
    }),
  }
}

describe('Tagesschwelle ohne Mittagsbedarf', () => {
  it('nullt nur den Tag UNTER der Schwelle, und dort den ganzen Tag', () => {
    const profile = twoDayLoad()
    const generation = zeroPvDaysWithoutMiddayDemand(profile, twoDayPv())

    expect(PV_DAY_MIN_DEMAND_KWH).toBe(1)
    const perDay = [0, 0]
    let zeroedOutsideWindow = 0
    for (const reading of generation.readings) {
      const ms = Date.parse(reading.ts)
      perDay[dayIndexOf(ms)]! += reading.pvGenerationKw * 0.25
      if (generates(ms) && !inWindow(ms) && dayIndexOf(ms) === 1) {
        /* Randstunden des genullten Tages: das Fenster ist das Kriterium, nicht der Wirkungsbereich. */
        expect(reading.pvGenerationKw).toBe(0)
        zeroedOutsideWindow++
      }
    }
    expect(zeroedOutsideWindow).toBeGreaterThan(0)
    /* 10 Erzeugungsstunden × 12 kW — der Tag über der Schwelle bleibt unangetastet. */
    expect(perDay[0]).toBeCloseTo(10 * PV_KW, 9)
    expect(perDay[1]).toBe(0)
  })

  it('nullt Ausfallmonate UND Tage in einem Aufruf', () => {
    const profile = twoDayLoad()
    const both = zeroPvWhereNoDemand(profile, twoDayPv(), [{ year: 2025, month: 1 }])
    /* Jänner ist hier Ausfallmonat — dann trägt auch der Tag über der Schwelle nichts. */
    expect(both.readings.every((r) => r.pvGenerationKw === 0)).toBe(true)
  })
})
