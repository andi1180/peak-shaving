import { describe, expect, it } from 'vitest'
import expected from '../../engine/test/golden/baeckerei/expected.json'
import type { AnalysisResult } from './analysis-result'
import { supplierPricesOnNetBasis } from './invoice-merge'
import { emptyInvoiceExtraction, type InvoiceExtraction } from './invoice-scan'
import {
  analysisForDisplay,
  displayedPriceBasis,
  displayPriceBasisFor,
  enteredFromNet,
  netFromEntered,
  priceBasisLabel,
} from './display-price-basis'

const golden = expected as unknown as AnalysisResult

describe('display-price-basis', () => {
  it('rechnet 12 ct inkl. USt auf 10 ct netto um und liest sie wieder als 12 zurück', () => {
    expect(netFromEntered(12, 'gross')).toBe(10)
    expect(netFromEntered(12, 'net')).toBe(12)
    expect(enteredFromNet(netFromEntered(13.081, 'gross'), 'gross')).toBe(13.081)
  })

  it('heim zeigt brutto, Amortisation und physikalische Grössen bleiben gleich', () => {
    expect(displayPriceBasisFor('heim')).toBe('gross')
    expect(displayPriceBasisFor('gewerbe')).toBe('net')
    expect(priceBasisLabel('gross')).toBe('inkl. 20 % USt')

    const shown = analysisForDisplay(golden, 'gross')
    const net = golden.perBattery[0]!
    const gross = shown.perBattery[0]!
    expect(gross.totalInvestment).toBeCloseTo(net.totalInvestment * 1.2, 9)
    expect(gross.totalSavingPerYear).toBeCloseTo(net.totalSavingPerYear * 1.2, 9)
    expect(gross.battery.pricePerKwh).toBeCloseTo(net.battery.pricePerKwh * 1.2, 9)
    expect(gross.amortizationYears).toBe(net.amortizationYears)
    expect(gross.netInvestment / gross.totalSavingPerYear).toBeCloseTo(
      net.netInvestment / net.totalSavingPerYear,
      12,
    )
    expect(gross.battery.maxPowerKw).toBe(net.battery.maxPowerKw)
    expect(gross.battery.usableCapacityKwh).toBe(net.battery.usableCapacityKwh)
    expect(shown.current.billedKw).toBe(golden.current.billedKw)
    expect(displayedPriceBasis(shown)).toBe('gross')
    expect(displayedPriceBasis(gross.battery)).toBe('gross')
    expect(displayedPriceBasis(golden)).toBe('net')
  })

  it('netto lässt das Ergebnis unangetastet (dasselbe Objekt)', () => {
    expect(analysisForDisplay(golden, 'net')).toBe(golden)
  })
})

describe('supplierPricesOnNetBasis', () => {
  const invoice = (basis: 'net' | 'gross' | null): InvoiceExtraction => {
    const e = emptyInvoiceExtraction()
    e.rates.energyPriceCtPerKwh = 12
    e.rates.supplierBaseFeeEurPerMonth = 6
    e.rates.arbeitspreisNetzCtPerKwh = 5
    e.supplierPriceBasis = basis
    return e
  }

  it('rechnet brutto abgelesene Lieferantenpreise auf netto, Netzpreise bleiben', () => {
    const net = supplierPricesOnNetBasis(invoice('gross'), 'gross')
    expect(net.rates.energyPriceCtPerKwh).toBe(10)
    expect(net.rates.supplierBaseFeeEurPerMonth).toBe(5)
    expect(net.rates.arbeitspreisNetzCtPerKwh).toBe(5)
  })

  it('hält die Lieferantenpreise bei unklarer Basis zurück, statt zu raten', () => {
    const held = supplierPricesOnNetBasis(invoice(null), null)
    expect(held.rates.energyPriceCtPerKwh).toBeNull()
    expect(held.rates.supplierBaseFeeEurPerMonth).toBeNull()
    expect(held.rates.arbeitspreisNetzCtPerKwh).toBe(5)
  })
})
