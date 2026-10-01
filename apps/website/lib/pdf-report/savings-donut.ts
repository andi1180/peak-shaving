import { formatEur } from '@/lib/format'
import { CHART_COLORS, PDF_COLORS } from './theme'

/**
 * Das Ringdiagramm „So setzt sich Ihre Ersparnis zusammen" im Jahreskapitel.
 *
 * ⚠ NUR DARSTELLUNG: die Euro-Beträge sind die gerundeten Zeilen der Tabelle „Woher die Ersparnis
 * kommt" (`annual-scenario.ts`), hier wird nichts neu gerechnet.
 */

export type SavingsDonutSegmentKey = 'switch' | 'control' | 'peak'

export type SavingsDonutSegment = {
  key: SavingsDonutSegmentKey
  label: string
  eur: number
  /** Ganze Prozent; die Segmente eines Rings ergeben zusammen genau 100. */
  percent: number
  /** Unter 3 % steht die Beschriftung nur in der Legende, nicht am Ring. */
  labelInChart: boolean
}

export type SavingsDonut = {
  title: string
  totalEur: number
  segments: SavingsDonutSegment[]
  storageEur: number
  storagePercent: number
  caption: string
}

export const SAVINGS_DONUT_TITLE = 'So setzt sich Ihre Ersparnis zusammen'

/** Tarifwechsel neutral, die beiden Speicher-Segmente zwei Töne des Akzents (Kappung heller). */
export const SAVINGS_DONUT_COLORS: Record<SavingsDonutSegmentKey, string> = {
  switch: PDF_COLORS.textMuted,
  control: CHART_COLORS.series,
  peak: CHART_COLORS.seriesSoft,
}

const MIN_PERCENT_IN_CHART = 3

/** Largest-Remainder-Rundung auf ganze Prozent; bei gleichem Rest gewinnt das frühere Segment. */
export function largestRemainderPercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0)
  const exact = values.map((v) => (v / total) * 100)
  const floors = exact.map(Math.floor)
  let missing = 100 - floors.reduce((sum, v) => sum + v, 0)
  const order = exact
    .map((v, i) => ({ i, rest: v - floors[i]! }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (missing <= 0) break
    floors[i]! += 1
    missing -= 1
  }
  return floors
}

/**
 * Die Segmente aus den Tabellenzeilen — oder `null`, wenn ein Anteil ≤ 0 € ist (ein Ring kann
 * keinen negativen Anteil zeigen; dann steht nur die Tabelle). Kappung 0 heisst zwei Segmente.
 */
export function buildSavingsDonut(parts: {
  switchEur: number
  controlEur: number
  peakEur: number
}): SavingsDonut | null {
  const { switchEur, controlEur, peakEur } = parts
  if (switchEur <= 0 || controlEur <= 0 || peakEur < 0) return null

  const raw: { key: SavingsDonutSegmentKey; label: string; eur: number }[] = [
    { key: 'switch', label: 'Tarifwechsel', eur: switchEur },
    { key: 'control', label: 'Ladesteuerung', eur: controlEur },
    ...(peakEur > 0
      ? [{ key: 'peak' as const, label: 'Spitzenkappung (Obergrenze)', eur: peakEur }]
      : []),
  ]
  const percents = largestRemainderPercents(raw.map((s) => s.eur))
  const segments = raw.map((s, i) => ({
    ...s,
    percent: percents[i]!,
    labelInChart: percents[i]! >= MIN_PERCENT_IN_CHART,
  }))

  const storage = segments.filter((s) => s.key !== 'switch')
  const storageEur = storage.reduce((sum, s) => sum + s.eur, 0)
  const storagePercent = storage.reduce((sum, s) => sum + s.percent, 0)

  return {
    title: SAVINGS_DONUT_TITLE,
    totalEur: segments.reduce((sum, s) => sum + s.eur, 0),
    segments,
    storageEur,
    storagePercent,
    caption:
      `Davon durch den Speicher: ${formatEur(storageEur)} (${storagePercent} %).` +
      (peakEur > 0 ? ' Spitzenkappung ist eine Obergrenze.' : ''),
  }
}

/** Legendenzeile eines Segments — Name, Euro und Prozent als Text, nicht nur als Farbe. */
export function savingsDonutLegendText(segment: SavingsDonutSegment): string {
  return `${segment.label}: ${formatEur(segment.eur)} (${segment.percent} %)`
}
