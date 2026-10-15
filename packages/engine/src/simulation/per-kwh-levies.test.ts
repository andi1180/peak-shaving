import { buildLevySchedule } from 'shared'
import type {
  GridTariffRowInput,
  LevySchedule,
  LoadProfile,
  MonthlyTariffComparison,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { buildMonthlyTariffComparison } from './monthly-tariff-comparison'

/**
 * Abgabenposten je kWh (DE) über den Jahreswechsel: synthetischer Lastgang 15.12.2025–15.01.2026
 * Ortszeit, konstant 4 kW = 1 kWh je Viertelstunde, damit die Energiemenge je Jahr exakt zählbar ist.
 */

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
/** 15.12.2025 00:00 Ortszeit (CET = UTC+1). */
const START_UTC = '2025-12-14T23:00:00Z'
const INTERVALS_2025 = 17 * 96 // 15.–31.12.
const INTERVALS_2026 = 15 * 96 // 01.–15.01.
const INTERVALS = INTERVALS_2025 + INTERVALS_2026
const LOAD_KW = 4

const iso = (ms: number): string => new Date(ms).toISOString()

const LOAD: LoadProfile = {
  readings: Array.from({ length: INTERVALS }, (_, i) => ({
    ts: iso(Date.parse(START_UTC) + i * STEP_MS),
    gridPowerKw: LOAD_KW,
  })),
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Berlin',
  source: 'import_only',
}

/** Speicherfahrplan mit 5 % Ladeverlust: abwechselnd 8,4 kW Bezug und 0 kW, im Mittel 4,2 kW. */
const GRID_AFTER = LOAD.readings.map((_, i) => (i % 2 === 0 ? 8.4 : 0))

const SPOT: SpotPriceSeriesInput = {
  prices: Array.from({ length: INTERVALS / 4 + 1 }, (_, h) => ({
    tsStart: iso(Date.parse(START_UTC) + h * ONE_HOUR_MS),
    tsEnd: iso(Date.parse(START_UTC) + (h + 1) * ONE_HOUR_MS),
    ctPerKwh: 10,
    priceBasis: 'net',
  })),
  complete: true,
  missingRanges: [],
}

const GRID_ROW: GridTariffRowInput = {
  validFrom: '2025-01-01',
  validUntil: null,
  netzverlustCtPerKwh: 0,
  priceBasis: 'net',
  windows: [
    { label: 'normal', monthDayFrom: null, monthDayTo: null, timeFrom: '00:00:00', timeTo: '24:00:00', ctPerKwh: 7 },
  ],
}

const TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 20,
  einspeiseverguetungCtPerKwh: 0,
}

const DE_PLAN = buildLevySchedule('de_netz', 7, '2025-12-15', '2026-01-15', null, {
  category: 'gewerbe',
  postalCode: '10115',
  country: 'DE',
})
/** Derselbe Plan ohne die Posten — die Bezugsgrösse der Differenz. */
const WITHOUT: LevySchedule = {
  periods: DE_PLAN.periods.map(({ perKwhComponents: _omit, ...rest }) => rest),
}

function run(levies: LevySchedule): MonthlyTariffComparison {
  const pricing: TariffPricingInputs = { gridTariffRows: [GRID_ROW], spotPrices: SPOT, levies }
  const result = buildMonthlyTariffComparison(LOAD, TARIFF, pricing, GRID_AFTER)
  expect(result).toBeDefined()
  return result!
}

const sum = (series: (number | null)[]): number =>
  series.reduce<number>((acc, v) => (v == null ? acc : acc + v), 0)

describe('Abgabenposten je kWh — DE über den Jahreswechsel', () => {
  it('erhöht Ist-Tarif und Weg 3 exakt um kWh × Satz je Jahr, Weg 4 zusätzlich um die Ladeverluste', () => {
    const withLevies = run(DE_PLAN)
    const base = run(WITHOUT)

    // Handrechnung: 1.632 kWh × 4,811 ct + 1.440 kWh × 5,106 ct = 78,51552 € + 73,52640 € = 152,04192 €.
    const kwh2025 = INTERVALS_2025 * LOAD_KW * 0.25
    const kwh2026 = INTERVALS_2026 * LOAD_KW * 0.25
    const expected = (kwh2025 * 4.811) / 100 + (kwh2026 * 5.106) / 100
    expect(expected).toBeCloseTo(152.04192, 10)

    const current = sum(withLevies.currentTariffEur as number[]) - sum(base.currentTariffEur as number[])
    const way3 = sum(withLevies.spotWithoutControlEur) - sum(base.spotWithoutControlEur)
    expect(current).toBeGreaterThan(0)
    expect(current).toBeCloseTo(expected, 8)
    expect(way3).toBeCloseTo(expected, 8)

    // Weg 4: Bezug 1,05-fach — die 5 % Ladeverlust-kWh tragen denselben Satz.
    const lossEur = (kwh2025 * 0.05 * 4.811) / 100 + (kwh2026 * 0.05 * 5.106) / 100
    const way4 = sum(withLevies.spotWithBatteryEur!) - sum(base.spotWithBatteryEur!)
    expect(way4).toBeCloseTo(expected + lossEur, 8)
  })
})
