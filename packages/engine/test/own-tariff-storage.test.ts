import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, TariffParams, TariffPricingInputs } from 'shared'

import {
  applyEstimatedPv,
  arbitrageImpossible,
  buildMonthlyTariffComparison,
  computeAnalysis,
  dispatchPlanningFor,
  drawSeries,
  mapDraftToTariffParams,
  ownTariffContext,
  ownTariffDispatch,
  ownTariffEnergyCostEur,
  ownTariffStorageOf,
  parseLoadProfile,
  parsePvProfile,
} from '../src'
import { decideInterval, planHorizon } from '../src/simulation/surplus-optimization'

/**
 * Speicherwert im eigenen Tarif („Ihr Tarif + Speicher"). Fixtures: Gewerbe-Lastgang 2025
 * (anonymisiert) mit eingefrorenen Netz-, Spot- und Abgabendaten; Fixtarif 13,339 ct netto,
 * Einspeisevergütung 11,0352 ct, kein Leistungspreis (von Hand). Kein Netzzugriff.
 */

const fixture = (relative: string) => new URL(`../../../${relative}`, import.meta.url)
const json = <T>(relative: string): T => JSON.parse(readFileSync(fixture(relative), 'utf8')) as T
const loadProfileOf = (relative: string): LoadProfile => {
  const parsed = parseLoadProfile({ content: readFileSync(fixture(relative)), fileName: relative })
  if (!parsed.ok) throw new Error(`${relative} ist nicht lesbar`)
  return parsed.profile
}

const GD = 'apps/website/test/report-snapshots/fixtures/gewerbe-ohne-rechnung-wien'
const PRICING = json<{ request: { window: { startIso: string } }; pricing: TariffPricingInputs }[]>(
  `${GD}/tariff-pricing.json`,
).find((e) => e.request.window.startIso === '2024-12-31T23:00:00.000Z')!.pricing
const TARIFF = {
  ...mapDraftToTariffParams(json(`${GD}/draft.json`), { category: 'gewerbe' }),
  supplierTariff: 'known',
  energyPriceCtPerKwh: 13.339,
  supplierPriceBasis: 'net',
  supplierBaseFeeEurPerMonth: 0,
  leistungspreisEurPerKwYear: 0,
  einspeiseverguetungCtPerKwh: 11.0352,
} as TariffParams
const FEED_IN = 11.0352

const battery = (capacityKwh: number, powerKw: number): BatteryCandidate =>
  ({
    id: `syn-${capacityKwh}-${powerKw}`,
    name: `syn ${capacityKwh}`,
    manufacturer: 'T',
    class: 'commercial',
    usableCapacityKwh: capacityKwh,
    maxPowerKw: powerKw,
    roundTripEfficiency: 0.88,
    pricePerKwh: 300,
    inverterIncluded: true,
    extraInverterCost: 0,
    requiresFoundation: false,
    installationCost: 0,
    controlType: 'dynamic',
  }) as BatteryCandidate
const B20 = battery(20, 10)
const DYNESS = json<BatteryCandidate[]>(`${GD}/battery-catalog.json`).find((b) =>
  b.id.startsWith('fa7a5775'),
)!

const consumption = loadProfileOf(`${GD}/lastgang.csv`)
const stceWithPv = (() => {
  const pv = parsePvProfile({
    content: readFileSync(fixture('dev-fixtures/demo-baeckerei-pv-erzeugung-2025.csv')),
    fileName: 'pv.csv',
  })
  if (!pv.ok) throw new Error('PV-Fixture ist nicht lesbar')
  const byTs = new Map(pv.profile.readings.map((r) => [r.ts, r.pvGenerationKw * (14.1 / 30)]))
  return applyEstimatedPv(
    consumption,
    consumption.readings.map((r) => byTs.get(r.ts)!),
  )
})()
const bakeryWithPv = loadProfileOf('dev-fixtures/demo-baeckerei-mit-pv-netzlastgang-2025.csv')

const okContext = (lp: LoadProfile, pricing = PRICING) => {
  const context = ownTariffContext(lp, TARIFF, pricing)
  if (!context.ok) throw new Error(`nicht rechenbar: ${context.reason}`)
  return context
}

/** Unabhängige Referenz: Eigenverbrauch (PV-Überschuss laden, bei Bezug entladen), eigene Kostenbewertung. */
function referenceSaving(
  lp: LoadProfile,
  b: BatteryCandidate,
  prices: readonly number[],
  endSocKwh: number,
) {
  const draws = drawSeries(lp)
  const C = b.usableCapacityKwh
  let soc = C / 2
  const grid = draws.map((d) => {
    let kw = 0
    if (d < 0) kw = Math.min(-d, b.maxPowerKw, (C - soc) / (b.roundTripEfficiency * 0.25))
    else if (d > 0) kw = -Math.min(d, b.maxPowerKw, soc / 0.25)
    soc += kw > 0 ? kw * 0.25 * b.roundTripEfficiency : kw * 0.25
    return d + kw
  })
  const cost = (g: number[]) =>
    g.reduce((eur, x, i) => eur + (x * 0.25 * (x > 0 ? prices[i]! : FEED_IN)) / 100, 0)
  const saving = cost(draws) - cost(grid)
  // Gleicher End-Ladestand wie die DP: die nicht entnommene Energie hätte den (flachen) Bezugspreis ersetzt.
  return { saving, sameEnd: saving - ((endSocKwh - soc) * prices[0]!) / 100 }
}

describe('arbitrageImpossible — Netzladung lohnt nur bei η × höchster > niedrigster Preis', () => {
  it('Grenzfälle um η × max = min', () => {
    expect(arbitrageImpossible(28, 32, 0.875)).toBe(true) // genau gleich
    expect(arbitrageImpossible(27.999, 32, 0.875)).toBe(false) // knapp darüber
    expect(arbitrageImpossible(28.001, 32, 0.875)).toBe(true) // knapp darunter
  })
})

describe('Gleichstand-Regel der DP', () => {
  // Konstanter Preis, Randwert = Preis: Halten und Entladen sind im Plan exakt gleich viel wert.
  const physics = { usableCapacityKwh: 10, maxPowerKw: 5, roundTripEfficiency: 0.9 }
  const plan = planHorizon({
    planKw: [5, 5, 5, 5],
    drawCtPerKwh: [25, 25, 25, 25],
    feedInCtPerKwh: 10,
    physics,
    deltaH: 0.25,
    startSocKwh: 5,
    terminalValueCtPerKwh: 25,
  })
  const interval = { drawKw: 5, priceCt: 25, capKw: Infinity, minEndSocKwh: 0 }

  it('ohne Angabe bleibt es beim bisherigen Verhalten (Halten)', () => {
    expect(decideInterval(plan, 0, 5, interval, 10, physics, 0.25)).toBe(0)
  })

  it("mit 'discharge' entlädt der Speicher (Eigenverbrauch)", () => {
    expect(decideInterval(plan, 0, 5, interval, 10, physics, 0.25, 'discharge')).toBe(-5)
  })
})

describe('Kostenfunktion = „Ihr Tarif heute"', () => {
  it('ohne Speicher bitgleich zum Monatsvergleich; ein Speicher ohne Leistung ändert nichts', () => {
    // Ohne Fixposten ist „Ihr Tarif heute" je Monat genau der Energieteil.
    const pricing: TariffPricingInputs = {
      ...PRICING,
      gridTariffRows: PRICING.gridTariffRows!.map((r) => ({
        ...r,
        grundpreisAmount: null,
        messpreisAmount: null,
      })),
      levies: {
        ...PRICING.levies!,
        periods: PRICING.levies!.periods.map((p) => ({
          ...p,
          eagPauschaleEurPerYear: 0,
          eagFoerderbeitragGrundpreisAmount: 0,
        })),
      },
    }
    const monthly = buildMonthlyTariffComparison(consumption, TARIFF, pricing, undefined)!
    const context = okContext(consumption, pricing)
    const currentSum = monthly.currentTariffEur!.reduce<number>((a, v) => a + (v ?? 0), 0)
    expect(Object.is(context.costWithoutStorageEur, currentSum)).toBe(true)

    const still = ownTariffDispatch(context, consumption, battery(20, 0), TARIFF, undefined)
    const draws = drawSeries(consumption)
    expect(still.gridAfterKw.every((g, i) => Object.is(g, draws[i]))).toBe(true)
    const cost = ownTariffEnergyCostEur(still.gridAfterKw, context.prices, context.monthIndex)
    expect(Object.is(cost, context.costWithoutStorageEur)).toBe(true)
  })

  it('Kapazität 0 ergibt exakt 0', () => {
    const field = ownTariffStorageOf(
      okContext(stceWithPv),
      stceWithPv,
      battery(0, 10),
      TARIFF,
      undefined,
    )
    expect(field.ownTariffStorage).toMatchObject({ savingPerYear: 0, planner: 'none' })
  })
})

describe('Kurzschluss ohne Einspeisung und ohne lohnende Arbitrage', () => {
  const context = okContext(consumption)
  const planning = dispatchPlanningFor(consumption)

  it('flacher Vollpreis, kein Überschuss → 0 ohne Simulation', () => {
    expect(context.hasFeedIn).toBe(false)
    expect(arbitrageImpossible(context.minPriceCt, context.maxPriceCt, 0.88)).toBe(true)
    expect(ownTariffStorageOf(context, consumption, B20, TARIFF, planning)).toEqual({
      ownTariffStorage: {
        savingPerYear: 0,
        savingOverCoveredPeriod: 0,
        basis: 'full_price',
        selfConsumptionGainKwh: 0,
        gridChargeKwh: 0,
        feedInKwh: 0,
        planner: 'none',
      },
    })
  })

  it('Positivkontrolle: die DP ohne Kurzschluss findet dort nichts (≤ 0,01 €)', () => {
    const { gridAfterKw } = ownTariffDispatch(context, consumption, B20, TARIFF, planning)
    const saving =
      context.costWithoutStorageEur -
      ownTariffEnergyCostEur(gridAfterKw, context.prices, context.monthIndex)
    expect(saving).toBeLessThanOrEqual(0.01)
    // Sie entlädt den Start-Bestand und kauft ihn am Ende mit Ladeverlust zurück: genau 10 kWh × (1/η − 1).
    expect(saving).toBeCloseTo((-(10 / 0.88 - 10) * context.maxPriceCt) / 100, 6)
  })
})

describe('Fixtarif mit PV-Überschuss — DP gegen Eigenverbrauchs-Referenz', () => {
  const cases = {
    'Gewerbe + PV (14,1 kWp), 20 kWh': [stceWithPv, B20, null],
    'Gewerbe + PV (14,1 kWp), Dyness': [stceWithPv, DYNESS, null],
    // Referenzwerte der Bestandsaufnahme (ohne End-Ladestand-Angleich).
    'Bäckerei mit PV, 20 kWh': [bakeryWithPv, B20, 527.82],
    'Bäckerei mit PV, Dyness': [bakeryWithPv, DYNESS, 701.53],
  } as const
  it.each(Object.keys(cases))('%s', (name) => {
    const [lp, b, documented] = cases[name as keyof typeof cases]
    const context = okContext(lp)
    const planning = dispatchPlanningFor(lp)
    const field = ownTariffStorageOf(context, lp, b, TARIFF, planning)
    const own = field.ownTariffStorage!
    expect(own.planner).toBe('surplus_dp')
    // Netzladung höchstens zum Wiederherstellen des Start-Ladestands am Lastgang-Ende.
    expect(own.gridChargeKwh).toBeLessThanOrEqual(
      b.usableCapacityKwh / 2 / b.roundTripEfficiency + 1e-6,
    )
    expect(context.minPriceCt).toBe(context.maxPriceCt)

    const endSoc = ownTariffDispatch(context, lp, b, TARIFF, planning).socKwh.at(-1)!
    const ref = referenceSaving(lp, b, context.prices.drawCtPerKwh, endSoc)
    expect(Math.abs(own.savingPerYear / ref.sameEnd - 1)).toBeLessThanOrEqual(0.0015)
    if (documented !== null) {
      expect(Math.abs(ref.saving - documented)).toBeLessThan(0.01)
      expect(Math.abs(own.savingPerYear / documented - 1)).toBeLessThanOrEqual(0.006)
    }
  })
})

describe('Fahrplan im eigenen Tarif — Energiebilanz, Grenzen, Monotonie', () => {
  const context = okContext(bakeryWithPv)
  const planning = dispatchPlanningFor(bakeryWithPv)
  const draws = drawSeries(bakeryWithPv)

  it('Bilanz und Grenzen', () => {
    const { socKwh, batteryPowerKw, gridAfterKw } = ownTariffDispatch(
      context,
      bakeryWithPv,
      B20,
      TARIFF,
      planning,
    )
    let soc = 10
    for (let i = 0; i < draws.length; i++) {
      const kw = batteryPowerKw[i]!
      expect(Math.abs(kw)).toBeLessThanOrEqual(10 + 1e-9)
      expect(gridAfterKw[i]).toBe(draws[i]! + kw)
      if (kw < 0) expect(gridAfterKw[i]!).toBeGreaterThanOrEqual(-1e-9)
      soc += kw > 0 ? kw * 0.25 * 0.88 : kw * 0.25
      expect(socKwh[i]!).toBeGreaterThanOrEqual(0)
      expect(socKwh[i]!).toBeLessThanOrEqual(20)
      expect(Math.abs(socKwh[i]! - soc)).toBeLessThan(1e-6)
    }
    const own = ownTariffStorageOf(context, bakeryWithPv, B20, TARIFF, planning).ownTariffStorage!
    expect(own.selfConsumptionGainKwh).toBeGreaterThan(0)
    expect(own.feedInKwh + own.selfConsumptionGainKwh).toBeCloseTo(
      context.feedInWithoutStorageKwh,
      6,
    )
  })

  it('mehr Kapazität spart nicht weniger (Stichprobe 5–100 kWh)', () => {
    const savings = [5, 10, 20, 50, 100].map(
      (kwh) =>
        ownTariffStorageOf(context, bakeryWithPv, battery(kwh, kwh / 2), TARIFF, planning)
          .ownTariffStorage!.savingPerYear,
    )
    for (let i = 1; i < savings.length; i++)
      expect(savings[i]!).toBeGreaterThanOrEqual(savings[i - 1]!)
  })
})

describe('computeAnalysis — das Feld je Gerät, null mit Grund', () => {
  const run = (tariff: TariffParams, pricing: TariffPricingInputs | undefined) =>
    computeAnalysis(
      {
        tariff,
        pv: null,
        tariffPricing: pricing,
        load: { fileName: 'x', profile: consumption, dataQuality: { warnings: [] } as never },
      },
      10,
      [B20],
    ).perBattery[0]!

  it.each([
    ['supplier_tariff_unknown', { ...TARIFF, supplierTariff: 'unknown' }, PRICING],
    ['no_price_data', TARIFF, undefined],
    ['time_of_use_tariff', { ...TARIFF, energyPriceNightCtPerKwh: 10 }, PRICING],
  ] as const)('%s', (reason, tariff, pricing) => {
    const entry = run(tariff as TariffParams, pricing)
    expect(entry.ownTariffStorage).toBeNull()
    expect(entry.ownTariffStorageReason).toBe(reason)
  })

  it('peak_shaving_active bei Leistungspreis', () => {
    const field = ownTariffStorageOf(
      okContext(consumption),
      consumption,
      B20,
      { ...TARIFF, leistungspreisEurPerKwYear: 50 } as TariffParams,
      undefined,
    )
    expect(field).toEqual({ ownTariffStorage: null, ownTariffStorageReason: 'peak_shaving_active' })
  })
})
