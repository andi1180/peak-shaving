import { describe, expect, it } from 'vitest'

import { findGridTariffRow } from './grid-tariff-row'
import { buildLevySchedule, findLevyPeriod } from './levies'
import { pinRatesToDate } from './rates-as-of'
import type { GridTariffRowInput } from './tariff-pricing'

const WINDOW = { fromDate: '2025-09-01', toDate: '2026-08-31' }

function row(validFrom: string, validUntil: string | null): GridTariffRowInput {
  return { validFrom, validUntil, netzverlustCtPerKwh: 0.3, priceBasis: 'net', windows: [] }
}

describe('pinRatesToDate', () => {
  const levies = buildLevySchedule('wiener_netze', 7, '2025-09-01', '2026-08-31', 'mit_leistungsmessung', {
    category: 'gewerbe',
    postalCode: '1100',
  })

  it('legt Netzentgelt-Zeile und Abgaben des Stichtags über das ganze Fenster', () => {
    const pinned = pinRatesToDate(
      { gridTariffRows: [row('2026-01-01', null)], spotPrices: null, levies },
      '2026-08-31',
      WINDOW,
    )

    for (const date of ['2025-09-01', '2025-12-31', '2026-02-15', '2026-08-31']) {
      expect(findGridTariffRow(pinned.gridTariffRows!, date)).not.toBeNull()
      const period = findLevyPeriod(pinned.levies!.periods, date)
      expect(period?.gebrauchsabgabeRate).toBe(0.07)
      expect(period?.elektrizitaetsabgabeCtPerKwh).toBe(0.82)
    }
  })

  it('ohne gültige Zeile am Stichtag bleibt die Seite leer — kein Rückfall auf eine ältere', () => {
    const pinned = pinRatesToDate(
      { gridTariffRows: [row('2025-01-01', '2025-12-31')], spotPrices: null, levies },
      '2026-08-31',
      WINDOW,
    )
    expect(pinned.gridTariffRows).toEqual([])
  })
})
