import { readFileSync, writeFileSync } from 'node:fs'
import { env } from 'node:process'
import type { BatteryCandidate, TariffParams, TariffPricingInputs } from 'shared'
import { describe, expect, it } from 'vitest'

import { computeAnalysis, parseLoadProfile } from '../../src'

/**
 * Golden-File-Regressionstest, Referenzfall Bäckerei (CLAUDE.md, Regel 12).
 *
 * Alle Eingaben liegen eingefroren in `baeckerei/` (Herkunft und Begründung: `baeckerei/README.md`);
 * das vollständige `AnalysisResult` muss exakt `baeckerei/expected.json` gleichen. Neu erzeugen
 * nur bei einer BEWUSSTEN Rechenänderung: `pnpm golden:update`.
 */

const DIR = new URL('./baeckerei/', import.meta.url)
const EXPECTED = new URL('expected.json', DIR)
const MAX_DIFF_LINES = 40

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T
}

function runBaeckerei(): unknown {
  const csv = readFileSync(new URL('lastgang.csv', DIR), 'utf8')
  const parsed = parseLoadProfile({ content: csv, fileName: 'lastgang.csv', format: 'csv' })
  if (!parsed.ok) throw new Error('Lastgang der Bäckerei ist nicht lesbar')

  const { horizonYears, tariff } = readJson<{ horizonYears: number; tariff: TariffParams }>(
    'tariff.json',
  )
  const result = computeAnalysis(
    {
      tariff,
      pv: null,
      tariffPricing: readJson<TariffPricingInputs>('tariff-pricing.json'),
      load: { fileName: 'lastgang.csv', profile: parsed.profile, dataQuality: parsed.dataQuality },
    },
    horizonYears,
    readJson<BatteryCandidate[]>('battery-catalog.json'),
  )
  // Durch JSON normalisiert, damit Laufzeitwert und Datei denselben Vergleichsraum teilen
  // (undefined-Felder fallen weg); Zahlen überstehen den Rundlauf bit-genau.
  return JSON.parse(JSON.stringify(result))
}

/** Jede Abweichung als `Pfad: erwartet → erhalten`, damit ein roter Lauf sagt, WAS sich bewegt hat. */
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

describe('Golden File — Referenzfall Bäckerei', () => {
  it('computeAnalysis liefert exakt das eingefrorene AnalysisResult', () => {
    const actual = runBaeckerei()

    if (env.GOLDEN_UPDATE === '1') {
      writeFileSync(EXPECTED, JSON.stringify(actual, null, 1) + '\n')
      return
    }

    const lines = diff(JSON.parse(readFileSync(EXPECTED, 'utf8')), actual)
    const shown = lines.slice(0, MAX_DIFF_LINES).join('\n')
    const more =
      lines.length > MAX_DIFF_LINES ? `\n… und ${lines.length - MAX_DIFF_LINES} weitere` : ''
    expect(
      lines.length,
      `AnalysisResult weicht vom Golden File ab (${lines.length} Stellen, erwartet → erhalten):\n` +
        `${shown}${more}\n\nBewusste Änderung? \`pnpm golden:update\` und im PR begründen (Regel 12).`,
    ).toBe(0)
  }, 120_000)
})
