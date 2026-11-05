import { describe, expect, it } from 'vitest'

import { draftMinBillableKwDefaults } from 'shared'

import { DEFAULT_DRAFT_BILLING_MODEL, mapDraftToTariffParams } from './draft-mapping'

/**
 * D3 — ein realistischer Zählpunkt-Entwurf, wie ihn die Wizard-Stationen hinterlassen:
 * Tarifwerte plus die Seiteneinträge und Felder, die der Contract nicht kennt.
 */
const DRAFT: Record<string, unknown> = {
  netzebene: 'NE 7',
  meteringVariant: 'mit_leistungsmessung',
  leistungspreisEurPerKwYear: 82.92,
  minBillableKw: 0,
  arbeitspreisNetzCtPerKwh: 2.61,
  energyPriceCtPerKwh: 24.5,
  energyPriceNightCtPerKwh: 18.9,
  einspeiseverguetungCtPerKwh: 7.2,
  supplierBaseFeeEurPerMonth: 4.9,
  netzbetreiber: 'wiener_netze',
  annualConsumptionKwh: 184500,
  invoiceSkipped: false,
  _provenance: { energyPriceCtPerKwh: { source: 'measured', at: '2026-09-16T08:00:00.000Z' } },
}

describe('mapDraftToTariffParams — Vergleichstarif', () => {
  const entered = (priceBasis: string) => ({
    ...DRAFT,
    tariffComparisonProviderName: 'Anbieter',
    tariffComparisonEnergyPriceCtPerKwh: 16.4,
    tariffComparisonBaseFeeEurPerMonth: 2.5,
    tariffComparisonPriceBasis: priceBasis,
  })

  it.each([
    ['AT', 1.2],
    ['DE', 1.19],
    [undefined, 1.2],
  ] as const)(
    'brutto (%s): beide Beträge durch den Landessatz, Eingabeart bleibt',
    (country, f) => {
      const supplier = mapDraftToTariffParams(entered('gross'), { country }).comparisonSupplier!
      expect(supplier.energyPriceCtPerKwh).toBeCloseTo(16.4 / f, 9)
      expect(supplier.baseFeeEurPerMonth).toBeCloseTo(2.5 / f, 9)
      expect(supplier.priceBasis).toBe('net')
      expect(supplier.enteredPriceBasis).toBe('gross')
    },
  )

  it('netto: unverändert, ohne Vermerk', () => {
    expect(mapDraftToTariffParams(entered('net'), { country: 'DE' }).comparisonSupplier).toEqual({
      supplier: 'Anbieter',
      energyPriceCtPerKwh: 16.4,
      baseFeeEurPerMonth: 2.5,
      priceBasis: 'net',
    })
  })

  it('Quelle und Angebotsdatum reisen mit, netto wie brutto', () => {
    const withOrigin = (basis: string) => ({
      ...entered(basis),
      tariffComparisonSource: 'durchblicker_at',
      tariffComparisonOfferDate: '2026-10-12',
    })
    for (const basis of ['net', 'gross']) {
      expect(mapDraftToTariffParams(withOrigin(basis), {}).comparisonSupplier).toMatchObject({
        source: 'durchblicker_at',
        offerDate: '2026-10-12',
      })
    }
  })

  it('Bestandsentwurf oder ungültige Angaben: Schlüssel fehlen, objektgleich zum Stand davor', () => {
    const before = {
      supplier: 'Anbieter',
      energyPriceCtPerKwh: 16.4,
      baseFeeEurPerMonth: 2.5,
      priceBasis: 'net',
    }
    // toStrictEqual, weil toEqual ein `source: undefined` durchliesse.
    expect(mapDraftToTariffParams(entered('net'), {}).comparisonSupplier).toStrictEqual(before)
    const invalid = {
      ...entered('net'),
      tariffComparisonSource: 'quatsch',
      tariffComparisonOfferDate: '2026-02-31',
    }
    expect(mapDraftToTariffParams(invalid, {}).comparisonSupplier).toStrictEqual(before)
  })

  it('eine unbekannte Preisbasis wird weiterhin abgewiesen', () => {
    expect(() => mapDraftToTariffParams(entered('irgendwie'))).toThrow()
  })
})

describe('mapDraftToTariffParams', () => {
  it('bildet die neun Entwurfsfelder ab und setzt den SNE-V-Standardfall als Abrechnungsmodell', () => {
    expect(mapDraftToTariffParams(DRAFT)).toEqual({
      billingModel: 'monthly_max_sum',
      netzebene: 'NE 7',
      meteringVariant: 'mit_leistungsmessung',
      leistungspreisEurPerKwYear: 82.92,
      minBillableKw: 0,
      arbeitspreisNetzCtPerKwh: 2.61,
      energyPriceCtPerKwh: 24.5,
      energyPriceNightCtPerKwh: 18.9,
      einspeiseverguetungCtPerKwh: 7.2,
      supplierBaseFeeEurPerMonth: 4.9,
    })
    expect(DEFAULT_DRAFT_BILLING_MODEL).toBe('monthly_max_sum')
  })

  it('⚠ nimmt ein im Entwurf BESTÄTIGTES Abrechnungsmodell — der Vorgabewert ist nur das letzte Glied', () => {
    /*
     * Bis zum 22.09.2026 stand `billingModel` in KEINER Schlüsselliste dieser Datei: die
     * Rechnung-Station konnte es schreiben, gerechnet wurde trotzdem mit dem Vorgabewert. Der
     * Fehlschlag wäre still gewesen — das Formular zeigte das eine Modell, der Report das andere,
     * und die beiden unterscheiden sich um den Faktor 12 im abgerechneten kW-Wert.
     */
    expect(mapDraftToTariffParams({ ...DRAFT, billingModel: 'annual_max' }).billingModel).toBe(
      'annual_max',
    )
    // Ein unbekannter Wert wird ABGEWIESEN und nicht still durch den Vorgabewert ersetzt.
    expect(() => mapDraftToTariffParams({ ...DRAFT, billingModel: 'quartalsmittel' })).toThrow(
      /Abrechnungsmodell/,
    )
  })

  /*
   * ⚠ BEIDE RICHTUNGEN IN EINEM TEST: die Lücke wird gefüllt, ein vorhandener Wert NICHT
   * überschrieben. Nur die erste Hälfte bliebe auch dann grün, wenn die Ableitung jeden Wert auf 0
   * setzte — und das wäre die stille Korrektur einer erhobenen Zahl.
   */
  it('⚠ leitet ohne Leistungsmessung einen Leistungspreis von 0 ab — füllt aber nur die Lücke', () => {
    const { leistungspreisEurPerKwYear: _weg, ...ohnePreis } = DRAFT

    expect(
      mapDraftToTariffParams({ ...ohnePreis, meteringVariant: 'ohne_leistungsmessung' })
        .leistungspreisEurPerKwYear,
    ).toBe(0)

    expect(
      mapDraftToTariffParams({ ...DRAFT, meteringVariant: 'ohne_leistungsmessung' })
        .leistungspreisEurPerKwYear,
    ).toBe(82.92)
  })

  it('übernimmt einen ausdrücklichen Override und wirft, wenn ein Pflichtfeld fehlt', () => {
    const { leistungspreisEurPerKwYear: _weg, ...ohneLeistungspreis } = DRAFT
    expect(
      mapDraftToTariffParams(DRAFT, { billingModelOverride: 'annual_max' }).billingModel,
    ).toBe('annual_max')
    expect(() => mapDraftToTariffParams(ohneLeistungspreis)).toThrow(
      /Leistungspreis Netz/,
    )
  })

  describe('Mindestleistung fehlt', () => {
    const { minBillableKw: _drop, ...ohneMindestleistung } = DRAFT

    it('mit Leistungsmessung und monthly_max_sum: 0 und als Annahme vermerkt statt Abbruch', () => {
      const draft = { ...ohneMindestleistung, billingModel: 'monthly_max_sum' }
      expect(mapDraftToTariffParams(draft).minBillableKw).toBe(0)
      expect(draftMinBillableKwDefaults(draft)).toBe(true)
    })

    it('ein vorhandener Wert bleibt unverändert', () => {
      const draft = { ...DRAFT, billingModel: 'monthly_max_sum', minBillableKw: 30 }
      expect(mapDraftToTariffParams(draft).minBillableKw).toBe(30)
      expect(draftMinBillableKwDefaults(draft)).toBe(false)
    })

    it('ohne Leistungsmessung und leere Tariffelder: Abbruch wie bisher', () => {
      const draft = {
        netzebene: 'NE 7',
        billingModel: 'monthly_max_sum',
        meteringVariant: 'ohne_leistungsmessung',
        leistungspreisEurPerKwYear: 0,
        invoiceSkipped: false,
      }
      expect(draftMinBillableKwDefaults(draft)).toBe(false)
      expect(() => mapDraftToTariffParams(draft)).toThrow(/Energie-Arbeitspreis/)
    })
  })
})

describe('mapDraftToTariffParams — Meldung bei unvollständigem Entwurf', () => {
  it('nennt in EINEM Durchgang alle fehlenden Pflichtangaben im Klartext, samt Station', () => {
    let message = ''
    try {
      mapDraftToTariffParams({})
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toBe(
      'Für die Berechnung fehlen: Leistungspreis Netz (€/kW·a), Mindestleistung (kW), ' +
        'Energie-Arbeitspreis (ct/kWh). Eintragen in: Rechnung-Station (oder Knopf ' +
        '„Werte vorschlagen" aus dem Preisblatt bzw. „Ohne Rechnung fortfahren").',
    )
    expect(message).not.toMatch(/Required|leistungspreisEurPerKwYear|minBillableKw/)
  })
})

describe('Mindestleistung mit Leistungsmessung auf Netzebene 7 — für jedes Land gleich', () => {
  const { minBillableKw: _drop, ...ohneMindestleistung } = DRAFT

  it.each([
    ['AT', 'wiener_netze'],
    ['DE', 'netze_bw'],
  ])('%s: fehlende Mindestleistung wird 0', (_country, netzbetreiber) => {
    const draft = { ...ohneMindestleistung, netzbetreiber, meteringVariant: 'mit_leistungsmessung' }
    expect(mapDraftToTariffParams(draft).minBillableKw).toBe(0)
    expect(draftMinBillableKwDefaults(draft)).toBe(true)
  })
})

describe('Leistungspreis bei Benutzungsdauer-Stufen', () => {
  const { leistungspreisEurPerKwYear: _weg, ...ohneLeistungspreis } = DRAFT

  it('ohne Stufen bricht ein leerer Leistungspreis weiter mit derselben Meldung ab', () => {
    expect(() => mapDraftToTariffParams(ohneLeistungspreis, { hasDemandTiers: false })).toThrow(
      /Leistungspreis Netz/,
    )
  })

  it('mit Stufen: Leistungspreis 0, Mindestleistung und Vermerk wie mit gesetztem Leistungspreis', () => {
    const { minBillableKw: _m, ...ohneBeides } = ohneLeistungspreis
    const mapped = mapDraftToTariffParams(ohneBeides, { hasDemandTiers: true })
    expect(mapped.leistungspreisEurPerKwYear).toBe(0)
    const { minBillableKw: _n, ...mitLeistungspreis } = DRAFT
    expect(mapped.minBillableKw).toBe(mapDraftToTariffParams(mitLeistungspreis).minBillableKw)
    expect(draftMinBillableKwDefaults(ohneBeides)).toBe(
      draftMinBillableKwDefaults(mitLeistungspreis),
    )
  })
})
