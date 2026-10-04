import type { BatteryRoiEntry } from 'shared'

import { buildYearSeries } from '@/components/report/cost-chart'
import { localMonthIndex } from '@/lib/local-time'
import {
  displayedInvestmentOf,
  dynamicTariffHintKind,
  hasEnteredSubsidy,
  storageJudgementText,
  storagePaysOff,
} from '@/lib/report-copy'
import { annualScenarioSavingsOf } from './annual-scenario'
import { dailyPeaksOf, type DailyPeak } from './daily-peaks'
import { detailChartPlan } from './detail'
import { amortizationYearsOf, headlineStorageOf } from './headline-storage'
import { peakShavingChartData, type PeakShavingCapSegment } from './peak-shaving-chart'
import { SHOW_ANNUAL_SCENARIO_CHAPTER } from './report-flags'
import { recommendedEntryOf, summaryWaysOf } from './summary'
import type { PdfReportInput } from './types'
import { buildWaysChapter } from './ways'

/**
 * Die Vorderseite „Auf einen Blick" als Daten — sie rechnet nichts neu, jede Zahl kommt aus einer
 * bestehenden Funktion. Es gibt sie nur mit einer Jahresbasis (Jahresszenario oder ein ganzes
 * gemessenes Jahr) und bekanntem Liefertarif, und vorerst nur für Betriebe.
 */
export type ExecutiveSummaryBasis = 'projected' | 'annual'

export type ExecutiveSummaryVariant = 'tarif-und-speicher' | 'nur-tarif' | 'speicher-lohnt-nicht'

export type ExecutiveSummaryWayId = 'today' | 'comparison' | 'spot' | 'spot-storage'

export type ExecutiveSummaryWay = {
  id: ExecutiveSummaryWayId
  /** Name des Lieferanten, nur beim selbst gefundenen Vergleichstarif. */
  supplier: string | null
  /** Stromkosten pro Jahr, ohne Leistungspreis — dieselbe Basis für alle Balken. */
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
  usableKwh: number
  investment: ReturnType<typeof displayedInvestmentOf>
  hasSubsidy: boolean
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
  todayCostPerYearEur: number
  hasLeistungspreis: boolean
  storage: ExecutiveSummaryStorage | null
  /** Bewertung des Katalog-Speichers, wenn er sich nicht rechnet. */
  storageVerdict: { name: string; savingPerYearEur: number; judgement: string } | null
  load: { dailyPeaks: DailyPeak[]; capSegments: PeakShavingCapSegment[] | null }
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
  todayEur: number
  comparison: { eur: number; supplier: string | null } | null
  spotEur: number
  spotStorageEur: number | null
}

/** Ab 365 Tagen gilt der Lastgang als Jahr — dieselbe Grenze wie `annualizationFactor` (Engine). */
const DAYS_PER_YEAR = 365

function yearlyWaysOf(input: PdfReportInput): YearlyWays | null {
  const analysis = input.analysis
  const measured = summaryWaysOf(analysis)
  if (!measured) return null
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
  if (measured.coveredDays < DAYS_PER_YEAR) return null
  const byId = (id: string) => measured.ways.find((way) => way.id === id)
  const comparison = byId('comparison_tariff')
  return {
    basis: 'annual',
    measuredDays: measured.coveredDays,
    projectedDays: 0,
    todayEur: measured.costTodayEur,
    comparison: comparison
      ? { eur: comparison.costEur, supplier: measured.comparisonSupplier }
      : null,
    spotEur: byId('tariff_switch')!.costEur,
    spotStorageEur: byId('controlled')?.costEur ?? null,
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
    usableKwh: b.usableCapacityKwh,
    investment: displayedInvestmentOf(entry, input.analysis.assumptions.subsidyPrograms),
    hasSubsidy: hasEnteredSubsidy(entry),
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

export function buildExecutiveSummary(input: PdfReportInput): ExecutiveSummary | null {
  // Privat (Anzeige inkl. USt, `displayPriceBasisFor('heim')`) folgt später.
  if ((input.priceDisplay ?? 'net') !== 'net') return null
  const analysis = input.analysis
  const yearly = yearlyWaysOf(input)
  if (!yearly) return null

  // Mit Bestandsspeicher ist offen, wohin dessen Spitzenersparnis gehört — vorerst keine Vorderseite.
  if (analysis.existingBatteryAnalysis != null) return null
  const entry = recommendedEntryOf(analysis)
  const catalogStorage =
    analysis.recommendation && entry && !dynamicTariffHintKind(analysis) ? entry : undefined
  const headline = catalogStorage ? headlineStorageOf(analysis, catalogStorage, input) : null
  // Rechnet das Jahresszenario mit einem anderen Gerät, stünden Jahres- und lineare Zahlen nebeneinander.
  if (yearly.basis === 'projected' && headline && headline.basis !== 'annual') return null
  const paysOff =
    headline !== null && storagePaysOff({ netSavingOverHorizon: headline.netSavingOverHorizonEur })

  const variant: ExecutiveSummaryVariant = !headline
    ? 'nur-tarif'
    : paysOff
      ? 'tarif-und-speicher'
      : 'speicher-lohnt-nicht'

  // Stufe 1: ohne neue Anschaffung. Mit neuem Speicher gilt aWATTar, weil er darauf aufbaut.
  const withStorage = variant === 'tarif-und-speicher' && yearly.spotStorageEur !== null
  const bestTariff =
    yearly.comparison && yearly.comparison.eur < yearly.spotEur && !withStorage
      ? ('comparison' as const)
      : ('spot' as const)
  const tariffCost = bestTariff === 'comparison' ? yearly.comparison!.eur : yearly.spotEur
  const stages: ExecutiveSummaryStage[] = [
    { id: 'ohne-anschaffung', savingPerYearEur: euros(yearly.todayEur - tariffCost) },
  ]
  const storage = withStorage && headline ? storageOf(input, catalogStorage!, headline) : null
  if (storage) stages.push({ id: 'mit-speicher', savingPerYearEur: storage.savingPerYearEur })

  const recommendedWay: ExecutiveSummaryWayId = withStorage ? 'spot-storage' : bestTariff
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
    way('today', yearly.todayEur),
    ...(yearly.comparison
      ? [way('comparison', yearly.comparison.eur, yearly.comparison.supplier)]
      : []),
    way('spot', yearly.spotEur),
    ...(yearly.spotStorageEur !== null ? [way('spot-storage', yearly.spotStorageEur)] : []),
  ]

  const capSegments =
    storage && storage.peakEur > 0
      ? (peakShavingChartData(analysis, input.loadProfile, buildWaysChapter(analysis, input))
          ?.capSegments ?? null)
      : null
  const tz = input.loadProfile.timezoneMeta
  const measuredMonths = [
    ...new Set(input.loadProfile.readings.map((r) => localMonthIndex(Date.parse(r.ts), tz))),
  ].sort((a, b) => a - b)

  return {
    variant,
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
    hasLeistungspreis: analysis.current.leistungspreisCostPerYear > 0,
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
    load: { dailyPeaks: dailyPeaksOf(input.loadProfile), capSegments },
    confidence: {
      measuredDays: yearly.measuredDays,
      projectedDays: yearly.projectedDays,
      isProjected: yearly.basis === 'projected',
      hasUpperBound: storage?.upperBound ?? false,
      spotTariffRecommended: recommendedWay === 'spot' || recommendedWay === 'spot-storage',
      measuredMonths,
    },
  }
}
