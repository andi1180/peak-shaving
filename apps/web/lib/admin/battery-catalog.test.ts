import { describe, expect, it } from 'vitest'
import { missingEngineFields, type BatteryCatalogRow } from './battery-catalog'

/**
 * `missingEngineFields` ist ein SPIEGEL des CHECK `battery_catalog_active_complete` (K1). Die harte
 * Grenze steht in der Datenbank; was hier steht, entscheidet allein, was die Oberfläche MELDET,
 * bevor jemand vergeblich auf „Freigeben" klickt.
 *
 * Geprüft werden die zwei Stellen, an denen ein Spiegel realistisch abweicht: die BEDINGTEN
 * Pflichtfelder (die zwei Zuschläge, die `roi.ts` addiert) und die Unterscheidung „false" von
 * „nicht angegeben" — `inverter_included === false` macht den Aufpreis zur Pflicht, `null` nicht.
 */
const BASE: BatteryCatalogRow = {
  id: 'b1',
  memodo_id: null,
  kategorie: 'gewerbe',
  hersteller: 'Test',
  bezeichnung: 'Gerät',
  usable_capacity_kwh: 60,
  max_power_kw: 30,
  round_trip_efficiency: 0.9,
  list_price_net: 24000,
  inverter_included: true,
  extra_inverter_cost_net: null,
  requires_foundation: false,
  foundation_cost_net: null,
  installation_cost_net: null,
  price_as_of: null,
  source_url: null,
  datasheet_url: null,
  control_type: null,
  notes: null,
  active: false,
  created_at: '2026-09-22T00:00:00Z',
  updated_at: '2026-09-22T00:00:00Z',
  purchase_price_net: null,
  purchase_price_as_of: null,
}

describe('missingEngineFields', () => {
  it('meldet nichts, wenn alle Engine-Pflichtfelder stehen', () => {
    expect(missingEngineFields(BASE)).toEqual([])
  })

  it('macht die zwei Zuschläge nur dort zur Pflicht, wo sie in die Investition eingehen', () => {
    expect(
      missingEngineFields({ ...BASE, inverter_included: false, requires_foundation: true }),
    ).toEqual(['extra_inverter_cost_net', 'foundation_cost_net'])
  })

  it('unterscheidet „nicht angegeben" von „nein" — null verlangt keinen Zuschlag', () => {
    expect(missingEngineFields({ ...BASE, inverter_included: null })).toEqual(['inverter_included'])
  })
})
