import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildAnnualScenarioChapter } from './annual-scenario'
import { buildReportInputFromRenderRequest, readRenderRequest } from './build-report-input'
import { headlineStorageOf } from './headline-storage'
import { recommendedEntryOf } from './summary'
import type { PdfReportInput } from './types'

/* Die anonymisierte Render-Anfrage der Report-Snapshots (Gewerbe, Leistungspreis, 157 Tage, ohne PV). */
const FIXTURES = path.join(import.meta.dirname, '../../test/report-snapshots/fixtures')

function muster(withAnnualScenario: boolean): PdfReportInput {
  const row = JSON.parse(
    readFileSync(
      path.join(FIXTURES, 'gewerbe-leistungspreis-teiljahr-wien/render-request.json'),
      'utf8',
    ),
  )
  if (withAnnualScenario) {
    row.analysis_result.annualScenario = JSON.parse(
      readFileSync(
        path.join(FIXTURES, 'gewerbe-leistungspreis-teiljahr-jahr-wien/annual-scenario.json'),
        'utf8',
      ),
    )
  }
  const readout = readRenderRequest({ data: row, error: null })
  if (readout.status !== 'ok') throw new Error('Render-Anfrage nicht lesbar')
  return buildReportInputFromRenderRequest(readout.request, new Date('2026-09-30T18:37:04.946Z'))
}

describe('headlineStorageOf', () => {
  it('nimmt mit Jahreskapitel dessen Speicher-Anteil — dieselbe Zahl wie im Ringdiagramm', () => {
    const input = muster(true)
    const entry = recommendedEntryOf(input.analysis)!
    const headline = headlineStorageOf(input.analysis, entry, input)

    expect(headline.basis).toBe('annual')
    expect(headline.savingPerYearEur).toBe(2125)
    expect(headline.savingPerYearEur).toBe(buildAnnualScenarioChapter(input)!.donut!.storageEur)
    expect(headline.ladesteuerungEur + headline.spitzenEur).toBe(headline.savingPerYearEur)
    // Gleiche Investitionsbasis wie die Engine (8.550 €, ohne Förderung), nur die Jahres-Ersparnis im Nenner.
    expect(headline.amortizationYears).toBeCloseTo(entry.netInvestment / 2125, 10)
    expect(headline.amortizationYears.toFixed(1)).toBe('4.0')
    expect(headline.netSavingOverHorizonEur).toBe(2125 * 10 - 8550)
  })

  it('bleibt ohne Jahreskapitel exakt bei den Werten der Engine', () => {
    const input = muster(false)
    const entry = recommendedEntryOf(input.analysis)!
    const headline = headlineStorageOf(input.analysis, entry, input)

    expect(headline).toMatchObject({
      basis: 'linear',
      savingPerYearEur: entry.totalSavingPerYear,
      amortizationYears: entry.amortizationYears,
      netSavingOverHorizonEur: entry.netSavingOverHorizon,
      ladesteuerungEur: entry.energySavingPerYear,
    })
  })

  it('rechnet bei PV linear, auch wenn ein Jahresszenario vorliegt', () => {
    const input = { ...muster(true), hasPv: true }
    const entry = recommendedEntryOf(input.analysis)!

    expect(buildAnnualScenarioChapter(input)).toBeNull()
    expect(headlineStorageOf(input.analysis, entry, input)).toMatchObject({
      basis: 'linear',
      savingPerYearEur: entry.totalSavingPerYear,
      amortizationYears: entry.amortizationYears,
    })
  })
})
