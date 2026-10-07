import { describe, expect, it } from 'vitest'

import { calculateRoi } from 'engine'

import { ifbEffectOf } from './ifb-effect'
import { taxEffectLines, taxEffectNoteOf, TAX_EFFECT_NOTE } from './report-copy'

/* Müldür-Live-Eingaben (vom Nutzer genannt): Investition 11.550 €, Ersparnis 2.125 €/Jahr, Horizont 10, AfA 10, IFB 22 %. */
const battery = {
  usableCapacityKwh: 1,
  pricePerKwh: 11550,
  inverterIncluded: true,
  requiresFoundation: false,
} as never
const entry = { battery, subsidyAmount: 0 } as never
const tax = (taxRatePercent: number, ifb: number | null) => ({
  taxRatePercent,
  investitionsfreibetragPercent: ifb,
  depreciationYears: 10,
})
const lines = (t: ReturnType<typeof tax>, saving: number) => {
  const ifb = ifbEffectOf(entry, t, 10, saving)
  const effect =
    calculateRoi(battery, saving, 10, {
      fixedSubsidyEur: 0,
      taxRatePercent: t.taxRatePercent,
      investitionsfreibetragPercent: t.investitionsfreibetragPercent ?? undefined,
      depreciationYears: 10,
    }).taxEffect ?? effectWith(0)
  return { ifb, rows: taxEffectLines(effect, t, 10, ifb), note: taxEffectNoteOf(ifb) }
}

const IFB_ROW = 'Investitionsfreibetrag, einmalig'
const effectWith = (ifbEffect: number) => ({
  ifbEffect,
  annualDepreciationEffect: 1,
  amortizationYearsAfterTax: 1,
  netSavingOverHorizonAfterTax: 1,
})

describe('ifbEffectOf', () => {
  it('Müldür: Verkürzung steht im Wert der IFB-Zeile, Erklärsatz mit Halbsatz, Invariante Netto-Differenz = IFB-Betrag', () => {
    const { ifb, rows, note } = lines(tax(40, 22), 2125)
    expect(ifb!.deltaYears).toBeCloseTo(0.6, 1)
    const roi = (p: number) =>
      calculateRoi(battery, 2125, 10, {
        fixedSubsidyEur: 0,
        taxRatePercent: 40,
        investitionsfreibetragPercent: p,
        depreciationYears: 10,
      }).taxEffect!
    expect(roi(22).netSavingOverHorizonAfterTax - roi(0).netSavingOverHorizonAfterTax).toBeCloseTo(
      roi(22).ifbEffect,
      6,
    )
    expect(rows.map((r) => r.label)).not.toContain('Wirkung des Investitionsfreibetrags')
    expect(rows.find((r) => r.label === IFB_ROW)!.value).toBe(
      '€\u00a01.016 · Amortisation 0,6 Jahre kürzer',
    )
    expect(note).toBe(
      'Richtwert, keine Steuerberatung. Die Ersparnis ist steuerpflichtig und berücksichtigt, deshalb dauert die Amortisation nach Steuern länger; der Investitionsfreibetrag verkürzt sie um 0,6 Jahre.',
    )
  })

  it('ohne IFB (0 %) oder Steuersatz 0: keine Wirkung, Hinweistext wie bisher', () => {
    for (const t of [tax(40, 0), tax(0, 22)]) {
      const { ifb, note } = lines(t, 2125)
      expect(ifb).toBeNull()
      expect(note).toBe(TAX_EFFECT_NOTE)
    }
  })

  it('Wert bleibt bei fehlender Verkürzung „€ x"; Einzahl bei gerundet 1,0, ganze Zahl ohne Komma', () => {
    const t = tax(40, 22)
    const val = (ifb: { deltaYears: number | null; taxedLonger: boolean } | null) =>
      taxEffectLines(effectWith(100), t, 10, ifb).find((r) => r.label === IFB_ROW)!.value
    expect(val(null)).toBe('€\u00a0100')
    expect(val({ deltaYears: null, taxedLonger: true })).toBe('€\u00a0100')
    expect(val({ deltaYears: 1.04, taxedLonger: true })).toBe(
      '€\u00a0100 · Amortisation 1 Jahr kürzer',
    )
    expect(val({ deltaYears: 2, taxedLonger: true })).toBe(
      '€\u00a0100 · Amortisation 2 Jahre kürzer',
    )
    expect(taxEffectNoteOf({ deltaYears: 1.04, taxedLonger: true })).toContain(
      'verkürzt sie um 1 Jahr.',
    )
    expect(taxEffectNoteOf({ deltaYears: null, taxedLonger: true })).toBe(
      'Richtwert, keine Steuerberatung. Die Ersparnis ist steuerpflichtig und berücksichtigt, deshalb dauert die Amortisation nach Steuern länger.',
    )
    expect(taxEffectNoteOf({ deltaYears: 0.5, taxedLonger: false })).toBe(TAX_EFFECT_NOTE)
  })
})
