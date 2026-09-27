import type { BatteryRoiEntry } from 'shared'

import { formatEur } from '@/lib/format'
import {
  hasEnteredSubsidy,
  investmentAfterSubsidy,
  NET_INVESTMENT_AFTER_SUBSIDY_LABEL,
  SUBSIDY_ROW_LABEL,
} from '@/lib/report-copy'
import type { ReportRow } from './statement'

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
