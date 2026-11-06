import { DEFAULT_SWITCH_RULES } from 'engine'
import {
  annualBasisApplies,
  countryDisplay,
  displayedPriceBasis,
  vatFactor,
  vatRateFor,
  type AnnualBasisPvInput,
  type AnnualSwitchPlan,
  type ComparisonTariffSource,
  type SwitchPlanBlock,
  type SwitchPlanInsufficientReason,
  type TariffSwitchPlan,
} from 'shared'

import { formatDateOnly, formatEur, formatPercent } from '@/lib/format'
import { dynamicTariffOf } from '@/lib/report-copy'
import type { ReportNotice, ReportRow, ReportStatement } from './statement'
import type { PdfReportAnalysis, PdfReportInput } from './types'
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

/** Der Plan der Hochrechnung samt seiner Datengrundlage. */
export type AnnualSwitch = { plan: AnnualSwitchPlan; measuredDays: number }

type OkPlan = Extract<TariffSwitchPlan, { status: 'ok' }>

// Die Schwelle gilt netto: die Brutto-Anzeige für Privatkunden darf die Stufe nicht verschieben.
const netSavingEurOf = (plan: OkPlan): number =>
  plan.savingVsBestSingleEur / vatFactor(displayedPriceBasis(plan))

export function switchPlanStageOf(plan: AnnualSwitchPlan | undefined): SwitchPlanStage {
  if (plan?.status !== 'ok') return 'nichts'
  if (plan.result.kind === 'switch') return 'weg'
  return plan.savingShare !== null && netSavingEurOf(plan) >= DEFAULT_SWITCH_RULES.minSavingEur
    ? 'hinweis'
    : 'nichts'
}

/** Warum ein geprüfter Wechsel in Stufe 3 nicht trägt; `null`, wenn dazu kein Satz gehört. */
function noSwitchReasonOf(plan: OkPlan): 'no_advantage' | 'too_small' | null {
  if (switchPlanStageOf(plan) !== 'nichts') return null
  if (!plan.bestSwitch || plan.savingVsBestSingleEur <= 0) return 'no_advantage'
  return netSavingEurOf(plan) < DEFAULT_SWITCH_RULES.minSavingEur ? 'too_small' : null
}

export function switchPlanNamesOf(analysis: PdfReportAnalysis): SwitchPlanNames {
  return {
    spot: dynamicTariffOf(analysis).name,
    comparisonSupplier: comparisonSupplierOf(analysis),
  }
}

function comparisonSupplierOf(analysis: PdfReportAnalysis): string | null {
  return analysis.tariffOptimization?.computable === true
    ? (analysis.tariffOptimization.monthlyComparison?.comparisonSupplier ?? null)
    : null
}

function tariffLabel(tariffId: string, names: SwitchPlanNames): string {
  if (tariffId === 'spot') return names.spot
  return names.comparisonSupplier ? `Fixtarif ${names.comparisonSupplier}` : 'Fixtarif'
}

/** Der Anbietername allein, für Sätze, die beide Tarife nebeneinander nennen. */
function tariffName(tariffId: string, names: SwitchPlanNames): string {
  if (tariffId === 'spot') return names.spot
  return names.comparisonSupplier ?? 'Fixtarif'
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

function planCostRows(plan: OkPlan, names: SwitchPlanNames): ReportRow[] {
  const annualCostRow = ({ tariffId, annualEur }: OkPlan['singles'][number]): ReportRow => ({
    label: `Jahreskosten ${tariffLabel(tariffId, names)}`,
    value: formatEur(annualEur),
    tone: 'neutral',
  })
  return [
    ...plan.singles.map(annualCostRow),
    {
      label: 'Jahreskosten mit Wechsel',
      value: formatEur(plan.bestSwitch.annualEur),
      tone: 'neutral',
    },
    {
      label: `Ersparnis gegenüber ${tariffLabel(plan.bestSingle.tariffId, names)}`,
      value: savingText(plan),
      tone: 'neutral',
      total: true,
    },
  ]
}

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
      rows: planCostRows(plan, names),
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

const switchNotice = (id: string, body: string): ReportNotice => ({
  id,
  tone: 'neutral',
  title: 'Wechsel im Jahreslauf',
  body,
  list: null,
  hints: [],
})

function noSwitchVerdict(
  plan: OkPlan,
  reason: NonNullable<ReturnType<typeof noSwitchReasonOf>>,
  names: SwitchPlanNames,
): string {
  const best = tariffName(plan.bestSingle.tariffId, names)
  return reason === 'no_advantage'
    ? `Er lohnt sich nicht – ${best} ist über das ganze Jahr günstiger.`
    : `Der beste Wechsel brächte höchstens ${formatEur(plan.savingVsBestSingleEur)} im Jahr – zu ` +
        `wenig, um ihn zu empfehlen; ${best} ganzjährig ist die einfachere Wahl.`
}

const tariffPair = (names: SwitchPlanNames): string =>
  `${tariffName('comparison', names)} und ${tariffName('spot', names)}`

export function seasonalSwitchNoticeOf(
  plan: TariffSwitchPlan | undefined,
  names: SwitchPlanNames,
): ReportNotice | null {
  if (plan?.status !== 'ok') return null
  const id = 'ways_seasonal_switch_hint'
  const reason = noSwitchReasonOf(plan)
  if (reason) {
    return switchNotice(
      id,
      `Geprüft wurde auch ein Tarifwechsel zweimal im Jahr zwischen ${tariffPair(names)}: ` +
        noSwitchVerdict(plan, reason, names),
    )
  }
  if (switchPlanStageOf(plan) !== 'hinweis') return null
  return switchNotice(
    id,
    `Ein Wechsel (${planText(plan.bestSwitch.blocks, names)}) hätte im Rückblick ` +
      `${savingText(plan)} gespart. Dieser Vorteil liegt im Bereich normaler Preisschwankungen von ` +
      'Jahr zu Jahr; ein Wechsel allein deshalb ist nicht zu empfehlen.',
  )
}

/** Der Plan der Hochrechnung, nur wenn das Jahreskapitel steht: dieselbe Bedingung wie dort. */
export function annualSwitchOf(
  analysis: PdfReportAnalysis,
  pv: AnnualBasisPvInput,
): AnnualSwitch | null {
  const scenario = analysis.annualScenario
  const plan = scenario?.switchPlan
  if (!plan || !annualBasisApplies(scenario, analysis.tariffOptimization?.monthlyComparison, pv)) {
    return null
  }
  return { plan, measuredDays: scenario.measuredDays }
}

/** Stufe 1 im Jahreskapitel. Bleibt ausserhalb der Wege: die Beträge gelten für 365 Tage. */
export function annualSwitchStatementOf(
  { plan, measuredDays }: AnnualSwitch,
  names: SwitchPlanNames,
): ReportStatement | null {
  if (plan.status !== 'ok' || switchPlanStageOf(plan) !== 'weg') return null
  return {
    id: 'annual_scenario_switch',
    title: 'Tarifwechsel im Jahreslauf (Hochrechnung)',
    amount: null,
    rows: planCostRows(plan, names),
    body:
      'Auf Basis Ihres hochgerechneten Jahresverbrauchs und der tatsächlichen Börsenpreise wäre ein ' +
      `Tarifwechsel zweimal im Jahr am günstigsten: ${planText(plan.bestSwitch.blocks, names)}. ` +
      `Gegenüber dem günstigeren Einzeltarif (${tariffLabel(plan.bestSingle.tariffId, names)}) spart ` +
      `das rund ${savingText(plan)} im Jahr. Gemessen sind ${measuredDays} Tage; die übrigen Tage ` +
      'sind aus Ihren gemessenen Wochen hochgerechnet, die Börsenpreise sind die tatsächlichen ' +
      'dieser Tage. Ob sich ein Wechsel künftig lohnt, hängt von der weiteren Preisentwicklung ab. ' +
      'Speicher und Steuerung sind hier nicht eingerechnet.',
  }
}

/** Stufe 2 und das geprüfte Nein im Jahreskapitel. */
export function annualSwitchNoticeOf(
  { plan }: AnnualSwitch,
  names: SwitchPlanNames,
): ReportNotice | null {
  if (plan.status !== 'ok') return null
  const id = 'annual_scenario_switch_hint'
  const reason = noSwitchReasonOf(plan)
  if (reason) {
    return switchNotice(
      id,
      `Auf Basis der Hochrechnung wurde auch ein Tarifwechsel zweimal im Jahr zwischen ` +
        `${tariffPair(names)} geprüft: ${noSwitchVerdict(plan, reason, names)}`,
    )
  }
  if (switchPlanStageOf(plan) !== 'hinweis') return null
  return switchNotice(
    id,
    `Auf Basis der Hochrechnung würde ein Tarifwechsel zweimal im Jahr ` +
      `(${planText(plan.bestSwitch.blocks, names)}) rund ${savingText(plan)} im Jahr sparen. Dieser ` +
      'Vorteil liegt im Bereich normaler Preisschwankungen von Jahr zu Jahr; ein Wechsel allein ' +
      'deshalb ist nicht zu empfehlen.',
  )
}

/** Die Zeile für Zusammenfassung und Vorderseite, nur in Stufe 1: nie eine Empfehlung. */
export function seasonalSwitchReviewOf(
  analysis: PdfReportAnalysis,
  pv: AnnualBasisPvInput,
): string | null {
  const names = switchPlanNamesOf(analysis)
  const plan = analysis.tariffSwitchPlan
  if (plan?.status === 'ok' && switchPlanStageOf(plan) === 'weg') {
    return (
      `Rückblick Tarifwechsel: Mit ${planText(plan.bestSwitch.blocks, names)} ` +
      `hätten Sie im betrachteten Zeitraum ${savingText(plan)} gegenüber dem günstigeren Einzeltarif ` +
      'gespart – keine Empfehlung, sondern ein Hinweis, wie stark die Tarife übers Jahr ' +
      'auseinanderlaufen.'
    )
  }
  const annual = annualSwitchOf(analysis, pv)?.plan
  if (annual?.status !== 'ok' || switchPlanStageOf(annual) !== 'weg') return null
  return (
    `Tarifwechsel (Hochrechnung): Mit ${planText(annual.bestSwitch.blocks, names)} würden Sie auf ` +
    `Basis Ihres hochgerechneten Jahresverbrauchs rund ${savingText(annual)} im Jahr gegenüber dem ` +
    'günstigeren Einzeltarif sparen – keine Empfehlung, sondern ein Hinweis, wie stark die Tarife ' +
    'übers Jahr auseinanderlaufen.'
  )
}

const SOURCE_LABEL: Record<ComparisonTariffSource, string> = {
  tarife_at: 'tarife.at',
  durchblicker_at: 'durchblicker.at',
  angebot: 'Angebot',
  sonstige: 'sonstiger Quelle',
}

const INSUFFICIENT_REASON: Record<SwitchPlanInsufficientReason, string> = {
  short_period: 'der Lastgang umfasst weniger als ein Jahr',
  overlap: 'der Lastgang umfasst mehr als ein Jahr',
  missing_months: 'für einzelne Monate fehlen Werte',
}

/** Ohne `loadProfile` zählt die Hochrechnung nicht: die Bedingung des Jahreskapitels liest ihn. */
export type ComparisonTariffHintsInput = Pick<PdfReportInput, 'comparisonTariffOrigin' | 'country'> &
  Partial<Pick<PdfReportInput, 'hasPv' | 'estimatedPv' | 'loadProfile'>>

/** Herkunft des Vergleichstarifs und Reichweite der Wechselprüfung — leer ohne Vergleichstarif. */
export function comparisonTariffHintsOf(
  analysis: PdfReportAnalysis,
  input?: ComparisonTariffHintsInput,
): string[] {
  const supplier = comparisonSupplierOf(analysis)
  if (supplier === null) return []

  const origin = input?.comparisonTariffOrigin
  const source = origin?.source ? ` laut ${SOURCE_LABEL[origin.source]}` : ''
  const date = origin?.offerDate ? ` vom ${formatDateOnly(origin.offerDate)}` : ''
  const hints = [
    `Vergleichstarif: ${supplier},${source}${date}${source || date ? ',' : ''} ohne Bindung und ohne Neukundenbonus.`,
  ]
  if (origin?.enteredPriceBasis === 'gross') {
    const ratePercent = Math.round(vatRateFor(input?.country) * 100)
    hints.push(
      `Der Vergleichstarif wurde als Bruttopreis erfasst und mit ${ratePercent} % Umsatzsteuer auf netto umgerechnet.`,
    )
  }

  // „Geprüft" stimmt nur mit Plan: ohne genug Daten sagt der zweite Satz, warum es nicht ging.
  const plan = analysis.tariffSwitchPlan
  const annual = input?.loadProfile
    ? annualSwitchOf(analysis, { ...input, loadProfile: input.loadProfile })
    : null
  if (plan?.status === 'ok') {
    hints.push(
      'Der unterjährige Tarifwechsel wurde ohne Speicher und Steuerung geprüft (höchstens zwei ' +
        'Wechsel pro Jahr, je 6 Monate).',
    )
  } else if (annual?.plan.status === 'ok') {
    hints.push(
      `Der unterjährige Tarifwechsel wurde auf Basis der Jahres-Hochrechnung geprüft (${annual.measuredDays} ` +
        'gemessene Tage), ohne Speicher und Steuerung (höchstens zwei Wechsel pro Jahr, je 6 Monate).',
    )
  } else if (annual?.plan.status === 'insufficient_data' && annual.plan.reason === 'short_measurement') {
    hints.push(
      'Für die Prüfung eines unterjährigen Tarifwechsels sind mindestens 90 gemessene Tage nötig; ' +
        `gemessen sind ${annual.measuredDays}.`,
    )
  } else if (plan) {
    hints.push(
      'Für die Prüfung eines unterjährigen Tarifwechsels sind 12 vollständige Monate Lastgang ' +
        `nötig; ${INSUFFICIENT_REASON[plan.reason]}.`,
    )
  }
  return hints
}
