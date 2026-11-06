import { computeSwitchPlan } from 'engine'
import { analysisForDisplay, type AnnualSwitchPlan, type TariffSwitchPlan } from 'shared'
import { describe, expect, it } from 'vitest'

import { muster } from '@/test/executive-summary-cases'
import { buildProposal } from './advice'
import { buildAnnualScenarioChapter } from './annual-scenario'
import { buildLimitations } from './basis'
import { buildExecutiveSummary } from './executive-summary'
import { buildReportSummary } from './summary'
import type { PdfReportInput } from './types'
import { buildWaysChapter, waysCountOf } from './ways'

const SEASON = (winterEur: number, summerEur: number) =>
  Array.from({ length: 12 }, (_, month) => (month >= 3 && month <= 8 ? summerEur : winterEur))

const SWITCH: AnnualSwitchPlan = computeSwitchPlan([
  { id: 'comparison', monthlyEur: SEASON(1700, 2300) },
  { id: 'spot', monthlyEur: SEASON(2400, 1600) },
])
const HINT = {
  ...SWITCH,
  result: { kind: 'single', tariffId: 'spot' },
  savingVsBestSingleEur: 663,
  savingShare: 0.033,
} as TariffSwitchPlan
const LOW = { ...HINT, savingVsBestSingleEur: 30 } as TariffSwitchPlan
const SHORT: AnnualSwitchPlan = { status: 'insufficient_data', reason: 'short_measurement' }

const base = structuredClone(muster(true))
const optimization = base.analysis.tariffOptimization
if (optimization?.computable !== true) throw new Error('Fixture ohne Tarifvergleich')
optimization.monthlyComparison!.comparisonSupplier = 'Vergleich'
base.analysis.tariffSwitchPlan = { status: 'insufficient_data', reason: 'short_period' }

const withPlan = (switchPlan: AnnualSwitchPlan): PdfReportInput => ({
  ...base,
  analysis: {
    ...base.analysis,
    annualScenario: { ...base.analysis.annualScenario!, switchPlan },
  },
})

const statementsOf = (input: PdfReportInput) => buildAnnualScenarioChapter(input)!.statements
const plain = (text: string | undefined) => text?.replace(/\u00a0/g, ' ')
const measuredDays = base.analysis.annualScenario!.measuredDays

const expectUntouchedOutsideChapter = (input: PdfReportInput) => {
  expect(waysCountOf(input.analysis)).toBe(waysCountOf(base.analysis))
  expect(buildWaysChapter(input.analysis)).toStrictEqual(buildWaysChapter(base.analysis))
  expect(buildProposal(input)).toStrictEqual(buildProposal(base))
  expect(buildReportSummary(input).kpis).toStrictEqual(buildReportSummary(base).kpis)
}

describe('Jahreskapitel', () => {
  it('Stufe 1: eigener Absatz direkt nach den Jahreskosten, wörtlich', () => {
    const statements = statementsOf(withPlan(SWITCH))
    const index = statements.findIndex((s) => s.id === 'annual_scenario_switch')
    const statement = statements[index]!

    expect(statements[index - 1]!.id).toBe('annual_scenario_costs')
    expect(statement.title).toBe('Tarifwechsel im Jahreslauf (Hochrechnung)')
    expect(statement.rows.map((row) => row.label)).toEqual([
      'Jahreskosten Fixtarif Vergleich',
      expect.stringMatching(/^Jahreskosten /),
      'Jahreskosten mit Wechsel',
      expect.stringMatching(/^Ersparnis gegenüber /),
    ])
    expect(plain(statement.body as string)).toMatch(
      new RegExp(
        '^Auf Basis Ihres hochgerechneten Jahresverbrauchs und der tatsächlichen Börsenpreise wäre ' +
          'ein Tarifwechsel zweimal im Jahr am günstigsten: April–September: .+ · Oktober–März: ' +
          'Fixtarif Vergleich\\. Gegenüber dem günstigeren Einzeltarif \\(.+\\) spart das rund € .+ ' +
          `\\(.+ %\\) im Jahr\\. Gemessen sind ${measuredDays} Tage; die übrigen Tage sind aus Ihren ` +
          'gemessenen Wochen hochgerechnet, die Börsenpreise sind die tatsächlichen dieser Tage\\. ' +
          'Ob sich ein Wechsel künftig lohnt, hängt von der weiteren Preisentwicklung ab\\. ' +
          'Speicher und Steuerung sind hier nicht eingerechnet\\.$',
      ),
    )
    expectUntouchedOutsideChapter(withPlan(SWITCH))
  })

  it('Stufe 2: ein Hinweis bei den Jahreskosten, sonst alles wie ohne Plan', () => {
    const statements = statementsOf(withPlan(HINT))
    const costs = statements.find((s) => s.id === 'annual_scenario_costs')!

    expect(statements.map((s) => s.id)).toEqual(statementsOf(base).map((s) => s.id))
    expect(plain(costs.notice?.body)).toMatch(
      /^Auf Basis der Hochrechnung würde ein Tarifwechsel zweimal im Jahr \(.+\) rund € 663 \(3,3 %\) im Jahr sparen\. Dieser Vorteil liegt im Bereich normaler Preisschwankungen von Jahr zu Jahr; ein Wechsel allein deshalb ist nicht zu empfehlen\.$/,
    )
    expect(buildReportSummary(withPlan(HINT)).switchReview).toBeUndefined()
    expectUntouchedOutsideChapter(withPlan(HINT))
  })

  it.each<[string, AnnualSwitchPlan]>([
    ['30 €', LOW],
    ['unter 90 Messtagen', SHORT],
  ])('Stufe 3 (%s): keine Spur im Kapitel, in der Zusammenfassung und vorne', (_name, plan) => {
    const input = withPlan(plan)
    expect(buildAnnualScenarioChapter(input)).toStrictEqual(buildAnnualScenarioChapter(base))
    expect(buildReportSummary(input)).toStrictEqual(buildReportSummary(base))
    expect(buildExecutiveSummary(input)).toStrictEqual(buildExecutiveSummary(base))
  })

  it('Beträge folgen der Anzeige: brutto steht brutto', () => {
    const input = withPlan(HINT)
    const gross = { ...input, analysis: analysisForDisplay(input.analysis, 'gross') }
    const costs = statementsOf(gross).find((s) => s.id === 'annual_scenario_costs')!
    expect(plain(costs.notice?.body)).toContain('rund € 796 (3,3 %) im Jahr')
  })
})

describe('Zusammenfassung und Vorderseite', () => {
  it('Stufe 1: dieselbe Zeile an beiden Stellen, die Vorderseite sonst unverändert', () => {
    const input = withPlan(SWITCH)
    const review = buildReportSummary(input).switchReview!

    expect(plain(review)).toMatch(
      /^Tarifwechsel \(Hochrechnung\): Mit April–September: .+ · Oktober–März: Fixtarif Vergleich würden Sie auf Basis Ihres hochgerechneten Jahresverbrauchs rund € .+ \(.+ %\) im Jahr gegenüber dem günstigeren Einzeltarif sparen – keine Empfehlung, sondern ein Hinweis, wie stark die Tarife übers Jahr auseinanderlaufen\.$/,
    )
    const { switchReview, ...front } = buildExecutiveSummary(input)!
    expect(switchReview).toBe(review)
    expect(front).toStrictEqual(buildExecutiveSummary(base))
  })

  it('steht das Jahreskapitel nicht, erscheint der Plan nirgends', () => {
    const input = { ...withPlan(SWITCH), hasPv: true }
    expect(buildAnnualScenarioChapter(input)).toBeNull()
    expect(buildReportSummary(input).switchReview).toBeUndefined()
    expect(buildLimitations(input.analysis, input).hints.join(' ')).toContain('12 vollständige Monate')
  })
})

describe('Einschränkungen', () => {
  const hintsOf = (input: PdfReportInput) => buildLimitations(input.analysis, input).hints

  it('Plan der Hochrechnung: geprüft, mit Messtagen', () => {
    expect(hintsOf(withPlan(SWITCH))).toContain(
      `Der unterjährige Tarifwechsel wurde auf Basis der Jahres-Hochrechnung geprüft (${measuredDays} ` +
        'gemessene Tage), ohne Speicher und Steuerung (höchstens zwei Wechsel pro Jahr, je 6 Monate).',
    )
    expect(hintsOf(withPlan(SWITCH)).join(' ')).not.toContain('12 vollständige Monate')
  })

  it('unter 90 Messtagen: die Mindestmenge', () => {
    expect(hintsOf(withPlan(SHORT))).toContain(
      'Für die Prüfung eines unterjährigen Tarifwechsels sind mindestens 90 gemessene Tage nötig; ' +
        `gemessen sind ${measuredDays}.`,
    )
    expect(hintsOf(withPlan(SHORT)).join(' ')).not.toContain('12 vollständige Monate')
  })

  it('Schlüssel fehlt: der bestehende Satz', () => {
    expect(hintsOf(base)).toContain(
      'Für die Prüfung eines unterjährigen Tarifwechsels sind 12 vollständige Monate Lastgang ' +
        'nötig; der Lastgang umfasst weniger als ein Jahr.',
    )
  })
})
