import { describe, expect, it } from 'vitest'

import { computeNetworkTierCost, type NetworkTierResult } from './network-tier'
import type { GridTariffRowInput } from './tariff-pricing'

function tierRow(
  validFrom: string,
  validUntil: string | null,
  lp1: number,
  ap1Ct: number,
  lp2: number,
  ap2Ct: number,
): GridTariffRowInput {
  return {
    validFrom,
    validUntil,
    netzverlustCtPerKwh: 0,
    grundpreisAmount: lp1,
    grundpreisUnit: 'eur_per_kw_year',
    tierThresholdHours: 2500,
    tier2LeistungspreisEurPerKwYear: lp2,
    tier2ArbeitspreisCtPerKwh: ap2Ct,
    priceBasis: 'net',
    windows: [
      {
        label: 'netz_test',
        monthDayFrom: null,
        monthDayTo: null,
        timeFrom: '00:00',
        timeTo: '24:00',
        ctPerKwh: ap1Ct,
      },
    ],
  }
}

const R26 = tierRow('2026-01-01', null, 22.75, 7.8, 115.43, 4.09)
const R25 = tierRow('2025-01-01', '2025-12-31', 29.81, 8.76, 131.8, 4.68)

/** `count` Tage ab `from`, `totalKwh` gleichverteilt. */
function days(from: string, count: number, totalKwh: number) {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => ({
    localDate: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    kwh: totalKwh / count,
  }))
}

function tiered(result: NetworkTierResult) {
  if (result.kind !== 'tiered') throw new Error(`erwartet tiered, war ${JSON.stringify(result)}`)
  return result
}

const EUR = 1 // toBeCloseTo(…, 1): Abweichung < 0,05 €
const YEAR_2026 = days('2026-01-01', 365, 117_841)

describe('computeNetworkTierCost', () => {
  it('(a) eine Zeile, ganzes Jahr: Stufe nach Kostenminimum, N = Kosten − AP₁-Basis', () => {
    const at = (P: number) =>
      tiered(computeNetworkTierCost({ rows: [R26], billedKw: P, dailyKwh: YEAR_2026 }))

    const p491 = at(49.1)
    expect(p491.tier).toBe(1)
    expect(p491.costTier1Eur).toBeCloseTo(22.75 * 49.1 + 0.078 * 117_841, EUR)
    expect(p491.costTier1Eur).toBeCloseTo(10_308.62, EUR)
    expect(p491.costTier2Eur).toBeCloseTo(115.43 * 49.1 + 0.0409 * 117_841, EUR)
    expect(p491.costTier2Eur).toBeCloseTo(10_487.31, EUR)
    expect(p491.correctionEur).toBeCloseTo(1_117.03, EUR)
    expect(p491.usageHours).toBeCloseTo(117_841 / 49.1, 6)
    expect(p491.thresholdHours).toBe(2500)

    const p471 = at(47.1)
    expect(p471.tier).toBe(2)
    expect(p471.costTier1Eur).toBeCloseTo(10_263.12, EUR)
    expect(p471.costTier2Eur).toBeCloseTo(10_256.45, EUR)

    const p40 = at(40)
    expect(p40.tier).toBe(2)
    expect(p40.chosenCostEur).toBeCloseTo(9_436.9, EUR)
    expect(p40.correctionEur).toBeCloseTo(245.3, EUR)

    const p35 = at(35)
    expect(p35.tier).toBe(2)
    expect(p35.chosenCostEur).toBeCloseTo(8_859.75, EUR)
    expect(p35.correctionEur).toBeCloseTo(-331.85, EUR)

    expect(p491.correctionEur - p40.correctionEur).toBeCloseTo(871.73, EUR)
    expect(p491.correctionEur - p35.correctionEur).toBeCloseTo(1_448.88, EUR)
  })

  it('(b) zwei Zeilen: Leistungspreis tagesanteilig, Arbeitspreis je Tag aus seiner Zeile', () => {
    const dailyKwh = [...days('2025-09-01', 122, 40_042), ...days('2026-01-01', 243, 77_799)]
    const r = tiered(computeNetworkTierCost({ rows: [R25, R26], billedKw: 49.1, dailyKwh }))
    const lpEff1 = (29.81 * 122 + 22.75 * 243) / 365
    expect(r.tier).toBe(1)
    expect(r.lpEffTier1EurPerKwYear).toBeCloseTo(lpEff1, 9)
    expect(r.costTier1Eur).toBeCloseTo(10_808.89, EUR)
    expect(r.costTier2Eur).toBeCloseTo(10_992.21, EUR)
    expect(r.correctionEur).toBeCloseTo(lpEff1 * 49.1, EUR)
    expect(r.correctionEur).toBeCloseTo(1_232.89, EUR)
    expect(r.thresholdHours).toBe(2500)
  })

  it('(c) Teiljahr: f auf die Arbeitsmenge entspricht der gestreckten Reihe', () => {
    const partial = days('2026-03-01', 182, 50_000).map((d, i) => ({
      ...d,
      kwh: d.kwh * (1 + (i % 7) / 10),
    }))
    const f = 365 / 182
    const withFactor = computeNetworkTierCost({
      rows: [R26],
      billedKw: 30,
      dailyKwh: partial,
      annualizationFactor: f,
    })
    const stretched = computeNetworkTierCost({
      rows: [R26],
      billedKw: 30,
      dailyKwh: partial.map((d) => ({ ...d, kwh: d.kwh * f })),
    })
    const a = tiered(withFactor)
    const b = tiered(stretched)
    expect(a.tier).toBe(b.tier)
    for (const key of ['costTier1Eur', 'costTier2Eur', 'correctionEur', 'annualKwh'] as const)
      expect(a[key]).toBeCloseTo(b[key], 6)
  })

  it('(d) Kosten und Korrektur fallen nicht mit steigendem P', () => {
    let lastCost = -Infinity
    let lastN = -Infinity
    for (let P = 0; P <= 60; P += 0.5) {
      const r = tiered(computeNetworkTierCost({ rows: [R26], billedKw: P, dailyKwh: YEAR_2026 }))
      expect(r.chosenCostEur).toBeGreaterThanOrEqual(lastCost)
      expect(r.correctionEur).toBeGreaterThanOrEqual(lastN)
      lastCost = r.chosenCostEur
      lastN = r.correctionEur
    }
  })

  it('(e) ohne Stufen, gemischt, fehlende Zeile, falsche Grundpreis-Einheit', () => {
    const plain: GridTariffRowInput = { ...R26 }
    delete plain.tierThresholdHours
    delete plain.tier2LeistungspreisEurPerKwYear
    delete plain.tier2ArbeitspreisCtPerKwh
    const plain26: GridTariffRowInput = { ...plain, validFrom: '2026-07-01' }
    const run = (rows: GridTariffRowInput[], dailyKwh = YEAR_2026) =>
      computeNetworkTierCost({ rows, billedKw: 40, dailyKwh })

    expect(run([plain])).toEqual({ kind: 'no_tiers' })
    expect(run([R26, plain26])).toEqual({ kind: 'error', reason: 'mixed_tier_rows' })
    expect(run([R26], days('2025-12-31', 2, 100))).toEqual({ kind: 'error', reason: 'missing_row' })
    expect(run([{ ...R26, grundpreisUnit: 'eur_per_year' }])).toEqual({
      kind: 'error',
      reason: 'invalid_tier_row',
    })
  })

  it('(f) billedKw = 0: keine Benutzungsdauer, kein Fehler', () => {
    const r = tiered(computeNetworkTierCost({ rows: [R26], billedKw: 0, dailyKwh: YEAR_2026 }))
    expect(r.usageHours).toBeNull()
    expect(r.tier).toBe(2)
  })
})
