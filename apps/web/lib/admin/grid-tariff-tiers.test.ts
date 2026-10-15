import { describe, expect, it } from 'vitest'
import { gridTariffFieldErrors, gridTariffSchema, readGridTariffForm } from './grid-tariffs-schema'

function form(over: Record<string, string> = {}): FormData {
  const fields: Record<string, string> = {
    operatorId: 'gate_de',
    operatorName: 'Gate Netz',
    country: 'DE',
    netzebene: '5',
    grundpreisAmount: '20,5',
    grundpreisUnit: 'eur_per_kw_year',
    netzverlustCtPerKwh: '0',
    priceBasis: 'net',
    validFrom: '2026-01-01',
    w0_label: 'normal',
    w0_timeFrom: '00:00',
    w0_timeTo: '24:00',
    w0_ctPerKwh: '6,1',
    ...over,
  }
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function parse(over: Record<string, string> = {}) {
  return gridTariffSchema.safeParse(readGridTariffForm(form(over)))
}

function errors(over: Record<string, string>): Record<string, string> {
  const r = parse(over)
  return r.success ? {} : gridTariffFieldErrors(r.error.issues)
}

const TIERS = {
  tierThresholdHours: '2500',
  tier2LeistungspreisEurPerKwYear: '110,4',
  tier2ArbeitspreisCtPerKwh: '1,9',
}

describe('Benutzungsdauer-Stufen im Admin-Schema', () => {
  it('alle drei Felder mit Dezimalkomma werden gelesen; ohne Stufen fehlen sie', () => {
    const withTiers = parse(TIERS)
    expect(withTiers.success && withTiers.data).toMatchObject({
      grundpreisAmount: 20.5,
      tierThresholdHours: 2500,
      tier2LeistungspreisEurPerKwYear: 110.4,
      tier2ArbeitspreisCtPerKwh: 1.9,
    })
    const without = parse()
    expect(without.success && without.data.tierThresholdHours).toBeUndefined()
  })

  it('ein oder zwei Felder werden abgewiesen, an den fehlenden', () => {
    expect(errors({ tierThresholdHours: '2500' })).toMatchObject({
      tier2LeistungspreisEurPerKwYear: expect.stringMatching(/alle drei/),
      tier2ArbeitspreisCtPerKwh: expect.stringMatching(/alle drei/),
    })
    expect(Object.keys(errors({ ...TIERS, tier2ArbeitspreisCtPerKwh: '' }))).toEqual([
      'tier2ArbeitspreisCtPerKwh',
    ])
  })

  it('Einheit eur_per_year, Schwelle 0, ein zweites Fenster oder eine Saison werden abgewiesen', () => {
    expect(errors({ ...TIERS, grundpreisUnit: 'eur_per_year' }).tierThresholdHours).toMatch(
      /€\/kW·a/,
    )
    expect(errors({ ...TIERS, tierThresholdHours: '0' }).tierThresholdHours).toMatch(
      /grösser als 0/,
    )
    const second = { w1_label: 'snap', w1_timeFrom: '10:00', w1_timeTo: '16:00', w1_ctPerKwh: '3' }
    expect(errors({ ...TIERS, ...second }).tierThresholdHours).toMatch(/genau ein ganzjähriges/)
    const season = { w0_monthDayFrom: '04-01', w0_monthDayTo: '09-30' }
    expect(errors({ ...TIERS, ...season }).tierThresholdHours).toMatch(/genau ein ganzjähriges/)
  })
})
