import { toIsoUtc } from './datetime'
import type { RawReading } from './normalize'

const STEP_MS = 15 * 60 * 1000
const SLOTS_PER_DAY = 96
const OUTLIER_KW = 100_000 // jenseits davon vermutlich Einheiten-/Skalierungsfehler

export type PreparedSlot = { ms: number; value: number }

export type PrepareResult = {
  slots: PreparedSlot[]
  intervalMinutes: number
  coveredDays: number
  gapsInterpolated: number
  warnings: string[]
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Häufigste positive Differenz (Minuten) zwischen aufeinanderfolgenden Zeitstempeln. */
function detectIntervalMinutes(sortedMs: number[]): number {
  const counts = new Map<number, number>()
  for (let i = 1; i < sortedMs.length; i++) {
    const diff = sortedMs[i]! - sortedMs[i - 1]!
    if (diff <= 0) continue
    const min = Math.round(diff / 60000)
    counts.set(min, (counts.get(min) ?? 0) + 1)
  }
  let best = 0
  let bestCount = 0
  for (const [min, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = min
    }
  }
  return best
}

/**
 * §3.3-Aufbereitung: sortieren, deduplizieren, Intervall bestimmen, lückenlosen 15-min-Vektor
 * bauen (kleine Lücken still interpolieren, große markieren), Plausibilität prüfen.
 */
export function prepareSeries(readings: RawReading[], maxInterpolationGap: number): PrepareResult {
  const warnings: string[] = []

  const sorted = [...readings].sort((a, b) => a.ms - b.ms)

  // Deduplizieren (gleicher Zeitstempel; u. a. DST-Rückfall-Stunde) — ersten Wert behalten.
  const deduped: RawReading[] = []
  let duplicates = 0
  for (const r of sorted) {
    const last = deduped[deduped.length - 1]
    if (last && last.ms === r.ms) {
      duplicates++
      continue
    }
    deduped.push(r)
  }
  if (duplicates > 0) {
    warnings.push(`${duplicates} doppelte Zeitstempel entfernt (z. B. Zeitumstellung).`)
  }

  const intervalMinutes = detectIntervalMinutes(deduped.map((r) => r.ms))
  if (deduped.length < 2) {
    return { slots: deduped, intervalMinutes, coveredDays: 0, gapsInterpolated: 0, warnings }
  }
  // Nur bei 15-min füllen wir das Gitter; anderes Intervall meldet der Orchestrator als Fehler.
  if (intervalMinutes !== 15) {
    return {
      slots: deduped,
      intervalMinutes,
      coveredDays: 0,
      gapsInterpolated: 0,
      warnings,
    }
  }

  const first = deduped[0]!.ms
  const last = deduped[deduped.length - 1]!.ms
  const totalSlots = Math.round((last - first) / STEP_MS) + 1

  // Bekannte Werte auf das Gitter legen.
  const grid: (number | undefined)[] = new Array(totalSlots).fill(undefined)
  for (const r of deduped) {
    const idx = Math.round((r.ms - first) / STEP_MS)
    if (idx >= 0 && idx < totalSlots) grid[idx] = r.value
  }

  // Lücken füllen (linear). Klein (≤ maxInterpolationGap) still, groß mit Warnung.
  let gapsInterpolated = 0
  let largeGaps = 0
  let i = 0
  while (i < totalSlots) {
    if (grid[i] !== undefined) {
      i++
      continue
    }
    const start = i
    while (i < totalSlots && grid[i] === undefined) i++
    const end = i // erstes bekanntes nach der Lücke
    const runLength = end - start
    const leftVal = grid[start - 1]
    const rightVal = grid[end]
    // Interpolieren nur zwischen zwei bekannten Werten (Ränder sind per Konstruktion bekannt).
    if (leftVal !== undefined && rightVal !== undefined) {
      const stepVal = (rightVal - leftVal) / (runLength + 1)
      for (let k = 0; k < runLength; k++) {
        grid[start + k] = round3(leftVal + stepVal * (k + 1))
      }
      gapsInterpolated += runLength
      if (runLength > maxInterpolationGap) largeGaps++
    }
  }
  if (largeGaps > 0) {
    warnings.push(
      `${largeGaps} größere Datenlücke(n) interpoliert (> ${maxInterpolationGap} Intervalle) — im Report als Datenqualitäts-Hinweis kennzeichnen.`,
    )
  }

  const slots: PreparedSlot[] = []
  let maxAbs = 0
  for (let idx = 0; idx < totalSlots; idx++) {
    const value = round3(grid[idx] ?? 0)
    maxAbs = Math.max(maxAbs, Math.abs(value))
    slots.push({ ms: first + idx * STEP_MS, value })
  }

  if (maxAbs > OUTLIER_KW) {
    warnings.push(
      `Ungewöhnlich hoher Spitzenwert (${Math.round(maxAbs)} kW) — mögliche Einheiten-/Skalierungsverwechslung prüfen.`,
    )
  }

  const coveredDays = Math.round(totalSlots / SLOTS_PER_DAY)

  return { slots, intervalMinutes, coveredDays, gapsInterpolated, warnings }
}

export function slotsToIso(slots: PreparedSlot[]): { ms: number; iso: string; value: number }[] {
  return slots.map((s) => ({ ms: s.ms, iso: toIsoUtc(s.ms), value: s.value }))
}
