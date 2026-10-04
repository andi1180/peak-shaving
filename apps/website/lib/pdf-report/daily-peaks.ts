import type { LoadProfile } from 'shared'

import { localDateKey } from '@/lib/local-time'

export type DailyPeak = { day: string; peakKw: number }

/** Höchster Netzbezug je lokalem Kalendertag, in Tagesreihenfolge — sonst nichts. */
export function dailyPeaksOf(
  loadProfile: Pick<LoadProfile, 'readings' | 'timezoneMeta'>,
): DailyPeak[] {
  const peaks = new Map<string, number>()
  for (const reading of loadProfile.readings) {
    if (!Number.isFinite(reading.gridPowerKw)) continue
    const day = localDateKey(Date.parse(reading.ts), loadProfile.timezoneMeta)
    const current = peaks.get(day)
    if (current === undefined || reading.gridPowerKw > current) peaks.set(day, reading.gridPowerKw)
  }
  return [...peaks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, peakKw]) => ({ day, peakKw }))
}
