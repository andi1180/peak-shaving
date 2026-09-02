import { describe, expect, it } from 'vitest'

import { buildRealSavingBreakdown } from './real-saving'

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
