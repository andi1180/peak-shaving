import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { formatEur } from '@/lib/format'

import { buildReportInputFromRenderRequest, readRenderRequest } from './build-report-input'
import {
  buildCandidateTable,
  buildComparisonChapter,
  comparisonChartPlan,
  comparisonSelection,
  POWER_LIMITED_MARK,
  POWER_LIMITED_NOTE,
} from './comparison'
import { buildReportContext } from './context'
import { headlineStorageOf } from './headline-storage'
import { recommendedEntryOf } from './summary'
import type { PdfReportInput } from './types'

/* Die Render-Anfrage der Report-Snapshots; `overlay` ersetzt bzw. ergänzt das Ergebnis. */
const FIXTURES = path.join(import.meta.dirname, '../../test/report-snapshots/fixtures')
const read = (file: string) => JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8'))

function input(overlay: 'jahresreihung' | 'vor-fassung-17'): PdfReportInput {
  const row = read('gewerbe-leistungspreis-teiljahr-wien/render-request.json')
  if (overlay === 'jahresreihung') {
    row.analysis_result = read('gewerbe-leistungspreis-teiljahr-jahr-wien/analysis-result.json')
  } else {
    row.analysis_result.annualScenario = read(
      'gewerbe-leistungspreis-teiljahr-jahr-wien/annual-scenario.json',
    )
  }
  const readout = readRenderRequest({ data: row, error: null })
  if (readout.status !== 'ok') throw new Error('Render-Anfrage nicht lesbar')
  return buildReportInputFromRenderRequest(readout.request, new Date('2026-09-30T18:37:04.946Z'))
}

const DYNESS_30 = 'Dyness Stack 100 30,72 kWh mit Solinteg MHT-15K-40'
const RETROFIT_S = 'Kostal & Dyness Retrofit S'

describe('E2 — eine Jahresbasis für Empfehlung und „Speichergrösse und Gerätewahl"', () => {
  it('Jahresreihung: Empfehlung ist Rang 1 des Jahreslaufs, Netto 13.299 gegen 12.700 der Retrofit S', () => {
    const i = input('jahresreihung')
    const entry = recommendedEntryOf(i.analysis)!
    const headline = headlineStorageOf(i.analysis, entry, i)
    const retrofit = comparisonSelection(i.analysis).considered.find(
      (c) => c.battery.name === RETROFIT_S,
    )!

    expect(entry.battery.name).toBe(DYNESS_30)
    expect(headline.basis).toBe('annual')
    expect(headline.netSavingOverHorizonEur).toBe(13_299)
    expect(retrofit.netSavingOverHorizon).toBe(12_700)
  })

  it('Kurve, Tabelle und Kapitel tragen je Gerät dieselben Jahreswerte, die Tabelle nach Jahres-Netto gereiht', () => {
    const i = input('jahresreihung')
    const chapter = buildComparisonChapter(i.analysis, buildReportContext(i), i.hasPv, i)
    const plan = comparisonChartPlan(i.analysis)!
    const { shown, reference } = comparisonSelection(i.analysis)
    const headline = headlineStorageOf(i.analysis, recommendedEntryOf(i.analysis)!, i)

    expect(plan.highlight.netSavingOverHorizon).toBe(headline.netSavingOverHorizonEur)
    expect(reference!.netSavingOverHorizon).toBe(headline.netSavingOverHorizonEur)
    expect(chapter.figure!.caption).toContain(`(29,2 kWh, ${formatEur(13_299)} über 10 Jahre)`)
    for (const c of shown) {
      expect(plan.points.find((p) => p.battery.id === c.battery.id)!.netSavingOverHorizon).toBe(
        c.netSavingOverHorizon,
      )
    }
    const nets = shown.map((c) => c.netSavingOverHorizon)
    expect(nets).toEqual([...nets].sort((a, b) => b - a))
    expect(chapter.table!.rows[0]!.cells[0]).toBe(RETROFIT_S)
    expect(chapter.table!.rows[0]!.cells).toContain(formatEur(12_700))
    expect(chapter.tableFootnote).toBeNull()
  })

  it('ein Ergebnis vor Fassung 17 (Jahreskapitel ohne Jahresreihung) bleibt linear, mit Hinweiszeile', () => {
    const i = input('vor-fassung-17')
    const chapter = buildComparisonChapter(i.analysis, buildReportContext(i), i.hasPv, i)

    expect(recommendedEntryOf(i.analysis)!.battery.name).toBe(RETROFIT_S)
    expect(comparisonSelection(i.analysis).shown[0]!.netSavingOverHorizon).toBe(
      i.analysis.perBattery.find((p) => p.battery.name === DYNESS_30)!.netSavingOverHorizon,
    )
    expect(chapter.tableFootnote).toContain('einheitlich linear hochgerechnet')
  })
})

describe('PR G — Markierung „Leistung begrenzt" je Gerät in der Vergleichstabelle', () => {
  const OLD_HINT = 'zu geringe Leistung für alle Spitzen'

  it('Jahresfall: alle drei Tabellengeräte tragen die Markierung, der Absatz erklärt sie', () => {
    const i = input('jahresreihung')
    const chapter = buildComparisonChapter(i.analysis, buildReportContext(i), i.hasPv, i)
    const body = JSON.stringify(chapter.statement.body)

    expect(chapter.table!.rows.map((r) => [r.cells[0], r.note])).toEqual([
      [RETROFIT_S, POWER_LIMITED_MARK],
      ['Dyness Stack 100 40,96 kWh mit Solinteg MHT-20K-40', POWER_LIMITED_MARK],
      ['GoodWe Lynx D 30 kWh mit GoodWe ET - GW29.9K-ET', POWER_LIMITED_MARK],
    ])
    expect(body).toContain(JSON.stringify(POWER_LIMITED_NOTE).slice(1, -1))
    expect(body).not.toContain(OLD_HINT)
  })

  it('ein Gerät ohne Flag (Retrofit L) trägt keine Markierung', () => {
    const i = input('jahresreihung')
    const retrofitL = i.analysis.perBattery.find(
      (p) => p.battery.name === 'Kostal & Dyness Retrofit L',
    )!
    expect(retrofitL.notices.some((n) => n.code === 'power_limited')).toBe(false)

    const table = buildCandidateTable([retrofitL], 10, null, true)
    expect(table.rows[0]).not.toHaveProperty('note')
  })

  it('Ergebnis vor Fassung 17: keine Markierung, der bisherige Satz bleibt', () => {
    const i = input('vor-fassung-17')
    const chapter = buildComparisonChapter(i.analysis, buildReportContext(i), i.hasPv, i)

    expect(chapter.table!.rows.every((r) => r.note === undefined)).toBe(true)
    expect(JSON.stringify(chapter.statement.body)).toContain(OLD_HINT)
  })
})
