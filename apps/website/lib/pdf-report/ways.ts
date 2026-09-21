import type { MonthlyTariffComparison } from 'shared'
import { sumCovered } from 'shared'

import { formatEur } from '@/lib/format'
import { monthlyBatteryRef } from '@/lib/report-copy'
import type { ReportFigure, ReportStatement } from './statement'
import { summaryWaysOf } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * D7 — das Kapitel „Zwei Wege zu weniger Stromkosten", zwischen „Ihr Lastgang" und „Empfehlung und
 * Wirtschaftlichkeit".
 *
 * ── ⚠ DREI BALKEN, NICHT FÜNF (D7, entschieden 16.09.2026) ────────────────────────────────────
 * Der Urbanz-Referenzreport zeigt fünf Wege inklusive eines einfachen Pauschaltarif-Wechsels und
 * einer LP-optimalen Bestmarke. Beide sind für den Kalkulator-Pfad ausdrücklich NICHT gebaut (der
 * eine liegt im Monitor-Produkt, der andere wäre eine unvalidierte Hindsight-Zahl in
 * Kundenmaterial) — MVP-Scope ist deshalb ZWEI Wege, nicht drei.
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — dieselbe Regel wie überall sonst in
 * diesem Verzeichnis (s. `summary.ts`). Gerendert wird in `document.tsx`.
 *
 * ── ⚠ KEINE ZAHL WIRD HIER NEU GERECHNET ───────────────────────────────────────────────────────
 * Die drei Balken sind `sumCovered` über dieselben drei Reihen, mit denen `detail.ts`
 * (`buildMonthly`) seine Tabellenzeilen bildet — bit-identisch, weil dieselbe Funktion auf
 * denselben Feldern läuft. Das Ergebnis der Ladesteuerung im Fliesstext ist `summaryWaysOf(...)`,
 * dieselbe Ableitung, aus der auch die Spanne der Zusammenfassung entsteht. Ein zweiter Rechenweg
 * für eine dieser Zahlen liefe irgendwann von ihr weg (#295).
 */

export type WaysTotals = {
  currentTariffEur: number
  spotWithoutControlEur: number
  spotWithBatteryEur: number
}

export type WaysChapter = {
  totals: WaysTotals
  figure: ReportFigure
  tariffSwitch: ReportStatement
  loadControl: ReportStatement
}

function monthlyComparisonOf(analysis: PdfReportAnalysis): MonthlyTariffComparison | undefined {
  return analysis.tariffOptimization?.computable === true
    ? analysis.tariffOptimization.monthlyComparison
    : undefined
}

/**
 * Gibt es dieses Kapitel in diesem Dokument?
 *
 * ⚠ Dieselbe Bedingung wie die Spanne der Zusammenfassung (`summaryWaysOf`): ohne Monatsvergleich
 * gibt es weder die eine noch die drei Zahlen, aus denen dieses Kapitel besteht.
 */
export function hasWaysChapter(analysis: PdfReportAnalysis): boolean {
  return summaryWaysOf(analysis) !== null
}

export function buildWaysChapter(analysis: PdfReportAnalysis): WaysChapter | null {
  const comparison = monthlyComparisonOf(analysis)
  const ways = summaryWaysOf(analysis)
  if (!comparison || !ways) return null

  const isExisting = analysis.existingBatteryAnalysis != null
  const whose = monthlyBatteryRef(isExisting)

  const totals: WaysTotals = {
    currentTariffEur: sumCovered(comparison.currentTariffEur),
    spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
    spotWithBatteryEur: sumCovered(comparison.spotWithBatteryEur),
  }

  /* ⚠ `ways.ways` steht immer in dieser Reihenfolge — s. `summaryWaysOf`: [Tarifwechsel, Ladesteuerung]. */
  const tariffSwitchEur = ways.ways[0].eur
  const controlledEur = ways.ways[1].eur
  const days = String(ways.coveredDays)

  return {
    totals,
    figure: {
      caption:
        `Was Sie über die ${days} gemessenen Tage tatsächlich gezahlt hätten: grau Ihr heutiger ` +
        `Tarif, hell aWATTar ohne Steuerung, kräftig aWATTar mit ${whose}. Alle Beträge exkl. MwSt.`,
      note: null,
    },
    tariffSwitch: {
      id: 'ways_tariff_switch',
      title: 'aWATTar ohne Steuerung',
      amount: null,
      rows: [],
      body:
        'Der einfachste Weg: derselbe Lastgang wie heute, aber zum Börsenpreis von aWATTar statt ' +
        'zu Ihrem festen Arbeitspreis — ohne jede Umstellung an Speicher oder Verbrauch. Über die ' +
        `${days} gemessenen Tage hätte das ` +
        (tariffSwitchEur > 0
          ? `${formatEur(tariffSwitchEur)} weniger gekostet.`
          : `${formatEur(Math.abs(tariffSwitchEur))} MEHR gekostet als Ihr heutiger Tarif, nicht ` +
            'weniger.'),
    },
    loadControl: {
      id: 'ways_load_control',
      title: `aWATTar mit ${whose}`,
      amount: null,
      rows: [],
      body:
        `Zusätzlich zum Tarifwechsel wird mit ${whose} gezielt geladen: in den Viertelstunden, ` +
        'deren Preis unter dem arithmetischen Mittel des jeweiligen Kalendertags liegt, lädt der ' +
        'Speicher aus dem Netz, während er Kapazität für die teureren Stunden desselben Tages ' +
        'zurückhält — der Schutz Ihrer Lastspitzen hat dabei weiterhin Vorrang. Über denselben ' +
        'Zeitraum hätte das, Tarifwechsel und Ladesteuerung zusammen, ' +
        (controlledEur > 0
          ? `insgesamt ${formatEur(controlledEur)} gespart.`
          : `insgesamt ${formatEur(Math.abs(controlledEur))} mehr gekostet als Ihr heutiger Tarif.`),
    },
  }
}
