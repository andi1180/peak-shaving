import { describe, expect, it } from 'vitest'

import { pvArrayAzimuthDeg } from 'shared'

import { combinePvArrayYields, splitPvArrayDesigns, type PvArrayLike } from './pv-estimate'

/**
 * Die Prüfungen zu `pv-estimate.ts` — dem Modul, das mehrere Modulflächen zu EINER Ertragsschätzung
 * zusammenführt (B24, Teil 1, Phase B).
 *
 * ⚠ DER WÄCHTER, AUF DEN ES ANKOMMT, IST `combinePvArrayYields`. Die naheliegende falsche
 * Umsetzung — die Streuungen der Einzelflächen mitteln, statt je Wetterjahr zu summieren — liefert
 * eine Zahl in plausibler Grössenordnung, und niemand sähe ihr an, dass sie eine Eigenschaft
 * beschreibt, die die Anlage gar nicht hat. Der Fall unten ist deshalb bewusst so gewählt, dass die
 * beiden Wege nicht um ein paar Prozent auseinanderliegen, sondern qualitativ: **0 % gegen rund
 * 11 %**. Ein Test mit ähnlich ausgerichteten Flächen bliebe bei beiden Wegen grün.
 */

function array(
  peakPowerKwp: number | null,
  slopeDeg: number | null,
  direction: PvArrayLike['direction'],
): PvArrayLike {
  return { peakPowerKwp, slopeDeg, direction }
}

describe('splitPvArrayDesigns', () => {
  it('trennt vollständige von unvollständigen Flächen und nummeriert 1-basiert', () => {
    const split = splitPvArrayDesigns([
      array(4.25, 35, 'S'),
      array(null, 35, 'S'),
      array(5.95, 30, 'W'),
      array(3, null, 'O'),
      array(3, 30, null),
    ])

    expect(split.designs).toHaveLength(2)
    expect(split.designs[0]?.peakPowerKwp).toBe(4.25)
    expect(split.designs[1]?.peakPowerKwp).toBe(5.95)
    // Die Nummern sind das, woran ein Mensch die Zeile in der Zusammenfassung wiedererkennt.
    expect(split.incompleteNumbers).toEqual([2, 4, 5])
  })

  it('⚠ behandelt eine Neigung von 0° als ANGABE, nicht als fehlenden Wert', () => {
    // Ein flach aufliegendes Modul hat 0° Neigung. Über `!slopeDeg` geprüft fiele es als
    // unvollständig heraus — und die Anlage würde um diese Fläche zu klein geschätzt.
    const split = splitPvArrayDesigns([array(4.25, 0, 'S')])

    expect(split.incompleteNumbers).toEqual([])
    expect(split.designs).toHaveLength(1)
    expect(split.designs[0]?.slopeDeg).toBe(0)
  })

  it('⚠ rechnet den Kompassgrad über `pvArrayAzimuthDeg` in die PVGIS-Konvention um', () => {
    // Die teuerste Verwechslung dieses Bauabschnitts: PV*SOL zählt vom Norden, PVGIS vom Süden.
    // Eine hier abgetippte Formel kostet gemessen 56 % der ausgewiesenen Ersparnis — und die
    // falsche Zahl sieht völlig plausibel aus.
    const split = splitPvArrayDesigns([array(4.25, 35, 'S'), array(4.25, 35, 'W')])

    expect(split.designs[0]?.azimuthDeg).toBe(
      pvArrayAzimuthDeg({ peakPowerKwp: 4.25, slopeDeg: 35, direction: 'S' }),
    )
    expect(split.designs[1]?.azimuthDeg).toBe(
      pvArrayAzimuthDeg({ peakPowerKwp: 4.25, slopeDeg: 35, direction: 'W' }),
    )
    // Süden ist in der PVGIS-Konvention die 0 — der Anker, an dem eine gedrehte Umrechnung auffällt.
    expect(split.designs[0]?.azimuthDeg).toBe(0)
  })

  it('liefert bei gar keiner Fläche zwei leere Listen', () => {
    expect(splitPvArrayDesigns([])).toEqual({ designs: [], incompleteNumbers: [] })
  })
})

describe('combinePvArrayYields', () => {
  /*
   * Zwei Flächen, deren Jahressummen sich exakt aufheben — eine hat 2014 ihr bestes und 2015 ihr
   * schlechtestes Jahr, die andere umgekehrt. Genau die Kompensation, wegen der ein Dach aus
   * mehreren Ausrichtungen gleichmässiger liefert als jede seiner Flächen.
   */
  const OST = [
    { year: 2014, kwh: 1000 },
    { year: 2015, kwh: 800 },
  ]
  const WEST = [
    { year: 2014, kwh: 800 },
    { year: 2015, kwh: 1000 },
  ]

  it('⚠ summiert JE WETTERJAHR und fasst erst danach zusammen', () => {
    const combined = combinePvArrayYields([OST, WEST])

    expect(combined).not.toBeNull()
    expect(combined?.annualYields).toEqual([
      { year: 2014, kwh: 1800 },
      { year: 2015, kwh: 1800 },
    ])
    expect(combined?.spread.meanKwh).toBe(1800)

    /*
     * ⚠ DIE ZAHL, DIE DEN TEST TRÄGT. Richtig gerechnet ist die Streuung der SUMME exakt 0 % — die
     * beiden Flächen gleichen einander vollständig aus. Wer stattdessen die Einzel-Streuungen
     * mittelt, landet bei (1000 − 800) / 2 / 900 = 11,1 % und weist damit eine Schwankung aus, die
     * die Anlage nicht hat. Beide Zahlen sehen plausibel aus; nur diese hier ist wahr.
     */
    expect(combined?.spread.spreadPercent).toBe(0)

    // Die falsche Zahl ausdrücklich benannt — sonst bliebe der Test auch grün, wenn 0 % aus einem
    // anderen Grund herauskäme.
    const wrongAverageOfSpreads = ((1000 - 800) / 2 / 900) * 100
    expect(wrongAverageOfSpreads).toBeCloseTo(11.11, 2)
    expect(combined?.spread.spreadPercent).not.toBeCloseTo(wrongAverageOfSpreads, 2)
  })

  it('behält bei EINER Fläche deren eigene Streuung', () => {
    const combined = combinePvArrayYields([OST])

    expect(combined?.spread.meanKwh).toBe(900)
    expect(combined?.spread.spreadPercent).toBeCloseTo(11.11, 2)
  })

  it('liefert `null` ohne jede Fläche — keine Aussage, nicht Ertrag 0', () => {
    expect(combinePvArrayYields([])).toBeNull()
  })

  it('⚠ liefert `null`, wenn die Jahressätze der Flächen auseinandergehen', () => {
    /*
     * Über den Index summiert (statt über das Jahr) stünde der Ertrag von 2015 der einen Fläche
     * neben dem von 2014 der anderen — die Summe wäre eine Zahl in plausibler Grössenordnung, und
     * niemand könnte ihr ansehen, dass sie zwei verschiedene Jahre addiert.
     */
    const other = [
      { year: 2015, kwh: 800 },
      { year: 2016, kwh: 1000 },
    ]

    expect(combinePvArrayYields([OST, other])).toBeNull()
  })

  it('liefert `null` bei einer leeren Fläche und bei einem doppelten Jahr in derselben Fläche', () => {
    expect(combinePvArrayYields([OST, []])).toBeNull()
    expect(
      combinePvArrayYields([
        [
          { year: 2014, kwh: 1000 },
          { year: 2014, kwh: 1000 },
        ],
      ]),
    ).toBeNull()
  })
})
