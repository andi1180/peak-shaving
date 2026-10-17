import { describe, expect, it } from 'vitest'
import { formatCtPerKwh } from './format'

describe('formatCtPerKwh', () => {
  it('zeigt immer zwei Nachkommastellen mit Einheit', () => {
    expect(formatCtPerKwh(0.1401 * 100)).toBe('14,01 ct/kWh')
    expect(formatCtPerKwh(0.0643 * 100)).toBe('6,43 ct/kWh')
    expect(formatCtPerKwh(0.015 * 100)).toBe('1,50 ct/kWh')
  })

  it('rundet die halbe Stelle auf, auch nach der Umrechnung aus Euro', () => {
    expect(formatCtPerKwh(0.14005 * 100)).toBe('14,01 ct/kWh')
  })
})
