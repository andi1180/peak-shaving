import { describe, expect, it } from 'vitest'

import { formatEur } from '@/lib/format'
import { EXECUTIVE_SUMMARY_CASES as CASES } from '@/test/executive-summary-cases'
import { aboutYears, breakEvenBandOf, type BreakEvenBand } from './break-even-band'
import { buildExecutiveSummary, type ExecutiveSummaryStorage } from './executive-summary'
import { executiveSummaryCopy } from './executive-summary-copy'
import { breakEvenLayoutOf, fitLabel, waysBarsOf } from './executive-summary-charts'
import { EXEC_SLOTS } from './executive-summary-layout'

const summary = (name: string) => buildExecutiveSummary(CASES[name]!)!

/** Die Beschriftungen, die das Diagramm zeichnet. */
function drawnTexts(band: BreakEvenBand): string[] {
  const layout = breakEvenLayoutOf(band, EXEC_SLOTS.breakEven)
  return [layout.investmentLabel.text, ...layout.markers.map((m) => m.label.text)]
}

/** Dieselben Zahlen, wie der Text der Seite sie nennt. */
function pageTexts(st: ExecutiveSummaryStorage): string[] {
  return [
    `${st.hasSubsidy ? 'Investition nach Förderung' : 'Investition'} ${formatEur(st.investment.netEur)}`,
    aboutYears(st.amortizationYears),
    ...(st.paybackWithoutPeaksYears !== null && !st.paybackWithoutPeaksBeyondHorizon
      ? [aboutYears(st.paybackWithoutPeaksYears)]
      : []),
  ]
}

describe('breakEvenBandOf', () => {
  it('Müldür-Jahr: Schnittpunkte 4,0 und 8,9 Jahre, Investition ohne Förderung', () => {
    const band = breakEvenBandOf(summary('jahr (Müldür)').storage)!
    expect(band.investmentEur).toBe(8550)
    expect(band.upperBound).toBe(true)
    expect(band.upper.paybackYears!.toFixed(1)).toBe('4.0')
    expect(band.lower!.paybackYears!.toFixed(1)).toBe('8.9')
    expect(drawnTexts(band)).toEqual([
      `Investition ${formatEur(8550)}`,
      'ca. 4 Jahre',
      'ca. 8,9 Jahre',
    ])
  })

  it('ohne Spitzenersparnis: eine Linie', () => {
    const band = breakEvenBandOf(summary('ohne Spitzenersparnis').storage)!
    expect(band.upperBound).toBe(false)
    expect(band.lower).toBeNull()
  })

  it('günstiges Laden allein jenseits des Horizonts: Linie ohne Schnittpunkt', () => {
    const s = summary('Worst Case')
    expect(s.storage!.paybackWithoutPeaksBeyondHorizon).toBe(true)
    const band = breakEvenBandOf(s.storage)!
    expect(band.lower).toMatchObject({ paybackYears: null })
    expect(breakEvenLayoutOf(band, EXEC_SLOTS.breakEven).markers).toHaveLength(1)
  })

  it('ohne Speicherblock: kein Diagramm', () => {
    expect(breakEvenBandOf(summary('nur-tarif (Katalog leer)').storage)).toBeNull()
  })

  it.each(Object.keys(CASES))('%s: Schnittpunkte und Investition wie im Text der Seite', (name) => {
    const st = summary(name).storage
    if (!st) return
    expect(drawnTexts(breakEvenBandOf(st)!)).toEqual(pageTexts(st))
  })

  it('mit Förderung: Label „Investition nach Förderung"', () => {
    const st = summary('mit Förderung').storage!
    expect(drawnTexts(breakEvenBandOf(st)!)[0]).toBe(
      `Investition nach Förderung ${formatEur(st.investment.netEur)}`,
    )
  })

  it('Positivkontrolle: 1 € Abweichung der Investition im Diagramm fällt auf', () => {
    const st = summary('jahr (Müldür)').storage!
    const band = breakEvenBandOf(st)!
    expect(drawnTexts({ ...band, investmentEur: band.investmentEur + 1 })).not.toEqual(
      pageTexts(st),
    )
  })
})

describe('waysBarsOf', () => {
  it.each(Object.keys(CASES))('%s: Balken = model.ways, gleiche Reihenfolge und Labels', (name) => {
    const s = summary(name)
    const slot = EXEC_SLOTS.ways
    const bars = waysBarsOf(s.ways, executiveSummaryCopy(s).wayLabels, slot)
    expect(bars.map((b) => b.valueEur)).toEqual(s.ways.map((w) => w.costPerYearEur))
    expect(bars.map((b) => b.label)).toEqual(executiveSummaryCopy(s).wayLabels)
    expect(bars.map((b) => b.recommended)).toEqual(s.ways.map((w) => w.isRecommended))
    expect(Math.max(...bars.map((b) => b.barWidth))).toBeLessThanOrEqual(slot.width)
  })
})

describe('fitLabel', () => {
  it('kürzt ein zu langes Wege-Label mit „…" auf die Breite', () => {
    const long = 'Wien Energie Optima Business Float Garantie (Ihr gefundener Tarif)'
    expect(fitLabel(long, 481.6)).toBe(long)
    const cut = fitLabel(long, 150)
    expect(cut).toMatch(/^Wien Energie .*…$/)
    expect(cut.length).toBeLessThan(long.length)
  })
})
