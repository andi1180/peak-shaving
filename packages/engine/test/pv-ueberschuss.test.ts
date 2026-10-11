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
  dispatchPlanningFor,
  mapDraftToTariffParams,
  parseLoadProfile,
  parsePvProfile,
  simulateBattery,
} from '../src'
import { utcMsToLocalFields } from '../src/parser/datetime'
import { hasFeedIn } from '../src/refusal'

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
 * IST-VERHALTEN, BEKANNTER MANGEL: der Fahrplan unter aWATTar ignoriert den PV-Überschuss — er lädt
 * vor dem Überschuss aus dem Netz, und der Überschuss geht dann bei vollem Speicher ins Netz. Dieser
 * Test hält den heutigen Stand fest und wird in PR 2 bewusst geändert; eine Abweichung VOR PR 2 ist
 * eine ungewollte Änderung am Dispatch.
 *
 * Gewerbe-Lastgang 2025 ohne PV (anonymisiert) mit derselben Preis-Fixture, abzüglich der synthetischen
 * 30-kWp-Erzeugungsreihe der Demo-Bäckerei, skaliert auf 14,1 kWp; Speicher 20 kWh / 10 kW / η 0,88,
 * Einspeisevergütung 11,0352 ct/kWh. Kein Netzzugriff.
 */
describe('Ist-Verhalten, bekannter Mangel (Fahrplan ignoriert PV-Überschuss), wird in PR 2 bewusst geändert', () => {
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

  it('Gate = true, Kosten und Energieflüsse wie heute', () => {
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
      if (b > 0 && draws[i]! >= 0) {
        gridCharge += b * dH
        if (surplusDays.has(dayOf(loadProfile.readings[i]!.ts))) gridChargeOnSurplusDays += b * dH
      }
      if (b > 0 && draws[i]! < 0) pvCharge += b * dH
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
      awattarOhneSteuerungEur: -28.284337,
      awattarMitLadesteuerungEur: -276.885109,
      netzladungKwh: 2645.055376,
      pvLadungKwh: 2239.623314,
      einspeisungKwh: 14181.400636,
      anteilNetzladungAnUeberschusstagen: 1,
    })
  })
})
