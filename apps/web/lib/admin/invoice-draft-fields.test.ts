import { describe, expect, it } from 'vitest'

import { energyPriceFromInvoice } from './invoice-draft-fields'

const draftWith = (entry: Record<string, unknown> | undefined) => ({
  energyPriceCtPerKwh: 16.2,
  ...(entry ? { _provenance: { energyPriceCtPerKwh: entry } } : {}),
})

describe('energyPriceFromInvoice', () => {
  it('ist wahr nur bei Rechnungs-Vermerk am Arbeitspreis', () => {
    const at = '2026-09-30T10:02:50.978Z'
    expect(energyPriceFromInvoice(draftWith({ source: 'measured', origin: 'invoice', at }))).toBe(true)
    expect(energyPriceFromInvoice(draftWith({ source: 'measured', at }))).toBe(false)
    expect(energyPriceFromInvoice(draftWith({ source: 'assumed', note: 'Handeingabe', at }))).toBe(false)
    expect(energyPriceFromInvoice(draftWith(undefined))).toBe(false)
  })
})
