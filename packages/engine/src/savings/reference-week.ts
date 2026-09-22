import type { LoadProfile, LoadReading } from 'shared'

import { utcMsToLocalFields, zonedWallToUtcMs } from '../parser/datetime'

/**
 * D6 Teil 3 — DIE REFERENZWOCHE: die sieben zusammenhängenden Tage mit dem höchsten gemessenen
 * Tagesverbrauch.
 *
 * ── ⚠ WARUM NICHT DIE KÄLTESTE WOCHE, OBWOHL D6 DAS SO VORSAH ─────────────────────────────────
 * Eine Auswahl nach Kalendermonat („Dezember/Jänner/Februar", `estimateAnnualConsumption`) setzt
 * voraus, dass der Kunde HEIZlastgetrieben ist. Ein Betrieb mit Kühlhaus oder Klimatisierung hat
 * seine Spitzenwoche im August, und für ihn wählte die Winterregel ausgerechnet die schwächste
 * Zeit als Referenz. Das Maximum über ALLE Wochen trifft beide Fälle, ohne den Kunden vorher
 * einordnen zu müssen: es braucht weder eine Wetterreihe noch eine Verbrauchertyp-Kategorie,
 * sondern liest die Antwort aus seinem eigenen Lastgang ab.
 *
 * ⚠ Die Wahl ist damit bewusst die OBERE Schranke der vorliegenden Daten — dieselbe Haltung und
 * dieselbe Begründung wie bei der Rückfallregel in `estimateAnnualConsumption`: eine zu niedrig
 * geschätzte Jahresmenge legt eine Anlage aus, die in der starken Zeit nicht trägt. Der
 * Rückgabewert nennt Zeitraum und Rate, damit der Report die Schätzung als solche ausweisen kann.
 *
 * ── ⚠ NUR VOLLSTÄNDIGE KALENDERTAGE ───────────────────────────────────────────────────────────
 * Ein Lastgang beginnt selten um Mitternacht. Ein angebrochener Rand-Tag trüge nur einen Teil
 * seines Verbrauchs und zöge den Wochenschnitt nach unten — die Referenzwoche verschöbe sich dann
 * an eine Stelle, die bloss vollständiger gemessen ist. Vollständigkeit wird gegen die TATSÄCHLICHE
 * Länge des lokalen Tages geprüft, nicht gegen 96: ein Zeitumstellungstag hat 92 bzw. 100
 * Viertelstunden, und beide sind vollständig.
 */

/** Die Länge des Fensters. Sieben, damit jede Wochentagsform genau einmal darin vorkommt. */
export const REFERENCE_WEEK_DAYS = 7

/** Ein Tag der Referenzwoche mit seinen ECHTEN Messwerten, in Tagesreihenfolge. */
export type ReferenceWeekDay = {
  /** Lokaler Kalendertag, `YYYY-MM-DD`. */
  date: string
  /** 0 = Montag (dieselbe Zählung wie `utcMsToLocalFields`). */
  weekday: number
  /** Die Messwerte dieses Tages, chronologisch — unverändert aus dem Lastgang. */
  readings: LoadReading[]
  consumptionKwh: number
}

export type ReferenceWeek = {
  /** Erster Tag des Fensters (lokal, inklusiv). */
  fromDate: string
  /** Letzter Tag des Fensters (lokal, inklusiv). */
  toDate: string
  /** Bezugsenergie der sieben Tage in kWh. */
  consumptionKwh: number
  /** `consumptionKwh / 7` — die Rate, die der Report als „höchste gemessene Wochenrate" nennt. */
  rateKwhPerDay: number
  /** Die sieben Tage, chronologisch. Jeder Wochentag kommt genau einmal vor. */
  days: ReferenceWeekDay[]
}

/**
 * Die BEZUGS-Komponente eines Intervalls in kWh — wortgleich zu `annual-consumption.ts`, und aus
 * demselben Grund: Einspeisung ist kein negativer Verbrauch.
 */
function consumptionKwhOf(gridPowerKw: number, intervalHours: number): number {
  return Math.max(0, gridPowerKw) * intervalHours
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Lokaler Kalendertag als `YYYY-MM-DD` — dieselbe Ableitung wie in `buildMonthlyTariffComparison`. */
export function localDateKeyOf(ms: number, timeZone: string): string {
  const { year, month, day } = utcMsToLocalFields(ms, timeZone)
  return `${year}-${pad(month)}-${pad(day)}`
}

export function parseDateKey(key: string): [number, number, number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))]
}

/** Kalendertage weiterzählen — reine Kalenderarithmetik, ohne Zeitzone und damit ohne DST-Frage. */
export function addDays(key: string, days: number): string {
  const [year, month, day] = parseDateKey(key)
  const at = new Date(Date.UTC(year, month - 1, day + days))
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/** Lokale Mitternacht eines Kalendertags, in UTC-Millisekunden. */
export function localMidnightMs(date: string, timeZone: string): number {
  const [year, month, day] = parseDateKey(date)
  return zonedWallToUtcMs(year, month, day, 0, 0, 0, timeZone)
}

/**
 * Wie viele Intervalle ein lokaler Kalendertag TATSÄCHLICH trägt — 96 im Regelfall, 92 bzw. 100 an
 * den beiden Zeitumstellungstagen. Gemessen als Abstand zwischen zwei lokalen Mitternächten.
 */
export function slotsInLocalDay(date: string, timeZone: string, intervalMinutes: number): number {
  const start = localMidnightMs(date, timeZone)
  const end = localMidnightMs(addDays(date, 1), timeZone)
  return Math.round((end - start) / (intervalMinutes * 60 * 1000))
}

type DayTally = {
  date: string
  readings: LoadReading[]
  consumptionKwh: number
}

/** Die Messwerte nach lokalem Kalendertag, jeder Tag chronologisch sortiert. */
export function tallyByLocalDay(loadProfile: LoadProfile): Map<string, DayTally> {
  const intervalHours = loadProfile.intervalMinutes / 60
  const days = new Map<string, DayTally>()

  for (const reading of loadProfile.readings) {
    const ms = Date.parse(reading.ts)
    if (!Number.isFinite(ms)) continue
    const date = localDateKeyOf(ms, loadProfile.timezoneMeta)
    const tally = days.get(date)
    const kwh = consumptionKwhOf(reading.gridPowerKw, intervalHours)
    if (!tally) {
      days.set(date, { date, readings: [reading], consumptionKwh: kwh })
      continue
    }
    tally.readings.push(reading)
    tally.consumptionKwh += kwh
  }

  /* ⚠ Nach ZEIT und nicht nach Einlesereihenfolge: ein Lastgang muss nicht sortiert hereinkommen. */
  for (const tally of days.values()) {
    tally.readings.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  }
  return days
}

/**
 * Die verbrauchsstärkste zusammenhängende Woche — `null`, wenn es keine gibt.
 *
 * `null` heisst: der Lastgang trägt keine sieben aufeinanderfolgenden VOLLSTÄNDIGEN Kalendertage.
 * Das ist keine Fehlanzeige mit Ersatzwert: ohne Referenzwoche gibt es nichts, womit die fehlenden
 * Tage belegt werden könnten, und eine aus Bruchstücken zusammengesetzte Woche wäre eine erfundene.
 *
 * ⚠ Strikt grösser beim Vergleich, damit bei Gleichstand das FRÜHERE Fenster gewinnt — die Wahl
 * bliebe sonst von der Aufzählungsreihenfolge abhängig und damit nicht reproduzierbar.
 */
export function findReferenceWeek(loadProfile: LoadProfile): ReferenceWeek | null {
  const tz = loadProfile.timezoneMeta
  const days = tallyByLocalDay(loadProfile)

  const full = new Map<string, DayTally>()
  for (const tally of days.values()) {
    if (tally.readings.length === slotsInLocalDay(tally.date, tz, loadProfile.intervalMinutes)) {
      full.set(tally.date, tally)
    }
  }

  const starts = [...full.keys()].sort()
  let best: { start: string; window: DayTally[]; consumptionKwh: number } | null = null

  for (const start of starts) {
    const window: DayTally[] = []
    let consumptionKwh = 0
    for (let i = 0; i < REFERENCE_WEEK_DAYS; i++) {
      const tally = full.get(addDays(start, i))
      if (!tally) break
      window.push(tally)
      consumptionKwh += tally.consumptionKwh
    }
    if (window.length < REFERENCE_WEEK_DAYS) continue
    if (best === null || consumptionKwh > best.consumptionKwh) {
      best = { start, window, consumptionKwh }
    }
  }

  if (best === null) return null

  return {
    fromDate: best.start,
    toDate: addDays(best.start, REFERENCE_WEEK_DAYS - 1),
    consumptionKwh: best.consumptionKwh,
    rateKwhPerDay: best.consumptionKwh / REFERENCE_WEEK_DAYS,
    days: best.window.map((tally) => ({
      date: tally.date,
      weekday: utcMsToLocalFields(localMidnightMs(tally.date, tz), tz).weekday,
      readings: tally.readings,
      consumptionKwh: tally.consumptionKwh,
    })),
  }
}
