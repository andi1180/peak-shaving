import { readFileSync } from 'node:fs'
import type {
  AnalysisResult,
  BatteryCandidate,
  GridTariffRowInput,
  LevySchedule,
  TariffParams,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { computeAnalysis, mapDraftToTariffParams } from '../src'
import { buildLoadProfile, buildSpotPrices, DAYS } from './golden/de-benutzungsdauer-knick/fixture'

/**
 * Gate: bei Benutzungsdauer-Stufen ist der Leistungspreis des Entwurfs wirkungslos — ein leerer
 * Leistungspreis mit `hasDemandTiers` rechnet bitgleich zum Golden File mit gesetztem.
 */

const DIR = new URL('./golden/de-benutzungsdauer-knick/', import.meta.url)

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T
}

function run(tariff: TariffParams): AnalysisResult {
  const result = computeAnalysis(
    {
      tariff,
      pv: null,
      tariffPricing: {
        gridTariffRows: readJson<GridTariffRowInput[]>('grid-tariff-rows.json'),
        spotPrices: buildSpotPrices(),
        levies: readJson<LevySchedule>('levies.json'),
      },
      load: {
        fileName: 'synthetisch',
        profile: buildLoadProfile(),
        dataQuality: {
          coveredDays: DAYS,
          coveredMonths: 12,
          gapsInterpolated: 0,
          largestGapSlots: 0,
          warnings: [],
        },
      },
    },
    readJson<{ horizonYears: number }>('tariff.json').horizonYears,
    readJson<BatteryCandidate[]>('battery-catalog.json'),
  )
  return JSON.parse(JSON.stringify(result)) as AnalysisResult
}

describe('Golden-Gate — Leistungspreis bei Benutzungsdauer-Stufen nicht Pflicht', () => {
  it('Leistungspreis leer + hasDemandTiers: bitgleich zum Golden File mit gesetztem', () => {
    const { tariff } = readJson<{ tariff: Record<string, unknown> }>('tariff.json')
    const { leistungspreisEurPerKwYear: _weg, ...ohneLeistungspreis } = tariff
    const mapped = mapDraftToTariffParams(ohneLeistungspreis, { hasDemandTiers: true })
    expect(mapped.leistungspreisEurPerKwYear).toBe(0)
    expect(run(mapped)).toEqual(readJson<AnalysisResult>('expected.json'))
  }, 120_000)
})
