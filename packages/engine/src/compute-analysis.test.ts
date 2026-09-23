import { describe, expect, it } from 'vitest'
import { LEVIES_NONE } from 'shared'
import type { BatteryCandidate, MonthlyTariffComparison, TariffPricingInputs } from 'shared'

import { computeAnalysis, type CalculatorPayload } from './compute-analysis'
import type { DataQuality } from './parser'
import {
  basisWithPvLoadProfile,
  flatTariff,
  GATE_CATALOG,
  GATE_DYNAMIC_BATTERY,
  GATE_HORIZON_YEARS,
  inconsistentPvProfile,
  N_DAYS,
} from './fixtures/profiles'

/*
 * D3: die volle Kette durch `computeAnalysis` — einmal ohne und einmal mit Bestandsspeicher. Die
 * erwarteten Zahlen sind die des app-lokalen Vorgängers in `apps/website/lib/analysis.worker.ts`,
 * vor dem Umzug gemessen; sie halten das Verhalten fest, nicht nur die Struktur.
 */

const dataQuality: DataQuality = {
  coveredDays: 18,
  coveredMonths: 1,
  gapsInterpolated: 0,
  largestGapSlots: 0,
  warnings: ['Teiljahres-Datensatz'],
}

const EXISTING_BATTERY: BatteryCandidate = {
  id: 'bestand-19-2',
  name: 'Bestandsspeicher 19,2 kWh',
  manufacturer: 'Bestand',
  class: 'commercial',
  usableCapacityKwh: 19.2,
  maxPowerKw: 10,
  roundTripEfficiency: 0.88,
  pricePerKwh: 0,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

function buildPayload(withExisting: boolean, tariffPricing?: TariffPricingInputs): CalculatorPayload {
  return {
    ...(tariffPricing ? { tariffPricing } : {}),
    load: { fileName: 'baeckerei.csv', profile: basisWithPvLoadProfile(), dataQuality },
    tariff: flatTariff('annual_max'),
    financial: { fixedSubsidyEur: 2000, taxRatePercent: 25, depreciationYears: 10 },
    // Brutto-PV UNTER der gemessenen Einspeisung → die §3.1-Konsistenzwarnung muss an
    // `dataQuality.warnings` angehängt werden, ohne die Warnung des Parsers zu verdrängen.
    pv: { fileName: 'pv.csv', profile: inconsistentPvProfile(), dataQuality },
    ...(withExisting
      ? { existingBattery: { battery: EXISTING_BATTERY, efficiencyAssumed: true } }
      : {}),
  }
}

describe('computeAnalysis', () => {
  it('rechnet die volle Kette ohne Bestandsspeicher', () => {
    const result = computeAnalysis(buildPayload(false), GATE_HORIZON_YEARS, GATE_CATALOG)

    expect(result.current).toEqual({
      annualPeakKw: 70,
      monthlyPeaksKw: [0, 70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      billedKw: 70,
      leistungspreisCostPerYear: 7000,
    })
    expect(result.assumptions).toEqual({
      roundTripEfficiency: 0.9,
      horizonYears: GATE_HORIZON_YEARS,
      billingModel: 'annual_max',
      energyPriceCtPerKwh: 25,
      einspeiseverguetungCtPerKwh: 8,
    })
    expect(result.recommendation.batteryId).toBe('gate-dynamic-60-20')
    expect(result.perBattery[0]!.totalSavingPerYear).toBeCloseTo(3693.5990463256835, 9)
    expect(result.perBattery[0]!.netSavingOverHorizon).toBeCloseTo(23185.990463256836, 8)
    expect(result.existingBatteryAnalysis).toBeUndefined()
    // Parser-Warnung bleibt erhalten, PV-Konsistenz kommt hinzu — nicht ersetzt.
    expect(result.dataQuality.warnings[0]).toBe('Teiljahres-Datensatz')
    expect(result.dataQuality.warnings).toHaveLength(2)
  })

  it('rechnet den Bestandsspeicher daneben, ohne perBattery zu verändern', () => {
    const ohne = computeAnalysis(buildPayload(false), GATE_HORIZON_YEARS, GATE_CATALOG)
    const mit = computeAnalysis(buildPayload(true), GATE_HORIZON_YEARS, GATE_CATALOG)

    // Der Bestand ist kein Katalog-Kandidat: Empfehlung und Kaufoptionen bleiben unberührt.
    expect(mit.perBattery).toEqual(ohne.perBattery)
    expect(mit.recommendation).toEqual(ohne.recommendation)

    const existing = mit.existingBatteryAnalysis!
    expect(existing.entry.battery.id).toBe('bestand-19-2')
    expect(existing.entry.totalSavingPerYear).toBeCloseTo(1981.9952697753906, 9)
    expect(existing.addonScenarios).toHaveLength(GATE_CATALOG.length)
    // Ausgewiesen wird die DIFFERENZ zum Bestand, nicht die Bruttozahl der Kombination.
    expect(existing.addonScenarios[0]!.totalSavingPerYear).toBeCloseTo(-302.5528455329634, 9)
    expect(existing.addonScenarios[0]!.netSavingOverHorizon).toBeCloseTo(-16775.528455329633, 8)
  })
})

/*
 * D7: die dritte Reihe des Monatsvergleichs entsteht auch OHNE Bestandsspeicher — aus dem Dispatch
 * der empfohlenen Katalog-Batterie, und nur wenn die sich im Betrachtungszeitraum rechnet.
 */

const ONE_HOUR_MS = 60 * 60 * 1000

/**
 * Billiger Nachtstrom, teurer Tag. Ein flacher Preis machte die dritte Reihe zur zweiten und die
 * Prüfung damit blind: sie bliebe auch dann grün, wenn gar kein Dispatch eingeflossen wäre.
 */
function pricingInputs(): TariffPricingInputs {
  const t0 = Date.parse('2024-02-01T00:00:00Z')
  return {
    gridTariffRows: [
      {
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
      },
    ],
    spotPrices: {
      prices: Array.from({ length: N_DAYS * 24 }, (_, h) => ({
        tsStart: new Date(t0 + h * ONE_HOUR_MS).toISOString(),
        tsEnd: new Date(t0 + (h + 1) * ONE_HOUR_MS).toISOString(),
        ctPerKwh: h % 24 < 6 ? 2 : 20,
        priceBasis: 'net',
      })),
      complete: true,
      missingRanges: [],
    },
    levies: LEVIES_NONE,
  }
}

function comparisonOf(payload: CalculatorPayload): MonthlyTariffComparison | undefined {
  const status = computeAnalysis(payload, GATE_HORIZON_YEARS, GATE_CATALOG).tariffOptimization
  expect(status?.computable).toBe(true)
  return status?.computable === true ? status.monthlyComparison : undefined
}

describe('Monatsvergleich ohne Bestandsspeicher (D7)', () => {
  /** Der Lastgang deckt einen einzigen Kalendermonat ab (Februar 2024) — Index 1. */
  const FEB = 1

  it('rechnet die dritte Reihe aus der empfohlenen Katalog-Batterie', () => {
    const payload = buildPayload(false, pricingInputs())
    const result = computeAnalysis(payload, GATE_HORIZON_YEARS, GATE_CATALOG)

    // Die Voraussetzung, an der die neue Quelle hängt — sonst prüft der Rest den falschen Zweig.
    expect(result.existingBatteryAnalysis).toBeUndefined()
    expect(result.perBattery[0]!.netSavingOverHorizon).toBeGreaterThan(0)

    const comparison = comparisonOf(payload)!
    expect(comparison.coveredMonths).toBe(1)
    for (const series of [
      comparison.currentTariffEur,
      comparison.spotWithoutControlEur,
      comparison.spotWithBatteryEur,
    ]) {
      expect(series[FEB]).not.toBeNull()
    }
    // Der Dispatch ist tatsächlich eingeflossen: die dritte Reihe steht nicht auf der zweiten.
    expect(comparison.spotWithBatteryEur[FEB]).not.toBeCloseTo(
      comparison.spotWithoutControlEur[FEB]!,
      6,
    )
  })

  it('lässt die dritte Reihe weg, wenn sich das empfohlene Gerät nicht rechnet', () => {
    // Identische Physik, nur unbezahlbar — damit die Ersparnis dieselbe bleibt und allein
    // `netSavingOverHorizon` kippt.
    const unaffordable = [{ ...GATE_DYNAMIC_BATTERY, id: 'zu-teuer', pricePerKwh: 5000 }]
    const result = computeAnalysis(
      buildPayload(false, pricingInputs()),
      GATE_HORIZON_YEARS,
      unaffordable,
    )

    expect(result.perBattery[0]!.netSavingOverHorizon).toBeLessThan(0)
    // Der Hebel bleibt berechenbar — es fehlt der Dispatch, nicht der Preis. Der Unterschied ist
    // die Aussage: „nicht empfehlenswert" ist nicht „nicht berechenbar".
    expect(result.tariffOptimization).toEqual({ computable: true })
  })

  it('der Bestandsspeicher hat Vorrang vor der Katalog-Batterie', () => {
    const ohne = comparisonOf(buildPayload(false, pricingInputs()))!
    const mit = comparisonOf(buildPayload(true, pricingInputs()))!

    // Die ersten beiden Reihen hängen am rohen Lastgang und sind in beiden Läufen dieselben …
    expect(mit.currentTariffEur[FEB]).toBeCloseTo(ohne.currentTariffEur[FEB]!, 9)
    expect(mit.spotWithoutControlEur[FEB]).toBeCloseTo(ohne.spotWithoutControlEur[FEB]!, 9)
    // … die dritte nicht: 19,2 kWh Bestand gegen 60 kWh Katalog-Empfehlung.
    expect(mit.spotWithBatteryEur[FEB]).not.toBeCloseTo(ohne.spotWithBatteryEur[FEB]!, 3)
  })
})

/*
 * K3b-2 — der LEERE Katalog. Drei Fälle, weil sie verschiedene Zweige treffen; der vierte
 * („es rechnet sich keiner", voller Katalog) steht unverändert eine Beschreibung weiter oben.
 */
describe('Leerer Katalog (K3b-2)', () => {
  const FEB = 1

  it('wirft nicht, liefert recommendation null mit Grund und rechnet alles ohne Speicher weiter', () => {
    const result = computeAnalysis(buildPayload(false, pricingInputs()), GATE_HORIZON_YEARS, [])

    expect(result.recommendation).toBeNull()
    expect(result.noRecommendationReason).toBe('no_candidates')
    expect(result.perBattery).toEqual([])
    // Ist-Kosten und Spitzen sind Zahlen ohne Speicher — sie stehen unverändert.
    expect(result.current.billedKw).toBe(70)

    // Der Tarifvergleich ist da, aber ohne dritte Reihe.
    const status = result.tariffOptimization
    expect(status?.computable).toBe(true)
    const comparison = status?.computable === true ? status.monthlyComparison : undefined
    expect(comparison?.currentTariffEur[FEB]).not.toBeNull()
    expect(comparison?.spotWithoutControlEur[FEB]).not.toBeNull()
    expect(comparison?.spotWithBatteryEur).toBeUndefined()
  })

  it('ein Bestandsspeicher trägt die dritte Reihe auch ohne Katalog', () => {
    const leer = computeAnalysis(buildPayload(true, pricingInputs()), GATE_HORIZON_YEARS, [])
    const voll = computeAnalysis(
      buildPayload(true, pricingInputs()),
      GATE_HORIZON_YEARS,
      GATE_CATALOG,
    )

    expect(leer.recommendation).toBeNull()
    const leerComparison =
      leer.tariffOptimization?.computable === true
        ? leer.tariffOptimization.monthlyComparison
        : undefined
    const vollComparison =
      voll.tariffOptimization?.computable === true
        ? voll.tariffOptimization.monthlyComparison
        : undefined
    // Der Bestand hat Vorrang — seine Reihe ist in beiden Läufen dieselbe, Katalog hin oder her.
    expect(leerComparison?.spotWithBatteryEur?.[FEB]).toBeCloseTo(
      vollComparison!.spotWithBatteryEur![FEB]!,
      9,
    )
  })

  it('ohne Preisdaten bleibt es beim bisherigen Verhalten: kein Vergleich, aber auch kein Wurf', () => {
    const result = computeAnalysis(buildPayload(false), GATE_HORIZON_YEARS, [])

    expect(result.recommendation).toBeNull()
    expect(result.tariffOptimization).toBeUndefined()
    expect(result.assumptions.roundTripEfficiency).toBe(0.9)
  })
})
