import type { AnalysisTaxAssumptions, BatteryRoiEntry } from 'shared'

import { formatEur } from '@/lib/format'
import {
  hasEnteredSubsidy,
  investmentAfterSubsidy,
  NET_INVESTMENT_AFTER_SUBSIDY_LABEL,
  SUBSIDY_ROW_LABEL,
  TAX_EFFECT_NOTE,
  TAX_EFFECT_TITLE,
  taxEffectLines,
} from '@/lib/report-copy'
import type { ReportRow, ReportSubBlock } from './statement'

/** Zeile „Gesamtinvestition" — geteilt mit Weg 4 im Wege-Kapitel (`ways.ts`), damit beide wortgleich bleiben. */
export function totalInvestmentRow(entry: BatteryRoiEntry): ReportRow {
  return { label: 'Gesamtinvestition', value: formatEur(entry.totalInvestment), tone: 'neutral', total: true }
}

/** Förderung und Nettoinvestition danach — nur bei eingetragener Förderung, sonst keine Zeile. */
export function subsidyRows(entry: BatteryRoiEntry): ReportRow[] {
  if (!hasEnteredSubsidy(entry)) return []
  return [
    { label: SUBSIDY_ROW_LABEL, value: formatEur(-entry.subsidyAmount), tone: 'neutral' },
    {
      label: NET_INVESTMENT_AFTER_SUBSIDY_LABEL,
      value: formatEur(investmentAfterSubsidy(entry)),
      tone: 'neutral',
      total: true,
    },
  ]
}

/** Zeile „Netto über N Jahre" — geteilt mit Weg 4 im Wege-Kapitel (`ways.ts`). */
export function netOverHorizonRow(entry: BatteryRoiEntry, horizonYears: number): ReportRow {
  return {
    label: `Netto über ${horizonYears} Jahre`,
    value: formatEur(entry.netSavingOverHorizon),
    /* Vorzeichenbewusst: ein Gerät, das sich im Betrachtungszeitraum nicht einspielt, darf nicht
       grün dastehen — dieselbe Regel wie `deltaRow` in `summary.ts`. */
    tone: entry.netSavingOverHorizon < 0 ? 'warning' : 'positive',
    total: true,
  }
}

/** Der Steuerblock als eigener Zeilenblock — nur, wo die Steuerwirkung gerechnet ist. */
export function taxEffectBlock(
  entry: BatteryRoiEntry,
  tax: AnalysisTaxAssumptions | undefined,
  horizonYears: number,
): ReportSubBlock | null {
  if (entry.taxEffect === undefined || tax === undefined) return null
  return {
    title: TAX_EFFECT_TITLE,
    rows: taxEffectLines(entry.taxEffect, tax, horizonYears).map((line) => ({
      label: line.label,
      value: line.value,
      tone: line.total ? (line.negative ? 'warning' : 'positive') : 'neutral',
      total: line.total,
    })),
    note: TAX_EFFECT_NOTE,
  }
}
