import { computeSwitchPlan } from 'engine'
import type { TariffSwitchPlan } from 'shared'
import { describe, expect, it } from 'vitest'

import { muster } from '@/test/executive-summary-cases'
import { buildProposal } from './advice'
import { buildLimitations } from './basis'
import { buildExecutiveSummary } from './executive-summary'
import { comparisonTariffHintsOf } from './seasonal-switch'
import { buildReportSummary } from './summary'
import type { PdfReportAnalysis, PdfReportInput } from './types'
import { buildWaysChapter, waysCountOf } from './ways'

const SEASON = (winterEur: number, summerEur: number) =>
  Array.from({ length: 12 }, (_, month) => (month >= 3 && month <= 8 ? summerEur : winterEur))

// Bewusst billiger als jeder andere Weg: auch dann darf der Wechsel nirgends Kandidat werden.
const SWITCH_PLAN = computeSwitchPlan([
  { id: 'comparison', monthlyEur: SEASON(1, 300) },
  { id: 'spot', monthlyEur: SEASON(300, 1) },
])
const HINT_PLAN = {
  ...SWITCH_PLAN,
  result: { kind: 'single', tariffId: 'spot' },
} as TariffSwitchPlan
const LOW_PLAN = { ...HINT_PLAN, savingVsBestSingleEur: 30 } as TariffSwitchPlan

const base = muster(true)
const withPlan = (tariffSwitchPlan: TariffSwitchPlan): PdfReportInput => ({
  ...base,
  analysis: { ...base.analysis, tariffSwitchPlan },
})
const overviewText = (input: PdfReportInput) => JSON.stringify(buildReportSummary(input).overview)

describe('Tarifwechsel in Zusammenfassung und Vorderseite', () => {
  const stage1 = withPlan(SWITCH_PLAN)

  it('Stufe 1: der Wechsel-Weg zählt in beiden Texten mit', () => {
    expect(waysCountOf(stage1.analysis)).toBe(waysCountOf(base.analysis) + 1)
    expect(buildWaysChapter(stage1.analysis)!.wayCount).toBe(waysCountOf(stage1.analysis))
    expect(overviewText(base)).toContain('Es gibt zwei unterschiedlich')
    expect(overviewText(stage1)).toContain('Es gibt drei unterschiedlich')
    expect(overviewText(stage1)).toContain('ein zweimal jährlicher Wechsel zwischen den Tarifen')
  })

  it('Stufe 1: die Rückblick-Zeile steht in beiden, getrennt und wörtlich', () => {
    const review = buildReportSummary(stage1).switchReview!
    expect(review.replace(/\u00a0/g, ' ')).toMatch(
      /^Rückblick Tarifwechsel: Mit April–September: .+ · Oktober–März: .+ hätten Sie im betrachteten Zeitraum € .+ \(.+ %\) gegenüber dem günstigeren Einzeltarif gespart – keine Empfehlung, sondern ein Hinweis, wie stark die Tarife übers Jahr auseinanderlaufen\.$/,
    )
    expect(buildExecutiveSummary(stage1)!.switchReview).toBe(review)
  })

  it('Stufe 1: Spanne, bester Weg und Vorderseite rechnen ohne den Wechsel', () => {
    expect(buildReportSummary(stage1).kpis).toStrictEqual(buildReportSummary(base).kpis)
    const { switchReview: _review, ...front } = buildExecutiveSummary(stage1)!
    expect(front).toStrictEqual(buildExecutiveSummary(base))
  })

  it('der Vorschlag wählt den Wechsel nie, auch wenn er der günstigste Weg wäre', () => {
    expect(SWITCH_PLAN.status === 'ok' && SWITCH_PLAN.bestSwitch.annualEur).toBe(12)
    expect(buildProposal(stage1)).toStrictEqual(buildProposal(base))
  })

  it.each<[string, TariffSwitchPlan]>([
    ['Stufe 2', HINT_PLAN],
    ['Stufe 3', LOW_PLAN],
    ['zu wenig Daten', { status: 'insufficient_data', reason: 'overlap' }],
  ])('%s: identisch zur Ausgabe ohne Plan', (_, plan) => {
    const input = withPlan(plan)
    expect(buildReportSummary(input)).toStrictEqual(buildReportSummary(base))
    expect(buildExecutiveSummary(input)).toStrictEqual(buildExecutiveSummary(base))
    expect(buildProposal(input)).toStrictEqual(buildProposal(base))
  })
})

describe('Einschränkungen: Vergleichstarif und Wechselprüfung', () => {
  const comparison = {
    tariffOptimization: {
      computable: true,
      monthlyComparison: { comparisonSupplier: 'ENSTROGA' },
    },
  }
  const analysisWith = (plan?: TariffSwitchPlan) =>
    ({ ...comparison, ...(plan ? { tariffSwitchPlan: plan } : {}) }) as unknown as PdfReportAnalysis
  const NO_BONUS = 'ohne Bindung und ohne Neukundenbonus.'

  it.each([
    [
      { source: 'tarife_at', offerDate: '2026-10-12' },
      `laut tarife.at vom 12.10.2026, ${NO_BONUS}`,
    ],
    [
      { source: 'durchblicker_at', offerDate: '2026-10-12' },
      `laut durchblicker.at vom 12.10.2026, ${NO_BONUS}`,
    ],
    [{ source: 'angebot', offerDate: '2026-10-12' }, `laut Angebot vom 12.10.2026, ${NO_BONUS}`],
    [
      { source: 'sonstige', offerDate: '2026-10-12' },
      `laut sonstiger Quelle vom 12.10.2026, ${NO_BONUS}`,
    ],
    [undefined, NO_BONUS],
  ] as const)('Herkunft %j', (origin, ending) => {
    const hints = comparisonTariffHintsOf(analysisWith(), { comparisonTariffOrigin: origin })
    expect(hints).toEqual([`Vergleichstarif: ENSTROGA, ${ending}`])
  })

  it.each([
    ['AT', 20],
    ['DE', 19],
    [undefined, 20],
  ] as const)('brutto (%s): %i %% Umsatzsteuer', (country, rate) => {
    const hints = comparisonTariffHintsOf(analysisWith(), {
      country,
      comparisonTariffOrigin: { enteredPriceBasis: 'gross' },
    })
    expect(hints[1]).toBe(
      `Der Vergleichstarif wurde als Bruttopreis erfasst und mit ${rate} % Umsatzsteuer auf netto umgerechnet.`,
    )
  })

  it('mit Plan: die Prüfung ist genannt', () => {
    expect(comparisonTariffHintsOf(analysisWith(SWITCH_PLAN))[1]).toBe(
      'Der unterjährige Tarifwechsel wurde ohne Speicher und Steuerung geprüft (höchstens zwei Wechsel pro Jahr, je 6 Monate).',
    )
  })

  it.each([
    ['short_period', 'der Lastgang umfasst weniger als ein Jahr'],
    ['overlap', 'der Lastgang umfasst mehr als ein Jahr'],
    ['missing_months', 'für einzelne Monate fehlen Werte'],
  ] as const)('zu wenig Daten (%s): der Grund, und keine behauptete Prüfung', (reason, text) => {
    const hints = comparisonTariffHintsOf(analysisWith({ status: 'insufficient_data', reason }))
    expect(hints).toHaveLength(2)
    expect(hints[1]).toBe(
      `Für die Prüfung eines unterjährigen Tarifwechsels sind 12 vollständige Monate Lastgang nötig; ${text}.`,
    )
  })

  it('ohne Vergleichstarif keiner der Sätze', () => {
    const analysis = { tariffSwitchPlan: SWITCH_PLAN } as unknown as PdfReportAnalysis
    expect(comparisonTariffHintsOf(analysis, { country: 'DE' })).toEqual([])
    expect(buildLimitations(base.analysis, base).hints).toEqual(
      buildLimitations(base.analysis).hints,
    )
  })

  it('die Sätze stehen im bestehenden Einschränkungs-Hinweis', () => {
    const analysis = { ...base.analysis, ...analysisWith(SWITCH_PLAN) }
    expect(buildLimitations(analysis).hints).toContain(`Vergleichstarif: ENSTROGA, ${NO_BONUS}`)
  })
})
