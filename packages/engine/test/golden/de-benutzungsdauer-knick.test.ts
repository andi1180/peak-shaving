import { readFileSync, writeFileSync } from 'node:fs'
import { env } from 'node:process'
import type {
  AnalysisResult,
  BatteryCandidate,
  GridTariffRowInput,
  LevySchedule,
  TariffParams,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { computeAnalysis } from '../../src'
import { buildLoadProfile, buildSpotPrices, DAYS } from './de-benutzungsdauer-knick/fixture'

/**
 * Golden File — synthetischer DE-Fall mit Benutzungsdauer-Stufen (Schritt 8b). Eingaben und von Hand
 * nachgerechnete Erwartungswerte: `de-benutzungsdauer-knick/README.md`. Die Variante „ohne Stufen"
 * ist vor dem Einbau eingefroren und muss danach bitgleich bleiben.
 */

const DIR = new URL('./de-benutzungsdauer-knick/', import.meta.url)
const MAX_DIFF_LINES = 40

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T
}

function run(rowsFile: string): AnalysisResult {
  const { horizonYears, tariff } = readJson<{ horizonYears: number; tariff: TariffParams }>(
    'tariff.json',
  )
  const result = computeAnalysis(
    {
      tariff,
      pv: null,
      tariffPricing: {
        gridTariffRows: readJson<GridTariffRowInput[]>(rowsFile),
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
    horizonYears,
    readJson<BatteryCandidate[]>('battery-catalog.json'),
  )
  return JSON.parse(JSON.stringify(result)) as AnalysisResult
}

function diff(expected: unknown, actual: unknown, path = '$', out: string[] = []): string[] {
  if (Object.is(expected, actual)) return out
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  if (!isObj(expected) || !isObj(actual) || Array.isArray(expected) !== Array.isArray(actual)) {
    out.push(`${path}: ${JSON.stringify(expected)} → ${JSON.stringify(actual)}`)
    return out
  }
  if (Array.isArray(expected) && Array.isArray(actual) && expected.length !== actual.length) {
    out.push(`${path}.length: ${expected.length} → ${actual.length}`)
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
  for (const key of keys) {
    const child = Array.isArray(expected) ? `${path}[${key}]` : `${path}.${key}`
    if (!(key in expected)) out.push(`${child}: (fehlt) → ${JSON.stringify(actual[key])}`)
    else if (!(key in actual)) out.push(`${child}: ${JSON.stringify(expected[key])} → (fehlt)`)
    else diff(expected[key], actual[key], child, out)
  }
  return out
}

function expectGolden(fileName: string, actual: unknown): void {
  const file = new URL(fileName, DIR)
  if (env.GOLDEN_UPDATE === '1') {
    writeFileSync(file, JSON.stringify(actual, null, 1) + '\n')
    return
  }
  const lines = diff(JSON.parse(readFileSync(file, 'utf8')), actual)
  const shown = lines.slice(0, MAX_DIFF_LINES).join('\n')
  const more =
    lines.length > MAX_DIFF_LINES ? `\n… und ${lines.length - MAX_DIFF_LINES} weitere` : ''
  expect(
    lines.length,
    `AnalysisResult weicht vom Golden File ${fileName} ab (${lines.length} Stellen):\n` +
      `${shown}${more}\n\nBewusste Änderung? \`pnpm golden:update\` und im PR begründen (Regel 12).`,
  ).toBe(0)
}

describe('Golden File — DE, Benutzungsdauer-Stufen', () => {
  it('ohne Stufenfelder (eine Zeile, Skalar-LP): bitgleich zum Stand vor dem Einbau', () => {
    expectGolden('expected-ohne-stufen.json', run('grid-tariff-rows-ohne-stufen.json'))
  }, 120_000)

  it('mit Stufen: Ist in Stufe 1, ein Gerät bleibt in Stufe 1, eines wechselt in Stufe 2', () => {
    const actual = run('grid-tariff-rows.json')
    expectGolden('expected.json', actual)
  }, 120_000)
})
