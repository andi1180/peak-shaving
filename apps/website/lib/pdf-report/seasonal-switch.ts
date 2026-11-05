import { DEFAULT_SWITCH_RULES } from 'engine'
import {
  countryDisplay,
  displayedPriceBasis,
  vatFactor,
  type SwitchPlanBlock,
  type TariffSwitchPlan,
} from 'shared'

import { formatEur, formatPercent } from '@/lib/format'
import type { ReportNotice, ReportRow, ReportStatement } from './statement'
import type { WaysBar } from './ways'

/** `weg` = eigener Weg im Kapitel, `hinweis` = ein Satz beim aWATTar-Weg, `nichts` = keine Spur im Report. */
export type SwitchPlanStage = 'weg' | 'hinweis' | 'nichts'

export type SwitchPlanNames = {
  /** Name des dynamischen Tarifs, wie ihn die übrigen Wege nennen. */
  spot: string
  comparisonSupplier: string | null
}

export type SeasonalSwitchWay = {
  bar: WaysBar
  statement: ReportStatement
  method: string
}

type OkPlan = Extract<TariffSwitchPlan, { status: 'ok' }>

export function switchPlanStageOf(plan: TariffSwitchPlan | undefined): SwitchPlanStage {
  if (plan?.status !== 'ok') return 'nichts'
  if (plan.result.kind === 'switch') return 'weg'
  // Die Schwelle gilt netto: die Brutto-Anzeige für Privatkunden darf die Stufe nicht verschieben.
  const netSavingEur = plan.savingVsBestSingleEur / vatFactor(displayedPriceBasis(plan))
  return plan.savingShare !== null && netSavingEur >= DEFAULT_SWITCH_RULES.minSavingEur
    ? 'hinweis'
    : 'nichts'
}

function tariffLabel(tariffId: string, names: SwitchPlanNames): string {
  if (tariffId === 'spot') return names.spot
  return names.comparisonSupplier ? `Fixtarif ${names.comparisonSupplier}` : 'Fixtarif'
}

/** „April–September: aWATTar · Oktober–März: Fixtarif X" — Block 2 läuft über den Jahreswechsel. */
function planText(blocks: readonly SwitchPlanBlock[], names: SwitchPlanNames): string {
  const { monthsLong } = countryDisplay(null)
  return blocks
    .map(({ tariffId, months }) => {
      const span = `${monthsLong[months[0]!]}–${monthsLong[months[months.length - 1]!]}`
      return `${span}: ${tariffLabel(tariffId, names)}`
    })
    .join(' · ')
}

const savingText = (plan: OkPlan): string =>
  `${formatEur(plan.savingVsBestSingleEur)} (${formatPercent((plan.savingShare ?? 0) * 100)})`

export function seasonalSwitchWayOf(
  plan: TariffSwitchPlan | undefined,
  names: SwitchPlanNames,
): SeasonalSwitchWay | null {
  if (plan?.status !== 'ok' || switchPlanStageOf(plan) !== 'weg') return null

  const text = planText(plan.bestSwitch.blocks, names)
  const cheaperSingle = tariffLabel(plan.bestSingle.tariffId, names)
  const rate = names.comparisonSupplier
    ? `der Vergleichstarif ${names.comparisonSupplier}`
    : 'der Vergleichstarif'
  const annualCostRow = ({ tariffId, annualEur }: OkPlan['singles'][number]): ReportRow => ({
    label: `Jahreskosten ${tariffLabel(tariffId, names)}`,
    value: formatEur(annualEur),
    tone: 'neutral',
  })

  return {
    bar: {
      key: 'seasonal',
      label: 'Tarifwechsel im Jahreslauf',
      eur: plan.bestSwitch.annualEur,
      model: false,
    },
    statement: {
      id: 'ways_seasonal_switch',
      title: 'Tarifwechsel im Jahreslauf (Rückblick)',
      amount: null,
      rows: [
        ...plan.singles.map(annualCostRow),
        {
          label: 'Jahreskosten mit Wechsel',
          value: formatEur(plan.bestSwitch.annualEur),
          tone: 'neutral',
        },
        {
          label: `Ersparnis gegenüber ${cheaperSingle}`,
          value: savingText(plan),
          tone: 'neutral',
          total: true,
        },
      ],
      body:
        'Statt das ganze Jahr bei einem Tarif zu bleiben, hätten Sie im betrachteten Zeitraum ' +
        `zweimal jährlich wechseln können: ${text}. Gegenüber dem günstigeren der beiden ` +
        `Einzeltarife (${cheaperSingle}) hätte das ${savingText(plan)} gespart. Grundlage sind Ihr ` +
        `gemessener Verbrauch, die tatsächlichen Börsenpreise dieses Zeitraums und ${rate}. Das ist ` +
        'ein Rückblick: Ob sich ein Wechsel künftig lohnt, hängt von der weiteren Preisentwicklung ' +
        'ab. Speicher und Steuerung sind hier nicht eingerechnet.',
    },
    method:
      'je Kalendermonat gilt der Tarif des jeweiligen Halbjahresblocks, gerechnet mit den ' +
      'Monatskosten von Vergleichstarif und Börsenpreis ohne Steuerung. Geprüft sind alle ' +
      `Halbjahresschnitte; als Weg steht ein Wechsel erst ab ${formatEur(DEFAULT_SWITCH_RULES.minSavingEur)} ` +
      `und ${formatPercent(DEFAULT_SWITCH_RULES.minSavingShare * 100)} Ersparnis gegenüber dem ` +
      'günstigeren Einzeltarif.',
  }
}

export function seasonalSwitchNoticeOf(
  plan: TariffSwitchPlan | undefined,
  names: SwitchPlanNames,
): ReportNotice | null {
  if (plan?.status !== 'ok' || switchPlanStageOf(plan) !== 'hinweis') return null
  return {
    id: 'ways_seasonal_switch_hint',
    tone: 'neutral',
    title: 'Wechsel im Jahreslauf',
    body:
      `Ein Wechsel (${planText(plan.bestSwitch.blocks, names)}) hätte im Rückblick ` +
      `${savingText(plan)} gespart. Dieser Vorteil liegt im Bereich normaler Preisschwankungen von ` +
      'Jahr zu Jahr; ein Wechsel allein deshalb ist nicht zu empfehlen.',
    list: null,
    hints: [],
  }
}
