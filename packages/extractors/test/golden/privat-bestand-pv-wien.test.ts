import { readFileSync, writeFileSync } from 'node:fs'
import { env } from 'node:process'
import { tariffWayCosts, type BatteryCandidate, type TariffPricingInputs } from 'shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TariffPricingRequest } from '../../src/analysis/run-from-draft'

vi.mock('server-only', () => ({}))

/**
 * Golden-File-Regressionstest, Referenzfall Privat mit Bestandsspeicher und PV, Wien (CLAUDE.md,
 * Regel 12).
 *
 * Deckt den Wizard-Pfad ab: `runAnalysisFromMeteringPointDraft` mit eingefrorenen Ports — Entwurf,
 * Lastgang-Datei, PVGIS-Reihe, Heim-Katalog und die Preis-Port-Antworten je Fenster. Herkunft und
 * Anonymisierung: `privat-bestand-pv-wien/README.md`. Neu erzeugen nur bei einer BEWUSSTEN
 * Rechenänderung: `pnpm golden:update`.
 */

const DIR = new URL('./privat-bestand-pv-wien/', import.meta.url)
const EXPECTED = new URL('expected.json', DIR)
const MAX_DIFF_LINES = 40
// Die obere Kante des Jahresfensters hängt an der Uhr (`today` in `run-from-draft.ts`).
const RUN_AT = new Date('2026-09-24T13:04:38.994Z')

const DOCUMENTS: Record<string, string> = {
  lastgang: 'lastgang.csv',
  'pv-erzeugung': 'pv-erzeugung.json',
}

function read(name: string): Buffer {
  return readFileSync(new URL(name, DIR))
}

function readJson<T>(name: string): T {
  return JSON.parse(read(name).toString('utf8')) as T
}

function windowKey(request: Pick<TariffPricingRequest, 'window' | 'intervalMinutes'>): string {
  return `${request.window.startIso}|${request.window.endIso}|${request.intervalMinutes}`
}

async function runCase(): Promise<unknown> {
  const { runAnalysisFromMeteringPointDraft } = await import('../../src/analysis/run-from-draft')

  const pricingByWindow = new Map(
    readJson<{ request: TariffPricingRequest; pricing: TariffPricingInputs }[]>(
      'tariff-pricing.json',
    ).map(({ request, pricing }) => [windowKey(request), pricing]),
  )

  const run = await runAnalysisFromMeteringPointDraft('zaehlpunkt', {
    batteryCatalog: readJson<BatteryCandidate[]>('battery-catalog.json'),
    readMeteringPoint: async () => ({
      draft: readJson<Record<string, unknown>>('draft.json'),
      sourceDocumentId: 'lastgang',
    }),
    readDocument: async (documentId) => {
      const filename = DOCUMENTS[documentId]
      if (filename === undefined) return null
      const bytes = read(filename)
      return {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        filename,
      }
    },
    fetchTariffPricing: async (request) => {
      const pricing = pricingByWindow.get(windowKey(request))
      // Ein neues Fenster heisst: die Rechnung fragt nach anderen Preisen als eingefroren.
      if (pricing === undefined)
        throw new Error(`Kein eingefrorener Preisstand für ${windowKey(request)}`)
      return pricing
    },
  })

  const comparison =
    run.result.tariffOptimization?.computable === true
      ? run.result.tariffOptimization.monthlyComparison
      : undefined

  // Durch JSON normalisiert, damit Laufzeitwert und Datei denselben Vergleichsraum teilen.
  return JSON.parse(
    JSON.stringify({
      result: run.result,
      tariffWays: comparison ? tariffWayCosts(comparison) : null,
      pvOutageMonths: run.pvOutageMonths,
      estimatedPvMetadata: run.estimatedPvMetadata ?? null,
    }),
  )
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

describe('Golden File — Referenzfall Privat, Bestandsspeicher + PV, Wien', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: RUN_AT })
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it('der Wizard-Lauf liefert exakt das eingefrorene Ergebnis', async () => {
    const actual = await runCase()

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
      `Ergebnis weicht vom Golden File ab (${lines.length} Stellen, erwartet → erhalten):\n` +
        `${shown}${more}\n\nBewusste Änderung? \`pnpm golden:update\` und im PR begründen (Regel 12).`,
    ).toBe(0)
  }, 120_000)
})
