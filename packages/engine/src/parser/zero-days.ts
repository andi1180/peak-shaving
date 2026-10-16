import { utcMsToLocalFields, zonedWallToUtcMs } from './datetime'

const STEP_MS = 15 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type ZeroDayFillSource = 'prev_week' | 'next_week' | 'interpolated'

/** Ein ganztägig mit 0 gemessener Ortszeit-Tag, als Lücke behandelt. `date` = YYYY-MM-DD (Ortszeit). */
export type ZeroDayFill = { date: string; source: ZeroDayFillSource }

type LocalDay = { date: string; indices: number[]; complete: boolean }

const pad = (n: number) => String(n).padStart(2, '0')

/** Ortszeit-Tage des Rasters; `complete` = alle Slots von 00:00 bis 24:00 liegen im Raster. */
function localDays(first: number, length: number, timeZone: string): Map<string, LocalDay> {
  const days = new Map<string, LocalDay>()
  for (let idx = 0; idx < length; idx++) {
    const f = utcMsToLocalFields(first + idx * STEP_MS, timeZone)
    const date = `${f.year}-${pad(f.month)}-${pad(f.day)}`
    const day = days.get(date)
    if (day) day.indices.push(idx)
    else days.set(date, { date, indices: [idx], complete: false })
  }
  for (const day of days.values()) {
    const [y, m, d] = day.date.split('-').map(Number) as [number, number, number]
    const start = zonedWallToUtcMs(y, m, d, 0, 0, 0, timeZone)
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    const end = zonedWallToUtcMs(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      0,
      0,
      0,
      timeZone,
    )
    day.complete =
      day.indices.length === (end - start) / STEP_MS && first + day.indices[0]! * STEP_MS === start
  }
  return days
}

function wallKey(ms: number, timeZone: string): string {
  const f = utcMsToLocalFields(ms, timeZone)
  return `${f.hour}:${f.minute}`
}

/**
 * Ein Ortszeit-Tag, an dem alle Slots vorhanden und exakt 0 sind, ist eine Datenlücke, keine
 * Messung: kein Anschluss bezieht 24 Stunden lang genau 0,000 kW. Gefüllt wird mit demselben
 * Wochentag der Vor-, sonst der Folgewoche, wenn dieser vollständig gemessen und selbst kein Nulltag
 * ist; sonst bleibt der Tag leer und geht in die lineare Lückenfüllung. Einzelne Nullslots bleiben
 * Messwerte. Ändert `grid` an Ort und Stelle; `undefined` = noch zu interpolieren.
 *
 * @returns die erkannten Tage und die Zahl der aus einer Nachbarwoche kopierten Slots.
 */
export function fillZeroDays(
  grid: (number | undefined)[],
  first: number,
  timeZone: string,
): { days: ZeroDayFill[]; copiedSlots: number; largestCopiedRun: number } {
  const days = localDays(first, grid.length, timeZone)
  const isMeasuredDay = (day: LocalDay | undefined) =>
    day !== undefined && day.complete && day.indices.every((i) => grid[i] !== undefined)
  const isZeroDay = (day: LocalDay) => isMeasuredDay(day) && day.indices.every((i) => grid[i] === 0)

  const zeroDays = [...days.values()].filter(isZeroDay)
  const zeroDates = new Set(zeroDays.map((d) => d.date))
  const dayAt = (ms: number) => {
    const f = utcMsToLocalFields(ms, timeZone)
    return days.get(`${f.year}-${pad(f.month)}-${pad(f.day)}`)
  }

  // Quellen gegen den Originalzustand wählen, bevor ein Tag gefüllt wird.
  const plan = zeroDays.map((day) => {
    const dayStart = first + day.indices[0]! * STEP_MS
    for (const [source, shift] of [
      ['prev_week', -WEEK_MS],
      ['next_week', WEEK_MS],
    ] as const) {
      const candidate = dayAt(dayStart + shift + 12 * 60 * 60 * 1000)
      if (candidate && isMeasuredDay(candidate) && !zeroDates.has(candidate.date)) {
        const byWall = new Map<string, number>()
        for (const i of candidate.indices) {
          const key = wallKey(first + i * STEP_MS, timeZone)
          if (!byWall.has(key)) byWall.set(key, grid[i]!)
        }
        return { day, source, byWall }
      }
    }
    return { day, source: 'interpolated' as const, byWall: null }
  })

  let copiedSlots = 0
  let largestCopiedRun = 0
  for (const { day, byWall } of plan) {
    const used = new Set<string>()
    let copied = 0
    for (const i of day.indices) {
      const key = wallKey(first + i * STEP_MS, timeZone)
      // Doppelte Ortszeit (Winterzeit) oder fehlende Quell-Uhrzeit (Sommerzeit) → interpolieren.
      const value = byWall && !used.has(key) ? byWall.get(key) : undefined
      used.add(key)
      grid[i] = value
      if (value !== undefined) copied++
    }
    copiedSlots += copied
    largestCopiedRun = Math.max(largestCopiedRun, copied)
  }

  return {
    days: plan.map(({ day, source }) => ({ date: day.date, source })),
    copiedSlots,
    largestCopiedRun,
  }
}

const SOURCE_TEXT: Record<ZeroDayFillSource, string> = {
  prev_week: 'ergänzt aus Vorwoche',
  next_week: 'ergänzt aus Folgewoche',
  interpolated: 'interpoliert',
}

/** Beginn der Warnung — erkennbar wie `IMPORT_ONLY_WITHOUT_PV_WARNING`. */
export const ZERO_DAY_FILLED_WARNING_PREFIX = 'Ganztägig 0 gemessen, als Datenlücke behandelt:'

export function zeroDayWarning(days: readonly ZeroDayFill[]): string {
  const list = days.map(({ date, source }) => {
    const [y, m, d] = date.split('-')
    return `${d}.${m}.${y} (${SOURCE_TEXT[source]})`
  })
  return `${ZERO_DAY_FILLED_WARNING_PREFIX} ${list.join(', ')}.`
}
