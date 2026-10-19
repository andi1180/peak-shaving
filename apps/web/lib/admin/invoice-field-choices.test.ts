import { describe, expect, it } from 'vitest'
import { emptyInvoiceExtraction, type InvoiceExtraction } from 'shared'

import {
  invoiceFieldConflictOptions,
  type ConsumptionByDay,
  type InvoiceFieldWeightedOption,
} from './invoice-field-choices'

function stored(id: string, price: number, from: string | null, to: string | null) {
  const base = emptyInvoiceExtraction()
  const extraction: InvoiceExtraction = {
    ...base,
    billingPeriodFrom: from,
    billingPeriodTo: to,
    supplierPriceBasis: 'net',
    rates: { ...base.rates, energyPriceCtPerKwh: price },
  }
  return { documentId: id, filename: `${id}.pdf`, extraction }
}

const draftOf = (...entries: ReturnType<typeof stored>[]) => ({ _invoiceExtractions: entries })

/** Voller Lastgang (96 Intervalle je Tag) mit `kwh` Bezug je Tag im Zeitraum. */
function consumption(from: string, to: string, kwhOf: (day: string) => number): ConsumptionByDay {
  const days = []
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    const day = new Date(t).toISOString().slice(0, 10)
    days.push({ day, importKwh: kwhOf(day), intervals: 96 })
  }
  return { days, intervalMinutes: 15 }
}

function weighted(conflicts: ReturnType<typeof invoiceFieldConflictOptions>) {
  return conflicts[0]!.options.find((o) => o.kind === 'weighted') as
    InvoiceFieldWeightedOption | undefined
}

describe('invoiceFieldConflictOptions — gewichteter Mittelwert', () => {
  const jan = stored('jan', 10, '2026-01-01', '2026-01-31')
  const feb = stored('feb', 20, '2026-02-01', '2026-02-28')

  it('gewichtet nach Lastgang-kWh, wenn jeder Zeitraum zu ≥ 90 % abgedeckt ist', () => {
    // Januar 31 × 100 kWh, Februar 28 × 50 kWh → (10·3100 + 20·1400) / 4500 = 13,1111…
    const load = consumption('2026-01-01', '2026-02-28', (d) => (d < '2026-02' ? 100 : 50))
    const [conflict] = invoiceFieldConflictOptions(draftOf(jan, feb), load)

    expect(conflict!.field).toBe('energyPriceCtPerKwh')
    expect(weighted([conflict!])).toMatchObject({ basis: 'load_profile', value: 13.1111 })
    expect(weighted([conflict!])!.parts.map((p) => p.weight)).toEqual([3100, 1400])
    expect(conflict!.preselected).toEqual({ kind: 'weighted' })
    expect(conflict!.current).toBeNull()
  })

  it('fällt auf Tage zurück, wenn ein Zeitraum unter 90 % abgedeckt ist', () => {
    // Lastgang endet am 20.02. → Februar nur 20/28 abgedeckt. (10·31 + 20·28) / 59 = 14,7458
    const load = consumption('2026-01-01', '2026-02-20', () => 100)
    const option = weighted(invoiceFieldConflictOptions(draftOf(jan, feb), load))

    expect(option).toMatchObject({ basis: 'days', value: 14.7458 })
    expect(option!.parts.map((p) => p.weight)).toEqual([31, 28])
  })

  it('bietet keinen Mittelwert an, wenn ein Zeitraum fehlt oder sich Zeiträume überlappen', () => {
    const ohne = invoiceFieldConflictOptions(
      draftOf(jan, stored('x', 20, null, '2026-02-28')),
      null,
    )
    expect(weighted(ohne)).toBeUndefined()
    expect(ohne[0]!.weightedUnavailableReason).toContain('Abrechnungszeitraum')
    // Ohne Mittelwert ist die Rechnung mit dem spätesten Ende vorgeschlagen.
    expect(ohne[0]!.preselected).toEqual({ kind: 'document', documentId: 'x' })

    const overlap = invoiceFieldConflictOptions(
      draftOf(jan, stored('y', 20, '2026-01-31', '2026-02-28')),
      null,
    )
    expect(weighted(overlap)).toBeUndefined()
    expect(overlap[0]!.weightedUnavailableReason).toContain('überschneiden')
  })
})
