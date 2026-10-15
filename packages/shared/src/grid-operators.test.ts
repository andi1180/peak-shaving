import { describe, expect, it } from 'vitest'
import { catalogCountryOfOperator, gridOperatorOptionsFor, netzebeneLabel } from './grid-operators'

describe('netzebeneLabel', () => {
  it('beschriftet DE nach Spannungsbereich und lässt AT unverändert', () => {
    expect(netzebeneLabel('DE', 7)).toBe('Niederspannung')
    expect(netzebeneLabel('DE', 4)).toBe('Umspannung HS/MS')
    expect(netzebeneLabel('AT', 7)).toBe('Netzebene 7')
  })
})

describe('gridOperatorOptionsFor', () => {
  it('AT ohne Zeilen ist exakt die bisherige Auswahl in der bisherigen Reihenfolge', () => {
    expect(gridOperatorOptionsFor('AT', [])).toEqual([
      { id: 'wiener_netze', label: 'Wiener Netze' },
      { id: 'netz_noe', label: 'Netz Niederösterreich' },
      { id: 'salzburg_netz', label: 'Salzburg Netz' },
    ])
  })

  it('AT ergänzt Betreiber aus den Zeilen, ohne Katalogeinträge zu doppeln oder umzubenennen', () => {
    const options = gridOperatorOptionsFor('AT', [
      { operator_id: 'wiener_netze', operator_name: 'Wiener Netze GmbH' },
      { operator_id: 'linz_netz', operator_name: 'LINZ NETZ' },
    ])
    expect(options.map((o) => o.id)).toEqual([
      'wiener_netze',
      'netz_noe',
      'salzburg_netz',
      'linz_netz',
    ])
    expect(options[0]!.label).toBe('Wiener Netze')
  })

  it('DE ist ohne Zeilen leer und mit einer DE-Zeile genau diese', () => {
    expect(gridOperatorOptionsFor('DE', [])).toEqual([])
    expect(
      gridOperatorOptionsFor('DE', [
        { operator_id: 'stromnetz_berlin', operator_name: 'Stromnetz Berlin' },
      ]),
    ).toEqual([{ id: 'stromnetz_berlin', label: 'Stromnetz Berlin' }])
  })
})

describe('catalogCountryOfOperator', () => {
  it('ordnet die Katalogkennungen ihrem Land zu und sonst keinem', () => {
    expect(catalogCountryOfOperator('wiener_netze')).toBe('AT')
    expect(catalogCountryOfOperator('stromnetz_berlin')).toBeNull()
  })
})
