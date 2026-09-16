import { describe, expect, it } from 'vitest'

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

  it('übernimmt einen ausdrücklichen Override und wirft, wenn ein Pflichtfeld fehlt', () => {
    const { leistungspreisEurPerKwYear: _weg, ...ohneLeistungspreis } = DRAFT
    expect(
      mapDraftToTariffParams(DRAFT, { billingModelOverride: 'annual_max' }).billingModel,
    ).toBe('annual_max')
    expect(() => mapDraftToTariffParams(ohneLeistungspreis)).toThrow(
      /leistungspreisEurPerKwYear/,
    )
  })
})
