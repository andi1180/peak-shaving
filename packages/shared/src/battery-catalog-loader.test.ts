import { describe, expect, it } from 'vitest'

import {
  BATTERY_CATALOG_SELECT,
  batteryCatalogRowToCandidate,
  loadBatteryCatalog,
  type BatteryCatalogRow,
  type BatteryCatalogSource,
} from './battery-catalog-loader'

/** Eine echte Produktionszeile (Fox ESS G-Max, 23.09.2026) als Ausgangspunkt. */
function row(overrides: Partial<BatteryCatalogRow> = {}): BatteryCatalogRow {
  return {
    id: '9750f9e0-c31c-4f8c-972d-bf3f2c50be23',
    kategorie: 'gewerbe',
    hersteller: 'Fox ESS',
    bezeichnung: 'Fox ESS G-Max GM215kWh-100kW-2h',
    usable_capacity_kwh: 215,
    max_power_kw: 100,
    round_trip_efficiency: 0.89,
    list_price_net: 36000,
    inverter_included: true,
    requires_foundation: true,
    control_type: null,
    active: true,
    foundation_component: { art: 'fundament', price_net: 2200 },
    installation_component: null,
    inverter_component: null,
    ...overrides,
  }
}

const sourceOf = (rows: BatteryCatalogRow[]): BatteryCatalogSource => async () => ({ ok: true, rows })

describe('batteryCatalogRowToCandidate', () => {
  it('übersetzt eine Zeile in den Engine-Typ, Gesamtpreis wird ungerundet zum Preis je kWh', () => {
    const result = batteryCatalogRowToCandidate(row())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.candidate).toEqual({
      id: '9750f9e0-c31c-4f8c-972d-bf3f2c50be23',
      name: 'Fox ESS G-Max GM215kWh-100kW-2h',
      manufacturer: 'Fox ESS',
      class: 'commercial',
      usableCapacityKwh: 215,
      maxPowerKw: 100,
      roundTripEfficiency: 0.89,
      pricePerKwh: 36000 / 215,
      inverterIncluded: true,
      extraInverterCost: 0,
      requiresFoundation: true,
      foundationCost: 2200,
      controlType: 'dynamic',
    })
    // Die Umkehrung der Division muss den Listenpreis exakt zurückgeben — genau so rechnet
    // `calculateTotalInvestment` (roi.ts:20), und eine Rundung liefe hier in die Investition.
    expect(result.candidate.usableCapacityKwh * result.candidate.pricePerKwh).toBe(36000)
  })

  it('löst den Fundament-Baustein zum reinen Wert auf, ohne Verweis auf die Bausteinzeile', () => {
    const result = batteryCatalogRowToCandidate(
      row({ foundation_component: { art: 'fundament', price_net: '3500.00' } }),
    )
    expect(result.ok && result.candidate.foundationCost).toBe(3500)
    expect(JSON.stringify(result)).not.toContain('fundament')
  })

  it('weist ein fundamentpflichtiges Gerät ohne Fundamentpreis ab, statt still mit 0 zu rechnen', () => {
    expect(batteryCatalogRowToCandidate(row({ foundation_component: null }))).toEqual({
      ok: false,
      reason: 'foundation_price_missing',
    })
    expect(
      batteryCatalogRowToCandidate(row({ foundation_component: { art: 'fundament', price_net: null } })),
    ).toEqual({ ok: false, reason: 'foundation_price_missing' })
  })

  it('rechnet einen Wechselrichter-Baustein ein: Preis in die Investition, Leistung als Obergrenze', () => {
    const result = batteryCatalogRowToCandidate(
      row({
        kategorie: 'heim',
        max_power_kw: 12,
        inverter_included: false,
        requires_foundation: false,
        foundation_component: null,
        inverter_component: { art: 'wechselrichter', price_net: '1330.5', leistung_kw: '8' },
      }),
    )
    expect(result.ok && result.candidate).toMatchObject({
      inverterIncluded: false,
      extraInverterCost: 1330.5,
      maxPowerKw: 8,
      roundTripEfficiency: 0.89,
    })
  })

  it('weist ein Gerät ohne eingebauten Wechselrichter und ohne bepreisten Baustein ab', () => {
    for (const inverter_component of [
      null,
      { art: 'wechselrichter', price_net: null, leistung_kw: 8 },
    ]) {
      expect(
        batteryCatalogRowToCandidate(row({ inverter_included: false, inverter_component })),
      ).toEqual({ ok: false, reason: 'inverter_price_missing' })
    }
  })

  it('weist eine inaktive und eine unvollständige Zeile ab', () => {
    expect(batteryCatalogRowToCandidate(row({ active: false }))).toEqual({
      ok: false,
      reason: 'inactive',
    })
    expect(batteryCatalogRowToCandidate(row({ usable_capacity_kwh: null }))).toEqual({
      ok: false,
      reason: 'incomplete',
    })
  })

  it('ersetzt eine fehlende Steuerungsart durch die Konvention der Kategorie', () => {
    const heim = batteryCatalogRowToCandidate(
      row({ kategorie: 'heim', requires_foundation: false, foundation_component: null }),
    )
    expect(heim.ok && heim.candidate.controlType).toBe('static')
    expect(heim.ok && heim.candidate.class).toBe('residential')

    const explicit = batteryCatalogRowToCandidate(row({ control_type: 'static' }))
    expect(explicit.ok && explicit.candidate.controlType).toBe('static')
  })
})

describe('loadBatteryCatalog', () => {
  it('liefert die verwendbaren Geräte und den Installationspreis daneben', async () => {
    const result = await loadBatteryCatalog(
      'gewerbe',
      sourceOf([row({ installation_component: { art: 'installation', price_net: 1800 } })]),
    )
    expect(result.kind).toBe('available')
    if (result.kind !== 'available') return
    expect(result.batteries).toHaveLength(1)
    expect(result.installationCostNet[result.batteries[0]!.id]).toBe(1800)
    // Der Installationspreis gehört NICHT in den Engine-Typ — die Engine rechnet ihn nicht mit.
    expect(result.batteries[0]).not.toHaveProperty('installationCostNet')
  })

  it('unterscheidet empty von failed — und nennt bei empty den Grund', async () => {
    const noRows = await loadBatteryCatalog('heim', sourceOf([]))
    expect(noRows).toEqual({ kind: 'empty', category: 'heim', skipped: [] })

    const allSkipped = await loadBatteryCatalog('gewerbe', sourceOf([row({ active: false })]))
    expect(allSkipped.kind).toBe('empty')
    expect(allSkipped.kind === 'empty' && allSkipped.skipped[0]?.reason).toBe('inactive')

    const failed = await loadBatteryCatalog('gewerbe', async () => ({
      ok: false,
      reason: 'request_failed',
      message: 'kaputt',
    }))
    expect(failed).toEqual({ kind: 'failed', reason: 'request_failed', message: 'kaputt' })
  })

  it('rechnet eine Zeile fremder Kategorie nicht mit, sondern benennt sie', async () => {
    const result = await loadBatteryCatalog('heim', sourceOf([row()]))
    expect(result.kind === 'empty' && result.skipped).toEqual([
      { id: row().id, label: row().bezeichnung, reason: 'wrong_category' },
    ])
  })

  it('bettet beide Kostenbausteine über ihren Fremdschlüsselnamen ein', () => {
    // Ohne `!…_fkey` kann PostgREST die zweifache Beziehung nicht auflösen (PGRST201).
    expect(BATTERY_CATALOG_SELECT).toContain(
      'foundation_component:battery_cost_components!battery_catalog_foundation_component_id_fkey',
    )
    expect(BATTERY_CATALOG_SELECT).toContain(
      'installation_component:battery_cost_components!battery_catalog_installation_component_id_fkey',
    )
    expect(BATTERY_CATALOG_SELECT).toContain(
      'inverter_component:battery_cost_components!battery_catalog_inverter_component_id_fkey(art,price_net,leistung_kw)',
    )
  })
})
