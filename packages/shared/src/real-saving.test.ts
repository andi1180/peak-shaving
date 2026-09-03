import { describe, expect, it } from 'vitest'

import { buildRealSavingBreakdown, sumCovered } from './real-saving'

describe('buildRealSavingBreakdown', () => {
  /*
   * Die Gegenprobe des Bau-Auftrags, an echten Zahlen aus dem Urbanz-Lauf (02.09.2026):
   * Ihr Tarif € 770 · aWATTar ohne Steuerung € 890 · aWATTar mit Speicher € 686.
   *
   * ⚠ Der reine Wechsel ist NEGATIV. Ein Test, der nur die positive Gesamtzahl prüft, liesse eine
   * Umsetzung durchgehen, die das Vorzeichen der ersten Zeile verschluckt — und genau die Zeile
   * ist die Auskunft, die der Kunde sonst nirgends bekommt.
   */
  it('teilt den realen Vorteil in Tarifwechsel und Ladesteuerung — der Wechsel allein ist teurer', () => {
    const b = buildRealSavingBreakdown({
      currentTariffEur: 770,
      spotWithoutControlEur: 890,
      spotWithBatteryEur: 686,
    })
    expect(b.tariffSwitchEur).toBe(-120)
    expect(b.controlValueEur).toBe(204)
    expect(b.totalEur).toBe(84)
  })

  /*
   * ⚠ DER EIGENTLICHE WÄCHTER: die Kopfzahl MUSS die Summe der beiden angezeigten Zeilen sein.
   * Sie stehen im Report untereinander; weicht die Summe ab, ist das für einen Leser ein
   * Rechenfehler — dieselbe Art Differenz, die am 02.09.2026 zwischen Monatsvergleich und
   * Ersparnis-Karte auffiel, diesmal von vornherein ausgeschlossen statt später gefunden.
   */
  it('die Kopfzahl ist bit-genau die Summe der beiden Zeilen', () => {
    const cases: Array<[number, number, number]> = [
      [770, 890, 686],
      [769.73, 890.07, 685.85],
      [0, 0, 0],
      [1234.56, 1111.11, 999.99],
      [-12.5, 8.25, 100.125],
      [1e16, 1, 2],
    ]
    for (const [currentTariffEur, spotWithoutControlEur, spotWithBatteryEur] of cases) {
      const b = buildRealSavingBreakdown({
        currentTariffEur,
        spotWithoutControlEur,
        spotWithBatteryEur,
      })
      expect(b.totalEur).toBe(b.tariffSwitchEur + b.controlValueEur)
    }
  })

  /*
   * ⚠ WARUM DIE SUMME UND NICHT `current − withBattery`: die beiden Wege sind rechnerisch
   * identisch und in IEEE-754 nicht immer. Dieser Eingang lässt sie messbar auseinanderlaufen —
   * er pinnt damit die Entscheidung im Modulkopf, statt sie nur zu behaupten. Bei realistischen
   * Beträgen liegen beide Wege dagegen exakt aufeinander (erster Fall).
   */
  it('summiert die Teile, statt die Differenz unabhängig zu rechnen', () => {
    const totals = { currentTariffEur: 1e16, spotWithoutControlEur: 1, spotWithBatteryEur: 2 }
    const b = buildRealSavingBreakdown(totals)
    const naive = totals.currentTariffEur - totals.spotWithBatteryEur
    expect(b.totalEur).not.toBe(naive)
    expect(b.totalEur).toBe(b.tariffSwitchEur + b.controlValueEur)
  })

  it('rundet nichts — gerundet wird erst beim Formatieren', () => {
    const b = buildRealSavingBreakdown({
      currentTariffEur: 769.73,
      spotWithoutControlEur: 890.07,
      spotWithBatteryEur: 685.85,
    })
    expect(b.tariffSwitchEur).toBeCloseTo(-120.34, 10)
    expect(b.controlValueEur).toBeCloseTo(204.22, 10)
    expect(b.totalEur).toBeCloseTo(83.88, 10)
  })
})

describe('sumCovered', () => {
  /*
   * ⚠ DER GANZE PUNKT DIESER FUNKTION: `null` heisst „kein Messwert" und trägt NICHTS bei — es ist
   * ausdrücklich keine 0. Eine Umsetzung, die `null` als 0 behandelt, liefert für diese Reihe
   * dieselbe Summe und ist trotzdem falsch, sobald jemand die Zahl der belegten Monate danebenlegt.
   * Der Test misst deshalb beides: die Summe UND dass ein `null`-Monat den Wert nicht verändert.
   */
  it('summiert nur die belegten Monate — `null` trägt nichts bei', () => {
    const withGaps = [34.59, null, 267.14, null, 16.8, null, null, null, null, null, null, null]
    const dense = [34.59, 267.14, 16.8]
    expect(sumCovered(withGaps)).toBe(sumCovered(dense))
    expect(sumCovered(withGaps)).toBeCloseTo(318.53, 10)
  })

  it('eine Reihe ganz ohne Messwerte ergibt 0, nicht NaN', () => {
    expect(sumCovered([null, null, null])).toBe(0)
    expect(sumCovered([])).toBe(0)
  })

  /*
   * Eine echte 0 ist eine ANGABE („gemessen, kostet nichts") und muss von `null` unterscheidbar
   * bleiben — für die Summe sind beide folgenlos, aber die Zeile pinnt, dass 0 nicht etwa
   * verworfen wird.
   */
  it('behandelt eine echte 0 als Messwert und nicht als Lücke', () => {
    expect(sumCovered([0, 5])).toBe(5)
    expect(sumCovered([-12.5, 8.25])).toBeCloseTo(-4.25, 10)
  })

  /*
   * ⚠ DIE EIGENTLICHE ZUSAGE DES UMZUGS NACH `shared` (B23c-1): Bildschirm-Karte und PDF-Summary
   * lesen DIESELBE Funktion, und die Kopfzahl der Aufschlüsselung entsteht aus ihren Summen. Der
   * Durchstich pinnt die Kette Reihe → Summe → Aufschlüsselung an den dokumentierten Urbanz-Werten
   * (02.09.2026: 769,73 / 890,07 / 685,85 €).
   */
  it('speist die Aufschlüsselung — Reihen mit Lücken ergeben die dokumentierten Summen', () => {
    const current = [34.59, 267.14, 118.4, 154.29, 74.13, 16.8, 67.0, 37.38, null, null, null, null]
    const without = [30.0, 340.07, 150.0, 120.0, 95.0, 20.0, 90.0, 45.0, null, null, null, null]
    const withBattery = [26.47, 245.79, 128.0, 87.92, 78.56, 15.91, 68.0, 35.2, null, null, null, null]

    expect(sumCovered(current)).toBeCloseTo(769.73, 10)
    expect(sumCovered(without)).toBeCloseTo(890.07, 10)
    expect(sumCovered(withBattery)).toBeCloseTo(685.85, 10)

    const b = buildRealSavingBreakdown({
      currentTariffEur: sumCovered(current),
      spotWithoutControlEur: sumCovered(without),
      spotWithBatteryEur: sumCovered(withBattery),
    })
    expect(b.tariffSwitchEur).toBeCloseTo(-120.34, 10)
    expect(b.controlValueEur).toBeCloseTo(204.22, 10)
    expect(b.totalEur).toBeCloseTo(83.88, 10)
  })
})
