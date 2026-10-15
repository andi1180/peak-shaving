import type { LoadProfile, SpotPriceSeriesInput } from 'shared'

/**
 * Synthetischer Lastgang und Spotreihe des DE-Golden, als Formel statt als Datei: beide sind exakt
 * reproduzierbar, und eine Änderung an der Formel steht im Diff. Zeitraum lokal 01.07.2025 – 30.06.2026.
 */

export const START_UTC_MS = Date.parse('2025-06-30T22:00:00Z')
export const DAYS = 365
const SLOT_MS = 15 * 60 * 1000
const SLOTS_PER_DAY = 96

export const NIGHT_KW = 8
export const DAY_KW = 17.34
export const SPIKE_KW = 49
/** Kurze Spitze: zwei Viertelstunden am 12.11.2025 ab 10:00 MEZ. */
const SPIKE_FROM_MS = Date.parse('2025-11-12T09:00:00Z')
const SPIKE_SLOTS = 2

function kwAt(ms: number): number {
  if (ms >= SPIKE_FROM_MS && ms < SPIKE_FROM_MS + SPIKE_SLOTS * SLOT_MS) return SPIKE_KW
  const utcHour = new Date(ms).getUTCHours()
  return utcHour >= 4 && utcHour < 18 ? DAY_KW : NIGHT_KW
}

export function buildLoadProfile(): LoadProfile {
  const readings = Array.from({ length: DAYS * SLOTS_PER_DAY }, (_, i) => {
    const ms = START_UTC_MS + i * SLOT_MS
    return { ts: new Date(ms).toISOString(), gridPowerKw: kwAt(ms) }
  })
  return { readings, intervalMinutes: 15, timezoneMeta: 'Europe/Berlin', source: 'import_only' }
}

/** Stündliche Spotreihe (netto): Tagesgang mit Mittagstal und Abendspitze, ganzzahlig auf 0,001 ct. */
export function buildSpotPrices(): SpotPriceSeriesInput {
  const prices = Array.from({ length: DAYS * 24 }, (_, h) => {
    const ms = START_UTC_MS + h * 3_600_000
    const hour = new Date(ms).getUTCHours()
    const ct = Math.round((9 + 4 * Math.sin(((hour - 12) * Math.PI) / 12)) * 1000) / 1000
    return {
      tsStart: new Date(ms).toISOString(),
      tsEnd: new Date(ms + 3_600_000).toISOString(),
      ctPerKwh: ct,
      priceBasis: 'net',
    }
  })
  return { prices, complete: true, missingRanges: [] }
}
