import { describe, expect, it } from 'vitest'
import type { BatteryCandidate } from 'shared'

import { computeAnalysis, type CalculatorPayload } from './compute-analysis'
import type { DataQuality } from './parser'
import {
  basisWithPvLoadProfile,
  flatTariff,
  GATE_CATALOG,
  GATE_HORIZON_YEARS,
  inconsistentPvProfile,
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

function buildPayload(withExisting: boolean): CalculatorPayload {
  return {
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
