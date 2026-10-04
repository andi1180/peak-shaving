import type { BatteryResultEntry, BatteryRoiEntry } from 'shared'

import { loadControlValueOf } from '@/lib/report-copy'
import { annualScenarioSavingsOf, type AnnualScenarioPvInput } from './annual-scenario'
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
