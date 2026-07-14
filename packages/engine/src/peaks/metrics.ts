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

/**
 * Monats-Höchstwerte des Bezugs NUR für BELEGTE Monate (§3.5), in Kalenderreihenfolge.
 * Ein Monat gilt als belegt, sobald er mindestens EINEN Messwert trägt — auch wenn seine
 * Bezugsspitze 0 ist (ein reiner Einspeise-Monat ist ein echter 0-kW-Bezugsmonat, keine
 * „keine Angabe"). Monate GANZ OHNE Messwert erscheinen NICHT (kein 0-Eintrag).
 *
 * Bewusst getrennt von `positiveMonthlyPeaksKw` (das 12 Elemente indexiert nach Monat liefern
 * MUSS — Contract `current.monthlyPeaksKw`/§3.4-Verteilung): die Tarif-Strategien `monthly_max_*`
 * (§3.5) mitteln/summieren über GENAU die belegten Monate. Bei Teiljahres-Daten (z. B. 7 Tage in
 * EINEM Monat) sonst der Kernfehler: ein realer Peak wird unter `monthly_max_average` durch elf
 * strukturelle Nullen der leeren Monate auf ~1/12 verdünnt (2,8 kW → 0,2 kW). Für `monthly_max_sum`
 * ändert der Ausschluss den Wert nicht (leere Monate = 0 tragen zur Summe ohnehin nichts bei),
 * hält die Semantik aber konsistent „nur belegte Monate zählen".
 */
export function coveredMonthlyPeaksKw(loadProfile: LoadProfile): number[] {
  const peaks = new Array(12).fill(0) as number[]
  const covered = new Array(12).fill(false) as boolean[]
  for (const r of loadProfile.readings) {
    const { month } = utcMsToLocalFields(Date.parse(r.ts), loadProfile.timezoneMeta)
    const idx = month - 1
    covered[idx] = true
    const d = drawKw(r.gridPowerKw)
    if (d > (peaks[idx] ?? 0)) peaks[idx] = d
  }
  const result: number[] = []
  for (let i = 0; i < 12; i++) if (covered[i]) result.push(peaks[i] ?? 0)
  return result
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
