import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import {
  tariffWayCosts,
  type BatteryCandidate,
  type LoadProfile,
  type TariffParams,
  type TariffPricingInputs,
} from 'shared'

import {
  applyEstimatedPv,
  computeAnalysis,
  dailyPriceOrder,
  dispatchPlanningFor,
  intervalTariffRates,
  mapDraftToTariffParams,
  parseLoadProfile,
  parsePvProfile,
  runCombinedDispatch,
  simulateBattery,
  startSoc,
  toPhysics,
} from '../src'
import { utcMsToLocalFields } from '../src/parser/datetime'
import { hasFeedIn } from '../src/refusal'
import { peakConstraints } from '../src/simulation/peak-constraints'
import { withoutPlanOnDaysMissingPattern } from '../src/simulation/planning'

const fixture = (relative: string) => new URL(`../../../${relative}`, import.meta.url)

function loadProfileOf(relative: string): LoadProfile {
  const parsed = parseLoadProfile({ content: readFileSync(fixture(relative)), fileName: relative })
  if (!parsed.ok) throw new Error(`${relative} ist nicht lesbar`)
  return parsed.profile
}

const GEWERBE_DIR = 'apps/website/test/report-snapshots/fixtures/gewerbe-ohne-rechnung-wien'

describe('Überschuss-Gate über die bestehenden Golden-Fälle', () => {
  // Bäckerei-Golden und gewerbe-tarif-unbekannt teilen denselben Lastgang.
  it.each([
    [
      'Bäckerei-Golden / gewerbe-tarif-unbekannt',
      'packages/engine/test/golden/baeckerei/lastgang.csv',
    ],
    [
      'Privat-Golden (privat-bestand-pv-wien)',
      'packages/extractors/test/golden/privat-bestand-pv-wien/lastgang.csv',
    ],
    ['Gewerbe ohne PV (gewerbe-ohne-rechnung-wien)', `${GEWERBE_DIR}/lastgang.csv`],
  ])('%s: kein Intervall mit Netto-Bezug < 0', (_, file) => {
    expect(hasFeedIn(loadProfileOf(file))).toBe(false)
  })
})

/**
 * Soll-Verhalten seit der Überschuss-Optimierung (`surplus-optimization.ts`): bei Einspeisung, echter
 * Preiskurve und gesperrter Spitzenkappung plant der Fahrplan den PV-Überschuss mit ein, statt vor
 * ihm aus dem Netz zu laden. Bis dahin lud er hier 2.645 kWh aus dem Netz (alles an Überschusstagen),
 * lagerte 2.240 kWh PV ein und speiste 14.181 kWh ein; aWATTar mit Ladesteuerung −276,89 €.
 *
 * Gewerbe-Lastgang 2025 ohne PV (anonymisiert) mit derselben Preis-Fixture, abzüglich der synthetischen
 * 30-kWp-Erzeugungsreihe der Demo-Bäckerei, skaliert auf 14,1 kWp; Speicher 20 kWh / 10 kW / η 0,88,
 * Einspeisevergütung 11,0352 ct/kWh, aWATTar HOURLY mit 1,5 ct/kWh Aufschlag (Fixture). Kein Netzzugriff.
 */
describe('Fahrplan bei PV-Überschuss plant den Überschuss ein', () => {
  const consumption = loadProfileOf(`${GEWERBE_DIR}/lastgang.csv`)
  const pvParsed = parsePvProfile({
    content: readFileSync(fixture('dev-fixtures/demo-baeckerei-pv-erzeugung-2025.csv')),
    fileName: 'pv.csv',
  })
  if (!pvParsed.ok) throw new Error('PV-Fixture ist nicht lesbar')
  const pvByTs = new Map(
    pvParsed.profile.readings.map((r) => [r.ts, r.pvGenerationKw * (14.1 / 30)]),
  )
  const pvKw = consumption.readings.map((r) => {
    const v = pvByTs.get(r.ts)
    if (v === undefined) throw new Error(`PV-Fixture deckt ${r.ts} nicht ab`)
    return v
  })
  const loadProfile = applyEstimatedPv(consumption, pvKw)

  const draft = JSON.parse(readFileSync(fixture(`${GEWERBE_DIR}/draft.json`), 'utf8')) as Record<
    string,
    unknown
  >
  const tariff = {
    ...mapDraftToTariffParams(draft, { category: 'gewerbe' }),
    einspeiseverguetungCtPerKwh: 11.0352,
  } as TariffParams
  const pricing = (
    JSON.parse(readFileSync(fixture(`${GEWERBE_DIR}/tariff-pricing.json`), 'utf8')) as {
      request: { window: { startIso: string } }
      pricing: TariffPricingInputs
    }[]
  ).find((e) => e.request.window.startIso === '2024-12-31T23:00:00.000Z')!.pricing
  const battery: BatteryCandidate = {
    id: 'charakterisierung-20kwh',
    name: 'Charakterisierung 20 kWh / 10 kW',
    manufacturer: 'Test',
    class: 'commercial',
    usableCapacityKwh: 20,
    maxPowerKw: 10,
    roundTripEfficiency: 0.88,
    pricePerKwh: 300,
    inverterIncluded: true,
    extraInverterCost: 0,
    requiresFoundation: false,
    installationCost: 0,
    controlType: 'dynamic',
  }

  it('Gate = true, Kosten und Energieflüsse', () => {
    expect(hasFeedIn(loadProfile)).toBe(true)

    const sim = simulateBattery(
      loadProfile,
      battery,
      tariff,
      undefined,
      pricing,
      dispatchPlanningFor(loadProfile),
    )
    expect(sim.hasFeedIn).toBe(true)

    const dH = loadProfile.intervalMinutes / 60
    const draws = loadProfile.readings.map((r) => r.gridPowerKw)
    const dayOf = (ts: string) => {
      const f = utcMsToLocalFields(Date.parse(ts), loadProfile.timezoneMeta)
      return `${f.year}-${f.month}-${f.day}`
    }
    const surplusDays = new Set(
      loadProfile.readings.filter((r) => r.gridPowerKw < 0).map((r) => dayOf(r.ts)),
    )
    let gridCharge = 0
    let gridChargeOnSurplusDays = 0
    let pvCharge = 0
    let feedIn = 0
    sim.dispatch.batteryPowerKw.forEach((b, i) => {
      // Ladeleistung über dem Überschuss des Intervalls kommt aus dem Netz.
      const fromPv = b > 0 ? Math.min(b, Math.max(0, -draws[i]!)) : 0
      const fromGrid = b > 0 ? b - fromPv : 0
      pvCharge += fromPv * dH
      gridCharge += fromGrid * dH
      if (surplusDays.has(dayOf(loadProfile.readings[i]!.ts)))
        gridChargeOnSurplusDays += fromGrid * dH
      const g = sim.dispatch.gridAfterKw[i]!
      if (g < 0) feedIn += -g * dH
    })

    const result = computeAnalysis(
      {
        tariff,
        pv: null,
        tariffPricing: pricing,
        load: {
          fileName: 'lastgang.csv',
          profile: loadProfile,
          dataQuality: { warnings: [] } as never,
        },
      },
      10,
      [battery],
    )
    const comparison =
      result.tariffOptimization?.computable === true
        ? result.tariffOptimization.monthlyComparison
        : undefined
    const ways = tariffWayCosts(comparison!)

    const r6 = (x: number) => Math.round(x * 1e6) / 1e6
    expect({
      awattarOhneSteuerungEur: r6(ways.spotWithoutControlEur),
      awattarMitLadesteuerungEur: r6(ways.controlledEur!),
      netzladungKwh: r6(gridCharge),
      pvLadungKwh: r6(pvCharge),
      einspeisungKwh: r6(feedIn),
      anteilNetzladungAnUeberschusstagen: r6(gridChargeOnSurplusDays / gridCharge),
    }).toEqual({
      awattarOhneSteuerungEur: 82.666608,
      awattarMitLadesteuerungEur: -555.220791,
      netzladungKwh: 472.793422,
      pvLadungKwh: 5591.52066,
      einspeisungKwh: 10829.50329,
      // Die synthetische Erzeugungsreihe hat an jedem Tag Überschuss.
      anteilNetzladungAnUeberschusstagen: 1,
    })
  })

  it('mit aktiver Spitzenkappung bleibt der bisherige Fahrplan', () => {
    // Gemessene statt geschätzter Einspeisung und ein Leistungspreis: die Kappung ist nicht gesperrt.
    const measured: LoadProfile = { ...loadProfile, pvSource: undefined }
    const peakTariff = {
      ...tariff,
      leistungspreisEurPerKwYear: 50,
      billingModel: 'monthly_max_sum',
    } as TariffParams
    const planning = dispatchPlanningFor(measured)
    const sim = simulateBattery(measured, battery, peakTariff, undefined, pricing, planning)

    const physics = toPhysics(battery)
    const deltaH = measured.intervalMinutes / 60
    const draws = measured.readings.map((r) => r.gridPowerKw)
    const pc = peakConstraints(measured, battery, peakTariff)
    expect(pc.peakShavingDisabled).toBe(false)
    const rates = intervalTariffRates(measured, peakTariff, pricing)
    if (planning.basis !== 'forecast') throw new Error('Prognose erwartet')
    const order = withoutPlanOnDaysMissingPattern(
      dailyPriceOrder({
        loadProfile: measured,
        rateCtPerKwh: rates.rateCtPerKwh,
        preferChargeInterval: rates.isCheapWindow,
        capForInterval: pc.capForInterval,
        draws: planning.forecast.forecastKw,
        physics,
        deltaH,
      }),
      planning.forecast.hasPattern,
      physics.usableCapacityKwh,
    )
    const previous = runCombinedDispatch(
      draws,
      pc.capForInterval,
      pc.socFloorKwh,
      physics,
      startSoc(physics),
      deltaH,
      rates.isCheapWindow,
      order,
    )
    expect(sim.dispatch).toEqual(previous)
  })
})
