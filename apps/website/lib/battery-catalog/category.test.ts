import { describe, expect, it } from 'vitest'

import { batteryCategoryFor, tariffComparisonDefaultFor } from './category'

describe('batteryCategoryFor', () => {
  it('Standardprofil mit Kundenklasse Haushalt fragt den Heim-Katalog', () => {
    expect(batteryCategoryFor({ entry: 'standard_profile', customerClass: 'privat' })).toBe('heim')
  })

  /*
   * Der Fall, den die Regel überhaupt erst nötig macht: `kleingewerbe` ist heute im Auswahlfeld
   * deaktiviert, aber sichtbar. Wird es freigeschaltet, muss ein Kleingewerbe Gewerbespeicher
   * bekommen — an der Herkunft des Lastgangs allein wäre das nicht unterscheidbar.
   */
  it('Standardprofil mit Kleingewerbe fragt den Gewerbe-Katalog', () => {
    expect(batteryCategoryFor({ entry: 'standard_profile', customerClass: 'kleingewerbe' })).toBe(
      'gewerbe',
    )
  })

  it('ein hochgeladener Lastgang gilt als Gewerbe', () => {
    expect(batteryCategoryFor({ entry: 'upload' })).toBe('gewerbe')
  })
})

describe('tariffComparisonDefaultFor', () => {
  it('Börsenpreis-Vergleich ist für Haushalte vorgewählt, für Gewerbe nicht', () => {
    expect(tariffComparisonDefaultFor('heim')).toBe(true)
    expect(tariffComparisonDefaultFor('gewerbe')).toBe(false)
  })
})
