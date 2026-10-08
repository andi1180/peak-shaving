import type { CalculatorPayload } from 'engine'
import { LEVIES_NONE, buildLevySchedule } from 'shared'
import type {
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import type { BatteryCandidate } from 'shared'
import { describe, expect, it } from 'vitest'

import { buildAnnualScenario } from './annual-scenario'

/**
 * D6 Teil 3 — das Jahres-Szenario.
 *
 * Der Lastgang ist bewusst KONSTANT (10 kW): jeder Blocktag trägt dann 240 kWh, jeder
 * gefüllte Tag sieht aus wie ein gemessener, und die Jahreskosten sind von Hand nachrechenbar,
 * ohne eine Zahl aus einem früheren Lauf zu pinnen.
 */

const STEP_MS = 15 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const CONSTANT_KW = 10

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

const CATALOG: BatteryCandidate[] = [
  {
    id: 'kat-30',
    name: 'Test 30',
    manufacturer: 'Test',
    class: 'commercial',
    usableCapacityKwh: 30,
    maxPowerKw: 15,
    roundTripEfficiency: 0.9,
    /* Bewusst billig: die dritte Reihe des Monatsvergleichs entsteht nur, wenn sich das Gerät im
       Betrachtungszeitraum rechnet (`netSavingOverHorizon > 0`, `compute-analysis.ts`). */
    pricePerKwh: 50,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'dynamic',
  },
]

/** Leistung von `fromIso` bis `toIso` (exklusiv) — beide lokale Mitternächte in UTC; `kwAt` je Slot. */
function profile(
  fromIso: string,
  toIso: string,
  kwAt: (ms: number) => number = () => CONSTANT_KW,
): LoadProfile {
  const t0 = Date.parse(fromIso)
  return {
    readings: Array.from({ length: (Date.parse(toIso) - t0) / STEP_MS }, (_, i) => ({
      ts: new Date(t0 + i * STEP_MS).toISOString(),
      gridPowerKw: kwAt(t0 + i * STEP_MS),
    })),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

/** 01.03.–25.09.2026 Ortszeit Wien: 209 Messtage. */
const MARCH_TO_SEPTEMBER = ['2026-02-28T23:00:00Z', '2026-09-25T22:00:00Z'] as const

function payloadOf(
  fromIso: string,
  toIso: string,
  kwAt?: (ms: number) => number,
  tariffParams: TariffParams = tariff,
): CalculatorPayload {
  const loadProfile = profile(fromIso, toIso, kwAt)
  return {
    load: {
      fileName: 'test.csv',
      profile: loadProfile,
      dataQuality: {
        coveredDays: loadProfile.readings.length / 96,
        coveredMonths: 7,
        gapsInterpolated: 0,
        largestGapSlots: 0,
        warnings: [],
      },
    },
    tariff: tariffParams,
    // Der gemessene Lauf trägt keine Schätzreihe: die Erzeugung steckt im Bezug (`import_only`).
    pv: null,
    financial: { fixedSubsidyEur: 0, taxRatePercent: 0, depreciationYears: 10 },
  }
}

function gridRow(validFrom = '2024-01-01', validUntil: string | null = null): GridTariffRowInput {
  return {
    validFrom,
    validUntil,
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

/**
 * Stundenpreise mit Tagesspreizung — nachts billig, abends teuer.
 *
 * ⚠ Eine FLACHE Preiskurve taugt hier nicht: ohne Spreizung verdient der Speicher nichts, die
 * Empfehlung fällt unter `netSavingOverHorizon > 0`, und mit ihr entfällt die dritte Reihe des
 * Monatsvergleichs — der Lauf käme dann mit `not_computable` zurück, ohne dass es an den Preisen
 * läge.
 */
function hourly(fromIso: string, toIso: string): SpotPriceSeriesInput {
  const prices = []
  const toMs = Date.parse(toIso)
  for (let ms = Date.parse(fromIso); ms < toMs; ms += HOUR_MS) {
    const hour = new Date(ms).getUTCHours()
    prices.push({
      tsStart: new Date(ms).toISOString(),
      tsEnd: new Date(Math.min(ms + HOUR_MS, toMs)).toISOString(),
      ctPerKwh: hour < 6 ? 2 : hour >= 16 && hour < 21 ? 40 : 12,
      priceBasis: 'net',
    })
  }
  return { prices, complete: true, missingRanges: [] }
}

/** Ein Preis-Port, der den angefragten Zeitraum mit Marktpreisen lückenlos bedient. */
const pricingWith =
  (row: GridTariffRowInput, levies: TariffPricingInputs['levies'] = LEVIES_NONE) =>
  (request: { window: { startIso: string; endIso: string } }) =>
    Promise.resolve<TariffPricingInputs>({
      gridTariffRows: [row],
      spotPrices: hourly(
        request.window.startIso,
        new Date(Date.parse(request.window.endIso) + HOUR_MS).toISOString(),
      ),
      levies,
    })

const fullPricing = (request: { window: { startIso: string; endIso: string } }) =>
  Promise.resolve<TariffPricingInputs>({
    gridTariffRows: [gridRow()],
    spotPrices: hourly(
      request.window.startIso,
      new Date(Date.parse(request.window.endIso) + HOUR_MS).toISOString(),
    ),
    levies: LEVIES_NONE,
  })

describe('buildAnnualScenario', () => {
  it('rechnet die ganze Kette auf 365 Tagen — nicht die Ersparnis-Zahlen gestreckt', async () => {
    const out = await buildAnnualScenario({
      payload: payloadOf(...MARCH_TO_SEPTEMBER),
      horizonYears: 10,
      catalog: [CATALOG[0]!],
      fetchTariffPricing: fullPricing,
    })
    if (!out.ok) throw new Error(`unerwartet abgelehnt: ${out.blocker}`)

    /* Das Fenster endet am letzten Messtag, gefüllt wird davor — unabhängig von der Uhr. */
    expect(out.value.windowFromDate).toBe('2025-09-26')
    expect(out.value.windowToDate).toBe('2026-09-25')
    expect(out.value.measuredDays).toBe(209)
    expect(out.value.projectedDays).toBe(365 - 209)
    /* Block: Mo 02.03. bis So 20.09.2026 — die vollen Mo–So-Wochen der Messung. */
    expect(out.value.fill).toEqual({
      blockFromDate: '2026-03-02',
      blockToDate: '2026-09-20',
      blockWeeks: 29,
    })

    /*
     * Die Jahreskosten sind grösser als die des gemessenen Zeitraums und stehen im Verhältnis der
     * Tage — bei KONSTANTEM Lastgang und konstanten Preisen muss das gelten. Bei einem echten
     * Lastgang gilt es gerade nicht, und genau deshalb wird hier gerechnet statt gestreckt.
     */
    const ways = out.value.ways
    expect(ways.currentTariffEur).toBeGreaterThan(0)
    expect(ways.spotWithoutControlEur).toBeGreaterThan(0)
    expect(ways.comparisonTariffEur).toBeNull()
    /* Ohne Leistungspreis gibt es Weg 5 nicht — die 0 ist die Aussage, nicht ein fehlender Wert. */
    expect(ways.peakShavingSavingEur).toBe(0)
  })

  it('Messung 28.03.–31.08.: Fenster 01.09.–31.08., 208 gefüllte Tage, kein Tag nach der Messung', async () => {
    const out = await buildAnnualScenario({
      payload: payloadOf('2026-03-27T23:00:00Z', '2026-08-31T22:00:00Z'),
      horizonYears: 10,
      catalog: [CATALOG[0]!],
      /* Netzentgelt-Zeile erst ab 01.01.2026: rechenbar nur mit dem Satzstand des Stichtags. */
      fetchTariffPricing: pricingWith(gridRow('2026-01-01')),
    })
    if (!out.ok) throw new Error(`unerwartet abgelehnt: ${out.blocker}`)

    expect(out.value.windowFromDate).toBe('2025-09-01')
    expect(out.value.windowToDate).toBe('2026-08-31')
    expect(out.value.ratesAsOf).toBe('2026-08-31')
    expect(out.value.fill).toEqual({
      blockFromDate: '2026-03-30',
      blockToDate: '2026-08-30',
      blockWeeks: 22,
    })
    expect(out.value.measuredDays).toBe(157)
    expect(out.value.projectedDays).toBe(208)
  })

  it('ohne Netzentgelt-Zeile am Stichtag: nicht berechenbar, kein Rückfall auf eine andere Zeile', async () => {
    const out = await buildAnnualScenario({
      payload: payloadOf('2026-03-27T23:00:00Z', '2026-08-31T22:00:00Z'),
      horizonYears: 10,
      catalog: [CATALOG[0]!],
      fetchTariffPricing: pricingWith(gridRow('2025-01-01', '2026-06-30')),
    })

    expect(out).toEqual({ ok: false, blocker: 'not_computable' })
  })

  it('verweigert, statt zu nähern, wenn die Preise das Jahresfenster nicht decken', async () => {
    const out = await buildAnnualScenario({
      payload: payloadOf(...MARCH_TO_SEPTEMBER),
      horizonYears: 10,
      catalog: [CATALOG[0]!],
      /* Nur die gemessenen Tage haben Preise — der Rest des Jahres bleibt eine Lücke. */
      fetchTariffPricing: async () => ({
        gridTariffRows: [gridRow()],
        spotPrices: {
          ...hourly(...MARCH_TO_SEPTEMBER),
          complete: false,
          missingRanges: [{ fromIso: '2025-09-25T22:00:00Z', toIso: '2026-02-28T23:00:00Z' }],
        },
        levies: LEVIES_NONE,
      }),
    })

    expect(out).toEqual({ ok: false, blocker: 'not_computable' })
  })

  /** Müldür-Konstellation mit täglicher Spitze (16–17 Uhr UTC 30 kW statt 10 kW) und Leistungspreis. */
  const MUELDUER = ['2026-03-27T23:00:00Z', '2026-08-31T22:00:00Z'] as const
  const peakyKw = (ms: number) => (new Date(ms).getUTCHours() === 16 ? 30 : CONSTANT_KW)
  const demandTariff: TariffParams = {
    ...tariff,
    leistungspreisEurPerKwYear: 82.92,
    billingModel: 'monthly_max_sum',
  }

  it('reiht den ganzen Katalog: das Gerät ist Rang 1, `devices` trägt jedes Gerät in Reihung', async () => {
    /* Klar besser: gleiche Grösse, höherer Wirkungsgrad, ein Fünftel des Preises. */
    const BETTER: BatteryCandidate = {
      ...CATALOG[0]!,
      id: 'kat-30-plus',
      name: 'Test 30 plus',
      roundTripEfficiency: 0.98,
      pricePerKwh: 10,
    }
    const out = await buildAnnualScenario({
      payload: payloadOf(...MUELDUER, peakyKw, demandTariff),
      horizonYears: 10,
      catalog: [CATALOG[0]!, BETTER],
      fetchTariffPricing: pricingWith(gridRow('2026-01-01')),
    })
    if (!out.ok) throw new Error('unerwartet abgelehnt')

    expect(out.value.device).toEqual({ batteryId: 'kat-30-plus', name: 'Test 30 plus' })
    expect(out.value.devices?.map((d) => d.batteryId)).toEqual(['kat-30-plus', 'kat-30'])
    expect(out.value.devices?.[0]?.peakShavingSavingEur).toBe(out.value.ways.peakShavingSavingEur)
  })

  it('Weg 5 enthält den EAG-Förderbeitrag Leistung', async () => {
    const levies = buildLevySchedule(
      'wiener_netze',
      7,
      '2025-09-01',
      '2026-08-31',
      'mit_leistungsmessung',
      {
        category: 'gewerbe',
        postalCode: '1100',
      },
    )
    const withoutEag = {
      ...levies,
      periods: levies.periods.map((p) => ({ ...p, eagFoerderbeitragGrundpreisAmount: 0 })),
    }
    const run = (l: typeof levies) =>
      buildAnnualScenario({
        payload: payloadOf(...MUELDUER, peakyKw, demandTariff),
        horizonYears: 10,
        catalog: [CATALOG[0]!],
        fetchTariffPricing: pricingWith(gridRow('2026-01-01'), l),
      })

    const a = await run(levies)
    const b = await run(withoutEag)
    if (!a.ok || !b.ok) throw new Error('unerwartet abgelehnt')

    expect(a.value.ways.peakShavingEagEur).toBeGreaterThan(0)
    expect(b.value.ways.peakShavingEagEur).toBe(0)
    expect(a.value.ways.peakShavingSavingEur - b.value.ways.peakShavingSavingEur).toBeCloseTo(
      a.value.ways.peakShavingEagEur!,
      6,
    )
  })
})
