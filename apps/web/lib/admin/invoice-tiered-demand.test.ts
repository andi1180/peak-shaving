import { describe, expect, it } from 'vitest'
import { emptyInvoiceExtraction, type GridTariffRowInput, type InvoiceExtraction } from 'shared'

import { invoiceFieldConflictOptions } from './invoice-field-choices'
import { withTieredDemand } from './invoice-tiered-demand'

function stored(id: string, lp: number | null, from: string, to: string, energy = 20) {
  const base = emptyInvoiceExtraction()
  const extraction: InvoiceExtraction = {
    ...base,
    billingPeriodFrom: from,
    billingPeriodTo: to,
    supplierPriceBasis: 'net',
    rates: { ...base.rates, energyPriceCtPerKwh: energy, leistungspreisEurPerKwYear: lp },
  }
  return { documentId: id, filename: `${id}.pdf`, extraction }
}

function row(validFrom: string, validUntil: string | null, tiers: boolean): GridTariffRowInput {
  return {
    validFrom,
    validUntil,
    netzverlustCtPerKwh: 0,
    grundpreisAmount: tiers ? 22.75 : 40,
    grundpreisUnit: 'eur_per_kw_year',
    ...(tiers
      ? {
          tierThresholdHours: 2500,
          tier2LeistungspreisEurPerKwYear: 131.8,
          tier2ArbeitspreisCtPerKwh: 2.1,
        }
      : {}),
    priceBasis: 'net',
    windows: [],
  }
}

const jan = stored('jan', 22.75, '2026-01-01', '2026-01-31', 10)
const feb = stored('feb', 131.8, '2026-02-01', '2026-02-28', 30)
const draft = { _invoiceExtractions: [jan, feb] }
const conflicts = () => invoiceFieldConflictOptions(draft, null)
const fields = (list: ReturnType<typeof conflicts>) => list.map((c) => c.field)

describe('withTieredDemand — Leistungspreis bei Benutzungsdauer-Stufen', () => {
  it('mit Stufen: kein Leistungspreis in den Konfliktoptionen, Stände und Rechnungswerte als Hinweis', () => {
    expect(fields(conflicts())).toContain('leistungspreisEurPerKwYear')
    const rows = [row('2026-01-01', null, true), row('2025-01-01', '2025-12-31', true)]
    const result = withTieredDemand(conflicts(), draft, rows)

    expect(fields(result.conflicts)).toEqual(['energyPriceCtPerKwh'])
    expect(result.tieredDemandInfo).toEqual({
      tiers: [
        {
          validFrom: '2025-01-01',
          validTo: '2025-12-31',
          thresholdHours: 2500,
          belowEurPerKwYear: 22.75,
          aboveEurPerKwYear: 131.8,
        },
        {
          validFrom: '2026-01-01',
          thresholdHours: 2500,
          belowEurPerKwYear: 22.75,
          aboveEurPerKwYear: 131.8,
        },
      ],
      invoiceValues: [
        {
          documentId: 'jan',
          filename: 'jan.pdf',
          periodFrom: '2026-01-01',
          periodTo: '2026-01-31',
          value: 22.75,
        },
        {
          documentId: 'feb',
          filename: 'feb.pdf',
          periodFrom: '2026-02-01',
          periodTo: '2026-02-28',
          value: 131.8,
        },
      ],
    })
  })

  it('mit Stufen, aber ohne Leistungspreis auf den Rechnungen: kein Hinweis', () => {
    const ohne = { _invoiceExtractions: [stored('a', null, '2026-01-01', '2026-01-31')] }
    expect(withTieredDemand([], ohne, [row('2026-01-01', null, true)])).toEqual({ conflicts: [] })
  })

  it('ohne Stufen oder bei Ladefehler: unverändert', () => {
    const before = conflicts()
    expect(withTieredDemand(before, draft, [row('2026-01-01', null, false)])).toEqual({
      conflicts: before,
    })
    expect(withTieredDemand(before, draft, null)).toEqual({ conflicts: before })
  })
})
