import { LEVIES_NONE } from 'shared'
import type {
  CalculatorPayload,
  GridTariffRowInput,
  LoadProfile,
  PvProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { buildPvValueScenario } from './pv-value'

/**
 * Der Wert einer bestehenden PV-Anlage — gemessener Zeitraum und Jahres-Hochrechnung.
 *
 * Das Fixture ist dasselbe wie in `packages/engine/src/pv-value/reconstruct.test.ts`: 85 Tage ab
 * dem 01.01.2025, Jänner und Februar mit Mittagseinbruch, März ohne. Geprüft wird hier die
 * KOSTENseite — dass beide Reihen durch dieselbe Tarifrechnung gehen und der Ausfallmonat nichts
 * beiträgt.
 */

const STEP_MS = 15 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const T0 = Date.parse('2024-12-31T23:00:00Z')
const DAYS = 85
const PV_KW = 12
const BASE_KW = 20
const SUN_HOURS = 6

const OUTAGE = [{ year: 2025, month: 3 }]

const isSunHour = (ms: number): boolean => {
  const hour = new Date(ms).getUTCHours()
  return hour >= 9 && hour < 15
}
const monthOf = (ms: number): number => new Date(ms + HOUR_MS).getUTCMonth() + 1

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

function loadProfile(): LoadProfile {
  return {
    readings: Array.from({ length: DAYS * 96 }, (_, i) => {
      const ms = T0 + i * STEP_MS
      const working = monthOf(ms) !== 3 && isSunHour(ms)
      return { ts: new Date(ms).toISOString(), gridPowerKw: working ? 0 : BASE_KW }
    }),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

function pvGross(): PvProfile {
  return {
    readings: Array.from({ length: DAYS * 96 }, (_, i) => {
      const ms = T0 + i * STEP_MS
      return { ts: new Date(ms).toISOString(), pvGenerationKw: isSunHour(ms) ? PV_KW : 0 }
    }),
  }
}

function gridRow(): GridTariffRowInput {
  return {
    validFrom: '2024-01-01',
    validUntil: null,
    netzverlustCtPerKwh: 0.7,
    priceBasis: 'net',
    windows: [
      {
        label: 'normal',
        monthDayFrom: null,
        monthDayTo: null,
        timeFrom: '00:00:00',
        timeTo: '24:00:00',
        ctPerKwh: 6.98,
      },
    ],
  }
}

function hourly(fromIso: string, toIso: string): SpotPriceSeriesInput {
  const prices = []
  const toMs = Date.parse(toIso)
  for (let ms = Date.parse(fromIso); ms < toMs; ms += HOUR_MS) {
    prices.push({
      tsStart: new Date(ms).toISOString(),
      tsEnd: new Date(Math.min(ms + HOUR_MS, toMs)).toISOString(),
      ctPerKwh: 12,
      priceBasis: 'net',
    })
  }
  return { prices, complete: true, missingRanges: [] }
}

const pricing = (window: { startIso: string; endIso: string }): TariffPricingInputs => ({
  gridTariffRows: [gridRow()],
  spotPrices: hourly(
    window.startIso,
    new Date(Date.parse(window.endIso) + HOUR_MS).toISOString(),
  ),
  levies: LEVIES_NONE,
})

function payload(): CalculatorPayload {
  const profile = loadProfile()
  return {
    load: {
      fileName: 'test.csv',
      profile,
      dataQuality: {
        coveredDays: DAYS,
        coveredMonths: 3,
        gapsInterpolated: 0,
        largestGapSlots: 0,
        warnings: [],
      },
    },
    tariff,
    financial: { fixedSubsidyEur: 0, taxRatePercent: 0, depreciationYears: 10 },
    tariffPricing: pricing({
      startIso: profile.readings[0]!.ts,
      endIso: profile.readings.at(-1)!.ts,
    }),
  }
}

/**
 * Der Arbeitspreis, den dieses Fixture je Kilowattstunde ergibt: Lieferant + Netz-Arbeitspreis +
 * Netzverlust-Sockel. Keine Abgaben (`LEVIES_NONE`), keine Grundgebühren — beide Reihen wären
 * davon ohnehin gleich betroffen.
 */
const CT_PER_KWH = tariff.energyPriceCtPerKwh + 6.98 + 0.7

/** Der gemessene Bezug: 20 kW rund um die Uhr, abzüglich der gedeckten Sonnenstunden in Jän/Feb. */
const MEASURED_KWH = DAYS * 24 * BASE_KW - (31 + 28) * SUN_HOURS * BASE_KW

/**
 * Die Kopfzahl des gemessenen Laufs — HIER VON HAND gerechnet und nicht aus dem Lauf gezogen.
 * Damit prüft der Test die „ohne PV"-Seite absolut und nicht nur ihre Differenz zu sich selbst.
 */
const MEASURED_WITH_PV_EUR = (MEASURED_KWH * CT_PER_KWH) / 100

describe('buildPvValueScenario', () => {
  it('bewertet beide Seiten mit derselben Rechnung — der Ausfallmonat trägt nichts bei', async () => {
    const scenario = await buildPvValueScenario({
      payload: payload(),
      measuredWithPvEur: MEASURED_WITH_PV_EUR,
      pvGross: pvGross(),
      outageMonths: OUTAGE,
      annualWindow: { fromDate: '2025-01-01', toDate: '2025-12-31' },
      fetchTariffPricing: async ({ window }) => pricing(window),
    })
    if (!scenario) throw new Error('unerwartet kein Szenario')

    /* Die „mit PV"-Zahl ist unverändert die übergebene — sie wird nicht nachgerechnet. */
    expect(scenario.measured.withPvEur).toBe(MEASURED_WITH_PV_EUR)
    expect(scenario.coveredDays).toBe(DAYS)

    /*
     * Die angesetzte Erzeugung: 6 Sonnenstunden × 12 kW × (31 + 28) Tage. März fehlt darin — das
     * ist die Ausfall-Nullung, gemessen an der Menge und nicht an einer Markierung.
     */
    expect(scenario.estimatedGenerationKwh).toBeCloseTo(SUN_HOURS * PV_KW * (31 + 28), 6)
    expect(scenario.months.map((m) => m.outage)).toEqual([false, false, true])
    expect(scenario.months[2]!.selfConsumptionKwh).toBeNull()

    /*
     * Die „ohne PV"-Seite kostet mehr, und um wie viel, ist von Hand nachrechenbar: derselbe
     * Arbeitspreis, derselbe Netz-Arbeitspreis, derselbe Netzverlust-Sockel auf 4.248 kWh mehr
     * Bezug. Fixkosten gibt es in diesem Fixture keine, sie kürzten sich ohnehin heraus.
     */
    const expectedDelta = (scenario.estimatedGenerationKwh * CT_PER_KWH) / 100
    expect(scenario.measured.valueEur).toBeCloseTo(expectedDelta, 6)
    expect(scenario.measured.withoutPvEur).toBeCloseTo(MEASURED_WITH_PV_EUR + expectedDelta, 6)
  })

  it('rechnet das Jahr auf DEMSELBEN Fenster wie das Kapitel davor — und nähert ohne es nichts', async () => {
    const options = {
      payload: payload(),
      measuredWithPvEur: MEASURED_WITH_PV_EUR,
      pvGross: pvGross(),
      outageMonths: OUTAGE,
      fetchTariffPricing: async ({ window }: { window: { startIso: string; endIso: string } }) =>
        pricing(window),
    }

    const withYear = await buildPvValueScenario({
      ...options,
      annualWindow: { fromDate: '2025-01-01', toDate: '2025-12-31' },
    })
    expect(withYear?.annual?.windowFromDate).toBe('2025-01-01')
    expect(withYear?.annual?.projectedDays).toBe(365 - DAYS)

    /*
     * ⚠ DIE JAHRESZAHL IST HIER GLEICH DER GEMESSENEN, UND DAS IST DER EIGENTLICHE BEFUND DIESES
     * FIXTURES: die verbrauchsstärkste Woche liegt im MÄRZ (480 kWh/Tag gegen 360 in Jän/Feb, weil
     * dort die Sonnenstunden den Bezug decken) — und der März ist der Ausfallmonat. Die gefüllten
     * Tage übernehmen deshalb eine Woche OHNE angesetzte Erzeugung, und die „ohne PV"-Seite
     * unterscheidet sich dort von der „mit PV"-Seite um nichts.
     *
     * Gemessen ist damit genau die Zusage, auf der dieses Modul steht: Lastgang und
     * Erzeugungsreihe werden nach DEMSELBEN Plan verlängert. Zwei getrennte Läufe könnten
     * verschiedene Referenzwochen wählen, und dann stünde hier eine Differenz, die aus der Auswahl
     * stammt und nicht aus der Anlage.
     */
    expect(withYear!.annual!.valueEur).toBeCloseTo(withYear!.measured.valueEur, 6)

    /* Ohne Jahresfenster entfällt die Hochrechnung — es wird NICHTS genähert. */
    const withoutYear = await buildPvValueScenario({ ...options, annualWindow: null })
    expect(withoutYear?.annual).toBeNull()
    expect(withoutYear?.measured).toEqual(withYear!.measured)
  })
})
