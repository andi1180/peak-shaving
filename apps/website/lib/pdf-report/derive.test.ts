import { describe, expect, it } from 'vitest'

import { tariffVintageNote } from './derive'

describe('tariffVintageNote — spricht den Kunden direkt an', () => {
  it('sagt „Ihre Jahresrechnung", nicht „die Jahresrechnung des Kunden"', () => {
    const note = tariffVintageNote(
      {
        readings: [{ ts: '2026-03-17T00:00:00.000Z', gridPowerKw: 9 }],
        timezoneMeta: 'Europe/Vienna',
      },
      { supplierBaseFeeEurPerMonth: undefined },
      new Date('2026-09-24T00:00:00.000Z'),
    )

    expect(note).toContain('Ihre 2026er-Jahresrechnung benötigt.')
    expect(note).not.toContain('des Kunden')
  })
})
