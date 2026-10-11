import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import {
  basisLoadProfile,
  basisWithPvLoadProfile,
  flatTariff,
  GATE_DYNAMIC_BATTERY,
} from '../fixtures/profiles'
import { hasFeedIn } from '../refusal'
import { simulateBattery } from './simulate'

const profile = (values: number[]): LoadProfile => ({
  readings: values.map((gridPowerKw, i) => ({
    ts: new Date(Date.parse('2025-06-01T00:00:00Z') + i * 15 * 60_000).toISOString(),
    gridPowerKw,
  })),
  intervalMinutes: 15,
  timezoneMeta: 'UTC',
  source: 'net_signed',
})

describe('Überschuss-Signal (hasFeedIn)', () => {
  it('true, sobald ein Intervall Netto-Bezug < 0 hat', () => {
    expect(hasFeedIn(profile([1.2, 0.4, -0.01, 2]))).toBe(true)
  })

  it('false ohne negative Werte, bei leerem Profil und bei genau 0', () => {
    expect(hasFeedIn(profile([1.2, 0.4, 2]))).toBe(false)
    expect(hasFeedIn(profile([]))).toBe(false)
    expect(hasFeedIn(profile([0, 0, 1]))).toBe(false)
  })

  it('steht im Simulationsergebnis und folgt dem simulierten Lastgang', () => {
    const tariff = flatTariff('monthly_max_average')
    expect(simulateBattery(basisWithPvLoadProfile(), GATE_DYNAMIC_BATTERY, tariff).hasFeedIn).toBe(
      true,
    )
    expect(simulateBattery(basisLoadProfile(), GATE_DYNAMIC_BATTERY, tariff).hasFeedIn).toBe(false)
  })
})
