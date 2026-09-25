import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { simulateBattery } from '../simulation/simulate'
import { computeBatterySavings } from './attribute'
import { annualizationFactor } from './annualization'

const STEP_MS = 15 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

function profile(days: number[][], startIso = '2023-06-01T00:00:00Z'): LoadProfile {
  const t0 = Date.parse(startIso)
  const readings = days
    .flat()
    .map((gridPowerKw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw }))
  return { readings, intervalMinutes: 15, timezoneMeta: 'UTC', source: 'net_signed' }
}

/**
 * Ein Tag (96 × 15 min). `peak` ersetzt die Morgenspitze (idx 24–31) — sonst 15 kW.
 *  - idx 0–23   (00–06 h): 5 kW  · NT-Fenster (günstig)
 *  - idx 24–39  (06–10 h): 15 kW · Morgen (teuer) — bzw. `peak` in 24–31
 *  - idx 40–55  (10–14 h): −20 kW · PV-Einspeisung
 *  - idx 56–79  (14–20 h): 25 kW · Nachmittag (teuer, Eigenverbrauch)
 *  - idx 80–87  (20–22 h): 15 kW
 *  - idx 88–95  (22–24 h): 5 kW  · NT-Fenster (günstig)
 */
function day(peak?: number): number[] {
  const d = new Array<number>(96)
  for (let i = 0; i < 96; i++) {
    if (i < 24) d[i] = 5
    else if (i < 32) d[i] = peak ?? 15
    else if (i < 40) d[i] = 15
    else if (i < 56) d[i] = -20
    else if (i < 80) d[i] = 25
    else if (i < 88) d[i] = 15
    else d[i] = 5
  }
  return d
}

const battery = (controlType: 'static' | 'dynamic'): BatteryCandidate => ({
  id: 'b1',
  name: 'Test',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 100,
  maxPowerKw: 50,
  roundTripEfficiency: 0.9,
  pricePerKwh: 400,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType,
})

const baseTariff: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

// NT-Fenster 22:00–06:00 zu 12 ct (günstiger als der Tagespreis 25 ct) → Lastverschiebung möglich.
const withNightWindow: TariffParams = {
  ...baseTariff,
  timeOfUseWindows: [{ from: '22:00', to: '06:00', ctPerKwh: 12 }],
}

// 10 Tage: Tag 5 trägt die 90-kW-Jahresspitze (Leistungspreis), alle Tage PV + NT-Fenster.
const days = Array.from({ length: 10 }, (_, i) => day(i === 5 ? 90 : undefined))
const lp = profile(days)

describe('§3.7 zwei exakte Anteile: Leistungspreis + Energie', () => {
  it('Summe Leistungspreis-Anteil + Energie-Anteil = Gesamtersparnis, exakt', () => {
    const s = computeBatterySavings(lp, battery('dynamic'), withNightWindow)

    expect(s.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(s.energySavingPerYear).not.toBe(0)
    expect(s.totalSavingPerYear).toBe(s.leistungspreisSavingPerYear + s.energySavingPerYear)
    expect(s.energySavingPerYear).toBe(s.energySavingOverCoveredPeriod * annualizationFactor(lp))
    // Ohne Preisdaten nur Arbeitspreis/Nachttarif — als Einschränkung gekennzeichnet.
    expect(s.energySavingBasis).toBe('energy_price_only')
  })
})

describe('§3.7 Kapp-Entladungen sind in der Energie-Ersparnis gebucht', () => {
  // Flacher Tarif ohne PV und ohne Fenster: die Batterie lädt und entlädt NUR für die Spitzenkappung.
  const flat: TariffParams = { ...baseTariff, einspeiseverguetungCtPerKwh: 0 }
  const peakDay = (): number[] => Array.from({ length: 96 }, (_, i) => (i >= 32 && i < 40 ? 60 : 20))
  const peakProfile = profile(Array.from({ length: 10 }, peakDay))

  it('Energie- und Verlustkosten der Kapp-Entladungen stehen in der Ersparnis', () => {
    const sim = simulateBattery(peakProfile, battery('dynamic'), flat)
    const s = computeBatterySavings(peakProfile, battery('dynamic'), flat, sim)

    const costEur = (kw: number[]): number => kw.reduce((sum, v) => sum + v * 0.25 * 25, 0) / 100
    const raw = peakProfile.readings.map((r) => r.gridPowerKw)
    const expected = costEur(raw) - costEur(sim.dispatch.gridAfterKw)

    expect(s.leistungspreisSavingPerYear).toBeGreaterThan(0)
    // Die Batterie hat gekappt, und ihre Ladeverluste kosten Geld: der Energie-Anteil ist negativ.
    expect(expected).toBeLessThan(-1)
    expect(s.totalSavingPerYear - s.leistungspreisSavingPerYear).toBeCloseTo(
      expected * annualizationFactor(peakProfile),
      6,
    )
  })
})

describe('§3.7 controlType (Martins Semantik, OP#5)', () => {
  it('static vs dynamic am identischen Profil: static kappt Leistungspreis auf 0 + reserve-freie Warnung', () => {
    const dyn = computeBatterySavings(lp, battery('dynamic'), withNightWindow)
    const stat = computeBatterySavings(lp, battery('static'), withNightWindow)

    // dynamic kreditiert die Spitzenkappung, static nicht.
    expect(dyn.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(stat.leistungspreisSavingPerYear).toBe(0)
    expect(dyn.newBilledKw).toBeLessThan(stat.newBilledKw) // static: newBilledKw = alter (unkreditiert)

    // Neuer Warntext (OP#5): keine Spitzenkappung; KEIN socFloor/Reserve-Hinweis mehr.
    expect(stat.warnings.some((w) => /statisch/i.test(w) && /keine Spitzenkappung/i.test(w))).toBe(true)
    expect(stat.warnings.some((w) => /socFloor|Reserve/i.test(w))).toBe(false)
    expect(dyn.warnings).toHaveLength(0)

    expect(stat.totalSavingPerYear).toBe(stat.energySavingPerYear)
  })

  it('§3.7 Hochrechnung: das 10-Tage-Profil wird mit 36,5 auf ein Jahr gerechnet — Leistungspreis nicht', () => {
    const dyn = computeBatterySavings(lp, battery('dynamic'), withNightWindow)
    const factor = 365 / 10

    expect(dyn.coveredDays).toBe(10)
    expect(dyn.annualizationFactor).toBe(factor)
    expect(dyn.energySavingPerYear).toBe(dyn.energySavingOverCoveredPeriod * factor)
    // Ratenbasiert und deshalb unskaliert — derselbe Fahrplan, derselbe Pin wie vor §3.7-Revision.
    expect(dyn.newBilledKw).toBeCloseTo(40.00001907348633, 8)
    expect(dyn.leistungspreisSavingPerYear).toBeCloseTo(4999.998092651367, 6)
  })
})

describe('§3.7 günstiges Tarif-Fenster', () => {
  it('ein NT-Fenster hebt den Energie-Anteil', () => {
    const withoutWindows = computeBatterySavings(lp, battery('dynamic'), baseTariff)
    const withWindows = computeBatterySavings(lp, battery('dynamic'), withNightWindow)
    expect(withWindows.energySavingPerYear).toBeGreaterThan(withoutWindows.energySavingPerYear + 50)
  })
})
