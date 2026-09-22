import { describe, expect, it } from 'vitest'
import type { MonthlyChargePrice } from 'shared'

import { buildChargePrice } from './insight'

/**
 * Die zwei Mengen des Ladepreis-Kapitels stehen UNTEREINANDER und werden verglichen — sie müssen
 * deshalb dieselbe Genauigkeit zeigen, auch wenn eine davon zufällig glatt aufgeht.
 */
const MONTHS = 12
const fill = <T>(value: T, first: T): T[] => [first, ...Array<T>(MONTHS - 1).fill(value)]

/** Ein einziger gemessener Monat — die Gesamtzahlen sind damit genau die Werte dieses Monats. */
function priceFor(chargedKwh: number, dischargedKwh: number): MonthlyChargePrice {
  return {
    chargeCtPerKwh: fill(null, 8.1),
    dischargeCtPerKwh: fill(null, 21.4),
    averageCtPerKwh: fill(null, 14.0),
    chargedKwh: fill(null, chargedKwh),
    dischargedKwh: fill(null, dischargedKwh),
  }
}

function values(price: MonthlyChargePrice): string[] {
  return buildChargePrice(price).statement.rows.map((row) => String(row.value))
}

describe('Ladepreis-Kapitel — die beiden Mengen', () => {
  it('zeigt beide mit einer Nachkommastelle, auch die glatte', () => {
    const [geladen, entladen] = values(priceFor(2679.6, 2402))

    /* `\u00a0` ist der Gruppentrenner aus Intl (de-AT) — im Quelltext nicht von einem
       gewöhnlichen Leerzeichen zu unterscheiden, deshalb ausgeschrieben. */
    expect(geladen).toContain('2\u00a0679,6 kWh bezogen')
    expect(entladen).toContain('2\u00a0402,0 kWh abgegeben')
  })

  it('lässt eine Menge von 0 weiterhin ganz weg — die Zeile sagt „—"', () => {
    const [geladen] = values(priceFor(0, 2402))
    expect(geladen).toBe('—')
  })
})
