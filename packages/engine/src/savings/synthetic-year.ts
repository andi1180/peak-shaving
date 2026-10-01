import type { LoadProfile, PvProfile, PvReading } from 'shared'

import { utcMsToLocalFields, zonedWallToUtcMs } from '../parser/datetime'
import { DAYS_PER_YEAR, coveredDaysOf } from './annualization'

/**
 * D6 Teil 3 — DER SYNTHETISCHE JAHRES-LASTGANG: gemessene Tage unverändert, fehlende Tage mit den
 * ECHTEN Viertelstundenwerten eines gemessenen Tages desselben Wochentags belegt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ GESCHÄTZT IST DER LASTGANG, NICHT DAS ERGEBNIS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hier entsteht eine EINGABE — ein vollständiges 365-Tage-Profil —, auf dem anschliessend dieselbe
 * Rechenkette läuft wie auf dem echten (`computeAnalysis`). Die fertigen Ersparnis-Zahlen mit
 * `365 / coveredDays` zu strecken wäre falsch: eine Batterie ist keine lineare Funktion ihrer
 * Betriebstage (Prinzip 3).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * DIE FÜLLREGEL: DER GEMESSENE WOCHENBLOCK, RÜCKWÄRTS WIEDERHOLT (01.10.2026)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Block = die längste zusammenhängende Folge vollständiger Mo–So-Wochen (bei Gleichstand die
 * jüngste). Ein fehlender Tag d bekommt die Werte des Tages d + 7·W·k (W = Blockwochen) mit dem
 * kleinsten |k| ≥ 1, der im Block liegt — vor dem Block also k ≥ 1, nach ihm k ≤ −1. Damit trägt
 * jeder Quelltag denselben Wochentag, und Spitzen wie Feiertage des Blocks werden mitkopiert
 * (kein Mittelwert, der die Spitzen glättete). Unter `MIN_BLOCK_WEEKS` gibt es keinen Jahreslauf.
 *
 * Die PV-Wirkung reist mit: bei BESTEHENDER Anlage steckt ihre Eigenversorgung im gemessenen Bezug;
 * eine mitgelieferte Brutto-PV-Reihe wird nach DEMSELBEN Plan verlängert.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WO DAS FENSTER LIEGT, ENTSCHEIDET DIESES MODUL NICHT ALLEIN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 365 Kalendertage, die alle gemessenen Tage enthalten; welche, hängt an Grenzen, die der
 * Rechenkern nicht kennen darf (Preisanker, Messende) — sie kommen als `bounds` herein. Innerhalb
 * der Grenzen wird das SPÄTESTMÖGLICHE Fenster gewählt. Der Wizard-Pfad (`extractors`,
 * `annual-scenario.ts`) setzt `latestDate` auf den letzten Messtag: dort endet das Fenster also immer
 * mit der jüngsten Messung, und gefüllt wird davor.
 */

/** Weniger volle Wochen tragen keine belastbare Jahreshochrechnung. */
export const MIN_BLOCK_WEEKS = 4

/** Die Grenzen, in denen das Jahresfenster liegen darf — lokale Kalendertage, beide INKLUSIV. */
export type SyntheticYearBounds = {
  earliestDate: string
  latestDate: string
}

/** Der gemessene Wochenblock, aus dem gefüllt wurde. */
export type SyntheticYearBlock = {
  /** Erster Tag (Montag, lokal, `YYYY-MM-DD`, inklusiv). */
  fromDate: string
  /** Letzter Tag (Sonntag, lokal, inklusiv). */
  toDate: string
  weeks: number
}

export type SyntheticYearProfile = {
  /** 365 Kalendertage, lückenlos. `source`/`pvSource` unverändert vom echten Profil. */
  profile: LoadProfile
  /** Die Brutto-PV-Reihe, nach DEMSELBEN Plan verlängert — gesetzt genau dann, wenn eine übergeben wurde. */
  pvProfile?: PvProfile
  windowFromDate: string
  windowToDate: string
  /** Kalendertage des Fensters mit echten Messwerten. */
  measuredDays: number
  /** Kalendertage des Fensters, die aus dem Block gefüllt wurden. */
  projectedDays: number
  block: SyntheticYearBlock
}

export type SyntheticYearBlocker =
  /** Der Lastgang deckt bereits ein volles Jahr ab — es gibt nichts hochzurechnen. */
  | 'full_period'
  /** Synthetisches Standardprofil: es trägt sein Jahr bereits als Eingabe. */
  | 'synthetic_profile'
  | 'no_data'
  /** Weniger als `MIN_BLOCK_WEEKS` zusammenhängende volle Mo–So-Wochen. */
  | 'insufficient_data'
  /** Die belegten Tage liegen weiter als 365 Kalendertage auseinander. */
  | 'span_exceeds_year'
  /** Kein Jahresfenster innerhalb der Grenzen enthält alle Messwerte — es wird nichts weggeschnitten. */
  | 'no_window'

export type SyntheticYearResult =
  { ok: true; value: SyntheticYearProfile } | { ok: false; blocker: SyntheticYearBlocker }

export function buildSyntheticYearProfile(
  loadProfile: LoadProfile,
  bounds: SyntheticYearBounds,
  pvProfile?: PvProfile,
): SyntheticYearResult {
  if (loadProfile.source === 'standard_profile') return { ok: false, blocker: 'synthetic_profile' }

  const coveredDays = coveredDaysOf(loadProfile)
  if (coveredDays <= 0 || loadProfile.readings.length === 0) {
    return { ok: false, blocker: 'no_data' }
  }
  if (coveredDays >= DAYS_PER_YEAR) return { ok: false, blocker: 'full_period' }

  const tz = loadProfile.timezoneMeta
  const days = readingsByLocalDay(loadProfile.readings, tz)
  if (days.size === 0) return { ok: false, blocker: 'no_data' }
  const dates = [...days.keys()].sort()
  const firstDate = dates[0]!
  const lastDate = dates[dates.length - 1]!

  const latestStart = minDate(firstDate, addDays(bounds.latestDate, -(DAYS_PER_YEAR - 1)))
  const earliestStart = maxDate(bounds.earliestDate, addDays(lastDate, -(DAYS_PER_YEAR - 1)))
  if (firstDate < addDays(lastDate, -(DAYS_PER_YEAR - 1))) {
    return { ok: false, blocker: 'span_exceeds_year' }
  }
  if (earliestStart > latestStart) return { ok: false, blocker: 'no_window' }

  const windowFromDate = latestStart
  const windowToDate = addDays(windowFromDate, DAYS_PER_YEAR - 1)

  const full = new Set(
    dates.filter(
      (date) => days.get(date)!.length === slotsInLocalDay(date, tz, loadProfile.intervalMinutes),
    ),
  )
  const block = findWeekBlock(full)
  if (block === null || block.weeks < MIN_BLOCK_WEEKS) {
    return { ok: false, blocker: 'insufficient_data' }
  }

  // Der Plan entsteht einmal und gilt für Lastgang UND PV-Reihe — sonst stammten Bezug und
  // Erzeugung eines gefüllten Tages aus verschiedenen Tagen.
  const period = block.weeks * 7
  const plan: PlanDay[] = []
  for (let i = 0; i < DAYS_PER_YEAR; i++) {
    const date = addDays(windowFromDate, i)
    if (days.has(date)) continue
    const offset = mod(dayDiff(block.fromDate, date), period)
    plan.push({ date, sourceDate: addDays(block.fromDate, offset) })
  }

  const intervalMs = loadProfile.intervalMinutes * 60 * 1000
  const filled = fillByWallTime(
    plan,
    days,
    tz,
    intervalMs,
    loadProfile.intervalMinutes,
    (ts, source) => ({
      ts,
      gridPowerKw: source.gridPowerKw,
    }),
  )

  return {
    ok: true,
    value: {
      profile: { ...loadProfile, readings: byTime([...loadProfile.readings, ...filled]) },
      ...(pvProfile
        ? { pvProfile: extendPv(pvProfile, plan, tz, intervalMs, loadProfile.intervalMinutes) }
        : {}),
      windowFromDate,
      windowToDate,
      measuredDays: DAYS_PER_YEAR - plan.length,
      projectedDays: plan.length,
      block,
    },
  }
}

type PlanDay = { date: string; sourceDate: string }

/**
 * Die längste Folge aufeinanderfolgender vollständiger Mo–So-Wochen; bei Gleichstand die jüngste.
 * `null`, wenn es keine einzige volle Woche gibt.
 */
function findWeekBlock(full: ReadonlySet<string>): SyntheticYearBlock | null {
  let best: SyntheticYearBlock | null = null
  for (const date of full) {
    if (weekdayOf(date) !== 0) continue
    // Nur am Anfang einer Folge zählen — eine volle Vorwoche hiesse, dieser Montag liegt mittendrin.
    if (isFullWeek(full, addDays(date, -7))) continue
    let weeks = 0
    while (isFullWeek(full, addDays(date, 7 * weeks))) weeks++
    if (weeks === 0) continue
    if (best === null || weeks > best.weeks || (weeks === best.weeks && date > best.fromDate)) {
      best = { fromDate: date, toDate: addDays(date, 7 * weeks - 1), weeks }
    }
  }
  return best
}

function isFullWeek(full: ReadonlySet<string>, monday: string): boolean {
  for (let i = 0; i < 7; i++) if (!full.has(addDays(monday, i))) return false
  return true
}

/**
 * Einen Zieltag Slot für Slot aus seinem Quelltag füllen — zugeordnet nach LOKALER Uhrzeit, nicht
 * nach Position: am Umstellungstag im März fehlt 02:00–02:59, im Oktober kommt sie zweimal vor.
 * Fehlt dem Quelltag eine Uhrzeit (Zieltag normal, Quelltag Umstellung März), gilt die Stunde davor.
 */
function fillByWallTime<S extends { ts: string }, T>(
  plan: readonly PlanDay[],
  sourceDays: ReadonlyMap<string, S[]>,
  tz: string,
  intervalMs: number,
  intervalMinutes: number,
  make: (ts: string, source: S) => T,
): T[] {
  const out: T[] = []
  for (const day of plan) {
    const source = sourceDays.get(day.sourceDate)
    if (!source || source.length === 0) continue
    const byWallTime = new Map<number, S>()
    for (const reading of source) {
      const minute = wallMinuteOf(Date.parse(reading.ts), tz)
      if (!byWallTime.has(minute)) byWallTime.set(minute, reading)
    }
    const startMs = localMidnightMs(day.date, tz)
    const slots = slotsInLocalDay(day.date, tz, intervalMinutes)
    for (let slot = 0; slot < slots; slot++) {
      const ms = startMs + slot * intervalMs
      const minute = wallMinuteOf(ms, tz)
      const match = byWallTime.get(minute) ?? byWallTime.get(minute - 60)
      if (match) out.push(make(new Date(ms).toISOString(), match))
    }
  }
  return out
}

/** Die Brutto-PV-Reihe nach demselben Plan verlängern; ein Quelltag ohne Erzeugungswerte bleibt leer. */
function extendPv(
  pvProfile: PvProfile,
  plan: readonly PlanDay[],
  tz: string,
  intervalMs: number,
  intervalMinutes: number,
): PvProfile {
  const filled = fillByWallTime<PvReading, PvReading>(
    plan,
    readingsByLocalDay(pvProfile.readings, tz),
    tz,
    intervalMs,
    intervalMinutes,
    (ts, source) => ({ ts, pvGenerationKw: source.pvGenerationKw }),
  )
  return { readings: byTime([...pvProfile.readings, ...filled]) }
}

function readingsByLocalDay<R extends { ts: string }>(
  readings: readonly R[],
  tz: string,
): Map<string, R[]> {
  const days = new Map<string, R[]>()
  for (const reading of readings) {
    const ms = Date.parse(reading.ts)
    if (!Number.isFinite(ms)) continue
    const date = localDateKeyOf(ms, tz)
    const bucket = days.get(date)
    if (bucket) bucket.push(reading)
    else days.set(date, [reading])
  }
  for (const bucket of days.values()) bucket.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  return days
}

function byTime<R extends { ts: string }>(readings: R[]): R[] {
  return readings.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

function wallMinuteOf(ms: number, tz: string): number {
  const { hour, minute } = utcMsToLocalFields(ms, tz)
  return hour * 60 + minute
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localDateKeyOf(ms: number, tz: string): string {
  const { year, month, day } = utcMsToLocalFields(ms, tz)
  return `${year}-${pad(month)}-${pad(day)}`
}

function parseDateKey(key: string): [number, number, number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))]
}

/** Kalendertage weiterzählen — reine Kalenderarithmetik, ohne Zeitzone. */
function addDays(key: string, days: number): string {
  const [year, month, day] = parseDateKey(key)
  const at = new Date(Date.UTC(year, month - 1, day + days))
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

function dayDiff(from: string, to: string): number {
  const [fy, fm, fd] = parseDateKey(from)
  const [ty, tm, td] = parseDateKey(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** 0 = Montag (dieselbe Zählung wie `utcMsToLocalFields`). */
function weekdayOf(key: string): number {
  const [year, month, day] = parseDateKey(key)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function localMidnightMs(date: string, tz: string): number {
  const [year, month, day] = parseDateKey(date)
  return zonedWallToUtcMs(year, month, day, 0, 0, 0, tz)
}

/** Intervalle eines lokalen Kalendertags — 96 im Regelfall, 92 bzw. 100 an den Umstellungstagen. */
function slotsInLocalDay(date: string, tz: string, intervalMinutes: number): number {
  const start = localMidnightMs(date, tz)
  const end = localMidnightMs(addDays(date, 1), tz)
  return Math.round((end - start) / (intervalMinutes * 60 * 1000))
}

const minDate = (a: string, b: string): string => (a < b ? a : b)
const maxDate = (a: string, b: string): string => (a > b ? a : b)
