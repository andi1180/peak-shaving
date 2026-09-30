import { describe, expect, it } from 'vitest'

import { draftValueFromInvoice } from './invoice-draft-fields'

const draftWith = (entry: Record<string, unknown> | undefined) => ({
  energyPriceCtPerKwh: 16.2,
  ...(entry ? { _provenance: { energyPriceCtPerKwh: entry } } : {}),
})

describe('draftValueFromInvoice', () => {
  it('ist wahr nur bei Rechnungs-Vermerk am Arbeitspreis', () => {
    const at = '2026-09-30T10:02:50.978Z'
    expect(draftValueFromInvoice(draftWith({ source: 'measured', origin: 'invoice', at }), 'energyPriceCtPerKwh')).toBe(true)
    expect(draftValueFromInvoice(draftWith({ source: 'measured', at }), 'energyPriceCtPerKwh')).toBe(false)
    expect(draftValueFromInvoice(draftWith({ source: 'assumed', note: 'Handeingabe', at }), 'energyPriceCtPerKwh')).toBe(false)
    expect(draftValueFromInvoice(draftWith(undefined), 'energyPriceCtPerKwh')).toBe(false)
  })

  it('gilt je Feld: Arbeitspreis und Grundgebühr getrennt', () => {
    const at = '2026-09-30T10:02:50.978Z'
    const draft = {
      _provenance: {
        energyPriceCtPerKwh: { source: 'measured', origin: 'invoice', at },
        supplierBaseFeeEurPerMonth: { source: 'assumed', note: 'Handeingabe', at },
      },
    }
    expect(draftValueFromInvoice(draft, 'energyPriceCtPerKwh')).toBe(true)
    expect(draftValueFromInvoice(draft, 'supplierBaseFeeEurPerMonth')).toBe(false)
  })
})
