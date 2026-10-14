import { describe, expect, it } from 'vitest'

import { isValidPostalCode, normalizePostalCodeFor } from './country'

describe('PLZ-Regel je Land', () => {
  it('AT: vier Ziffern gelten, fünf werden abgelehnt', () => {
    expect(isValidPostalCode('AT', '1100')).toBe(true)
    expect(isValidPostalCode('AT', '10115')).toBe(false)
    expect(normalizePostalCodeFor('AT', 'A-1100')).toBe('1100')
    expect(normalizePostalCodeFor('AT', '10115')).toBeNull()
  })

  it('DE: fünf Ziffern gelten, vier werden abgelehnt', () => {
    expect(isValidPostalCode('DE', '10115')).toBe(true)
    expect(isValidPostalCode('DE', '1010')).toBe(false)
    expect(normalizePostalCodeFor('DE', ' 10115 ')).toBe('10115')
    expect(normalizePostalCodeFor('DE', '1010')).toBeNull()
    expect(normalizePostalCodeFor('DE', 'D-10115')).toBeNull() // nicht normalisiert, wie in der DB
  })
})
