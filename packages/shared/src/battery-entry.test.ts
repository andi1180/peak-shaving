import { describe, expect, it } from 'vitest'

import { peakShavingSavingPerYearOf } from './battery-entry'

describe('peakShavingSavingPerYearOf', () => {
  it('Müldür-Hauptreport: 12,3 kW Senkung, Leistungspreis 82,92 € × 1,07 plus EAG 5,619 €/kW·a = 1.160 €', () => {
    /* Ø Senkung je Monat: (255,764 − 181,964) kW über 6 Monate. */
    const kwReduction = (255.764 - 181.964) / 6
    const saving = peakShavingSavingPerYearOf({
      leistungspreisSavingPerYear: kwReduction * 82.92 * 1.07,
      eagDemandSavingPerYear: kwReduction * 5.619,
    })
    expect(Math.round(saving)).toBe(1160)
  })

  it('ohne positiven Leistungspreis-Anteil gibt es keine Kappung, auch keinen EAG-Rest', () => {
    expect(
      peakShavingSavingPerYearOf({ leistungspreisSavingPerYear: 0, eagDemandSavingPerYear: 5 }),
    ).toBe(0)
    expect(peakShavingSavingPerYearOf(undefined)).toBe(0)
  })
})
