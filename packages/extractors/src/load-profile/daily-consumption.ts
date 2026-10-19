import 'server-only'

import { parseLoadProfile } from 'engine'

import { MAX_LOAD_PROFILE_FILE_BYTES } from './limits'

/** Netzbezug eines Ortstags: kWh (nur positive Netzleistung) und Zahl der gelesenen Intervalle. */
export type DailyConsumption = { day: string; importKwh: number; intervals: number }

export type DailyConsumptionOutcome =
  | { ok: true; days: DailyConsumption[]; intervalMinutes: number; timezone: string }
  | { ok: false; reason: 'too_large' | 'unreadable' }

/**
 * Der Netzbezug je Ortstag aus einer Lastgang-Datei — gelesen mit `parseLoadProfile`, demselben
 * Parser und denselben Optionen wie der Analyse-Lauf. Heraus kommen Tagessummen, keine Messwerte.
 */
export function readDailyConsumption(
  bytes: ArrayBuffer,
  fileName: string,
  options: { timezone?: string } = {},
): DailyConsumptionOutcome {
  if (bytes.byteLength > MAX_LOAD_PROFILE_FILE_BYTES) return { ok: false, reason: 'too_large' }

  // CSV als Text, XLSX als Bytes — dieselbe Unterscheidung wie im Analyse-Lauf.
  const isXlsx = /\.xlsx?$/i.test(fileName.trim())
  const outcome = parseLoadProfile(
    {
      content: isXlsx ? bytes : new TextDecoder().decode(bytes),
      fileName,
      format: isXlsx ? 'xlsx' : 'csv',
    },
    options.timezone ? { timezone: options.timezone } : {},
  )
  if (!outcome.ok) return { ok: false, reason: 'unreadable' }

  const { readings, intervalMinutes, timezoneMeta } = outcome.profile
  const dayOf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezoneMeta,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const hours = intervalMinutes / 60
  const byDay = new Map<string, DailyConsumption>()
  for (const reading of readings) {
    const day = dayOf.format(new Date(reading.ts))
    const entry = byDay.get(day) ?? { day, importKwh: 0, intervals: 0 }
    entry.importKwh += Math.max(0, reading.gridPowerKw) * hours
    entry.intervals += 1
    byDay.set(day, entry)
  }
  return {
    ok: true,
    days: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    intervalMinutes,
    timezone: timezoneMeta,
  }
}
