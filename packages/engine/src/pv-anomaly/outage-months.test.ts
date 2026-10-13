import { describe, expect, it } from 'vitest'
import type { LoadProfile, LoadReading } from 'shared'

import {
  PV_NEAR_ZERO_KW,
  PV_OUTAGE_MIN_DAYS_PER_MONTH,
  PV_STRONG_MONTH_MIN_DAYS,
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
/** Nur an den ersten `days` Tagen ein Einbruch — sonst das Ausfallmuster. */
const workingOn = (days: number) => (day: number) => (day <= days ? -12 : 21)

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

  it('meldet einen Wintermonat ohne starken Nachbarn nicht — er ist kein belastbares Signal', () => {
    /*
     * Dezember hat hier eine ARBEITENDE, aber schwache Anlage (mittags 8 kW statt 30 — sichtbar,
     * nur nicht nahe null). Eine absolute Schwelle kann das nicht unterscheiden; ohne starken
     * Nachbarmonat (hier: gar keiner) ist ein Winter-Monat ohne Einbruch kein belastbares Signal.
     */
    const alone = [...month(2025, 7, working), ...month(2025, 12, () => 8)]
    expect(detectPvOutageMonths(profileOf(alone))).toEqual([])

    // Mit einem starken November davor bleibt die Schwelle absolut: der Dezember wird gemeldet.
    const withStrongNeighbour = [...alone, ...month(2025, 11, working)]
    const found = detectPvOutageMonths(profileOf(withStrongNeighbour))
    expect(found.map((m) => m.month)).toEqual([12])
    expect(found[0]?.minDayWindowKw).toBe(8)
  })

  describe('Kontinuitätsregel: eine Folge zählt nur mit starkem Nachbarmonat', () => {
    const weak = workingOn(3)

    it('meldet eine Folge mit starkem Nachbarn davor', () => {
      const readings = [
        month(2025, 5, working),
        month(2025, 6, outage),
        month(2025, 7, weak),
      ].flat()
      expect(detectPvOutageMonths(profileOf(readings)).map((m) => m.month)).toEqual([6])
    })

    it('meldet eine Folge mit starkem Nachbarn danach', () => {
      const readings = [
        month(2025, 5, weak),
        month(2025, 6, outage),
        month(2025, 7, working),
      ].flat()
      expect(detectPvOutageMonths(profileOf(readings)).map((m) => m.month)).toEqual([6])
    })

    it('verwirft eine Folge ohne starken Nachbarn — auch eine mehrmonatige als Ganzes', () => {
      const single = [month(2025, 5, weak), month(2025, 6, outage), month(2025, 7, weak)].flat()
      expect(detectPvOutageMonths(profileOf(single))).toEqual([])

      const run = [
        month(2025, 4, weak),
        month(2025, 5, outage),
        month(2025, 6, outage),
        month(2025, 7, weak),
      ].flat()
      expect(detectPvOutageMonths(profileOf(run))).toEqual([])
    })

    it('trennt „stark" an der Grenze: 9 Tage zu wenig, 10 genug', () => {
      expect(PV_STRONG_MONTH_MIN_DAYS).toBe(10)
      const at = (days: number) =>
        detectPvOutageMonths(
          profileOf([month(2025, 5, workingOn(days)), month(2025, 6, outage)].flat()),
        )

      expect(at(PV_STRONG_MONTH_MIN_DAYS - 1)).toEqual([])
      expect(at(PV_STRONG_MONTH_MIN_DAYS).map((m) => m.month)).toEqual([6])
    })

    it('zählt einen unbeurteilten Nachbarn (unter 20 Tagen) nicht als stark', () => {
      /* Mai: 19 Tage, alle mit Einbruch — „stark" nach Tagen, aber unter der Mindest-Tageszahl.
         August liefert die Referenz, ist aber kein Nachbar von Juni. */
      const may = month(2025, 5, working).filter(
        (r) => Number(r.ts.slice(8, 10)) <= PV_OUTAGE_MIN_DAYS_PER_MONTH - 1,
      )
      const readings = [...may, ...month(2025, 6, outage), ...month(2025, 8, working)]

      expect(detectPvOutageMonths(profileOf(readings))).toEqual([])
    })

    it('kennt am Datenrand nur den vorhandenen Nachbarn, und eine Lücke ist keine Nachbarschaft', () => {
      // Anfang der Daten: nur der Nachbar danach zählt.
      const start = [month(2025, 6, outage), month(2025, 7, working)].flat()
      expect(detectPvOutageMonths(profileOf(start)).map((m) => m.month)).toEqual([6])

      // Ende der Daten, Nachbar davor schwach: verworfen.
      const end = [month(2025, 5, workingOn(3)), month(2025, 6, outage)].flat()
      expect(detectPvOutageMonths(profileOf(end))).toEqual([])

      // Juni fehlt: der starke Mai grenzt nicht an den Juli.
      const gap = [month(2025, 5, working), month(2025, 7, outage)].flat()
      expect(detectPvOutageMonths(profileOf(gap))).toEqual([])
    })

    it('behandelt den Jahreswechsel als Nachbarschaft (Dez 2025 / Jan 2026)', () => {
      const after = [month(2025, 12, outage), month(2026, 1, working)].flat()
      expect(detectPvOutageMonths(profileOf(after))).toMatchObject([{ year: 2025, month: 12 }])

      const before = [month(2025, 12, working), month(2026, 1, outage)].flat()
      expect(detectPvOutageMonths(profileOf(before))).toMatchObject([{ year: 2026, month: 1 }])
    })
  })
})
