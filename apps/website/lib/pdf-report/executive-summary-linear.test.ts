import { describe, expect, it } from 'vitest'

import { muster } from '@/test/executive-summary-cases'
import { buildExecutiveSummary } from './executive-summary'
import { executiveSummaryCopy } from './executive-summary-copy'
import { summaryWaysOf } from './summary'
import type { PdfReportInput } from './types'

/** Teiljahr-Fall ohne Jahresszenario, auf `days` Messtage gesetzt, wahlweise als PV-Lastgang. */
function partialYear(days: number, pv: boolean): PdfReportInput {
  const input = structuredClone(muster(false))
  input.analysis.dataQuality.coveredDays = days
  if (pv) input.loadProfile.source = 'net_signed'
  return input
}

/** Die gemessenen Wege in der Reihenfolge der Vorderseite (heute, aWATTar, aWATTar mit Speicher). */
function measuredWayCosts(input: PdfReportInput): number[] {
  const measured = summaryWaysOf(input.analysis)!
  const cost = (id: string) => measured.ways.find((way) => way.id === id)!.costEur
  return [measured.costTodayEur, cost('tariff_switch'), cost('controlled')]
}

const cents = (values: number[]) => values.map((v) => Math.round(v * 100))

describe('Vorderseite: lineare Jahreshochrechnung bei PV-Lastgang', () => {
  it('PV, 352 Tage: Basis „linear", Wege = gemessene Wege × 365/352, Hinweis auf der Seite', () => {
    const input = partialYear(352, true)
    const s = buildExecutiveSummary(input)!
    expect(s.header.basis).toBe('linear')
    expect(s.header.measuredDays).toBe(352)
    expect(cents(s.ways.map((w) => w.costPerYearEur))).toEqual(
      cents(measuredWayCosts(input).map((v) => (v * 365) / 352)),
    )
    expect(executiveSummaryCopy(s).basisLine).toBe(
      'Jahreswerte linear hochgerechnet aus 352 Tagen Messdaten.',
    )
  })

  it('PV, 300 Tage: unter der Untergrenze keine Vorderseite', () => {
    expect(buildExecutiveSummary(partialYear(300, true))).toBeNull()
  })

  it('PV, 365 Tage: bisheriger Weg über das gemessene Jahr, unskaliert', () => {
    const input = partialYear(365, true)
    const s = buildExecutiveSummary(input)!
    expect(s.header.basis).toBe('annual')
    expect(s.ways.map((w) => w.costPerYearEur)).toEqual(measuredWayCosts(input))
  })

  it('ohne PV, 352 Tage: wie vor der Änderung keine Vorderseite', () => {
    expect(buildExecutiveSummary(partialYear(352, false))).toBeNull()
  })
})
