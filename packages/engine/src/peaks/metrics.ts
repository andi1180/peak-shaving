import type { LoadProfile, PeakDistribution } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'

// Spitzenerkennung (§3.4). Reine, deterministische Funktionen über den Ist-Lastgang.
// Nur der POSITIVE Anteil von `gridPowerKw` zählt als Bezug — Einspeisung (negativ)
// bleibt für Spitzen/Kosten irrelevant.

const drawKw = (gridPowerKw: number): number => Math.max(0, gridPowerKw)

/** Jahreshöchstwert des Bezugs (§3.4). 0 bei leerem oder rein einspeisendem Profil. */
export function positiveAnnualPeakKw(loadProfile: LoadProfile): number {
  let max = 0
  for (const r of loadProfile.readings) {
    const d = drawKw(r.gridPowerKw)
    if (d > max) max = d
  }
  return max
}

/**
 * 12 Monats-Höchstwerte des Bezugs (§3.4), Index 0 = Jänner.
 * Monatsgrenzen nach LOKALER Zeit (`loadProfile.timezoneMeta`), nicht UTC — österreichische
 * Abrechnungsperioden folgen der lokalen Wanduhr, nicht dem UTC-Kalendertag. Setzt (wie das
 * übrige MVP) einen einzelnen abgedeckten Jahrgang voraus; mehrjährige Profile würden sich
 * hier über den Monatsindex überlagern.
 */
export function positiveMonthlyPeaksKw(loadProfile: LoadProfile): number[] {
  const peaks = new Array(12).fill(0) as number[]
  for (const r of loadProfile.readings) {
    const d = drawKw(r.gridPowerKw)
    if (d === 0) continue
    const { month } = utcMsToLocalFields(Date.parse(r.ts), loadProfile.timezoneMeta)
    const idx = month - 1
    if (d > (peaks[idx] ?? 0)) peaks[idx] = d
  }
  return peaks
}

/** [ANNAHME] N=10 — im Pflichtenheft §3.4 nicht beziffert, folgt CLAUDE_PEAKSHAVING.md. */
export const TOP_PEAKS_N = 10

/** Top-N Bezugsspitzen mit Zeitstempel, absteigend sortiert (§3.4). */
export function topPeaksKw(
  loadProfile: LoadProfile,
  n: number = TOP_PEAKS_N,
): Array<{ ts: string; kw: number }> {
  const draws = loadProfile.readings
    .map((r) => ({ ts: r.ts, kw: drawKw(r.gridPowerKw) }))
    .filter((r) => r.kw > 0)
  draws.sort((a, b) => b.kw - a.kw)
  return draws.slice(0, n)
}

/**
 * [ANNAHME, fixiert mit dieser Implementierung] Verteilung der Bezugsspitzen — je Bucket
 * der MAXIMALE Bezug (kW), nicht Anzahl der Intervalle oder aufsummierte Energie (siehe
 * Begründung am `PeakDistribution`-Typ in packages/shared).
 */
export function peakDistribution(loadProfile: LoadProfile): PeakDistribution {
  const byWeekday = new Array(7).fill(0) as number[]
  const byHour = new Array(24).fill(0) as number[]
  const byMonth = new Array(12).fill(0) as number[]
  for (const r of loadProfile.readings) {
    const d = drawKw(r.gridPowerKw)
    if (d === 0) continue
    const { weekday, hour, month } = utcMsToLocalFields(Date.parse(r.ts), loadProfile.timezoneMeta)
    if (d > (byWeekday[weekday] ?? 0)) byWeekday[weekday] = d
    if (d > (byHour[hour] ?? 0)) byHour[hour] = d
    if (d > (byMonth[month - 1] ?? 0)) byMonth[month - 1] = d
  }
  return { byWeekday, byHour, byMonth }
}
