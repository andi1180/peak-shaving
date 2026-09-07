import { describe, expect, it } from 'vitest'

import { gridTariffPrefill, type GridTariffPrefillRow } from './grid-tariff-prefill'

/**
 * Die ECHTE Wiener-Netze-Zeile für Netzebene 6, wie sie am 07.09.2026 in der Produktions-Datenbank
 * steht (`public.grid_tariffs`, über den anon-Lesepfad gemessen — Preisblatt WN-EX0105 Vers. 2/2026,
 * eingetragen über `/admin/netzbetreiber-tarife` am 01.09.2026).
 *
 * Bewusst die echten Zahlen und nicht runde Erfindungen: der Punkt dieser Umstellung ist, dass
 * genau DIESER Stand im Rechner ankommt.
 */
const NE6: GridTariffPrefillRow = {
  operatorName: 'Wiener Netze',
  validFrom: '2026-01-01',
  validUntil: null,
  grundpreisAmount: 59.52,
  grundpreisUnit: 'eur_per_kw_year',
  netzverlustCtPerKwh: 0.307,
  priceBasis: 'net',
  windows: [
    {
      label: 'normal',
      monthDayFrom: null,
      monthDayTo: null,
      timeFrom: '00:00:00',
      timeTo: '24:00:00',
      ctPerKwh: 1.93,
    },
  ],
}

/** Dieselbe Zeile, aber mit dem zweiten realen Fenstermuster (NE 7: ganztägig + SNAP-Ausschnitt). */
const TWO_WINDOWS: GridTariffPrefillRow = {
  ...NE6,
  windows: [
    { ...NE6.windows[0], ctPerKwh: 4.21 },
    {
      label: 'snap',
      monthDayFrom: '04-01',
      monthDayTo: '09-30',
      timeFrom: '10:00:00',
      timeTo: '16:00:00',
      ctPerKwh: 3.37,
    },
  ],
}

describe('gridTariffPrefill', () => {
  it('übernimmt den Grundpreis als Leistungspreis, wenn die Einheit €/kW·a ist', () => {
    const p = gridTariffPrefill({
      netzbetreiber: 'wiener_netze',
      netzebene: 6,
      row: NE6,
      currentBillingModel: 'monthly_max_average',
    })

    expect(p.fields.leistungspreisEurPerKwYear).toBe(59.52)
    expect(p.grundpreisIsLeistungspreis).toBe(true)
    // Netzverlust und Fensterpreis sind ANZEIGEwerte — sie stehen in der Herkunftszeile und in
    // KEINEM Formularfeld (ihren Weg in die Rechnung nehmen sie über `intervalTariffRates`).
    expect(p.netzverlustCtPerKwh).toBe(0.307)
    expect(p.netzArbeitspreisCtPerKwh).toBe(1.93)
    expect(p.operatorLabel).toBe('Wiener Netze')
    expect(p.validFrom).toBe('2026-01-01')
  })

  /*
   * ⚠ DER TEUERSTE DENKBARE LESEFEHLER DIESER DATEI (Delta 3).
   *
   * `eur_per_year` ist eine JAHRESPAUSCHALE. Als Leistungspreis übernommen würde sie mit dem
   * abgerechneten kW-Wert multipliziert und ergäbe eine völlig plausibel aussehende, frei
   * erfundene Spitzenkappungs-Ersparnis. Der reale Fall existiert: Wiener Netze NE 7 ohne
   * Leistungsmessung trägt 54,00 EUR/Jahr.
   */
  it('macht aus einer Jahrespauschale KEINEN Leistungspreis, sondern 0', () => {
    const p = gridTariffPrefill({
      netzbetreiber: 'wiener_netze',
      netzebene: 6,
      row: { ...NE6, grundpreisAmount: 54, grundpreisUnit: 'eur_per_year' },
      currentBillingModel: 'annual_max',
    })

    expect(p.fields.leistungspreisEurPerKwYear).toBe(0)
    expect(p.grundpreisIsLeistungspreis).toBe(false)
    // Der Betrag geht dabei NICHT verloren — die Oberfläche soll ihn benennen können, statt ihn
    // als 0 zu verschweigen.
    expect(p.grundpreisAmount).toBe(54)
  })

  it('behandelt eine unbekannte Einheit wie eine Pauschale — es wird nichts geraten', () => {
    const p = gridTariffPrefill({
      netzbetreiber: 'wiener_netze',
      netzebene: 6,
      row: { ...NE6, grundpreisUnit: 'eur_per_month' },
      currentBillingModel: 'annual_max',
    })
    expect(p.fields.leistungspreisEurPerKwYear).toBe(0)
    expect(p.grundpreisIsLeistungspreis).toBe(false)
  })

  /*
   * Eine Tarifzeile trägt weder Abrechnungsmodell noch Mindestbemessung — ein Preisblatt nennt
   * Preise, nicht die Regel dahinter. `minBillableKw: 0` ist deshalb die einzige Zahl, die nichts
   * behauptet (der Sockel kann nur ANHEBEN, §3.5), und das Abrechnungsmodell kommt unverändert aus
   * dem Formular.
   */
  it('belegt den Sockel mit 0 und erfindet KEIN Abrechnungsmodell', () => {
    const p = gridTariffPrefill({
      netzbetreiber: 'wiener_netze',
      netzebene: 6,
      row: NE6,
      currentBillingModel: 'annual_max',
    })

    expect(p.fields.minBillableKw).toBe(0)
    expect(p.selection.defaults.billingModel).toBe('annual_max')
    expect(Object.keys(p.fields).sort()).toEqual(['leistungspreisEurPerKwYear', 'minBillableKw'])
  })

  /*
   * Gegenprobe zum vorigen Test: das übergebene Modell wird WIRKLICH durchgereicht und nicht
   * insgeheim durch einen festen Vorgabewert ersetzt. Ohne diese zweite Richtung bliebe der Test
   * auch dann grün, wenn hier fest `monthly_max_average` stünde und der Aufrufer zufällig
   * denselben Wert schickt.
   */
  it('reicht jedes Abrechnungsmodell unverändert in die Vorgabewerte durch', () => {
    for (const model of ['annual_max', 'monthly_max_average', 'monthly_max_sum'] as const) {
      const p = gridTariffPrefill({
        netzbetreiber: 'netz_noe',
        netzebene: 5,
        row: NE6,
        currentBillingModel: model,
      })
      expect(p.selection.defaults.billingModel).toBe(model)
    }
  })

  it('bildet eine Herkunftsangabe, die den Stand benennt und mit B11 vergleichbar bleibt', () => {
    const p = gridTariffPrefill({
      netzbetreiber: 'wiener_netze',
      netzebene: 6,
      row: NE6,
      currentBillingModel: 'monthly_max_average',
    })

    // Derselbe Schlüssel wie im statischen Katalog — ein Bündel von vorher und eines von nachher
    // bleiben über dieselbe Kombination vergleichbar.
    expect(p.selection.tariffProfileKey).toBe('wiener_netze:NE6')
    expect(p.selection.netzbetreiber).toBe('wiener_netze')
    expect(p.selection.netzebene).toBe(6)
    expect(p.selection.tariffSetValidFrom).toBe('2026-01-01')
    // Die Herkunft ist an der Kennung erkennbar und von den Katalog-Ständen (`at-2026`) getrennt.
    expect(p.selection.tariffSetId).toBe('grid_tariffs:2026-01-01')
    expect(p.selection.tariffSetLabel).toBe('Preisblatt Wiener Netze, Netzebene 6')
    expect(p.selection.defaults.leistungspreisEurPerKwYear).toBe(59.52)
  })

  /*
   * Der Anzeigewert ist der Preis des GRUNDSATZ-Fensters (weiteste Abdeckung), nicht der erste der
   * Liste und nicht der höchste. Die Reihenfolge wird bewusst umgedreht: fiele die Auswahl auf das
   * erste Element zurück, käme hier 3,37 heraus und die Herkunftszeile nennte den
   * Sommer-Mittags-Ausschnitt als Arbeitspreis der ganzen Zeile.
   */
  it('zeigt den Preis des Grundsatz-Fensters, nicht den eines Ausschnitts', () => {
    const reversed: GridTariffPrefillRow = {
      ...TWO_WINDOWS,
      windows: [...TWO_WINDOWS.windows].reverse(),
    }
    for (const row of [TWO_WINDOWS, reversed]) {
      const p = gridTariffPrefill({
        netzbetreiber: 'wiener_netze',
        netzebene: 6,
        row,
        currentBillingModel: 'annual_max',
      })
      expect(p.netzArbeitspreisCtPerKwh).toBe(4.21)
      expect(p.windowCount).toBe(2)
    }
  })

  it('meldet eine Zeile ohne Zeitfenster als „kein Arbeitspreis" statt als 0', () => {
    const p = gridTariffPrefill({
      netzbetreiber: 'wiener_netze',
      netzebene: 6,
      row: { ...NE6, windows: [] },
      currentBillingModel: 'annual_max',
    })
    expect(p.netzArbeitspreisCtPerKwh).toBeNull()
    expect(p.windowCount).toBe(0)
  })

  it('fällt ohne Anzeigenamen auf die Kennung zurück, statt eine leere Herkunft zu zeigen', () => {
    const p = gridTariffPrefill({
      netzbetreiber: 'salzburg_netz',
      netzebene: 4,
      row: { ...NE6, operatorName: '   ' },
      currentBillingModel: 'annual_max',
    })
    expect(p.operatorLabel).toBe('salzburg_netz')
  })
})
