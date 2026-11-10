import {
  annualScenarioInvolvesPv,
  displayedPriceBasis,
  effectiveBillingModel,
  type BatteryRoiEntry,
  type BillingModel,
} from 'shared'

import { buildYearSeries } from '@/components/report/cost-chart'
import { localMonthIndex } from '@/lib/local-time'
import {
  hasDemandChargeComponent,
  displayedInvestmentOf,
  dynamicTariffHintKind,
  dynamicTariffHintText,
  hasEnteredSubsidy,
  perYearText,
  storageJudgementText,
  storagePaysOff,
  dynamicTariffOf,
} from '@/lib/report-copy'
import { annualScenarioSavingsOf } from './annual-scenario'
import { dailyPeaksOf } from './daily-peaks'
import { detailChartPlan } from './detail'
import type { LoadInput } from './executive-summary-load-chart'
import { amortizationYearsOf, headlineStorageOf } from './headline-storage'
import { peakShavingChartData } from './peak-shaving-chart'
import { SHOW_ANNUAL_SCENARIO_CHAPTER } from './report-flags'
import { seasonalSwitchReviewOf } from './seasonal-switch'
import { tierChangesWithStorage } from './tier-change'
import {
  ownTariffCostTodayOf,
  recommendedEntryOf,
  summaryWaysOf,
  unknownTariffWaysOf,
} from './summary'
import type { PdfReportInput } from './types'
import { buildWaysChapter } from './ways'

/**
 * Die Vorderseite „Auf einen Blick" als Daten — sie rechnet nichts neu, jede Zahl kommt aus einer
 * bestehenden Funktion. Jeder Report hat eine; die volle Fassung braucht eine Jahresbasis, sonst
 * steht eine einfachere (`measured`: Beträge über den gemessenen Zeitraum, nichts hochgerechnet).
 */
export type ExecutiveSummaryBasis = 'projected' | 'annual' | 'linear' | 'measured'

/**
 * `tarif-unbekannt`: Liefertarif unbekannt, ein ganzes gemessenes Jahr, Speicher rechnet sich — die
 * Ersparnis ist allein die des Speichers gegenüber aWATTar ohne Speicher; ein Tarifwechsel ist nicht
 * bewertbar. Teiljahr oder ohne Speicherempfehlung gibt es bei unbekanntem Tarif keine Vorderseite.
 */
export type ExecutiveSummaryVariant =
  | 'tarif-und-speicher'
  | 'nur-tarif'
  | 'speicher-lohnt-nicht'
  | 'tarif-unbekannt'
  /** Ohne Konditionen des dynamischen Tarifs: kein Tarifwechsel, der Speicher rechnet sich im eigenen Tarif. */
  | 'nur-speicher'
  | SimpleVariant

/**
 * Die einfacheren Fassungen (`simpleSummaryOf`), je eine für jeden Grund, aus dem die volle entfällt:
 * kein Jahr (`messzeitraum`), Jahreslauf mit anderem Gerät (`messzeitraum-anderes-geraet`),
 * unbekannter Tarif im Teiljahr, Bestandsspeicher, weder Börsenseite noch Speicher, unbekannter
 * Tarif ohne lohnenden Speicher.
 */
export type SimpleVariant =
  | 'messzeitraum'
  | 'messzeitraum-anderes-geraet'
  | 'tarif-unbekannt-messzeitraum'
  | 'bestandsspeicher'
  | 'nur-kosten'
  | 'tarif-unbekannt-ohne-speicher'

type SimpleReason =
  | 'keine-jahresbasis'
  | 'bestandsspeicher'
  | 'anderes-geraet'
  | 'nur-kosten'
  | 'tarif-unbekannt-ohne-speicher'

export type ExecutiveSummaryWayId = 'today' | 'comparison' | 'spot' | 'spot-storage'

export type ExecutiveSummaryWay = {
  id: ExecutiveSummaryWayId
  /** Name des Lieferanten, nur beim selbst gefundenen Vergleichstarif. */
  supplier: string | null
  /** Stromkosten pro Jahr (bei Basis `measured`: über den gemessenen Zeitraum), ohne Leistungspreis. */
  costPerYearEur: number
  isToday: boolean
  isRecommended: boolean
}

export type ExecutiveSummaryStage = {
  id: 'ohne-anschaffung' | 'mit-speicher'
  savingPerYearEur: number
}

export type ExecutiveSummaryStorage = {
  name: string
  /** Der Speicher wechselt die Netzentgelt-Stufe (`tierChangesWithStorage`) — nur Beschriftung. */
  tierChange: boolean
  usableKwh: number
  investment: ReturnType<typeof displayedInvestmentOf>
  hasSubsidy: boolean
  /** Investition nach Förderung, ungerundet — Grundlage jeder Rückzahlzeit dieser Seite. */
  netInvestmentEur: number
  includes: { installation: boolean; foundation: boolean; extraInverter: boolean }
  savingPerYearEur: number
  loadShiftEur: number
  peakEur: number
  amortizationYears: number
  /**
   * Rückzahlzeit allein aus dem günstigen Laden (ohne Spitzenersparnis) — nur gesetzt, wenn die
   * Spitzenersparnis enthalten ist und das Laden etwas bringt; dieselbe Rechnung wie `amortizationYears`.
   */
  paybackWithoutPeaksYears: number | null
  paybackWithoutPeaksBeyondHorizon: boolean
  /** Die Spitzenersparnis ist enthalten und eine Obergrenze. */
  upperBound: boolean
  netSavingOverHorizonEur: number
  horizonYears: number
  breakEven: { year: number; withoutStorageEur: number; withStorageEur: number }[]
}

export type ExecutiveSummary = {
  variant: ExecutiveSummaryVariant
  /** Nur in Stufe 1 — steht unter den Wegen und ist keine Empfehlung (`seasonalSwitchReviewOf`). */
  switchReview?: string
  /** Anzeigebasis der Beträge; fehlt = netto. */
  priceBasis?: 'gross'
  /** Nur bei einer einfacheren Fassung; ihre Leser im Report-Körper behandeln sie wie „keine Vorderseite". */
  simple?: {
    /** Tarifwechsel gegenüber heute in der Basis der Seite; `null` ohne Tarifvergleich. */
    switchSavingEur: number | null
    /** Bezug der Speicher-Ersparnis wie im Körper („pro Jahr (auf ein Jahr hochgerechnet)"). */
    storagePerYear: string | null
    /** Warum kein Speichervorschlag dasteht — nur bei `nur-kosten`. */
    noStorageNote: string | null
  }
  header: {
    customerName: string | null
    period: string | null
    printedAt: string
    savingPerYearEur: number
    /** Vorerst immer `undefined`: „Ihr Tarif heute" enthält den Leistungspreis nicht. */
    savingPercent?: number
    basis: ExecutiveSummaryBasis
    measuredDays: number
    projectedDays: number
  }
  stages: ExecutiveSummaryStage[]
  ways: ExecutiveSummaryWay[]
  /** `null` bei unbekanntem Liefertarif. */
  todayCostPerYearEur: number | null
  hasLeistungspreis: boolean
  /** Wählt den Satz, welche Spitze die Gebühr bestimmt; fehlt = Monatsmodell (Satz wie bisher). */
  billingModel?: BillingModel
  /** Name des dynamischen Tarifs (`dynamicTariffOf`); fehlt = Fallback-Name. */
  tariffName?: string
  storage: ExecutiveSummaryStorage | null
  /** Bewertung des Katalog-Speichers, wenn er sich nicht rechnet. */
  storageVerdict: { name: string; savingPerYearEur: number; judgement: string } | null
  load: LoadInput
  confidence: {
    measuredDays: number
    projectedDays: number
    isProjected: boolean
    hasUpperBound: boolean
    spotTariffRecommended: boolean
    /** Lokale Monate (0 = Jänner) mit Messwerten. */
    measuredMonths: number[]
  }
}

/** Jahreskosten je Weg, aus dem Jahresszenario oder aus einem ganzen gemessenen Jahr. */
type YearlyWays = {
  basis: ExecutiveSummaryBasis
  measuredDays: number
  projectedDays: number
  /** `null` bei unbekanntem Liefertarif. */
  todayEur: number | null
  comparison: { eur: number; supplier: string | null } | null
  /** `null` ohne Börsenseite (Konditionen des dynamischen Tarifs fehlen). */
  spotEur: number | null
  spotStorageEur: number | null
}

/** Ab 365 Tagen gilt der Lastgang als Jahr — dieselbe Grenze wie `annualizationFactor` (Engine). */
const DAYS_PER_YEAR = 365

/** Untergrenze der linearen Hochrechnung: darunter fehlt zu viel vom Jahresgang. */
export const MIN_DAYS_LINEAR_ANNUAL = 335

function yearlyWaysOf(input: PdfReportInput): YearlyWays | null {
  const analysis = input.analysis
  const measured = summaryWaysOf(analysis)
  const own = measured ? null : ownTariffCostTodayOf(analysis)
  if (own) return ownTariffYearlyOf(input, own)
  if (!measured) {
    // Liefertarif unbekannt: nur mit einem ganzen gemessenen Jahr, sonst fehlt die Jahresbasis.
    const unknown = unknownTariffWaysOf(analysis)
    if (!unknown || unknown.coveredDays < DAYS_PER_YEAR) return null
    return {
      basis: 'annual',
      measuredDays: unknown.coveredDays,
      projectedDays: 0,
      todayEur: null,
      comparison: null,
      spotEur: unknown.uncontrolledEur,
      spotStorageEur: unknown.controlledEur,
    }
  }
  const annual = SHOW_ANNUAL_SCENARIO_CHAPTER ? annualScenarioSavingsOf(analysis, input) : null
  if (annual) {
    const ways = annual.scenario.ways
    return {
      basis: 'projected',
      measuredDays: annual.scenario.measuredDays,
      projectedDays: annual.scenario.projectedDays,
      todayEur: annual.currentTariffEur,
      comparison:
        ways.comparisonTariffEur === null
          ? null
          : { eur: ways.comparisonTariffEur, supplier: ways.comparisonSupplier },
      spotEur: annual.spotWithoutControlEur,
      spotStorageEur: annual.controlledEur,
    }
  }
  if (measured.coveredDays >= DAYS_PER_YEAR) return measuredYearlyWays(measured, 'annual', 1)
  // Mit PV entfällt das Jahresszenario; fast ein ganzes Jahr trägt dann eine lineare Streckung.
  if (annualScenarioInvolvesPv(input) && measured.coveredDays >= MIN_DAYS_LINEAR_ANNUAL) {
    return measuredYearlyWays(measured, 'linear', DAYS_PER_YEAR / measured.coveredDays)
  }
  return null
}

/** Ohne Börsenseite: nur „Ihr Tarif heute", aus dem Jahreslauf oder dem gemessenen Zeitraum. */
function ownTariffYearlyOf(
  input: PdfReportInput,
  own: NonNullable<ReturnType<typeof ownTariffCostTodayOf>>,
): YearlyWays | null {
  const ownWays = (
    basis: ExecutiveSummaryBasis,
    todayEur: number,
    measuredDays: number,
    projectedDays = 0,
  ) => ({
    basis,
    measuredDays,
    projectedDays,
    todayEur,
    comparison: null,
    spotEur: null,
    spotStorageEur: null,
  })
  const annual = SHOW_ANNUAL_SCENARIO_CHAPTER
    ? annualScenarioSavingsOf(input.analysis, input)
    : null
  if (annual) {
    return ownWays(
      'projected',
      annual.currentTariffEur,
      annual.scenario.measuredDays,
      annual.scenario.projectedDays,
    )
  }
  if (own.coveredDays >= DAYS_PER_YEAR) return ownWays('annual', own.costTodayEur, own.coveredDays)
  if (annualScenarioInvolvesPv(input) && own.coveredDays >= MIN_DAYS_LINEAR_ANNUAL) {
    return ownWays('linear', (own.costTodayEur * DAYS_PER_YEAR) / own.coveredDays, own.coveredDays)
  }
  return null
}

/** Die gemessenen Wege als Jahreskosten, mit `factor` auf ein Jahr gestreckt (1 bei einem ganzen Jahr). */
function measuredYearlyWays(
  measured: NonNullable<ReturnType<typeof summaryWaysOf>>,
  basis: ExecutiveSummaryBasis,
  factor: number,
): YearlyWays {
  const byId = (id: string) => measured.ways.find((way) => way.id === id)
  const comparison = byId('comparison_tariff')
  const controlled = byId('controlled')
  return {
    basis,
    measuredDays: measured.coveredDays,
    projectedDays: 0,
    todayEur: measured.costTodayEur * factor,
    comparison: comparison
      ? { eur: comparison.costEur * factor, supplier: measured.comparisonSupplier }
      : null,
    spotEur: byId('tariff_switch')!.costEur * factor,
    spotStorageEur: controlled ? controlled.costEur * factor : null,
  }
}

const euros = (value: number): number => Math.round(value)

function storageOf(
  input: PdfReportInput,
  entry: BatteryRoiEntry,
  headline: ReturnType<typeof headlineStorageOf>,
): ExecutiveSummaryStorage {
  const plan = detailChartPlan(input.analysis, input).cost
  const series =
    plan?.kind === 'cumulative'
      ? buildYearSeries(plan.entry, plan.currentLeistungspreisCostPerYear, plan.horizonYears)
      : []
  const b = entry.battery
  const horizonYears = input.analysis.assumptions.horizonYears
  const paybackWithoutPeaksYears =
    headline.spitzenEur > 0 && headline.ladesteuerungEur > 0
      ? amortizationYearsOf(entry.netInvestment, headline.ladesteuerungEur)
      : null
  return {
    name: b.name,
    tierChange: tierChangesWithStorage(input.analysis.current, entry),
    usableKwh: b.usableCapacityKwh,
    investment: displayedInvestmentOf(entry, input.analysis.assumptions.subsidyPrograms),
    hasSubsidy: hasEnteredSubsidy(entry),
    netInvestmentEur: entry.netInvestment,
    includes: {
      installation: (b.installationCost ?? 0) > 0,
      foundation: b.requiresFoundation === true && (b.foundationCost ?? 0) > 0,
      extraInverter: !b.inverterIncluded && (b.extraInverterCost ?? 0) > 0,
    },
    savingPerYearEur: headline.savingPerYearEur,
    loadShiftEur: headline.ladesteuerungEur,
    peakEur: headline.spitzenEur,
    amortizationYears: headline.amortizationYears,
    paybackWithoutPeaksYears,
    paybackWithoutPeaksBeyondHorizon:
      paybackWithoutPeaksYears !== null && paybackWithoutPeaksYears > horizonYears,
    upperBound: headline.spitzenEur > 0,
    netSavingOverHorizonEur: headline.netSavingOverHorizonEur,
    horizonYears,
    breakEven: series.map((point) => ({
      year: point.year,
      withoutStorageEur: point.without,
      withStorageEur: point.with,
    })),
  }
}

/** Jeder Report hat eine Vorderseite: die volle, sonst eine einfachere Fassung (`simpleSummaryOf`). */
export function buildExecutiveSummary(input: PdfReportInput): ExecutiveSummary {
  const full = fullSummaryOf(input)
  return typeof full === 'string' ? simpleSummaryOf(input, full) : full
}

/** Die volle Vorderseite mit Jahresbasis — oder der Grund, warum es nur die einfachere Fassung gibt. */
function fullSummaryOf(input: PdfReportInput): ExecutiveSummary | SimpleReason {
  const analysis = input.analysis
  const yearly = yearlyWaysOf(input)
  if (!yearly) return 'keine-jahresbasis'

  // Mit Bestandsspeicher ist offen, wohin dessen Spitzenersparnis gehört — dafür die einfachere Fassung.
  if (analysis.existingBatteryAnalysis != null) return 'bestandsspeicher'
  const entry = recommendedEntryOf(analysis)
  const catalogStorage =
    analysis.recommendation && entry && !dynamicTariffHintKind(analysis) ? entry : undefined
  const headline = catalogStorage ? headlineStorageOf(analysis, catalogStorage, input) : null
  // Rechnet das Jahresszenario mit einem anderen Gerät, stünden Jahres- und lineare Zahlen nebeneinander.
  if (yearly.basis === 'projected' && headline && headline.basis !== 'annual') return 'anderes-geraet'
  const paysOff =
    headline !== null && storagePaysOff({ netSavingOverHorizon: headline.netSavingOverHorizonEur })

  const tariffKnown = yearly.todayEur !== null
  // Ohne Börsenseite gibt es keinen Tarifwechsel; ohne Speicher dann auch nichts für diese Seite.
  const spotEur = yearly.spotEur
  if (spotEur === null && !headline) return 'nur-kosten'
  if (!tariffKnown && !(paysOff && yearly.spotStorageEur !== null)) return 'tarif-unbekannt-ohne-speicher'
  const variant: ExecutiveSummaryVariant = !tariffKnown
    ? 'tarif-unbekannt'
    : !headline
      ? 'nur-tarif'
      : paysOff
        ? spotEur === null
          ? 'nur-speicher'
          : 'tarif-und-speicher'
        : 'speicher-lohnt-nicht'

  // Stufe 1: ohne neue Anschaffung. Mit neuem Speicher gilt aWATTar, weil er darauf aufbaut.
  const withStorage =
    variant === 'nur-speicher' ||
    ((variant === 'tarif-und-speicher' || variant === 'tarif-unbekannt') &&
      yearly.spotStorageEur !== null)
  const bestTariff =
    spotEur === null
      ? null
      : yearly.comparison && yearly.comparison.eur < spotEur && !withStorage
        ? ('comparison' as const)
        : ('spot' as const)
  const tariffCost = bestTariff === 'comparison' ? yearly.comparison!.eur : spotEur
  const stages: ExecutiveSummaryStage[] =
    yearly.todayEur === null || tariffCost === null
      ? []
      : [{ id: 'ohne-anschaffung', savingPerYearEur: euros(yearly.todayEur - tariffCost) }]
  const storage = withStorage && headline ? storageOf(input, catalogStorage!, headline) : null
  if (storage) stages.push({ id: 'mit-speicher', savingPerYearEur: storage.savingPerYearEur })

  // Ohne Börsenseite steht nur „Ihr Tarif heute" da, und es gibt keinen empfohlenen Weg.
  const recommendedWay: ExecutiveSummaryWayId | null =
    spotEur === null ? null : withStorage ? 'spot-storage' : bestTariff
  const way = (
    id: ExecutiveSummaryWayId,
    costPerYearEur: number,
    supplier: string | null = null,
  ): ExecutiveSummaryWay => ({
    id,
    supplier,
    costPerYearEur,
    isToday: id === 'today',
    isRecommended: id === recommendedWay,
  })
  const ways = [
    ...(yearly.todayEur !== null ? [way('today', yearly.todayEur)] : []),
    ...(yearly.comparison
      ? [way('comparison', yearly.comparison.eur, yearly.comparison.supplier)]
      : []),
    ...(spotEur !== null ? [way('spot', spotEur)] : []),
    ...(yearly.spotStorageEur !== null ? [way('spot-storage', yearly.spotStorageEur)] : []),
  ]

  const switchReview = seasonalSwitchReviewOf(analysis, input)

  return {
    variant,
    ...(switchReview ? { switchReview } : {}),
    // Abgelesen an den Zahlen selbst; nur bei Brutto gesetzt, damit die Netto-Seite bitgleich bleibt.
    ...(displayedPriceBasis(analysis) === 'gross' ? { priceBasis: 'gross' as const } : {}),
    header: {
      customerName: input.customer?.company ?? input.customer?.name ?? null,
      period: input.period,
      printedAt: input.printedAt,
      savingPerYearEur: stages.reduce((sum, stage) => sum + stage.savingPerYearEur, 0),
      basis: yearly.basis,
      measuredDays: yearly.measuredDays,
      projectedDays: yearly.projectedDays,
    },
    stages,
    ways,
    todayCostPerYearEur: yearly.todayEur,
    hasLeistungspreis: hasDemandChargeComponent(analysis.current),
    billingModel: effectiveBillingModel(analysis.assumptions.billingModel),
    tariffName: dynamicTariffOf(analysis).name,
    storage,
    storageVerdict:
      variant === 'speicher-lohnt-nicht' && headline
        ? {
            name: catalogStorage!.battery.name,
            savingPerYearEur: headline.savingPerYearEur,
            judgement: storageJudgementText(
              { netSavingOverHorizon: headline.netSavingOverHorizonEur },
              analysis.assumptions.horizonYears,
            ),
          }
        : null,
    load: loadOf(input, storage),
    confidence: {
      measuredDays: yearly.measuredDays,
      projectedDays: yearly.projectedDays,
      isProjected: yearly.basis === 'projected',
      hasUpperBound: storage?.upperBound ?? false,
      spotTariffRecommended: recommendedWay === 'spot' || recommendedWay === 'spot-storage',
      measuredMonths: measuredMonthsOf(input),
    },
  }
}

/** Lastgang-Block: Tagesspitzen, mit Kappung die Linie des Speichers. */
function loadOf(input: PdfReportInput, storage: ExecutiveSummaryStorage | null): LoadInput {
  const analysis = input.analysis
  const capSegments =
    storage && storage.peakEur > 0
      ? (peakShavingChartData(analysis, input.loadProfile, buildWaysChapter(analysis, input))
          ?.capSegments ?? null)
      : null
  return {
    dailyPeaks: dailyPeaksOf(input.loadProfile),
    capSegments,
    ...(input.country ? { country: input.country } : {}),
  }
}

/** Lokale Monate (0 = Jänner) mit Messwerten. */
function measuredMonthsOf(input: PdfReportInput): number[] {
  const tz = input.loadProfile.timezoneMeta
  return [
    ...new Set(input.loadProfile.readings.map((r) => localMonthIndex(Date.parse(r.ts), tz))),
  ].sort((a, b) => a - b)
}

/** Die Wege über den gemessenen Zeitraum, nicht hochgerechnet; `null` ohne jeden Tarifvergleich. */
function measuredWaysOf(analysis: PdfReportInput['analysis']): YearlyWays | null {
  const measured = summaryWaysOf(analysis)
  if (measured) return measuredYearlyWays(measured, 'measured', 1)
  const blank = { basis: 'measured' as const, projectedDays: 0, comparison: null }
  const own = ownTariffCostTodayOf(analysis)
  if (own) {
    const days = own.coveredDays
    return { ...blank, measuredDays: days, todayEur: own.costTodayEur, spotEur: null, spotStorageEur: null }
  }
  const unknown = unknownTariffWaysOf(analysis)
  if (unknown) {
    return {
      ...blank,
      measuredDays: unknown.coveredDays,
      todayEur: null,
      spotEur: unknown.uncontrolledEur,
      spotStorageEur: unknown.controlledEur,
    }
  }
  return null
}

function simpleVariantOf(
  analysis: PdfReportInput['analysis'],
  reason: SimpleReason,
  storagePays: boolean,
  measured: YearlyWays | null,
  hasStorage: boolean,
): SimpleVariant {
  // Vor „keine Jahresbasis": ein Bestandsspeicher bestimmt die Fassung auch im Teiljahr.
  if (reason === 'bestandsspeicher' || analysis.existingBatteryAnalysis != null) {
    return 'bestandsspeicher'
  }
  if (unknownTariffWaysOf(analysis)) {
    return storagePays && measured?.spotStorageEur != null
      ? 'tarif-unbekannt-messzeitraum'
      : 'tarif-unbekannt-ohne-speicher'
  }
  if (reason === 'nur-kosten' || (measured?.spotEur == null && !hasStorage)) return 'nur-kosten'
  if (reason === 'anderes-geraet') return 'messzeitraum-anderes-geraet'
  return 'messzeitraum'
}

/** Warum bei `nur-kosten` kein Speicher dasteht — Wortlaut angelehnt an „Annahmen und Datengrundlage". */
function noStorageNoteOf(analysis: PdfReportInput['analysis']): string | null {
  const hint = dynamicTariffHintKind(analysis)
  if (hint) return dynamicTariffHintText(hint)
  return analysis.noRecommendationReason === 'no_candidates'
    ? 'Ein Speichervorschlag ist nicht enthalten, weil für diese Kundenkategorie noch kein Speicher im Katalog freigegeben ist.'
    : null
}

/**
 * Die einfachere Vorderseite. Jahreswerte nur, wo die volle Seite sie ebenso hätte (Bestandsspeicher,
 * nur Kosten, unbekannter Tarif ohne Speicher); die Messzeitraum-Fassungen zeigen die Wege über den
 * gemessenen Zeitraum und den Speicher mit seinem Jahreswert aus dem Körper. Kein Tarifwechsel-Anteil
 * in `stages`, damit nichts Perioden- und Jahreswert addiert.
 */
function simpleSummaryOf(input: PdfReportInput, reason: SimpleReason): ExecutiveSummary {
  const analysis = input.analysis
  const entry = recommendedEntryOf(analysis)
  const catalogStorage =
    analysis.existingBatteryAnalysis == null &&
    analysis.recommendation &&
    entry &&
    !dynamicTariffHintKind(analysis)
      ? entry
      : undefined
  const headline = catalogStorage ? headlineStorageOf(analysis, catalogStorage, input) : null
  const paysOff =
    headline !== null && storagePaysOff({ netSavingOverHorizon: headline.netSavingOverHorizonEur })
  const measured = measuredWaysOf(analysis)
  const variant = simpleVariantOf(analysis, reason, paysOff, measured, headline !== null)
  const keepsYear =
    variant === 'bestandsspeicher' ||
    variant === 'nur-kosten' ||
    variant === 'tarif-unbekannt-ohne-speicher'
  const yearly = (keepsYear ? yearlyWaysOf(input) : null) ?? measured
  const basis: ExecutiveSummaryBasis = yearly?.basis ?? 'measured'

  const showsStorage =
    variant === 'messzeitraum' ||
    variant === 'messzeitraum-anderes-geraet' ||
    variant === 'tarif-unbekannt-messzeitraum'
  const storage =
    showsStorage && paysOff && headline ? storageOf(input, catalogStorage!, headline) : null

  const today = yearly?.todayEur ?? null
  const spotEur = yearly?.spotEur ?? null
  const candidates: { id: ExecutiveSummaryWayId; eur: number }[] = [
    ...(yearly?.comparison ? [{ id: 'comparison' as const, eur: yearly.comparison.eur }] : []),
    ...(spotEur !== null ? [{ id: 'spot' as const, eur: spotEur }] : []),
    ...(yearly?.spotStorageEur != null ? [{ id: 'spot-storage' as const, eur: yearly.spotStorageEur }] : []),
  ]
  const cheapest = (ids: ExecutiveSummaryWayId[]) =>
    candidates
      .filter((c) => ids.includes(c.id))
      .reduce<{ id: ExecutiveSummaryWayId; eur: number } | null>(
        (best, c) => (best === null || c.eur < best.eur ? c : best),
        null,
      )
  // Der Tarifweg ohne neuen Speicher; beim Bestandsspeicher zählt dessen Ladesteuerung dazu.
  const tariffWay =
    variant === 'nur-kosten' || variant === 'tarif-unbekannt-ohne-speicher'
      ? null
      : cheapest(
          variant === 'bestandsspeicher'
            ? ['comparison', 'spot', 'spot-storage']
            : storage
              ? ['spot']
              : ['comparison', 'spot'],
        )
  const recommendedWay: ExecutiveSummaryWayId | null =
    storage && yearly?.spotStorageEur != null
      ? 'spot-storage'
      : tariffWay && (today === null || tariffWay.eur < today)
        ? tariffWay.id
        : null
  const switchSavingEur =
    today !== null && tariffWay && variant !== 'tarif-unbekannt-messzeitraum'
      ? today - tariffWay.eur
      : null

  const way = (id: ExecutiveSummaryWayId, cost: number, supplier: string | null = null) => ({
    id,
    supplier,
    costPerYearEur: cost,
    isToday: id === 'today',
    isRecommended: id === recommendedWay,
  })
  const ways: ExecutiveSummaryWay[] = yearly
    ? [
        ...(today !== null ? [way('today', today)] : []),
        ...(yearly.comparison
          ? [way('comparison', yearly.comparison.eur, yearly.comparison.supplier)]
          : []),
        ...(spotEur !== null ? [way('spot', spotEur)] : []),
        ...(yearly.spotStorageEur != null ? [way('spot-storage', yearly.spotStorageEur)] : []),
      ]
    : []

  const storageVerdict =
    headline && !paysOff && variant !== 'bestandsspeicher'
      ? {
          name: catalogStorage!.battery.name,
          savingPerYearEur: headline.savingPerYearEur,
          judgement: storageJudgementText(
            { netSavingOverHorizon: headline.netSavingOverHorizonEur },
            analysis.assumptions.horizonYears,
          ),
        }
      : null

  return {
    variant,
    ...(displayedPriceBasis(analysis) === 'gross' ? { priceBasis: 'gross' as const } : {}),
    simple: {
      switchSavingEur,
      storagePerYear: headline
        ? headline.basis === 'annual'
          ? 'pro Jahr'
          : perYearText(catalogStorage!)
        : null,
      noStorageNote: variant === 'nur-kosten' ? noStorageNoteOf(analysis) : null,
    },
    header: {
      customerName: input.customer?.company ?? input.customer?.name ?? null,
      period: input.period,
      printedAt: input.printedAt,
      savingPerYearEur: storage?.savingPerYearEur ?? switchSavingEur ?? 0,
      basis,
      measuredDays: yearly?.measuredDays ?? analysis.dataQuality.coveredDays,
      projectedDays: yearly?.projectedDays ?? 0,
    },
    stages: [],
    ways,
    todayCostPerYearEur: today,
    hasLeistungspreis: hasDemandChargeComponent(analysis.current),
    billingModel: effectiveBillingModel(analysis.assumptions.billingModel),
    tariffName: dynamicTariffOf(analysis).name,
    storage,
    storageVerdict,
    load: loadOf(input, storage),
    confidence: {
      measuredDays: yearly?.measuredDays ?? analysis.dataQuality.coveredDays,
      projectedDays: yearly?.projectedDays ?? 0,
      isProjected: basis === 'projected',
      hasUpperBound: storage?.upperBound ?? false,
      spotTariffRecommended: recommendedWay === 'spot' || recommendedWay === 'spot-storage',
      measuredMonths: measuredMonthsOf(input),
    },
  }
}
