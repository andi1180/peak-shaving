import { computeSwitchPlan } from 'engine'
import { analysisForDisplay, type TariffSwitchPlan } from 'shared'
import { describe, expect, it } from 'vitest'

import { seasonalSwitchNoticeOf, seasonalSwitchWayOf, switchPlanStageOf } from './seasonal-switch'

const seasonal = (winterEur: number, summerEur: number) =>
  Array.from({ length: 12 }, (_, month) => (month >= 3 && month <= 8 ? summerEur : winterEur))

const planOf = (fix: number[], spot: number[]) =>
  computeSwitchPlan([
    { id: 'comparison', monthlyEur: fix },
    { id: 'spot', monthlyEur: spot },
  ]) as Extract<TariffSwitchPlan, { status: 'ok' }>

const NAMES = { spot: 'aWATTar', comparisonSupplier: 'ENSTROGA' }
const SWITCH_PLAN = planOf(seasonal(100, 130), seasonal(130, 100))
const SINGLE_PLAN = planOf(flat(100), flat(120))

function flat(eur: number) {
  return Array.from({ length: 12 }, () => eur)
}

const single = (savingVsBestSingleEur: number, savingShare: number | null): TariffSwitchPlan => ({
  ...SINGLE_PLAN,
  savingVsBestSingleEur,
  savingShare,
})

describe('switchPlanStageOf', () => {
  it.each<[string, TariffSwitchPlan | undefined, string]>([
    ['Wechsel', SWITCH_PLAN, 'weg'],
    ['Einzeltarif, 663 € und 3,3 %', single(663, 0.033), 'hinweis'],
    ['genau an der Schwelle', single(50, 0.01), 'hinweis'],
    ['Einzeltarif, 30 €', single(30, 0.1), 'nichts'],
    ['kein Anteil', single(663, null), 'nichts'],
    ['negativ', single(-120, -0.1), 'nichts'],
    ['zu wenig Daten', { status: 'insufficient_data', reason: 'short_period' }, 'nichts'],
    ['Feld fehlt', undefined, 'nichts'],
  ])('%s', (_, plan, stage) => {
    expect(switchPlanStageOf(plan)).toBe(stage)
  })

  it('die Schwelle gilt netto: 45 € netto werden brutto nicht zum Hinweis', () => {
    const { plan } = analysisForDisplay({ plan: single(45, 0.05) }, 'gross')
    expect((plan as { savingVsBestSingleEur: number }).savingVsBestSingleEur).toBeCloseTo(54)
    expect(switchPlanStageOf(plan)).toBe('nichts')
  })
})

describe('Inhalt', () => {
  it('Weg: Plan kalendarisch benannt, Text und Kennzahlen aus dem Plan', () => {
    const way = seasonalSwitchWayOf(SWITCH_PLAN, NAMES)!

    expect(way.statement.title).toBe('Tarifwechsel im Jahreslauf (Rückblick)')
    expect(way.statement.body).toContain(
      'zweimal jährlich wechseln können: April–September: aWATTar · Oktober–März: Fixtarif ENSTROGA. ' +
        'Gegenüber dem günstigeren der beiden Einzeltarife (Fixtarif ENSTROGA) hätte das €\u00a0180 (13 %) gespart.',
    )
    expect(way.statement.body).toContain('und der Vergleichstarif ENSTROGA. Das ist ein Rückblick')
    expect(way.statement.rows.map((row) => [row.label, row.value])).toEqual([
      ['Jahreskosten Fixtarif ENSTROGA', '€\u00a01.380'],
      ['Jahreskosten aWATTar', '€\u00a01.380'],
      ['Jahreskosten mit Wechsel', '€\u00a01.200'],
      ['Ersparnis gegenüber Fixtarif ENSTROGA', '€\u00a0180 (13 %)'],
    ])
    expect(way.bar.eur).toBe(1200)
  })

  it('Hinweis: wortgleich, ohne eigenen Weg', () => {
    const plan = { ...SWITCH_PLAN, result: { kind: 'single', tariffId: 'spot' } } as const
    const hinted = { ...plan, savingVsBestSingleEur: 663, savingShare: 0.033 }

    expect(seasonalSwitchWayOf(hinted, NAMES)).toBeNull()
    expect(seasonalSwitchNoticeOf(hinted, NAMES)?.body).toBe(
      'Ein Wechsel (April–September: aWATTar · Oktober–März: Fixtarif ENSTROGA) hätte im Rückblick ' +
        '€\u00a0663 (3,3 %) gespart. Dieser Vorteil liegt im Bereich normaler Preisschwankungen von Jahr ' +
        'zu Jahr; ein Wechsel allein deshalb ist nicht zu empfehlen.',
    )
  })

  it('Beträge folgen der Anzeige: brutto steht brutto', () => {
    const { plan } = analysisForDisplay({ plan: SWITCH_PLAN }, 'gross')
    const way = seasonalSwitchWayOf(plan as TariffSwitchPlan, NAMES)!
    expect(way.statement.rows[2]!.value).toBe('€\u00a01.440')
    expect(way.statement.rows[3]!.value).toBe('€\u00a0216 (13 %)')
  })
})
