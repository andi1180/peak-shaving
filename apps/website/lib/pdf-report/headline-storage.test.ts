import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { formatEur, formatYears } from '@/lib/format'

import { buildAnnualScenarioChapter } from './annual-scenario'
import { buildReportInputFromRenderRequest, readRenderRequest } from './build-report-input'
import { buildReportContext } from './context'
import { buildDetailChapter } from './detail'
import { headlineStorageOf, taxEffectOf } from './headline-storage'
import { buildLoadControl } from './recommendation'
import { buildSummaryKpis, primaryEntryOf, recommendedEntryOf, summaryWaysOf } from './summary'
import type { PdfReportInput } from './types'
import { buildWaysChapter } from './ways'

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

  /* Die Verbraucher ausserhalb der Hauptzahl-Blöcke: a) Ladesteuerung, b) Kostenverlauf, c) Weg 4, d) Hinweisnotiz. */
  const consumers = (input: PdfReportInput) => ({
    loadControl: buildLoadControl(input.analysis, primaryEntryOf(input.analysis), input)!.amount!
      .value,
    detail: JSON.stringify(
      buildDetailChapter(input.analysis, { flowDay: null }, buildReportContext(input)).cost,
    ),
    ways: JSON.stringify(buildWaysChapter(input.analysis, input)!.statements),
    kpiNotes: buildSummaryKpis(input.analysis, summaryWaysOf(input.analysis)!).map((k) => k.note),
  })

  it('a–d zeigen im Jahr-Fall die Jahreszahl', () => {
    const c = consumers(muster(true))
    expect(c.loadControl).toBe(formatEur(965))
    expect(c.detail).toContain(`Der Schnittpunkt liegt bei ${formatYears(8550 / 2125)}`)
    expect(c.ways).toContain(`spart voraussichtlich ${formatEur(2125)} pro Jahr`)
    expect(c.ways).toContain('rechnet er sich damit.')
    // d) Jahres- wie lineare Netto-Ersparnis sind positiv: keine „rechnet sich nicht"-Notiz.
    expect(c.kpiNotes).toEqual([undefined, undefined])
  })

  it('a–d bleiben ohne Jahreskapitel bei der linearen Zahl, mit wie ohne PV-Angaben', () => {
    const input = muster(false)
    const c = consumers(input)
    expect(c).toEqual(consumers({ ...input, hasPv: undefined }))
    expect(buildLoadControl(input.analysis, primaryEntryOf(input.analysis))!.amount!.value).toBe(
      c.loadControl,
    )
    expect(c.loadControl).toBe(formatEur(1334))
    expect(c.detail).toContain(
      `Der Schnittpunkt liegt bei ${formatYears(8550 / 2494.804316978467)}`,
    )
    expect(c.ways).toContain(`spart voraussichtlich ${formatEur(2495)} pro Jahr`)
  })
})

describe('taxEffectOf', () => {
  /* Müldür-Live-Eingaben (vom Nutzer genannt): Investition 11.550 €, Ersparnis 2.125 €/Jahr, Horizont 10, AfA 10, IFB 22 %. */
  const analysisFor = (taxRatePercent: number) =>
    ({
      assumptions: {
        horizonYears: 10,
        tax: { taxRatePercent, investitionsfreibetragPercent: 22, depreciationYears: 10 },
      },
    }) as never
  const entry = {
    battery: { usableCapacityKwh: 1, pricePerKwh: 11550, inverterIncluded: true, requiresFoundation: false },
    subsidyAmount: 0,
    netInvestment: 11550,
    taxEffect: { ifbEffect: 1, annualDepreciationEffect: 1, amortizationYearsAfterTax: 1, netSavingOverHorizonAfterTax: 1 },
  } as never
  const annual = (saving: number) => ({ basis: 'annual', savingPerYearEur: saving }) as never

  it('rechnet mit der Jahres-Ersparnis der Überschrift (40 % und 23 %)', () => {
    const at40 = taxEffectOf(analysisFor(40), entry, annual(2125))!
    expect(at40.ifbEffect).toBeCloseTo(1016.4, 6)
    expect(at40.annualDepreciationEffect).toBeCloseTo(462, 6)
    expect(at40.amortizationYearsAfterTax).toBeCloseTo(6.06, 2)
    expect(at40.netSavingOverHorizonAfterTax).toBeCloseTo(6836, 0)

    const at23 = taxEffectOf(analysisFor(23), entry, annual(2125))!
    expect(at23.ifbEffect).toBeCloseTo(584.43, 2)
    expect(at23.annualDepreciationEffect).toBeCloseTo(265.65, 2)
    expect(at23.amortizationYearsAfterTax).toBeCloseTo(5.77, 2)
    expect(at23.netSavingOverHorizonAfterTax).toBeCloseTo(8053, 0)
  })

  it('gibt bei linearer Basis die Engine-Zahl unverändert zurück', () => {
    expect(taxEffectOf(analysisFor(40), entry, { basis: 'linear', savingPerYearEur: 9 } as never)).toBe(
      (entry as never as { taxEffect: unknown }).taxEffect,
    )
  })
})
