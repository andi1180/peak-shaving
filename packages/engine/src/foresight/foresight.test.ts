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

import { simulateBattery } from '../simulation/simulate'
import { consumptionPatternForDay } from './consumption-pattern'
import { computePredictiveControlValue } from './predictive-control-value'

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
 * Verbrauchserwartung (gemessen, s. Modulkopf von `predictive-control-value.ts`).
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

describe('Vorausschauender controlValueEur (Zahl 2)', () => {
  it('liefert eine Zahl und kann die Bestmarke nicht übertreffen', () => {
    const result = computePredictiveControlValue({
      loadProfile: profile(),
      battery: BATTERY,
      tariffParams: TARIFF,
      pricing: PRICING,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.basis).toBe('foresight_unvalidated')
    expect(result.patternDays).toBe(DAYS)
    expect(result.daysWithoutPattern).toBe(0)
    expect(result.hindsightControlValueEur).toBeGreaterThan(0)
    // §5 Punkt 4: eine Steuerung ohne Rückblick kann die Bestmarke nicht übertreffen.
    expect(result.realizationRatio).not.toBeNull()
    expect(result.realizationRatio!).toBeLessThanOrEqual(1)
    // Und die Prognose schlägt hier wirklich durch — sonst prüfte die Zeile darüber nichts.
    expect(result.realizationRatio!).toBeLessThan(0.9)
  })

  it('Weg a: rechnet MIT Leistungspreis und übernimmt cap/socFloor aus dem Rückblick-Lauf', () => {
    const loadProfile = peakyProfile()
    const result = computePredictiveControlValue({
      loadProfile,
      battery: DYNAMIC_BATTERY,
      tariffParams: TARIFF_WITH_DEMAND_CHARGE,
      pricing: PRICING,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Der frühere `demand_charge`-Blocker ist weg — und die Schranken sind nicht mehr ∞/0.
    expect(result.capKwByPeriod).toHaveLength(1)
    expect(result.capKwByPeriod[0]).toBeLessThan(12) // Tagesspitze des Fixture-Lastgangs
    expect(Number.isFinite(result.capKwByPeriod[0]!)).toBe(true)
    expect(result.socFloorKwh.some((v) => v > 0)).toBe(true)

    // Und sie stammen wirklich aus dem Rückblick-Lauf: bit-identisch zu `simulateBattery`.
    const hindsight = simulateBattery(loadProfile, DYNAMIC_BATTERY, TARIFF_WITH_DEMAND_CHARGE)
    expect(result.capKwByPeriod).toEqual(hindsight.capKwByPeriod)
    expect(result.socFloorKwh).toEqual(hindsight.socFloorKwh)

    expect(result.basis).toBe('foresight_unvalidated')
    // Die Prognose schlägt trotz Spitzenschutz durch, und sie übertrifft die Bestmarke nicht.
    expect(result.realizationRatio).not.toBeNull()
    expect(result.realizationRatio!).toBeLessThanOrEqual(1)
    expect(result.predictiveControlValueEur).not.toBe(result.hindsightControlValueEur)
  })

  it('verweigert mit benanntem Grund, statt eine falsche Zahl zu liefern', () => {
    const base = { battery: BATTERY, pricing: PRICING, tariffParams: TARIFF }

    // Synthetisches Profil: Muster und Wahrheit wären dieselbe Formel.
    expect(
      computePredictiveControlValue({
        ...base,
        loadProfile: profile('standard_profile'),
      }),
    ).toEqual({ ok: false, reason: 'standard_profile' })

    // Ohne Preiskurve gibt es innerhalb eines Tages gar keine Rangfolge.
    expect(
      computePredictiveControlValue({
        ...base,
        loadProfile: profile(),
        pricing: { ...PRICING, spotPrices: null },
      }),
    ).toEqual({ ok: false, reason: 'price_curve_not_computable' })
  })
})
