import { readFileSync, writeFileSync } from 'node:fs'
import { env } from 'node:process'
import type {
  BatteryCandidate,
  ComparisonSupplierTariff,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { computeAnalysis, parseLoadProfile } from '../../src'

/**
 * Golden File — Gewerbe mit unbekanntem eigenem Liefertarif (Regel 12). Herkunft der Eingaben:
 * `gewerbe-tarif-unbekannt/README.md`; Lastgang, Preisdaten und Katalog sind die des Bäckerei-Falls.
 */

const DIR = new URL('./gewerbe-tarif-unbekannt/', import.meta.url)
const BAECKEREI = new URL('./baeckerei/', import.meta.url)
const MAX_DIFF_LINES = 40

function readJson<T>(base: URL, name: string): T {
  return JSON.parse(readFileSync(new URL(name, base), 'utf8')) as T
}

function run(comparisonSupplier?: ComparisonSupplierTariff): unknown {
  const csv = readFileSync(new URL('lastgang.csv', BAECKEREI), 'utf8')
  const parsed = parseLoadProfile({ content: csv, fileName: 'lastgang.csv', format: 'csv' })
  if (!parsed.ok) throw new Error('Lastgang ist nicht lesbar')

  const { horizonYears, tariff } = readJson<{ horizonYears: number; tariff: TariffParams }>(
    DIR,
    'tariff.json',
  )
  const result = computeAnalysis(
    {
      tariff: comparisonSupplier ? { ...tariff, comparisonSupplier } : tariff,
      pv: null,
      tariffPricing: readJson<TariffPricingInputs>(BAECKEREI, 'tariff-pricing.json'),
      load: { fileName: 'lastgang.csv', profile: parsed.profile, dataQuality: parsed.dataQuality },
    },
    horizonYears,
    readJson<BatteryCandidate[]>(BAECKEREI, 'battery-catalog.json'),
  )
  return JSON.parse(JSON.stringify(result))
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

describe('Golden File — Gewerbe, eigener Liefertarif unbekannt', () => {
  it('ohne Vergleichstarif: kein „Ihr Tarif heute", nur absolute aWATTar-Kosten', () => {
    const actual = run()
    expectGolden('expected.json', actual)
    const status = (
      actual as { tariffOptimization: { monthlyComparison: Record<string, unknown> } }
    ).tariffOptimization
    expect(status.monthlyComparison.currentTariffEur).toBeNull()
    expect(status.monthlyComparison.comparisonTariffEur).toBeUndefined()
  }, 120_000)

  it('mit Vergleichstarif: er steht als eigener Weg da', () => {
    const actual = run(readJson<ComparisonSupplierTariff>(DIR, 'comparison-supplier.json'))
    expectGolden('expected-mit-vergleichstarif.json', actual)
    const status = (
      actual as { tariffOptimization: { monthlyComparison: Record<string, unknown> } }
    ).tariffOptimization
    expect(status.monthlyComparison.currentTariffEur).toBeNull()
    expect(status.monthlyComparison.comparisonTariffEur).toBeInstanceOf(Array)
  }, 120_000)
})
