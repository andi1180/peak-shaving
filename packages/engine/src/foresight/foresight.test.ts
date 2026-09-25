import { describe, expect, it } from 'vitest'
import { LEVIES_NONE } from 'shared'
import type {
  BatteryCandidate,
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { buildMonthlyTariffComparison } from '../simulation/monthly-tariff-comparison'
import { dispatchPlanningFor, HINDSIGHT_PLANNING } from '../simulation/planning'
import { simulateBattery } from '../simulation/simulate'
import { consumptionPatternForDay } from './consumption-pattern'

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

/** Fünf Kalendertage im selben Monat — bei `scheme: 'month'` also ein Eimer mit vier Vergleichstagen. */
const START_UTC = '2025-01-06T23:00:00Z' // 07.01.2025, 00:00 Ortszeit (Europe/Vienna)
const DAYS = 5
const SLOTS = 96

/**
 * Zwei gegensätzliche Nachtlasten im selben Eimer: Tage, die in der teuersten Spanne (21–24 Uhr)
 * wenig brauchen, und Tage, die dort viel brauchen. Das Eimermittel liegt zwischen beiden und
 * trifft keinen — genau der Fall, den eine Prognose real hat. Der übrige Tag ist gleich, damit die
 * Wirkung eindeutig von dieser einen Stelle kommt.
 */
function loadKw(day: number, slot: number): number {
  const hour = Math.floor(slot / 4)
  if (hour < 6) return 0.5
  if (hour < 16) return 2
  if (hour < 21) return 5
  return day % 2 === 0 ? 1 : 3
}

function profile(source: LoadProfile['source'] = 'import_only'): LoadProfile {
  const t0 = Date.parse(START_UTC)
  const readings = []
  for (let d = 0; d < DAYS; d++)
    for (let s = 0; s < SLOTS; s++)
      readings.push({ ts: iso(t0 + (d * SLOTS + s) * STEP_MS), gridPowerKw: loadKw(d, s) })
  return { readings, intervalMinutes: 15, timezoneMeta: 'Europe/Vienna', source }
}

/**
 * Vier Preisstufen. Entscheidend ist, dass eine NICHT günstige Spanne (16–21 Uhr) vor der
 * TEUERSTEN liegt: nur dann hält die Preis-Untergrenze Energie zurück, und nur dann hängt der
 * Fahrplan überhaupt davon ab, wie viel für den späten Abend erwartet wird.
 */
function spot(): SpotPriceSeriesInput {
  const t0 = Date.parse(START_UTC)
  const hours = DAYS * 24
  return {
    prices: Array.from({ length: hours }, (_, h) => {
      const hour = h % 24
      return {
        tsStart: iso(t0 + h * ONE_HOUR_MS),
        tsEnd: iso(t0 + (h + 1) * ONE_HOUR_MS),
        ctPerKwh: hour < 6 ? 3 : hour < 16 ? 10 : hour < 21 ? 20 : 32,
        priceBasis: 'net',
      }
    }),
    complete: true,
    missingRanges: [],
  }
}

const GRID_ROW: GridTariffRowInput = {
  validFrom: '2024-01-01',
  validUntil: null,
  netzverlustCtPerKwh: 0.7,
  priceBasis: 'net',
  windows: [
    { label: 'normal', monthDayFrom: null, monthDayTo: null, timeFrom: '00:00:00', timeTo: '24:00:00', ctPerKwh: 6.98 },
  ],
}

const PRICING: TariffPricingInputs = {
  gridTariffRows: [GRID_ROW],
  spotPrices: spot(),
  levies: LEVIES_NONE,
}

/** Ohne Leistungsmessung — dort sperrt `no_demand_charge` die Spitzenkappung ohnehin. */
const TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 20,
  einspeiseverguetungCtPerKwh: 0,
}

const BATTERY: BatteryCandidate = {
  id: 'test',
  name: 'Test',
  manufacturer: 'Test',
  class: 'commercial',
  usableCapacityKwh: 10,
  maxPowerKw: 5,
  roundTripEfficiency: 0.9,
  pricePerKwh: 500,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'static',
}

/** MIT Leistungsmessung und kappfähiger Steuerung — der Fall, den Weg a neu abdeckt. */
const TARIFF_WITH_DEMAND_CHARGE: TariffParams = { ...TARIFF, leistungspreisEurPerKwYear: 100 }
const DYNAMIC_BATTERY: BatteryCandidate = {
  ...BATTERY,
  controlType: 'dynamic',
  usableCapacityKwh: 30,
  maxPowerKw: 10,
}

/**
 * Derselbe Tagesverlauf, aber mit einer KURZEN Spitze statt des fünfstündigen Plateaus — sonst
 * bindet die Spitzen-Reserve die ganze Batterie und der Fahrplan hängt gar nicht mehr an der
 * Verbrauchserwartung (gemessen am 21.09.2026).
 */
function peakyLoadKw(day: number, slot: number): number {
  if (slot === 40 || slot === 41) return 12 // 10:00–10:30 Ortszeit
  const hour = Math.floor(slot / 4)
  if (hour < 6) return 0.5
  if (hour < 21) return 2
  return day % 2 === 0 ? 1 : 3
}

function peakyProfile(): LoadProfile {
  const t0 = Date.parse(START_UTC)
  const readings = []
  for (let d = 0; d < DAYS; d++)
    for (let s = 0; s < SLOTS; s++)
      readings.push({ ts: iso(t0 + (d * SLOTS + s) * STEP_MS), gridPowerKw: peakyLoadKw(d, s) })
  return { readings, intervalMinutes: 15, timezoneMeta: 'Europe/Vienna', source: 'import_only' }
}

describe('Verbrauchsmuster', () => {
  it('der Eimermittelwert enthält den bewerteten Tag NICHT (Leave-one-out, Produktivverhalten)', () => {
    const outcome = consumptionPatternForDay(profile(), '2025-01-07', 'month')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.peerDays).toBe(DAYS - 1)
    // Slot 88 = 22:00 Ortszeit, die einzige Stelle, an der sich die Tage unterscheiden. Die vier
    // ANDEREN Tage tragen dort 3/1/3/1 kW → Mittel 2. Mit dem eigenen Wert (1) wären es 1,8.
    const slot = 88
    const peerMean = [1, 2, 3, 4].reduce((s, d) => s + loadKw(d, slot), 0) / 4
    expect(outcome.forecastKw[slot]).toBeCloseTo(peerMean, 10)
    expect(outcome.forecastKw[slot]).not.toBeCloseTo(loadKw(0, slot), 3)
  })
})

/** aWATTar-Kosten mit Speicher über den ganzen Zeitraum (€). */
function spotCostEur(loadProfile: LoadProfile, gridAfterKw: number[]): number {
  const c = buildMonthlyTariffComparison(loadProfile, TARIFF, PRICING, gridAfterKw)
  return (c?.spotWithBatteryEur ?? []).reduce<number>((s, v) => s + (v ?? 0), 0)
}

describe('Fahrplan mit Vorabend-Prognose', () => {
  it('ist ohne Angabe vorausschauend und kann die Rückblick-Obergrenze nicht unterbieten', () => {
    const loadProfile = profile()
    const planning = dispatchPlanningFor(loadProfile)
    expect(planning.basis).toBe('forecast')

    const byDefault = simulateBattery(loadProfile, BATTERY, TARIFF, undefined, PRICING)
    const forecast = simulateBattery(loadProfile, BATTERY, TARIFF, undefined, PRICING, planning)
    const hindsight = simulateBattery(loadProfile, BATTERY, TARIFF, undefined, PRICING, HINDSIGHT_PLANNING)
    expect(byDefault.dispatch.gridAfterKw).toEqual(forecast.dispatch.gridAfterKw)

    // Die Prognose schlägt hier wirklich durch — und perfektes Wissen ist nie teurer.
    const forecastEur = spotCostEur(loadProfile, forecast.dispatch.gridAfterKw)
    const hindsightEur = spotCostEur(loadProfile, hindsight.dispatch.gridAfterKw)
    expect(forecastEur).toBeGreaterThan(hindsightEur)
  })

  it('übernimmt Kappschwelle und Spitzen-Reserve unverändert aus dem ganzen Zeitraum', () => {
    const loadProfile = peakyProfile()
    const run = (planning = dispatchPlanningFor(loadProfile)) =>
      simulateBattery(loadProfile, DYNAMIC_BATTERY, TARIFF_WITH_DEMAND_CHARGE, undefined, PRICING, planning)
    const forecast = run()
    const hindsight = run(HINDSIGHT_PLANNING)

    expect(forecast.capKwByPeriod[0]).toBeLessThan(12) // Tagesspitze des Fixture-Lastgangs
    expect(forecast.socFloorKwh.some((v) => v > 0)).toBe(true)
    expect(forecast.capKwByPeriod).toEqual(hindsight.capKwByPeriod)
    expect(forecast.socFloorKwh).toEqual(hindsight.socFloorKwh)
    expect(forecast.dispatch.gridAfterKw).not.toEqual(hindsight.dispatch.gridAfterKw)
  })

  it('das Standardprofil ist seine eigene Erwartung und plant ohne Prognose', () => {
    expect(dispatchPlanningFor(profile('standard_profile'))).toEqual(HINDSIGHT_PLANNING)
  })
})
