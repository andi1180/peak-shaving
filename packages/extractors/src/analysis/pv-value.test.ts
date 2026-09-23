import type { CalculatorPayload } from 'engine'
import { LEVIES_NONE } from 'shared'
import type {
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
/*
 * Der Rest-Bezug über Mittag in den Monaten MIT Einbruch. Bewusst nicht 0: seit der Tagesschwelle
 * (`PV_DAY_MIN_DEMAND_KWH`) wäre ein Tag ohne jeden Mittagsbedarf selbst genullt, und dieses
 * Fixture prüft die MONATSebene. 6 h × 2 kW = 12 kWh liegen klar über der Schwelle.
 */
const DIP_KW = 2

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
      return { ts: new Date(ms).toISOString(), gridPowerKw: working ? DIP_KW : BASE_KW }
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
    // Der gemessene Lauf trägt keine Schätzreihe: die Erzeugung steckt im Bezug (`import_only`).
    pv: null,
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

/** Der gemessene Bezug: 20 kW rund um die Uhr, über Mittag in Jän/Feb auf `DIP_KW` gesenkt. */
const MEASURED_KWH = DAYS * 24 * BASE_KW - (31 + 28) * SUN_HOURS * (BASE_KW - DIP_KW)

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
     * FIXTURES: die verbrauchsstärkste Woche liegt im MÄRZ (480 kWh/Tag gegen 372 in Jän/Feb, weil
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

/**
 * URBANZ-ÄHNLICH: ein Ausfallmonat, gefolgt von einem Monat, in dem die MEISTEN Tage keinen
 * Mittagsbedarf zeigen — der Fall, für den die Tagesschwelle gebaut ist.
 *
 * Jänner: kein Einbruch, als Ausfallmonat übergeben. Februar: 20 Tage mit 0,6 kWh im Tagfenster
 * (unter der Schwelle), 8 Tage mit 12 kWh (darüber). Gemessen wird, dass nur die 8 Tage Erzeugung
 * tragen — und dass der Februar-Balken dabei trotzdem ein normaler Monat bleibt.
 */
const DAYS_2M = 31 + 28
const QUIET_FEB_DAYS = 20
/** 6 h × 0,1 kW = 0,6 kWh im Fenster — unter `PV_DAY_MIN_DEMAND_KWH`. */
const QUIET_KW = 0.1
const dayOf = (ms: number): number => Math.floor((ms - T0) / (24 * HOUR_MS))

/** Derselbe Weg wie oben: der gemessene Bezug von Hand, damit `valueEur` eine echte Differenz ist. */
const MEASURED_KWH_2M =
  DAYS_2M * 24 * BASE_KW -
  QUIET_FEB_DAYS * SUN_HOURS * (BASE_KW - QUIET_KW) -
  (28 - QUIET_FEB_DAYS) * SUN_HOURS * (BASE_KW - DIP_KW)
const MEASURED_WITH_PV_EUR_2M = (MEASURED_KWH_2M * CT_PER_KWH) / 100

function loadProfile2M(): LoadProfile {
  return {
    readings: Array.from({ length: DAYS_2M * 96 }, (_, i) => {
      const ms = T0 + i * STEP_MS
      if (monthOf(ms) === 1 || !isSunHour(ms)) {
        return { ts: new Date(ms).toISOString(), gridPowerKw: BASE_KW }
      }
      const quiet = dayOf(ms) < 31 + QUIET_FEB_DAYS
      return { ts: new Date(ms).toISOString(), gridPowerKw: quiet ? QUIET_KW : DIP_KW }
    }),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

function payload2M(): CalculatorPayload {
  const profile = loadProfile2M()
  return {
    load: {
      fileName: 'test.csv',
      profile,
      dataQuality: {
        coveredDays: DAYS_2M,
        coveredMonths: 2,
        gapsInterpolated: 0,
        largestGapSlots: 0,
        warnings: [],
      },
    },
    tariff,
    // Der gemessene Lauf trägt keine Schätzreihe: die Erzeugung steckt im Bezug (`import_only`).
    pv: null,
    financial: { fixedSubsidyEur: 0, taxRatePercent: 0, depreciationYears: 10 },
    tariffPricing: pricing({
      startIso: profile.readings[0]!.ts,
      endIso: profile.readings.at(-1)!.ts,
    }),
  }
}

describe('buildPvValueScenario — Tage ohne Mittagsbedarf', () => {
  it('rechnet nur die Tage MIT Bedarf an und senkt den €-Wert entsprechend', async () => {
    const profile = loadProfile2M()
    const scenario = await buildPvValueScenario({
      payload: payload2M(),
      measuredWithPvEur: MEASURED_WITH_PV_EUR_2M,
      pvGross: {
        readings: profile.readings.map((r) => ({
          ts: r.ts,
          pvGenerationKw: isSunHour(Date.parse(r.ts)) ? PV_KW : 0,
        })),
      },
      outageMonths: [{ year: 2025, month: 1 }],
      annualWindow: null,
      fetchTariffPricing: async ({ window }) => pricing(window),
    })
    if (!scenario) throw new Error('unerwartet kein Szenario')

    /* Nur die 8 Februartage über der Schwelle tragen — Jänner per Ausfallmonat, 20 Tage per Tagesregel. */
    const withDayRule = SUN_HOURS * PV_KW * (28 - QUIET_FEB_DAYS)
    expect(scenario.estimatedGenerationKwh).toBeCloseTo(withDayRule, 6)
    expect(scenario.measured.valueEur).toBeCloseTo((withDayRule * CT_PER_KWH) / 100, 6)

    /* Die alte Fassung hätte den ganzen Februar angesetzt — der Wert sinkt auf rund ein Drittel. */
    const monthRuleOnly = SUN_HOURS * PV_KW * 28
    expect(scenario.measured.valueEur).toBeLessThan((monthRuleOnly * CT_PER_KWH) / 100 * 0.4)

    /*
     * Der Monatsbalken bleibt ein NORMALER Monat: „Ausfall" ist ganzen Monaten vorbehalten, ein
     * teilweise genullter zeigt einfach eine kleinere Summe.
     */
    expect(scenario.months.map((m) => m.outage)).toEqual([true, false])
    expect(scenario.months[1]!.selfConsumptionKwh).toBeCloseTo(withDayRule, 6)
  })
})
