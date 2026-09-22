import { describe, expect, it } from 'vitest'

import { evenAxisTicks } from './chart-ticks'

const steps = (ticks: number[]) => ticks.slice(1).map((v, i) => Number((v - ticks[i]!).toFixed(6)))

describe('evenAxisTicks', () => {
  /*
   * Der gemeldete Fall: die Grenznutzen-Kurve des Urbanz-Reports lag durchgehend im Minus und
   * bekam von Recharts 0/-10k/-30k/-50k/-70k — erster Abstand 10k, die folgenden 20k. Gemessen an
   * `getTickValuesFixedDomain([-70000, 0], 5)` aus recharts 3.9.2.
   */
  it('vergibt bei durchgehend negativen Werten gleich grosse Abstände und behält die Null', () => {
    const axis = evenAxisTicks(-66_400, 0)
    expect(axis).not.toBeNull()
    expect(new Set(steps(axis!.ticks)).size).toBe(1)
    expect(axis!.ticks).toContain(0)
    expect(axis!.domain[0]).toBeLessThanOrEqual(-66_400)
  })

  it('legt die Null auch bei Werten beiderseits der Achse auf einen Tick', () => {
    const axis = evenAxisTicks(-12.6, 88.2)
    expect(new Set(steps(axis!.ticks)).size).toBe(1)
    expect(axis!.ticks).toContain(0)
  })

  it('lehnt einen Bereich ohne Spanne ab, statt eine zu erfinden', () => {
    expect(evenAxisTicks(5, 5)).toBeNull()
    expect(evenAxisTicks(0, Number.POSITIVE_INFINITY)).toBeNull()
  })
})
