import { calculateRoi } from 'engine'
import type { BatteryResultEntry, BatteryRoiEntry, BatteryTaxEffect } from 'shared'

import { ifbEffectOf, type IfbEffect } from '@/lib/ifb-effect'
import { loadControlValueOf } from '@/lib/report-copy'
import {
  annualDeviceSavingEur,
  annualScenarioSavingsOf,
  type AnnualScenarioPvInput,
} from './annual-scenario'
import { SHOW_ANNUAL_SCENARIO_CHAPTER } from './report-flags'
import type { PdfReportAnalysis } from './types'
import { peakShavingSavingOf } from './ways'

/**
 * Die Speicher-Hauptzahl des Reports: Ersparnis pro Jahr, Amortisation und Netto über den Horizont
 * des gezeigten Geräts. Steht das Jahreskapitel im Report und rechnet es mit diesem Gerät, ist sie
 * dessen Speicher-Anteil („Davon durch den Speicher"), sonst die lineare Hochrechnung der Engine.
 * Jede Stelle, die eine dieser Zahlen zeigt, nimmt sie von hier — zwei Zahlen für dieselbe Sache
 * in einem Dokument sind der Fehler, den diese Datei verhindert.
 */
export type HeadlineStorage = {
  basis: 'annual' | 'linear'
  savingPerYearEur: number
  amortizationYears: number
  netSavingOverHorizonEur: number
  ladesteuerungEur: number
  spitzenEur: number
}

/** Ohne `pv` ist die Bedingung des Jahreskapitels nicht prüfbar — dann gilt `linear`. */
export function headlineStorageOf(
  analysis: PdfReportAnalysis,
  entry: BatteryRoiEntry,
  pv?: AnnualScenarioPvInput,
): HeadlineStorage {
  const annual = annualFor(analysis, entry, pv)
  if (annual) {
    const saving = annual.controlEur + annual.peakEur
    return {
      basis: 'annual',
      savingPerYearEur: saving,
      amortizationYears: amortizationYearsOf(entry.netInvestment, saving),
      netSavingOverHorizonEur: saving * analysis.assumptions.horizonYears - entry.netInvestment,
      ladesteuerungEur: annual.controlEur,
      spitzenEur: annual.peakEur,
    }
  }

  return {
    basis: 'linear',
    savingPerYearEur: entry.totalSavingPerYear,
    amortizationYears: entry.amortizationYears,
    netSavingOverHorizonEur: entry.netSavingOverHorizon,
    ladesteuerungEur: headlineLoadControlEur(analysis, entry, pv),
    spitzenEur: peakShavingSavingOf(analysis),
  }
}

/** Der Ladesteuerungs-Anteil allein — auch für einen Bestandsspeicher, der keine ROI-Felder trägt. */
export function headlineLoadControlEur(
  analysis: PdfReportAnalysis,
  entry: BatteryResultEntry,
  pv?: AnnualScenarioPvInput,
): number {
  const annual = annualFor(analysis, entry, pv)
  if (annual) return annual.controlEur
  const comparison =
    analysis.tariffOptimization?.computable === true
      ? analysis.tariffOptimization.monthlyComparison
      : undefined
  const control = loadControlValueOf(entry, comparison)
  return control.annualizedEur ?? control.overCoveredDaysEur
}

function annualFor(
  analysis: PdfReportAnalysis,
  entry: Pick<BatteryResultEntry, 'battery'>,
  pv: AnnualScenarioPvInput | undefined,
) {
  const annual = pv && SHOW_ANNUAL_SCENARIO_CHAPTER ? annualScenarioSavingsOf(analysis, pv) : null
  return annual && annual.scenario.device?.batteryId === entry.battery.id ? annual : null
}

/** Dieselbe Rechnung wie `calculateAmortizationYears` in `engine/src/roi/roi.ts` (dort nicht exportiert). */
export function amortizationYearsOf(netInvestment: number, savingPerYear: number): number {
  if (netInvestment <= 0) return 0
  if (savingPerYear <= 0) return Infinity
  return netInvestment / savingPerYear
}

/**
 * Die Steuerwirkung des Steuerblocks, gerechnet mit der Ersparnis der Überschrift. Bei `linear` ist das die
 * Zahl der Engine unverändert; bei `annual` läuft dieselbe Engine-Funktion (`calculateRoi`) mit der
 * Jahres-Ersparnis — die bereits abgezogene Förderung reist als Festbetrag, die Investition bleibt gleich.
 */
export function taxEffectOf(
  analysis: PdfReportAnalysis,
  entry: BatteryRoiEntry,
  headline: HeadlineStorage,
): BatteryTaxEffect | undefined {
  if (headline.basis === 'linear' || analysis.assumptions.tax === undefined || entry.taxEffect === undefined) {
    return entry.taxEffect
  }
  return annualRoiOf(analysis, entry, headline.savingPerYearEur).taxEffect ?? entry.taxEffect
}

/**
 * ROI eines Geräts mit einer Jahres-Ersparnis statt der linearen: dieselbe Engine-Funktion, die
 * bereits abgezogene Förderung reist als Festbetrag, die Steuerannahmen aus `assumptions.tax`.
 */
export function annualRoiOf(analysis: PdfReportAnalysis, entry: BatteryRoiEntry, savingPerYear: number) {
  const tax = analysis.assumptions.tax
  return calculateRoi(entry.battery, savingPerYear, analysis.assumptions.horizonYears, {
    fixedSubsidyEur: entry.subsidyAmount,
    ...(tax === undefined
      ? {}
      : {
          taxRatePercent: tax.taxRatePercent,
          investitionsfreibetragPercent: tax.investitionsfreibetragPercent ?? undefined,
          depreciationYears: tax.depreciationYears ?? undefined,
        }),
  })
}

/**
 * Die Katalog-Geräte auf Jahresbasis, in der Reihung des Jahreslaufs — `null` ohne Jahresreihung
 * (`annualScenario.devices` steht nur, wenn das Jahreskapitel steht). Für „Speichergrösse und
 * Gerätewahl": Kurve, Tabelle, Abstand und Nach-Steuer-Satz auf derselben Basis wie die Empfehlung.
 */
export function annualCatalogEntriesOf(analysis: PdfReportAnalysis): BatteryRoiEntry[] | null {
  const scenario = analysis.annualScenario
  if (!scenario?.devices || analysis.existingBatteryAnalysis) return null
  if (scenario.device?.batteryId !== analysis.recommendation?.batteryId) return null
  return scenario.devices.flatMap((device) => {
    const entry = analysis.perBattery.find((p) => p.battery.id === device.batteryId)
    const saving = annualDeviceSavingEur(scenario, device.batteryId)
    if (!entry || saving === null) return []
    return [{ ...entry, ...annualRoiOf(analysis, entry, saving), totalSavingPerYear: saving }]
  })
}

/** Die IFB-Wirkung zum Steuerblock — dieselbe Ersparnis-Basis wie `taxEffectOf`. */
export function ifbEffectForHeadline(
  analysis: PdfReportAnalysis,
  entry: BatteryRoiEntry,
  headline: HeadlineStorage,
): IfbEffect | null {
  return ifbEffectOf(
    entry,
    analysis.assumptions.tax,
    analysis.assumptions.horizonYears,
    headline.basis === 'annual' ? headline.savingPerYearEur : entry.totalSavingPerYear,
  )
}
