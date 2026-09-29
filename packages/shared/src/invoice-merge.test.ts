import { describe, expect, it } from 'vitest'

import {
  emptyInvoiceExtraction,
  parseInvoiceExtraction,
  type InvoiceExtraction,
} from './invoice-scan'
import {
  INVOICE_MERGE_FIELD_KEYS,
  INVOICE_MERGE_FIELD_LABELS,
  mergeInvoiceExtractions,
} from './invoice-merge'

function invoice(patch: {
  netzbetreiber?: InvoiceExtraction['netzbetreiber']
  netzebene?: InvoiceExtraction['netzebene']
  meteringVariant?: InvoiceExtraction['meteringVariant']
  annualConsumptionKwh?: number | null
  rates?: Partial<InvoiceExtraction['rates']>
}): InvoiceExtraction {
  const base = emptyInvoiceExtraction()
  return {
    ...base,
    netzbetreiber: patch.netzbetreiber ?? null,
    netzebene: patch.netzebene ?? null,
    meteringVariant: patch.meteringVariant ?? null,
    annualConsumptionKwh: patch.annualConsumptionKwh ?? null,
    rates: { ...base.rates, ...patch.rates },
  }
}

describe('Feldliste und Beschriftungen', () => {
  it('deckt Kopffelder und alle Beträge ab', () => {
    expect([...INVOICE_MERGE_FIELD_KEYS]).toEqual([
      'netzbetreiber',
      'netzebene',
      'meteringVariant',
      'billingModel',
      'annualConsumptionKwh',
      'leistungspreisEurPerKwYear',
      'minBillableKw',
      'arbeitspreisNetzCtPerKwh',
      'energyPriceCtPerKwh',
      'energyPriceNightCtPerKwh',
      'einspeiseverguetungCtPerKwh',
      'supplierBaseFeeEurPerMonth',
    ])
  })

  it('hat für jedes Feld einen Anzeigenamen — sonst nennt die Meldung einen Programmbezeichner', () => {
    for (const key of INVOICE_MERGE_FIELD_KEYS) {
      expect(INVOICE_MERGE_FIELD_LABELS[key]).toBeTruthy()
    }
  })
})

describe('mergeInvoiceExtractions', () => {
  it('lässt eine einzelne Rechnung unverändert und meldet keinen Widerspruch', () => {
    const single = invoice({
      netzbetreiber: 'wiener_netze',
      netzebene: 3,
      annualConsumptionKwh: 88_426,
      rates: { energyPriceCtPerKwh: 25.4, leistungspreisEurPerKwYear: 38.52 },
    })
    const { merged, conflicts } = mergeInvoiceExtractions([single])
    expect(merged).toEqual(single)
    expect(conflicts).toEqual([])
  })

  it('ergibt bei leerer Liste ein Ergebnis, in dem nichts erkannt wurde — kein Wurf', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([])
    expect(merged).toEqual(emptyInvoiceExtraction())
    expect(conflicts).toEqual([])
  })

  it('übernimmt einen Wert, den nur EINE der Rechnungen nennt', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([
      invoice({ rates: { energyPriceCtPerKwh: 25.4 } }),
      invoice({ rates: { einspeiseverguetungCtPerKwh: 8 } }),
    ])
    expect(merged.rates.energyPriceCtPerKwh).toBe(25.4)
    expect(merged.rates.einspeiseverguetungCtPerKwh).toBe(8)
    expect(conflicts).toEqual([])
  })

  it('übernimmt einen Wert, über den sich alle Rechnungen einig sind', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([
      invoice({ netzbetreiber: 'wiener_netze', netzebene: 7, rates: { minBillableKw: 12 } }),
      invoice({ netzbetreiber: 'wiener_netze', netzebene: 7, rates: { minBillableKw: 12 } }),
      invoice({ netzbetreiber: 'wiener_netze' }),
    ])
    expect(merged.netzbetreiber).toBe('wiener_netze')
    expect(merged.netzebene).toBe(7)
    expect(merged.rates.minBillableKw).toBe(12)
    expect(conflicts).toEqual([])
  })

  it('⚠ lässt ein widersprüchliches Feld LEER und benennt es — kein Mittelwert, kein „erste gewinnt"', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([
      invoice({ rates: { energyPriceCtPerKwh: 24.0 } }),
      invoice({ rates: { energyPriceCtPerKwh: 26.0 } }),
    ])
    expect(merged.rates.energyPriceCtPerKwh).toBeNull()
    expect(conflicts).toEqual(['energyPriceCtPerKwh'])
    // Weder der Mittelwert (25) noch der erste (24) noch der grösste (26) sind durchgekommen.
    expect(merged.rates.energyPriceCtPerKwh).not.toBe(25)
  })

  it('trennt Widerspruch und Einigkeit feldweise — ein Streit verwirft nicht den Rest', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([
      invoice({
        netzbetreiber: 'wiener_netze',
        netzebene: 3,
        rates: { energyPriceCtPerKwh: 24, leistungspreisEurPerKwYear: 38.52 },
      }),
      invoice({
        netzbetreiber: 'wiener_netze',
        netzebene: 3,
        rates: { energyPriceCtPerKwh: 26, leistungspreisEurPerKwYear: 38.52 },
      }),
    ])
    expect(conflicts).toEqual(['energyPriceCtPerKwh'])
    expect(merged.netzbetreiber).toBe('wiener_netze')
    expect(merged.netzebene).toBe(3)
    expect(merged.rates.leistungspreisEurPerKwYear).toBe(38.52)
    expect(merged.rates.energyPriceCtPerKwh).toBeNull()
  })

  it('⚠ vergleicht ohne Toleranz — 25,4 und 25,41 sind zwei Tarifsätze, keine Messungenauigkeit', () => {
    const { conflicts } = mergeInvoiceExtractions([
      invoice({ rates: { energyPriceCtPerKwh: 25.4 } }),
      invoice({ rates: { energyPriceCtPerKwh: 25.41 } }),
    ])
    expect(conflicts).toEqual(['energyPriceCtPerKwh'])
  })

  it('behandelt Zeichenketten-Felder wie Beträge — auch der Netzbetreiber kann streitig sein', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([
      invoice({ netzbetreiber: 'wiener_netze' }),
      invoice({ netzbetreiber: 'netz_noe' }),
    ])
    expect(merged.netzbetreiber).toBeNull()
    expect(conflicts).toEqual(['netzbetreiber'])
  })

  it('unterscheidet eine ausgewiesene 0 von „nicht erkennbar"', () => {
    // 0 ist eine ANGABE (kein Sockel vereinbart) und darf nicht als „schweigt" gelten.
    const { merged, conflicts } = mergeInvoiceExtractions([
      invoice({ rates: { minBillableKw: 0 } }),
      invoice({ rates: { minBillableKw: 12 } }),
    ])
    expect(merged.rates.minBillableKw).toBeNull()
    expect(conflicts).toEqual(['minBillableKw'])

    const agreed = mergeInvoiceExtractions([
      invoice({ rates: { minBillableKw: 0 } }),
      invoice({ rates: { minBillableKw: 0 } }),
    ])
    expect(agreed.merged.rates.minBillableKw).toBe(0)
    expect(agreed.conflicts).toEqual([])
  })

  it('meldet Widersprüche in stabiler Reihenfolge, unabhängig von der Reihenfolge der Dateien', () => {
    const a = invoice({ netzebene: 3, rates: { energyPriceCtPerKwh: 24 } })
    const b = invoice({ netzebene: 5, rates: { energyPriceCtPerKwh: 26 } })
    expect(mergeInvoiceExtractions([a, b]).conflicts).toEqual(['netzebene', 'energyPriceCtPerKwh'])
    expect(mergeInvoiceExtractions([b, a]).conflicts).toEqual(['netzebene', 'energyPriceCtPerKwh'])
  })
})

describe('mergeInvoiceExtractions — abweichende abgerechnete kW (29.09.2026)', () => {
  // Ohne Zeitraum greift die Monatsregel des Parsers nicht; entscheidend ist hier allein der Abgleich.
  function annualMax(billedKw: number): InvoiceExtraction {
    return {
      ...emptyInvoiceExtraction(),
      billingModel: 'annual_max',
      billingModelBasis: 'inferred',
      billedKw,
    }
  }

  it('schliesst annual_max aus, wenn die kW zwischen den Rechnungen abweichen', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([43, 44, 42].map(annualMax))
    expect(merged.billingModel).toBe('monthly_max_sum')
    expect(conflicts).not.toContain('billingModel')
  })

  it('lässt annual_max bei gleichen kW stehen', () => {
    const { merged } = mergeInvoiceExtractions([44, 44].map(annualMax))
    expect(merged.billingModel).toBe('annual_max')
  })
})

describe('mergeInvoiceExtractions — Mindestleistung gegen abgerechnete kW (29.09.2026)', () => {
  it('verwirft minBillableKw, wenn eine Rechnung darunter abrechnet', () => {
    const billed = (billedKw: number): InvoiceExtraction => ({
      ...invoice({ rates: { minBillableKw: 30 } }),
      billedKw,
    })
    const { merged, conflicts } = mergeInvoiceExtractions([billed(30), billed(31), billed(29)])
    expect(merged.rates.minBillableKw).toBeNull()
    expect(conflicts).not.toContain('minBillableKw')
  })
})

describe('mergeInvoiceExtractions — Leistungspreis aus Monatsrechnungen (29.09.2026)', () => {
  // Synthetisch: dieselbe Rate (0,22718 €/kW je Tag), 28 und 31 Tage; das Modell rechnete ×12.
  function monthly(from: string, to: string, netAmountEur: number, modelRate: number) {
    return parseInvoiceExtraction({
      billingModel: 'monthly_max_sum',
      billedKwLines: [{ kw: 44, netAmountEur }],
      billingPeriodFrom: from,
      billingPeriodTo: to,
      billingPeriodAssumed: false,
      rates: { leistungspreisEurPerKwYear: modelRate },
    })
  }

  it('Februar und Mai ergeben keinen Konflikt', () => {
    const { merged, conflicts } = mergeInvoiceExtractions([
      monthly('2026-02-01', '2026-02-28', 279.89, 76.33),
      monthly('2026-05-01', '2026-05-31', 309.87, 84.51),
    ])
    expect(conflicts).not.toContain('leistungspreisEurPerKwYear')
    expect(Math.abs((merged.rates.leistungspreisEurPerKwYear ?? 0) - 82.92)).toBeLessThanOrEqual(
      0.01,
    )
  })

  it('eine echte Abweichung bleibt ein Konflikt', () => {
    const { conflicts } = mergeInvoiceExtractions([
      invoice({ rates: { leistungspreisEurPerKwYear: 82.92 } }),
      invoice({ rates: { leistungspreisEurPerKwYear: 85 } }),
    ])
    expect(conflicts).toContain('leistungspreisEurPerKwYear')
  })
})
