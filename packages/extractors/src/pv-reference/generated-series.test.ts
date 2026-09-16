import { describe, expect, it } from 'vitest'

import {
  GENERATED_PV_SERIES_FORMAT,
  buildGeneratedPvSeriesFile,
  sumReferenceHourlySeries,
  type GeneratedPvSeriesDocument,
} from './generated-series'

/**
 * Die abgelegte Schätzreihe: Summe über die Flächen, Zeitstempel des Lastgangs, zwei Metadaten.
 *
 * ⚠ KEIN PVGIS-ABRUF UND KEINE ATTRAPPE. Was hier schiefgehen kann, ist rein rechnerisch — eine
 * falsch summierte Fläche, ein neu formatierter Zeitstempel, ein verlorenes Metadatum. Der Netzweg
 * darum herum ist in `apps/web/lib/pv-reference.test.ts` gemessen.
 */

const HOURS = 8760

/** Eine Modulfläche als Tagesform: Leistung nur zur angegebenen UTC-Stunde. */
function arrayAt(hour: number, kw: number): number[] {
  return Array.from({ length: HOURS }, (_, i) => (i % 24 === hour ? kw : 0))
}

const EAST = arrayAt(8, 6) // Ostfläche: Morgenspitze
const WEST = arrayAt(16, 4) // Westfläche: Nachmittagsspitze

describe('sumReferenceHourlySeries — zwei Flächen, eine Anlagenkurve', () => {
  it('summiert elementweise über alle 8.760 Zellen', () => {
    const total = sumReferenceHourlySeries([EAST, WEST])

    expect(total).toHaveLength(HOURS)
    // Jede Zelle, nicht nur eine Stichprobe: eine über den Index verschobene Summe bliebe sonst grün.
    expect(total.every((value, i) => value === (EAST[i] ?? 0) + (WEST[i] ?? 0))).toBe(true)
    // Die zwei Tagesformen bleiben unterscheidbar — gemittelt stünde hier zweimal dieselbe Zahl.
    expect(total[8]).toBe(6)
    expect(total[16]).toBe(4)
    expect(total.reduce((a, b) => a + b, 0)).toBeCloseTo(365 * 10, 6)
  })
})

describe('buildGeneratedPvSeriesFile', () => {
  /*
   * ⚠ DIE ZEITSTEMPEL SIND ABSICHTLICH UNEINHEITLICH GESCHRIEBEN: einer mit Zonenversatz, einer
   * ohne Millisekunden, einer in der kanonischen Form. Ein Leser, der sie über `Date` neu bildete,
   * lieferte drei kanonische Zeichenketten zurück — und die Zuordnung zum Lastgang
   * (`alignPvGrossToLoad`, exakter ISO-String-Vergleich) liefe für zwei davon ins Leere, ohne dass
   * irgendetwas fehlschlüge.
   */
  const TIMESTAMPS = [
    '2025-01-02T08:00:00.000Z',
    '2025-01-02T09:00:00Z',
    '2025-01-02T17:00:00+01:00', // = 16:00 UTC
  ]

  const META = { weatherYears: { from: 2014, to: 2023 }, smoothingOptimismPercent: 4.9 }

  function build(): GeneratedPvSeriesDocument {
    const file = buildGeneratedPvSeriesFile({
      hourlySeries: [EAST, WEST],
      timestamps: TIMESTAMPS,
      ...META,
    })
    expect(file.readingCount).toBe(TIMESTAMPS.length)
    return JSON.parse(file.text) as GeneratedPvSeriesDocument
  }

  it('legt die summierte Reihe auf die ECHTEN Zeitstempel — Zeichen für Zeichen dieselben', () => {
    const document = build()

    expect(document.readings.map((r) => r.ts)).toEqual(TIMESTAMPS)
    // Die Werte stammen aus der SUMME und folgen der UTC-Stunde, nicht der Position in der Reihe.
    expect(document.readings.map((r) => r.pvGenerationKw)).toEqual([6, 0, 4])
  })

  it('speichert die zwei Metadaten mit — sie überleben den Entwurf', () => {
    const document = build()

    expect(document.format).toBe(GENERATED_PV_SERIES_FORMAT)
    expect(document.weatherYears).toEqual({ from: 2014, to: 2023 })
    expect(document.smoothingOptimismPercent).toBe(4.9)
  })
})
