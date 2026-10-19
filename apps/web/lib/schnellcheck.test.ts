import { describe, expect, it } from 'vitest'
import { computeSchnellcheck, demandPrice, formatTyped, parseGroupedNumber } from './schnellcheck'

const base = { country: 'AT' as const, kwh: 250_000, kw: null, bill: null, sliderKw: 150 }

describe('schnellcheck', () => {
  it('AT: 180 kW kosten rund 12.100 € pro Jahr, 10-%-Box 1.200 €', () => {
    const result = computeSchnellcheck({ ...base, kw: 180 })
    expect([result?.peakCostEur, result?.savingEur, result?.usageHours]).toEqual([
      12_100,
      1_200,
      null,
    ])
  })

  it('DE: 250.000 kWh / 180 kW (1.389 h) → 34 €/kW·a, 6.100 €, Box 600 €', () => {
    const result = computeSchnellcheck({ ...base, country: 'DE', kw: 180 })
    expect([result?.demandPrice, result?.peakCostEur, result?.savingEur]).toEqual([34, 6_100, 600])
    expect(Math.round(result?.usageHours ?? 0)).toBe(1_389)
  })

  it('DE: 600.000 kWh / 180 kW (3.333 h) → 152 €/kW·a, 27.400 €, Box 2.700 €', () => {
    const result = computeSchnellcheck({ ...base, country: 'DE', kwh: 600_000, kw: 180 })
    expect([result?.demandPrice, result?.peakCostEur, result?.savingEur]).toEqual([
      152, 27_400, 2_700,
    ])
  })

  it('DE: genau 2.500 h zählen zum hohen Preis', () => {
    expect(demandPrice('DE', 250_000, 100)).toBe(152)
    expect(demandPrice('DE', 249_999, 100)).toBe(34)
  })

  it('bei 65.000 € Rechnung ist der Anteil gerundet 19 %', () => {
    const result = computeSchnellcheck({ ...base, kw: 180, bill: 65_000 })
    expect(result?.bill?.percent).toBe(19)
    expect(result?.bill?.restEur).toBe(52_900)
  })

  it('Spitzenkosten ≥ Rechnung → kein Balken', () => {
    const result = computeSchnellcheck({ ...base, kw: 180, bill: 12_100 })
    expect(result?.bill).toBeNull()
  })

  it('ohne Jahresverbrauch gibt es kein Ergebnis', () => {
    expect(computeSchnellcheck({ ...base, kwh: null, kw: 180 })).toBeNull()
  })

  it('ohne kW rechnet der Reglerwert, auch in Deutschland', () => {
    const at = computeSchnellcheck(base)
    expect([at?.kw, at?.kwFromInput]).toEqual([150, false])
    const de = computeSchnellcheck({ ...base, country: 'DE' })
    expect([de?.kw, de?.usageHours]).toEqual([150, 250_000 / 150])
  })

  it('liest und formatiert getippte Zahlen mit Tausenderpunkt', () => {
    expect(parseGroupedNumber('250.000')).toBe(250_000)
    expect(parseGroupedNumber('0')).toBeNull()
    expect(formatTyped('65000')).toBe('65.000')
  })
})
