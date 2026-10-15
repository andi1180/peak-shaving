import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { computeAnalysis } from 'engine'
import type {
  AnalysisResult,
  BatteryCandidate,
  GridTariffRowInput,
  LevySchedule,
  LoadProfile,
  TariffParams,
} from 'shared'
import { describe, expect, it } from 'vitest'

import {
  buildLoadProfile,
  buildSpotPrices,
  DAYS,
  SPIKE_KW,
  START_UTC_MS,
} from '../../../../../../packages/engine/test/golden/de-benutzungsdauer-knick/fixture'

/**
 * Generator der beiden DE-Render-Anfragen (Baseline Schritt 10). Aufruf:
 *   pnpm --filter website exec vitest run --config test/report-snapshots/vitest.de-baseline.config.ts
 * Eingaben aus dem Engine-Golden `de-benutzungsdauer-knick`, dazu ein dynamischer Tarif.
 */

const HERE = import.meta.dirname
const GOLDEN = path.resolve(
  HERE,
  '../../../../../../packages/engine/test/golden/de-benutzungsdauer-knick',
)

const DYNAMIC_TARIFF = { supplier: 'Spot-Test', markupCtPerKwh: 1.2, baseFeeEurPerMonth: 9.9 }

function readGolden<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(GOLDEN, name), 'utf8')) as T
}

/** Fall B: flache Grundlast 20 kW, dieselbe 49-kW-Spitze wie das Golden (≈ 3.576 h/a, Ist in Stufe 2). */
function buildFlatLoadProfile(): LoadProfile {
  const golden = buildLoadProfile()
  return {
    ...golden,
    readings: golden.readings.map((r) => ({
      ...r,
      gridPowerKw: r.gridPowerKw === SPIKE_KW ? SPIKE_KW : 20,
    })),
  }
}

function analyze(profile: LoadProfile): AnalysisResult {
  const { horizonYears, tariff } = readGolden<{ horizonYears: number; tariff: TariffParams }>(
    'tariff.json',
  )
  const gridTariffRows = readGolden<GridTariffRowInput[]>('grid-tariff-rows.json')
  const result = computeAnalysis(
    {
      tariff,
      pv: null,
      tariffPricing: {
        gridTariffRows,
        spotPrices: buildSpotPrices(),
        levies: readGolden<LevySchedule>('levies.json'),
        dynamicTariff: DYNAMIC_TARIFF,
      },
      load: {
        fileName: 'synthetisch',
        profile,
        dataQuality: {
          coveredDays: DAYS,
          coveredMonths: 12,
          gapsInterpolated: 0,
          largestGapSlots: 0,
          warnings: [],
        },
      },
    },
    horizonYears,
    readGolden<BatteryCandidate[]>('battery-catalog.json'),
  )
  return JSON.parse(JSON.stringify(result)) as AnalysisResult
}

/** Die Übergabe so, wie `report-render-actions.ts` sie schreibt (Gewerbe, netto, ohne Rechnung, ohne PV). */
function writeRenderRequest(dir: string, profile: LoadProfile, result: AnalysisResult): void {
  const gridTariffRows = readGolden<GridTariffRowInput[]>('grid-tariff-rows.json')
  const row = {
    analysis_result: result,
    load_profile: profile,
    report_input_meta: {
      customerLabel: 'Referenzfall DE Gewerbe',
      netzbetreiber: 'netz_test',
      netzbetreiberName: 'Netz Test GmbH',
      netzebene: 7,
      supplierBaseFeeEurPerMonth: null,
      hasPv: false,
      pvStage: null,
      pvPeakPowerKwp: null,
      pvOutageMonths: [],
      gridTariffValidFrom: [...new Set(gridTariffRows.map((r) => r.validFrom))].sort(),
      invoicePeriods: [],
      batteryCatalogMeta: {},
      priceDisplay: 'net',
    },
  }
  writeFileSync(path.join(HERE, dir, 'render-request.json'), JSON.stringify(row) + '\n')
}

describe('DE-Baseline: Render-Anfragen erzeugen', () => {
  it('Fall A (Golden-Lastgang): Ist in Stufe 1', () => {
    const profile = buildLoadProfile()
    expect(profile.readings[0]!.ts).toBe(new Date(START_UTC_MS).toISOString())
    const result = analyze(profile)
    expect(result.current.networkTier?.tier).toBe(1)
    expect(result.tariffOptimization?.computable).toBe(true)
    writeRenderRequest('stufe1', profile, result)
  }, 300_000)

  it('Fall B (flache Grundlast 20 kW): Ist in Stufe 2, N(Ist) ≤ 0', () => {
    const profile = buildFlatLoadProfile()
    const result = analyze(profile)
    expect(result.current.networkTier?.tier).toBe(2)
    expect(result.current.leistungspreisCostPerYear).toBeLessThanOrEqual(0)
    expect(result.tariffOptimization?.computable).toBe(true)
    writeRenderRequest('stufe2', profile, result)
  }, 300_000)
})
