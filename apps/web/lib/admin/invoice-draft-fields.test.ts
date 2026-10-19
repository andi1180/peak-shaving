import { describe, expect, it } from 'vitest'

import { draftValueFromInvoice, replaceInvoiceDraftFields } from './invoice-draft-fields'

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

describe('replaceInvoiceDraftFields — widersprüchliche Felder', () => {
  const now = new Date('2026-10-19T08:00:00.000Z')
  // Ein widersprüchliches Feld kommt in `values` nicht vor; daneben ein unstrittiger Wert.
  const values = [{ field: 'minBillableKw', value: 44 }]

  it('leert ein Feld mit Herkunft „aus Rechnung" samt Vermerk', () => {
    const draft = {
      energyPriceCtPerKwh: 24.5,
      _provenance: { energyPriceCtPerKwh: { source: 'measured', origin: 'invoice', at: '2026-10-01T00:00:00.000Z' } },
    }
    const next = replaceInvoiceDraftFields(draft, values, now, true)
    expect(next).not.toHaveProperty('energyPriceCtPerKwh')
    expect(next._provenance).not.toHaveProperty('energyPriceCtPerKwh')
    expect(next.minBillableKw).toBe(44)
  })

  it('lässt Handeingaben stehen — auch über die Übergangsregel', () => {
    const hand = { source: 'assumed', note: 'Handeingabe', at: '2026-10-01T00:00:00.000Z' }
    // Nach der Übergangsgrenze ohne Vermerk geschrieben: zählt als Handeingabe.
    const lateMeasured = { source: 'measured', at: '2026-10-01T00:00:00.000Z' }
    const draft = {
      energyPriceCtPerKwh: 16.2,
      supplierBaseFeeEurPerMonth: 4.2,
      _provenance: { energyPriceCtPerKwh: hand, supplierBaseFeeEurPerMonth: lateMeasured },
    }
    expect(replaceInvoiceDraftFields(draft, values, now, true)).toMatchObject(draft)
  })
})
