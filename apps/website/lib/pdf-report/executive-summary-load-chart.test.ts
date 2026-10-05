import { describe, expect, it } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES as CASES } from '@/test/executive-summary-cases'
import { buildExecutiveSummary } from './executive-summary'
import { EXEC_SLOTS } from './executive-summary-layout'
import { loadChartOf, splitAtCap, type LoadInput } from './executive-summary-load-chart'

const loadOf = (name: string) => buildExecutiveSummary(CASES[name]!)!.load

/** Die Begrenzung des Modells für einen Tag, unabhängig vom Diagramm nachgeschlagen. */
function modelCap(load: LoadInput, day: string): number | null {
  const noon = Date.parse(`${day}T12:00:00Z`)
  return load.capSegments?.find((s) => s.startMs <= noon && noon < s.endMs)?.capKw ?? null
}

describe('splitAtCap', () => {
  it('unter, auf und über der Begrenzung; ohne Begrenzung alles Basis', () => {
    expect(splitAtCap(20, 30)).toEqual({ base: 20, above: 0 })
    expect(splitAtCap(30, 30)).toEqual({ base: 30, above: 0 })
    expect(splitAtCap(42, 30)).toEqual({ base: 30, above: 12 })
    expect(splitAtCap(42, null)).toEqual({ base: 42, above: 0 })
  })
})

describe('loadChartOf', () => {
  it('Müldür-Jahr: ein Balken je Messtag mit den Werten des Modells', () => {
    const load = loadOf('jahr (Müldür)')
    const chart = loadChartOf(load, EXEC_SLOTS.load)!
    expect(chart.bars).toHaveLength(load.dailyPeaks.length)
    expect(chart.bars.map((b) => [b.day, b.peakKw])).toEqual(
      load.dailyPeaks.map((p) => [p.day, p.peakKw]),
    )
    for (const bar of chart.bars) expect(bar.base + bar.above).toBeCloseTo(bar.peakKw, 9)
    expect(chart.bars.some((b) => b.above > 0)).toBe(true)
    expect(chart.capLines.length).toBeGreaterThan(0)
    expect(chart.legend.map((l) => l.text)).toEqual([
      'Höchste Leistung pro Tag',
      'Spitzen, die der Speicher abfängt',
      'Begrenzung mit Speicher (Höchstwert)',
    ])
    expect(new Set(chart.legend.map((l) => l.row))).toEqual(new Set([0]))
    expect(chart.months.map((m) => m.text)).toEqual(['Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug'])
  })

  it('gezeichnete Begrenzung je Tag = Modell (Positivkontrolle: 1 kW Abweichung fällt auf)', () => {
    const load = loadOf('jahr (Müldür)')
    const drawn = (input: LoadInput) =>
      Object.fromEntries(loadChartOf(input, EXEC_SLOTS.load)!.capByDay)
    const expected = Object.fromEntries(
      load.dailyPeaks.map((p) => [p.day, modelCap(load, p.day)]).filter(([, cap]) => cap !== null),
    )
    expect(drawn(load)).toMatchObject(expected)
    const shifted = {
      ...load,
      capSegments: load.capSegments!.map((s, i) => (i === 1 ? { ...s, capKw: s.capKw + 1 } : s)),
    }
    expect(drawn(shifted)).not.toMatchObject(expected)
  })

  it('rote Punkte: genau die Tage über der Linie, an der Tagesspitze (Positivkontrolle)', () => {
    const load = loadOf('jahr (Müldür)')
    const chart = loadChartOf(load, EXEC_SLOTS.load)!
    const expected = load.dailyPeaks
      .filter((p) => splitAtCap(p.peakKw, modelCap(load, p.day)).above > 0)
      .map((p) => [p.day, chart.y(p.peakKw)])
    const drawn = (dots: typeof chart.dots) => dots.map((d) => [d.day, d.y])
    expect(expected.length).toBeGreaterThan(0)
    expect(drawn(chart.dots)).toEqual(expected)
    // Ein fehlender oder um 1 kW versetzter Punkt fällt auf.
    expect(drawn(chart.dots.slice(1))).not.toEqual(expected)
    const shifted = chart.dots.map((d, i) => (i === 0 ? { ...d, y: chart.y(d.peakKw + 1) } : d))
    expect(drawn(shifted)).not.toEqual(expected)
  })

  it('Linie gilt für die Tage ihres Monats', () => {
    const march = Date.parse('2026-02-28T23:00:00Z')
    const april = Date.parse('2026-03-31T22:00:00Z')
    const may = Date.parse('2026-04-30T22:00:00Z')
    const chart = loadChartOf(
      {
        dailyPeaks: [
          { day: '2026-03-31', peakKw: 40 },
          { day: '2026-04-01', peakKw: 40 },
        ],
        capSegments: [
          { startMs: march, endMs: april, capKw: 10 },
          { startMs: april, endMs: may, capKw: 20 },
        ],
      },
      EXEC_SLOTS.load,
    )!
    expect(chart.bars.map((b) => [b.capKw, b.base, b.above])).toEqual([
      [10, 10, 30],
      [20, 20, 20],
    ])
  })

  it('ohne Begrenzung: keine Linie, kein Akzentteil, nur die Basislegende', () => {
    const chart = loadChartOf(loadOf('nur-tarif (Katalog leer)'), EXEC_SLOTS.load)!
    expect(chart.capLines).toEqual([])
    expect(chart.dots).toEqual([])
    expect(chart.bars.every((b) => b.above === 0)).toBe(true)
    expect(chart.legend.map((l) => l.text)).toEqual(['Höchste Leistung pro Tag'])
  })

  it('ohne Tagesspitzen: kein Diagramm', () => {
    expect(loadChartOf({ dailyPeaks: [], capSegments: null }, EXEC_SLOTS.load)).toBeNull()
  })
})
