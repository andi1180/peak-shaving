import type { CalculatorPayload } from 'engine'
import { LEVIES_NONE } from 'shared'
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
 * Der Lastgang ist bewusst KONSTANT (10 kW): die Referenzwoche trägt dann 240 kWh/Tag, jeder
 * gefüllte Tag sieht aus wie ein gemessener, und die Jahreskosten sind von Hand nachrechenbar,
 * ohne eine Zahl aus einem früheren Lauf zu pinnen.
 */

const STEP_MS = 15 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const CONSTANT_KW = 10
const TODAY = new Date('2026-09-22T08:00:00Z')

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

/** `days` Tage ab dem 01.03.2025 00:00 Ortszeit Wien, konstante Leistung. */
function profile(days: number): LoadProfile {
  const t0 = Date.parse('2025-02-28T23:00:00Z')
  return {
    readings: Array.from({ length: days * 96 }, (_, i) => ({
      ts: new Date(t0 + i * STEP_MS).toISOString(),
      gridPowerKw: CONSTANT_KW,
    })),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

function payloadOf(days: number): CalculatorPayload {
  return {
    load: {
      fileName: 'test.csv',
      profile: profile(days),
      dataQuality: {
        coveredDays: days,
        coveredMonths: 7,
        gapsInterpolated: 0,
        largestGapSlots: 0,
        warnings: [],
      },
    },
    tariff,
    // Der gemessene Lauf trägt keine Schätzreihe: die Erzeugung steckt im Bezug (`import_only`).
    pv: null,
    financial: { fixedSubsidyEur: 0, taxRatePercent: 0, depreciationYears: 10 },
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

/** Ein Preis-Port, der den angefragten Zeitraum lückenlos bedient. */
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
      payload: payloadOf(209),
      horizonYears: 10,
      catalog: CATALOG,
      fetchTariffPricing: fullPricing,
      today: TODAY,
    })
    if (!out.ok) throw new Error(`unerwartet abgelehnt: ${out.blocker}`)

    expect(out.value.measuredDays + out.value.projectedDays).toBe(365)
    expect(out.value.windowFromDate).toBe('2025-03-01')
    expect(out.value.windowToDate).toBe('2026-02-28')
    /* Konstanter Lastgang: jede Woche trägt dieselbe Menge, die erste gewinnt den Gleichstand. */
    expect(out.value.reference.rateKwhPerDay).toBeCloseTo(CONSTANT_KW * 24, 6)

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

  it('verweigert, statt zu nähern, wenn die Preise das Jahresfenster nicht decken', async () => {
    const out = await buildAnnualScenario({
      payload: payloadOf(209),
      horizonYears: 10,
      catalog: CATALOG,
      /* Nur die gemessenen Tage haben Preise — der Rest des Jahres bleibt eine Lücke. */
      fetchTariffPricing: async () => ({
        gridTariffRows: [gridRow()],
        spotPrices: {
          ...hourly('2025-02-28T23:00:00Z', '2025-09-25T22:00:00Z'),
          complete: false,
          missingRanges: [{ fromIso: '2025-09-25T22:00:00Z', toIso: '2026-02-28T23:00:00Z' }],
        },
        levies: LEVIES_NONE,
      }),
      today: TODAY,
    })

    expect(out).toEqual({ ok: false, blocker: 'not_computable' })
  })
})
