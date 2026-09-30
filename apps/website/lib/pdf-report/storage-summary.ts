import type { BatteryRoiEntry, MonthlyTariffComparison } from 'shared'

import { formatEur, formatYears } from '@/lib/format'
import { dynamicTariffHintKind, loadControlValueOf } from '@/lib/report-copy'
import { totalInvestmentRow } from './investment-rows'
import type { ReportRow, ReportStatement } from './statement'
import { recommendedEntryOf, summaryWaysOf } from './summary'
import type { PdfReportAnalysis } from './types'
import { buildWaysChapter, peakShavingSavingOf } from './ways'

export const STORAGE_SUMMARY_ID = 'storage_result'

/**
 * Zusammenfassung — was der empfohlene Speicher zusätzlich bringt. Nur, wo Weg 5 im Wege-Kapitel
 * steht (dieselbe Bedingung wie Seite 7) und Seite 8 dieses Gerät aufschlüsselt; jede Zahl ist die
 * der Seiten 7–9, hier nur neu zusammengestellt.
 */
/** Das Gerät des Blocks samt Monatsvergleich — `null`, wo der Block entfällt. Auch „Unser Vorschlag" liest hier. */
export function storageSummarySource(
  analysis: PdfReportAnalysis,
): { entry: BatteryRoiEntry; comparison: MonthlyTariffComparison } | null {
  const ways = buildWaysChapter(analysis)
  if (!ways?.statements.some((statement) => statement.id === 'ways_peak_shaving')) return null
  // Im Bestandsfall gibt es keinen empfohlenen Speicher, mit Tarif-Hinweis kein Gerät auf Seite 8.
  if (analysis.existingBatteryAnalysis || dynamicTariffHintKind(analysis)) return null
  const entry = recommendedEntryOf(analysis)
  const comparison =
    analysis.tariffOptimization?.computable === true
      ? analysis.tariffOptimization.monthlyComparison
      : undefined
  return entry && comparison ? { entry, comparison } : null
}

export function buildStorageSummary(analysis: PdfReportAnalysis): ReportStatement | null {
  const source = storageSummarySource(analysis)
  if (!source) return null
  const { entry, comparison } = source

  const control = loadControlValueOf(entry, comparison)
  const annualized = control.annualizedEur !== null
  const row = (label: string, value: string, extra: Partial<ReportRow> = {}): ReportRow => ({
    label,
    value,
    tone: 'neutral',
    ...extra,
  })

  const summaryWays = summaryWaysOf(analysis)
  const tariffSwitch = summaryWays?.ways.find((way) => way.id === 'tariff_switch')
  const days = control.coveredDays

  return {
    id: STORAGE_SUMMARY_ID,
    title: 'Was der empfohlene Speicher zusätzlich bringt',
    amount: null,
    rows: [
      row(entry.battery.name, totalInvestmentRow(entry).value, { hint: 'Gesamtinvestition' }),
      row('Ladesteuerung (aWATTar)', formatEur(control.annualizedEur ?? control.overCoveredDaysEur), {
        ...(annualized
          ? {
              hint: `hochgerechnet aus ${days} gemessenen Tagen; gemessen ${formatEur(control.overCoveredDaysEur)}`,
            }
          : {}),
      }),
      row('Kappung der Lastspitzen', formatEur(peakShavingSavingOf(analysis))),
      row('Zusammen pro Jahr', formatEur(entry.totalSavingPerYear), {
        hint: 'Beträge gerundet',
        total: true,
      }),
      row('Amortisation', formatYears(entry.amortizationYears)),
    ],
    body:
      (tariffSwitch && tariffSwitch.eur > 0
        ? `Der Tarifwechsel (${formatEur(tariffSwitch.eur)} über die ${summaryWays!.coveredDays} ` +
          'gemessenen Tage) ' +
          'wirkt auch ohne Speicher und ist in diesen Zahlen nicht enthalten. '
        : '') +
      'Vorausberechnung, keine Zusage: Der Kappungs-Anteil ist eine Obergrenze, weil er voraussetzt, ' +
      'dass der Speicher jede Monatsspitze rechtzeitig kennt' +
      (annualized ? '; der Ladesteuerungs-Anteil ist auf ein Jahr hochgerechnet.' : '.'),
  }
}
