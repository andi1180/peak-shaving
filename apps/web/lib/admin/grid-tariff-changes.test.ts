import { describe, expect, it } from 'vitest'
import { changedFields } from './grid-tariff-changes'
import { readUpdateGridTariffForm, updateGridTariffSchema } from './grid-tariffs-schema'

const base = {
  operator_name: 'Wiener Netze',
  grundpreis_amount: 38.52,
  grundpreis_unit: 'eur_per_kw_year',
  messpreis_amount: null,
  messpreis_unit: null,
  netzverlust_ct_per_kwh: 0.3,
  price_basis: 'net',
  valid_from: '2026-01-01',
  valid_until: null,
  rate_windows: [
    {
      label: 'normal',
      month_day_from: null,
      month_day_to: null,
      time_from: '00:00:00',
      time_to: '24:00:00',
      ct_per_kwh: 4.5,
      note: null,
    },
  ],
}

describe('changedFields', () => {
  it('meldet nur geänderte Felder, Betrag und Einheit als eine Zeile', () => {
    const out = changedFields({
      old_row: base,
      new_row: {
        ...base,
        netzverlust_ct_per_kwh: 0.43,
        messpreis_amount: 2.4,
        messpreis_unit: 'eur_per_month',
      },
    })
    expect(out.map((f) => f.label)).toEqual(['Messpreis', 'Netzverlust'])
    expect(out[0]!.from).toBe('—')
    expect(out[1]).toEqual({ label: 'Netzverlust', from: '0.3 ct/kWh', to: '0.43 ct/kWh' })
  })
})

describe('updateGridTariffSchema', () => {
  it('verlangt einen Grund und lehnt ein Ende vor dem Beginn ab', () => {
    const fd = new FormData()
    for (const [k, v] of Object.entries({
      tariffId: '0b6f1c3e-2d4a-4c5b-8e9f-1a2b3c4d5e6f',
      operatorId: 'wiener_netze',
      operatorName: 'Wiener Netze',
      netzebene: '5',
      grundpreisAmount: '38.52',
      grundpreisUnit: 'eur_per_kw_year',
      netzverlustCtPerKwh: '0.3',
      priceBasis: 'net',
      validFrom: '2026-01-01',
      validUntil: '2025-12-31',
      reason: '  ',
      w0_label: 'normal',
      w0_timeFrom: '00:00',
      w0_timeTo: '24:00',
      w0_ctPerKwh: '4.5',
    }))
      fd.set(k, v)
    const res = updateGridTariffSchema.safeParse(readUpdateGridTariffForm(fd))
    expect(res.success).toBe(false)
    const paths = res.success ? [] : res.error.issues.map((i) => i.path[0])
    expect(paths).toEqual(expect.arrayContaining(['reason', 'validUntil']))
  })
})
