import { describe, expect, it } from 'vitest'
import type { LoadProfile, LoadReading } from 'shared'

import {
  PV_NEAR_ZERO_KW,
  PV_OUTAGE_MIN_DAYS_PER_MONTH,
  detectPvOutageMonths,
} from './outage-months'

/**
 * D5 — die Ausfallerkennung sieht eine ABWESENHEIT. Geprüft wird deshalb an Fixtures, die sich nur
 * im Mittagsverhalten unterscheiden: gleicher Grundverbrauch, gleiche Abdeckung, gleiche Zeitzone.
 */

const TZ = 'Europe/Vienna'
const SLOTS_PER_DAY = 96

/** Tage je Monat 2025 — die Fixtures decken ganze Monate ab, Schaltjahre spielen keine Rolle. */
const DAYS_IN_MONTH_2025 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * Ein Monat als Viertelstundenreihe: Grundlast 30 kW, und um 12:00 Ortszeit der Wert, den
 * `middayKw` für diesen Tag liefert. `null` heisst „kein Einbruch" — dann bleibt die Grundlast.
 *
 * ⚠ Erzeugt wird in UTC über den festen Winter-/Sommerversatz, damit die Fixture ohne
 * Zeitzonen-Bibliothek auskommt. Die Erkennung selbst rechnet in Ortszeit (`utcMsToLocalFields`);
 * geprüft wird mit 12:00 mittig im Fenster, also weit von den 10/16-Kanten entfernt — ein um eine
 * Stunde verfehlter Versatz könnte das Ergebnis hier gar nicht kippen.
 */
function month(
  year: number,
  monthNumber: number,
  middayKw: (day: number) => number | null,
): LoadReading[] {
  const offsetHours = monthNumber >= 4 && monthNumber <= 10 ? 2 : 1
  const readings: LoadReading[] = []

  for (let day = 1; day <= (DAYS_IN_MONTH_2025[monthNumber - 1] ?? 30); day += 1) {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
      const localMinutes = slot * 15
      const ms = Date.UTC(year, monthNumber - 1, day, 0, localMinutes - offsetHours * 60)
      const dip = middayKw(day)
      const isMidday = localMinutes === 12 * 60
      readings.push({
        ts: new Date(ms).toISOString(),
        gridPowerKw: isMidday && dip !== null ? dip : 30,
      })
    }
  }
  return readings
}

function profileOf(readings: LoadReading[]): LoadProfile {
  return { readings, intervalMinutes: 15, timezoneMeta: TZ, source: 'net_signed' }
}

/** Jeder Tag speist mittags ein — eine Anlage, die sichtbar arbeitet. */
const working = () => -12
/** Mittags nur gedämpft, nie nahe null — das Ausfallmuster. */
const outage = () => 21

describe('detectPvOutageMonths', () => {
  it('meldet nichts, wenn jeder Monat seinen Mittagseinbruch zeigt', () => {
    const readings = [4, 5, 6, 7, 8, 9].flatMap((m) => month(2025, m, working))

    expect(detectPvOutageMonths(profileOf(readings))).toEqual([])
  })

  it('erkennt genau die Monate ohne Einbruch (Urbanz-Muster: Februar bis April)', () => {
    const readings = [
      month(2025, 1, working),
      month(2025, 2, outage),
      month(2025, 3, outage),
      month(2025, 4, outage),
      month(2025, 5, working),
      month(2025, 6, working),
    ].flat()

    const found = detectPvOutageMonths(profileOf(readings))

    expect(found.map((m) => m.month)).toEqual([2, 3, 4])
    expect(found[0]).toMatchObject({ year: 2025, month: 2, daysWithDayWindowData: 28 })
    // Der Beleg reist mit: der kleinste Mittagswert lag über der Schwelle, nicht darunter.
    expect(found[0]?.minDayWindowKw).toBe(21)
    expect(found.every((m) => m.minDayWindowKw >= PV_NEAR_ZERO_KW)).toBe(true)
  })

  it('bewertet einen Monat unter der Mindest-Tageszahl nicht', () => {
    /*
     * Mai vollständig mit Einbruch (die Referenz), Juni nur bis zum 19. — also ein Tag zu wenig —
     * und in diesen 19 Tagen KEIN Einbruch. Ohne die Mindestzahl stünde Juni als Treffer da.
     *
     * Gefiltert wird am UTC-Datum der Kennung; für das Tagfenster ist das dasselbe Datum wie in
     * Ortszeit (10–16 Uhr MESZ = 08–14 Uhr UTC), und nur die Fenster-Tage werden gezählt.
     */
    const partial = month(2025, 6, outage).filter(
      (r) => Number(r.ts.slice(8, 10)) <= PV_OUTAGE_MIN_DAYS_PER_MONTH - 1,
    )
    const readings = [...month(2025, 5, working), ...partial]

    expect(detectPvOutageMonths(profileOf(readings))).toEqual([])
  })

  it('meldet nichts, wenn der Lastgang nirgends einen Einbruch belegt', () => {
    /*
     * Die Referenzbedingung. Zwölf Monate ohne Mittagseinbruch sind nicht von einer Anlage zu
     * unterscheiden, die für diesen Betrieb zu klein ist, um je sichtbar zu werden — dann sagt die
     * Funktion nichts, statt zwölf Ausfälle zu behaupten.
     */
    const readings = [1, 2, 3, 4, 5, 6].flatMap((m) => month(2025, m, outage))

    expect(detectPvOutageMonths(profileOf(readings))).toEqual([])
  })

  it('erkennt einen schwachen Wintermonat als Treffer — bekannte Einschränkung', () => {
    /*
     * ⚠ POSITIV-KONTROLLE MIT UMGEKEHRTEM VORZEICHEN: Dezember hat hier eine ARBEITENDE, aber
     * schwache Anlage (mittags 8 kW statt 30 — deutlich sichtbar, nur nicht nahe null) und wird
     * trotzdem gemeldet. Das ist kein Fehler dieses Tests, sondern die im Modulkopf benannte offene
     * Einschränkung: die Schwelle ist absolut und kennt keine Jahreszeit. Der Test pinnt das
     * Verhalten, damit ein späterer saisonaler Ausbau als ABSICHTLICHE Änderung sichtbar wird.
     */
    const readings = [...month(2025, 7, working), ...month(2025, 12, () => 8)]

    const found = detectPvOutageMonths(profileOf(readings))

    expect(found.map((m) => m.month)).toEqual([12])
    expect(found[0]?.minDayWindowKw).toBe(8)
  })
})
