import { describe, expect, it } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES as CASES } from '@/test/executive-summary-cases'
import { buildExecutiveSummary } from './executive-summary'
import { aboutDuration, totalAmortizationExtra, totalAmortizationOf } from './total-amortization'

describe('Amortisation der Gesamtmaßnahme', () => {
  it('Müldür: 8.550 € ÷ 10.150 €/Jahr = 0,84 Jahre, „ca. 10 Monate"', () => {
    const s = buildExecutiveSummary(CASES['jahr (Müldür)']!)!
    const total = totalAmortizationOf(s)!
    expect(total.years).toBeCloseTo(8550 / 10150, 6)
    expect(aboutDuration(total.years)).toBe('ca. 10 Monate')
    const extra = totalAmortizationExtra(s, s.storage!.amortizationYears)!
    expect(extra.line).toBe('Gesamtmaßnahme: frühestens ca. 10 Monate')
    expect(extra.note).toContain('frühestens nach ca. 10 Monaten amortisiert')
    expect(extra.note).toContain('frühestens in 4 Jahren')
  })

  it('Format: mindestens 1 Monat, ab 24 Monaten in Jahren, Dativ', () => {
    expect(aboutDuration(0.01)).toBe('ca. 1 Monat')
    expect(aboutDuration(1.9)).toBe('ca. 23 Monate')
    expect(aboutDuration(2.5)).toBe('ca. 2,5 Jahre')
    expect(aboutDuration(2.5, true)).toBe('ca. 2,5 Jahren')
  })

  it('entfällt ohne Tarifwechsel-Anteil, ohne Speicher und bei unbekanntem Tarif', () => {
    for (const name of ['nur-tarif (Katalog leer)', 'speicher-lohnt-nicht', 'tarif-unbekannt (konstruiert)']) {
      expect(totalAmortizationOf(buildExecutiveSummary(CASES[name]!)!), name).toBeNull()
    }
    const s = buildExecutiveSummary(CASES['jahr (Müldür)']!)!
    s.stages[0]!.savingPerYearEur = 0
    expect(totalAmortizationOf(s)).toBeNull()
  })
})
