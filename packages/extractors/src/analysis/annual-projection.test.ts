import { estimateAnnualConsumption } from 'engine'
import { LEVIES_NONE } from 'shared'
import type {
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { projectAnnualTariffComparison } from './annual-projection'
import type { SpotPriceRangeReader } from './gap-market-prices'

/**
 * D6 Teil 2b — die Jahres-Kosten-Hochrechnung.
 *
 * Der Lastgang ist bewusst KONSTANT (10 kW über alle Viertelstunden): die Referenzrate ist dann
 * 240 kWh/Tag, der synthetische Lückentag trägt dieselbe Leistung wie ein echter, und die
 * Tageskosten der beiden Ausschnitte müssen deshalb übereinstimmen. Das macht die Hochrechnung von
 * Hand nachrechenbar, ohne eine Zahl aus einem früheren Lauf zu pinnen.
 */

const STEP_MS = 15 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const CONSTANT_KW = 10

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

function fullDayRow(
  validFrom: string,
  validUntil: string | null,
  ctPerKwh: number,
): GridTariffRowInput {
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
        ctPerKwh,
      },
    ],
  }
}

/** `days` Tage ab dem 01.01.2025 00:00 Ortszeit Wien (= 31.12.2024 23:00Z), konstante Leistung. */
function profile(days: number): LoadProfile {
  const t0 = Date.parse('2024-12-31T23:00:00Z')
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

/** Ein Bestandsleser, der den angefragten Zeitraum lückenlos zum festen Preis bedient. */
function storedPrices(ctPerKwh: number): SpotPriceRangeReader {
  return async (fromIso, toIso) => hourly(Date.parse(fromIso), Date.parse(toIso), ctPerKwh, true)
}

function hourly(
  fromMs: number,
  toMs: number,
  ctPerKwh: number,
  complete: boolean,
): SpotPriceSeriesInput {
  const prices = []
  for (let ms = fromMs; ms < toMs; ms += HOUR_MS) {
    prices.push({
      tsStart: new Date(ms).toISOString(),
      tsEnd: new Date(Math.min(ms + HOUR_MS, toMs)).toISOString(),
      ctPerKwh,
      priceBasis: 'net',
    })
  }
  return {
    prices,
    complete,
    missingRanges: complete ? [] : [{ fromIso: new Date(toMs).toISOString(), toIso: new Date(toMs).toISOString() }],
  }
}

/** Kein Nachlade-Fenster nötig, solange der Bestandsleser vollständig meldet. */
const noFetch = async () => []

async function project(loadProfile: LoadProfile, pricing: TariffPricingInputs, read = storedPrices(10)) {
  return projectAnnualTariffComparison({
    loadProfile,
    tariffParams: tariff,
    pricing,
    consumption: estimateAnnualConsumption(loadProfile),
    readSpotPrices: read,
    fetchMarketWindow: noFetch,
  })
}

describe('projectAnnualTariffComparison', () => {
  it('rechnet einen 209-Tage-Lastgang auf 365 Tage hoch — beide Zeilen wachsen, Tageskosten bleiben gleich', async () => {
    const load = profile(209)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [fullDayRow('2024-01-01', null, 6.98)],
      spotPrices: hourly(Date.parse('2024-12-31T23:00:00Z'), Date.parse('2025-07-29T00:00:00Z'), 10, true),
      levies: LEVIES_NONE,
    }
    const before = structuredClone(pricing)

    const out = (await project(load, pricing))!
    expect(out).toBeDefined()
    /*
     * 210 statt 209 belegte Kalendertage: die 209 × 96 Viertelstunden sind gleichmässig in UTC
     * gesetzt, und die Sommerzeitumstellung am 30.03. verschiebt die Wanduhr um eine Stunde nach
     * vorne — der Lastgang endet dadurch am 29.07. um 01:00 Ortszeit und berührt diesen Tag noch.
     * Genau die Unterscheidung, die `projectedDays` beschreibt; die Summe bleibt das volle Jahr.
     */
    expect(out.measuredDays).toBe(210)
    expect(out.projectedDays).toBe(155)
    expect(out.measuredDays + out.projectedDays).toBe(365)
    expect(out.windowFromDate).toBe('2025-01-01')
    expect(out.windowToDate).toBe('2025-12-31')
    expect(out.consumption.method).toBe('winter_reference')
    expect(out.consumption.referenceRateKwhPerDay).toBeCloseTo(CONSTANT_KW * 24, 6)

    for (const row of [out.currentTariffEur, out.spotWithoutControlEur]) {
      expect(row.totalEur).toBeGreaterThan(row.measuredEur)
      expect(row.totalEur).toBeCloseTo(row.measuredEur + row.projectedEur, 6)
      // Gleiche Leistung, gleicher Preis → die Tageskosten der beiden Ausschnitte stimmen überein
      // (Rest: die Grundgebühr-Anteile hängen an den unterschiedlich langen Monaten).
      expect(row.projectedEur / 155).toBeCloseTo(row.measuredEur / 209, 0)
    }

    // Delta 15 Regel C: die bestehende Preis-Eingabe bleibt unangetastet.
    expect(pricing).toEqual(before)
  })

  it('volles Jahr: nichts wird hochgerechnet, der gemessene Wert steht unverändert', async () => {
    const load = profile(365)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [fullDayRow('2024-01-01', null, 6.98)],
      spotPrices: hourly(Date.parse('2024-12-31T23:00:00Z'), Date.parse('2025-12-31T23:00:00Z'), 10, true),
      levies: LEVIES_NONE,
    }

    const out = (await project(load, pricing))!
    expect(out.projectedDays).toBe(0)
    expect(out.consumption.method).toBe('full_period')
    expect(out.consumption.missingDays).toBe(0)
    expect(out.currentTariffEur.projectedEur).toBe(0)
    expect(out.currentTariffEur.totalEur).toBe(out.currentTariffEur.measuredEur)
    expect(out.marketPrices.hoursByOrigin).toEqual({ database: 0, fetched: 0, assumed: 0 })
  })

  it('genäherte Marktpreise bleiben im Rückgabewert erkennbar', async () => {
    const load = profile(209)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [fullDayRow('2024-01-01', null, 6.98)],
      spotPrices: hourly(Date.parse('2024-12-31T23:00:00Z'), Date.parse('2025-07-29T00:00:00Z'), 10, true),
      levies: LEVIES_NONE,
    }
    // Der Bestand endet nach 30 Tagen der Lücke; nachladen lässt sich nichts → Näherung.
    const partial: SpotPriceRangeReader = async (fromIso, toIso) => {
      const fromMs = Date.parse(fromIso)
      const realUntil = Math.min(fromMs + 30 * 24 * HOUR_MS, Date.parse(toIso))
      const series = hourly(fromMs, realUntil, 10, true)
      return {
        prices: series.prices,
        complete: false,
        missingRanges: [{ fromIso: new Date(realUntil).toISOString(), toIso }],
      }
    }

    const out = (await project(load, pricing, partial))!
    expect(out.marketPrices.hoursByOrigin.database).toBeCloseTo(30 * 24, 6)
    expect(out.marketPrices.hoursByOrigin.assumed).toBeCloseTo(125 * 24, 6)
    expect(out.marketPrices.coverage.some((c) => c.origin === 'assumed' && c.assumption)).toBe(true)
    expect(out.marketPrices.missingRanges).toEqual([])
  })

  it('ein Preisblattwechsel innerhalb der Lücke schlägt sichtbar durch', async () => {
    const load = profile(209)
    const spot = hourly(Date.parse('2024-12-31T23:00:00Z'), Date.parse('2025-07-29T00:00:00Z'), 10, true)
    // Ab 01.10.2025 ein deutlich teureres Preisblatt — es liegt mitten im Lückenzeitraum.
    const staged: TariffPricingInputs = {
      gridTariffRows: [
        fullDayRow('2024-01-01', '2025-09-30', 6.98),
        fullDayRow('2025-10-01', null, 20),
      ],
      spotPrices: spot,
      levies: LEVIES_NONE,
    }
    // Die naive Lesart „der Stand des ersten Lückentages gilt für alle 156".
    const naive: TariffPricingInputs = {
      gridTariffRows: [fullDayRow('2024-01-01', null, 6.98)],
      spotPrices: spot,
      levies: LEVIES_NONE,
    }

    const withChange = (await project(load, staged))!
    const withoutChange = (await project(load, naive))!

    expect(withChange.currentTariffEur.measuredEur).toBeCloseTo(
      withoutChange.currentTariffEur.measuredEur,
      6,
    )
    // 92 Tage (Oktober–Dezember) × 240 kWh × 13,02 ct ≈ 2.875 € Unterschied.
    expect(
      withChange.currentTariffEur.projectedEur - withoutChange.currentTariffEur.projectedEur,
    ).toBeCloseTo(92 * 240 * (20 - 6.98) / 100, 0)
  })
})
