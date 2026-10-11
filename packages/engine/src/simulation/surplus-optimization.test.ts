import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import { energyCostEur } from './energy-cost'
import type { DispatchResult } from './dispatch'
import type { BatteryPhysics } from './helpers'
import { executePlan, planHorizon, runSurplusOptimizedDispatch } from './surplus-optimization'

const DT = 0.25
const FEED_IN = 8
const DAYS = 4

/** Haushaltsnahe Last mit Mittags-PV und einer Preiskurve mit Nacht-, Mittags- und Abendstufe (UTC = lokal). */
function scenario(dayTwoPriceShift = 0) {
  const draws: number[] = []
  const prices: number[] = []
  for (let d = 0; d < DAYS; d++) {
    for (let q = 0; q < 96; q++) {
      const h = q / 4
      const load = 1 + (h >= 7 && h < 9 ? 2 : 0) + (h >= 18 && h < 22 ? 3 : 0)
      const pv =
        h >= 9 && h < 16 ? 6 * Math.sin(((h - 9) / 7) * Math.PI) * (d % 2 === 0 ? 1 : 0.5) : 0
      draws.push(load - pv)
      const base = h < 6 ? 18 : h >= 10 && h < 15 ? 12 : h >= 17 && h < 21 ? 32 : 24
      prices.push(base + (d === 1 ? dayTwoPriceShift : 0))
    }
  }
  const loadProfile: LoadProfile = {
    readings: draws.map((gridPowerKw, i) => ({
      ts: new Date(Date.parse('2025-06-02T00:00:00Z') + i * 15 * 60_000).toISOString(),
      gridPowerKw,
    })),
    intervalMinutes: 15,
    timezoneMeta: 'UTC',
    source: 'net_signed',
  }
  return { loadProfile, draws, prices }
}

const physics = (capacity = 10, power = 5): BatteryPhysics => ({
  usableCapacityKwh: capacity,
  maxPowerKw: power,
  roundTripEfficiency: 0.9,
})

const cost = (grid: number[], prices: number[]) =>
  energyCostEur(grid, { drawCtPerKwh: prices, feedInCtPerKwh: FEED_IN, deltaHours: DT }).totalEur

function dispatch(draws: number[], prices: number[], loadProfile: LoadProfile, p: BatteryPhysics) {
  const n = draws.length
  return runSurplusOptimizedDispatch({
    loadProfile,
    draws,
    planKw: draws,
    drawCtPerKwh: prices,
    feedInCtPerKwh: FEED_IN,
    capForInterval: new Array<number>(n).fill(Infinity),
    socFloorKwh: new Array<number>(n).fill(0),
    physics: p,
    startSocKwh: p.usableCapacityKwh / 2,
    deltaH: DT,
  })
}

/** Ein Plan über die ganze Reihe, auf derselben Reihe ausgeführt. */
function planAndRun(draws: number[], prices: number[], p: BatteryPhysics, states: number) {
  const start = p.usableCapacityKwh / 2
  const plan = planHorizon({
    planKw: draws,
    drawCtPerKwh: prices,
    feedInCtPerKwh: FEED_IN,
    physics: p,
    deltaH: DT,
    startSocKwh: start,
    states,
  })
  const n = draws.length
  const out: DispatchResult = { socKwh: [], gridAfterKw: [], batteryPowerKw: [] }
  executePlan(
    plan,
    (t) => ({ drawKw: draws[t]!, priceCt: prices[t]!, capKw: Infinity, minEndSocKwh: 0 }),
    0,
    n,
    start,
    FEED_IN,
    p,
    DT,
    out,
    0,
  )
  return { plan, out }
}

describe('Ladesteuerung mit Überschuss-Optimierung', () => {
  it('hält Energiebilanz, SoC- und Leistungsgrenzen und entlädt nie über den Bezug hinaus', () => {
    const { loadProfile, draws, prices } = scenario()
    const p = physics()
    const d = dispatch(draws, prices, loadProfile, p)
    let soc = p.usableCapacityKwh / 2
    for (let i = 0; i < draws.length; i++) {
      const b = d.batteryPowerKw[i]!
      soc += b > 0 ? b * DT * p.roundTripEfficiency : b * DT
      expect(d.socKwh[i]).toBeCloseTo(soc, 9)
      expect(d.socKwh[i]).toBeGreaterThanOrEqual(0)
      expect(d.socKwh[i]).toBeLessThanOrEqual(p.usableCapacityKwh + 1e-9)
      expect(Math.abs(b)).toBeLessThanOrEqual(p.maxPowerKw + 1e-9)
      expect(d.gridAfterKw[i]).toBe(draws[i]! + b)
      if (b < 0) expect(d.gridAfterKw[i]).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(cost(d.gridAfterKw, prices)).toBeLessThan(cost(draws, prices))
  })

  it('DP-Zielwert = bestehende Kostenfunktion auf dem Plan, Abweichung schrumpft mit dem Raster', () => {
    const { draws, prices } = scenario()
    const runs = [100, 400].map((states) => {
      const { plan, out } = planAndRun(draws, prices, physics(), states)
      const realized = cost(out.gridAfterKw, prices)
      return { gap: Math.abs(plan.dpValueEur - realized), saving: cost(draws, prices) - realized }
    })
    expect(runs[0]!.gap).toBeLessThan(0.01 * runs[0]!.saving)
    expect(runs[1]!.gap).toBeLessThan(runs[0]!.gap)
  })

  it('mehr Kapazität senkt die Ersparnis nicht', () => {
    const { draws, prices } = scenario()
    const savings = [2, 5, 10, 20].map(
      (c) =>
        cost(draws, prices) -
        cost(planAndRun(draws, prices, physics(c), 100).out.gridAfterKw, prices),
    )
    for (let i = 1; i < savings.length; i++)
      expect(savings[i]).toBeGreaterThanOrEqual(savings[i - 1]! - 1e-9)
  })

  it('kennt Preise des Folgetags erst ab 14:00', () => {
    const base = scenario()
    const shifted = scenario(10)
    const a = dispatch(base.draws, base.prices, base.loadProfile, physics())
    const b = dispatch(shifted.draws, shifted.prices, shifted.loadProfile, physics())
    // Tag 1 bis 14:00 kennt Tag 2 noch nicht; ab 14:00 darf die andere Preiskurve wirken.
    expect(b.batteryPowerKw.slice(0, 56)).toEqual(a.batteryPowerKw.slice(0, 56))
    expect(b.batteryPowerKw.slice(56, 192)).not.toEqual(a.batteryPowerKw.slice(56, 192))
  })
})
