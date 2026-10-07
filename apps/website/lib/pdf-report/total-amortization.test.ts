import { describe, expect, it } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES as CASES } from '@/test/executive-summary-cases'
import { buildExecutiveSummary } from './executive-summary'
import { aboutDuration, totalAmortizationExtra, totalAmortizationOf } from './total-amortization'

describe('Amortisation der Gesamtmaßnahme', () => {
  it('Müldür-Fixture: 8.550 € ÷ 10.150 €/Jahr = 0,84 Jahre, „ca. 0,8 Jahre"', () => {
    const s = buildExecutiveSummary(CASES['jahr (Müldür)']!)!
    const total = totalAmortizationOf(s)!
    expect(total.years).toBeCloseTo(8550 / 10150, 6)
    expect(aboutDuration(total.years)).toBe('ca. 0,8 Jahre')
    const extra = totalAmortizationExtra(s, s.storage!.amortizationYears)!
    expect(extra.line).toBe('Gesamtmaßnahme: frühestens ca. 0,8 Jahre')
    expect(extra.note).toContain('frühestens nach ca. 0,8 Jahren amortisiert')
    expect(extra.note).toContain('frühestens in 4 Jahren')
  })

  it('Müldür live: 11.550 € ÷ 10.150 €/Jahr = 1,138 → „ca. 1,1 Jahre", Dativ „ca. 1,1 Jahren"', () => {
    expect(aboutDuration(11550 / 10150)).toBe('ca. 1,1 Jahre')
    expect(aboutDuration(11550 / 10150, true)).toBe('ca. 1,1 Jahren')
  })

  it('Randfälle: 1,0 → „ca. 1 Jahr", ganze Zahl → „ca. 2 Jahre", sehr klein → „ca. 0,1 Jahre", jeweils mit Dativ', () => {
    expect(aboutDuration(1)).toBe('ca. 1 Jahr')
    expect(aboutDuration(0.96)).toBe('ca. 1 Jahr')
    expect(aboutDuration(1, true)).toBe('ca. 1 Jahr')
    expect(aboutDuration(2)).toBe('ca. 2 Jahre')
    expect(aboutDuration(2, true)).toBe('ca. 2 Jahren')
    expect(aboutDuration(0.01)).toBe('ca. 0,1 Jahre')
    expect(aboutDuration(0.01, true)).toBe('ca. 0,1 Jahren')
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
