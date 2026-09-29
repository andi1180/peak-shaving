import { buildLevySchedule } from 'shared'
import type { BatteryCandidate, LevySchedule, LoadProfile, TariffParams } from 'shared'
import { describe, expect, it } from 'vitest'

import { drawSeries } from '../simulation/helpers'
import type { BatterySimulationResult } from '../simulation/simulate'
import { getTariffStrategy } from '../tariff/strategy'
import { computeBatterySavings } from './attribute'

/**
 * EAG-Förderbeitrag Leistung in der Spitzenkappungs-Ersparnis. Der Fahrplan wird vorgegeben
 * (`precomputed`), damit die Differenz der Leistungswerte exakt 13 kW je Monat beträgt.
 */

// Kalenderjahr 2026 in Ortszeit, 15 min; Grundlast 10 kW, je Monat eine 30-kW-Spitze am 15. um 12:00.
const FROM_MS = Date.parse('2025-12-31T23:00:00Z')
const TO_MS = Date.parse('2026-12-31T23:00:00Z')
const readings: LoadProfile['readings'] = []
for (let t = FROM_MS; t < TO_MS; t += 15 * 60_000) {
  const ts = new Date(t).toISOString()
  readings.push({ ts, gridPowerKw: ts.slice(8, 16) === '15T11:00' ? 30 : 10 })
}
const lp: LoadProfile = { readings, intervalMinutes: 15, timezoneMeta: 'Europe/Vienna', source: 'import_only' }

const battery: BatteryCandidate = {
  id: 'test-dynamic',
  name: 'Test',
  manufacturer: 'Test',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 30,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

const tariff = (leistungspreisEurPerKwYear: number): TariffParams => ({
  billingModel: 'monthly_max_sum',
  minBillableKw: 0,
  leistungspreisEurPerKwYear,
  energyPriceCtPerKwh: 20,
  einspeiseverguetungCtPerKwh: 0,
})

const oldBilledKw = getTariffStrategy('monthly_max_sum').billedKw(lp, tariff(50))
// Je Monat 13 kW weniger → Summenmodell 12 × 13 kW; Energie unverändert (Netzreihe = Rohbezug).
const sim = {
  newBilledKw: oldBilledKw - 12 * 13,
  dispatch: { gridAfterKw: drawSeries(lp) },
} as unknown as BatterySimulationResult

/** Wiener Netze NE 7 mit Leistungsmessung 2026 (EAG 5,619 €/kW·a), Gebrauchsabgabe fest gesetzt. */
function levies(gebrauchsabgabeRate: number): LevySchedule {
  const schedule = buildLevySchedule('wiener_netze', 7, '2026-01-01', '2026-12-31', 'mit_leistungsmessung', {
    category: 'gewerbe',
    postalCode: '1010',
  })
  return { ...schedule, periods: schedule.periods.map((p) => ({ ...p, gebrauchsabgabeRate })) }
}

describe('computeBatterySavings — EAG-Förderbeitrag Leistung', () => {
  it('kreditiert Δ 13 kW je Monat × 5,619 €/kW·a und rechnet ihn in die Gesamtersparnis', () => {
    expect(oldBilledKw).toBeCloseTo(12 * 30, 9)
    const s = computeBatterySavings(lp, battery, tariff(50), sim, undefined, levies(0))
    // Handrechnung: 12 Monate × 13 kW × 5,619 €/kW·a ÷ 12 = 73,047 €/Jahr.
    expect(s.eagDemandSavingPerYear).toBeCloseTo(73.047, 9)
    expect(s.leistungspreisSavingPerYear).toBeCloseTo(13 * 50, 9)
    expect(s.totalSavingPerYear).toBeCloseTo(
      s.leistungspreisSavingPerYear + s.eagDemandSavingPerYear + s.energySavingPerYear,
      9,
    )
  })

  it('Gebrauchsabgabe 6 % hebt den Leistungspreis-Anteil, den EAG-Anteil nicht', () => {
    const ohne = computeBatterySavings(lp, battery, tariff(50), sim, undefined, levies(0))
    const mit = computeBatterySavings(lp, battery, tariff(50), sim, undefined, levies(0.06))
    expect(mit.eagDemandSavingPerYear).toBe(ohne.eagDemandSavingPerYear)
    expect(mit.leistungspreisSavingPerYear).toBeCloseTo(ohne.leistungspreisSavingPerYear * 1.06, 9)
  })

  it('Blocker no_demand_charge → EAG-Anteil 0, wie der Leistungspreis-Anteil', () => {
    const s = computeBatterySavings(lp, battery, tariff(0), sim, undefined, levies(0))
    expect(s.warnings.some((w) => w.startsWith('Tarif ohne Leistungspreis'))).toBe(true)
    expect(s.eagDemandSavingPerYear).toBe(0)
    expect(s.leistungspreisSavingPerYear).toBe(0)
  })
})
