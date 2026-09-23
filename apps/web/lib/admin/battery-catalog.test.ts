import { describe, expect, it } from 'vitest'
import { missingEngineFields, type BatteryCatalogRow } from './battery-catalog'

/**
 * `missingEngineFields` ist ein SPIEGEL des CHECK `battery_catalog_active_complete` (K1). Die harte
 * Grenze steht in der Datenbank; was hier steht, entscheidet allein, was die Oberfläche MELDET,
 * bevor jemand vergeblich auf „Freigeben" klickt.
 *
 * Geprüft werden die zwei Stellen, an denen ein Spiegel realistisch abweicht: die BEDINGTEN
 * Pflichtfelder (die zwei Zuschläge, die `roi.ts` addiert) und die Unterscheidung „false" von
 * „nicht angegeben" — `inverter_included === false` macht den Wechselrichter-Baustein zur Pflicht, `null` nicht.
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
  rte_source: 'datenblatt',
  list_price_net: 24000,
  inverter_included: true,
  requires_foundation: false,
  foundation_component_id: null,
  installation_component_id: null,
  inverter_component_id: null,
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
  foundation_component_label: null,
  foundation_component_price_net: null,
  installation_component_label: null,
  installation_component_price_net: null,
  inverter_component_label: null,
  inverter_component_price_net: null,
  inverter_component_leistung_kw: null,
}

describe('missingEngineFields', () => {
  it('meldet nichts, wenn alle Engine-Pflichtfelder stehen', () => {
    expect(missingEngineFields(BASE)).toEqual([])
  })

  it('macht die zwei Zuschläge nur dort zur Pflicht, wo sie in die Investition eingehen', () => {
    expect(
      missingEngineFields({ ...BASE, inverter_included: false, requires_foundation: true }),
    ).toEqual(['inverter_component_id', 'foundation_component_id'])
  })

  it('verlangt am zugeordneten Wechselrichter-Baustein Preis und Nennleistung', () => {
    expect(
      missingEngineFields({ ...BASE, inverter_included: false, inverter_component_id: 'w1' }),
    ).toEqual(['inverter_component_price_net', 'inverter_component_leistung_kw'])
  })

  // K1b: aus einem Betrag sind zwei Zustände geworden, und sie verlangen verschiedene Handgriffe
  // an verschiedenen Stellen — zugeordnet-aber-unbepreist darf nicht wie gar-nicht-zugeordnet
  // aussehen, sonst schickt die Meldung jemanden ins falsche Formular.
  it('unterscheidet den fehlenden Baustein vom Baustein ohne Preis', () => {
    expect(missingEngineFields({ ...BASE, requires_foundation: true })).toEqual([
      'foundation_component_id',
    ])
    expect(
      missingEngineFields({
        ...BASE,
        requires_foundation: true,
        foundation_component_id: 'b1e1…',
        foundation_component_price_net: null,
      }),
    ).toEqual(['foundation_component_price_net'])
    expect(
      missingEngineFields({
        ...BASE,
        requires_foundation: true,
        foundation_component_id: 'b1e1…',
        foundation_component_price_net: 4200,
      }),
    ).toEqual([])
  })

  it('unterscheidet „nicht angegeben" von „nein" — null verlangt keinen Zuschlag', () => {
    expect(missingEngineFields({ ...BASE, inverter_included: null })).toEqual(['inverter_included'])
  })
})
