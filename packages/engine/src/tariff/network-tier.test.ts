import type {
  BatteryCandidate,
  GridTariffRowInput,
  LoadProfile,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { computeAnalysis } from '../compute-analysis'
import { AnalysisRefusedError } from '../refusal'
import { peakShavingBlockers } from '../simulation/peak-shaving'

const SLOT_MS = 15 * 60 * 1000
const START = Date.parse('2026-03-01T23:00:00Z') // 02.03.2026 00:00 MEZ

/** Zwei Tage, 10 kW Grundlast, eine halbe Stunde 30 kW. */
function profile(): LoadProfile {
  const readings = Array.from({ length: 2 * 96 }, (_, i) => ({
    ts: new Date(START + i * SLOT_MS).toISOString(),
    gridPowerKw: i === 40 || i === 41 ? 30 : 10,
  }))
  return { readings, intervalMinutes: 15, timezoneMeta: 'Europe/Berlin', source: 'import_only' }
}

function row(tiers: boolean, validFrom = '2026-01-01'): GridTariffRowInput {
  return {
    validFrom,
    validUntil: null,
    netzverlustCtPerKwh: 0,
    grundpreisAmount: 22.75,
    grundpreisUnit: 'eur_per_kw_year',
    priceBasis: 'net',
    ...(tiers
      ? {
          tierThresholdHours: 2500,
          tier2LeistungspreisEurPerKwYear: 115.43,
          tier2ArbeitspreisCtPerKwh: 4.09,
        }
      : {}),
    windows: [
      {
        label: 'normal',
        monthDayFrom: null,
        monthDayTo: null,
        timeFrom: '00:00:00',
        timeTo: '24:00:00',
        ctPerKwh: 7.8,
      },
    ],
  }
}

const BATTERY: BatteryCandidate = {
  id: 'test-akku',
  name: 'Testspeicher',
  manufacturer: 'Test',
  class: 'commercial',
  usableCapacityKwh: 10,
  maxPowerKw: 5,
  roundTripEfficiency: 0.9,
  pricePerKwh: 500,
  inverterIncluded: true,
  extraInverterCost: 0,
  requiresFoundation: false,
  controlType: 'dynamic',
}

function tariff(overrides: Partial<TariffParams> = {}): TariffParams {
  return {
    leistungspreisEurPerKwYear: 22.75,
    billingModel: 'annual_max',
    minBillableKw: 0,
    energyPriceCtPerKwh: 20,
    einspeiseverguetungCtPerKwh: 0,
    ...overrides,
  } as TariffParams
}

// Ohne Spotreihe: der Börsenvergleich ist gesperrt, die Stufen werden trotzdem gerechnet (H-7).
function pricing(rows: GridTariffRowInput[]): TariffPricingInputs {
  return { gridTariffRows: rows, spotPrices: null, levies: { periods: [] } }
}

function analyse(tariffParams: TariffParams, rows: GridTariffRowInput[]) {
  const load = profile()
  return computeAnalysis(
    {
      tariff: tariffParams,
      pv: null,
      tariffPricing: pricing(rows),
      load: {
        fileName: 'synthetisch',
        profile: load,
        dataQuality: {
          coveredDays: 2,
          coveredMonths: 1,
          gapsInterpolated: 0,
          largestGapSlots: 0,
          warnings: [],
        },
      },
    },
    10,
    [BATTERY],
  )
}

function refusalOf(run: () => unknown): AnalysisRefusedError {
  try {
    run()
  } catch (error) {
    if (error instanceof AnalysisRefusedError) return error
    throw error
  }
  throw new Error('keine Verweigerung')
}

describe('Netzentgelt-Stufen in der Engine (Schritt 8b)', () => {
  it('annual_max mit LP > 0 ohne Stufen: Ist-Kosten und Ersparnis wie der Skalar-Weg', () => {
    const result = analyse(tariff(), [row(false)])
    const entry = result.perBattery[0]!
    expect(result.current.networkTier).toBeUndefined()
    expect(entry.networkTier).toBeUndefined()
    expect(result.current.leistungspreisCostPerYear).toBe(30 * 22.75)
    expect(entry.leistungspreisSavingPerYear).toBe((30 - entry.newBilledKw) * 22.75)
  })

  it('Stufenzeile mit monthly_max_sum: Verweigerung mit Klartext', () => {
    const error = refusalOf(() => analyse(tariff({ billingModel: 'monthly_max_sum' }), [row(true)]))
    expect(error.refusal.reason).toBe('network_tier_requires_annual_max')
    expect(error.message).toContain('Jahreshöchstwert')
  })

  it('gemischte Zeilen (mit und ohne Stufen): Verweigerung, kein Rückfall auf den Skalar-LP', () => {
    const rows = [row(true), { ...row(false), validFrom: '2026-03-03' }]
    const error = refusalOf(() => analyse(tariff(), rows))
    expect(error.refusal).toEqual({ reason: 'network_tier_invalid', detail: 'mixed_tier_rows' })
  })

  it('Stufenzeile mit Entwurfs-LP 0: Spitzenkappung läuft und wird über die Stufen kreditiert', () => {
    const load = profile()
    const params = tariff({ leistungspreisEurPerKwYear: 0 })
    expect(peakShavingBlockers(load, BATTERY, params, pricing([row(false)]))).toContain(
      'no_demand_charge',
    )
    expect(peakShavingBlockers(load, BATTERY, params, pricing([row(true)]))).not.toContain(
      'no_demand_charge',
    )

    const result = analyse(params, [row(true)])
    const entry = result.perBattery[0]!
    expect(entry.newBilledKw).toBeLessThan(30)
    expect(entry.networkTier).toBeDefined()
    expect(entry.leistungspreisSavingPerYear).toBeCloseTo(
      result.current.networkTier!.correctionEur - entry.networkTier!.correctionEur,
      9,
    )
    expect(entry.leistungspreisSavingPerYear).toBeGreaterThan(0)
  })
})
