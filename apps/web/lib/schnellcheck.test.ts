import { describe, expect, it } from 'vitest'
import { computeSchnellcheck, formatTyped, parseGroupedNumber } from './schnellcheck'

const base = { country: 'AT' as const, kwh: 250_000, kw: null, bill: null, sliderKw: 150 }

describe('schnellcheck', () => {
  it('180 kW kosten rund 12.100 € pro Jahr', () => {
    const result = computeSchnellcheck({ ...base, kw: 180 })
    expect(result?.country === 'AT' && result.peakCostEur).toBe(12_100)
  })

  it('bei 65.000 € Rechnung ist der Anteil gerundet 19 %', () => {
    const result = computeSchnellcheck({ ...base, kw: 180, bill: 65_000 })
    expect(result?.country === 'AT' && result.bill?.percent).toBe(19)
    expect(result?.country === 'AT' && result.bill?.restEur).toBe(52_900)
  })

  it('Spitzenkosten ≥ Rechnung → kein Balken', () => {
    const result = computeSchnellcheck({ ...base, kw: 180, bill: 12_100 })
    expect(result?.country === 'AT' && result.bill).toBeNull()
  })

  it('ohne Jahresverbrauch gibt es kein Ergebnis', () => {
    expect(computeSchnellcheck({ ...base, kwh: null, kw: 180 })).toBeNull()
  })

  it('ohne kW rechnet der Reglerwert, in Deutschland gibt es keine Euro-Zahl', () => {
    const at = computeSchnellcheck(base)
    expect(at?.country === 'AT' && [at.kw, at.kwFromInput]).toEqual([150, false])
    expect(computeSchnellcheck({ ...base, country: 'DE', kw: 180 })).toEqual({
      country: 'DE',
      smallConsumption: false,
    })
  })

  it('liest und formatiert getippte Zahlen mit Tausenderpunkt', () => {
    expect(parseGroupedNumber('250.000')).toBe(250_000)
    expect(parseGroupedNumber('0')).toBeNull()
    expect(formatTyped('65000')).toBe('65.000')
  })
})
