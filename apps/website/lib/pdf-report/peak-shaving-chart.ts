import { effectiveBillingModel, type LoadProfile } from 'shared'

import { localMonthIndex } from '@/lib/local-time'
import { primaryEntryOf } from './summary'
import type { PdfReportAnalysis } from './types'
import type { WaysChapter } from './ways'

/** Mehr Punkte zeichnet das Bild nicht — bei mehr bleiben die höchsten. */
export const MAX_PEAK_SHAVING_POINTS = 1500

/** Eine Viertelstunde über der Kappschwelle ihrer Abrechnungsperiode. */
export type PeakShavingPoint = { ts: string; kw: number; capKw: number }

/** Die Schwelle einer belegten Periode, vom ersten bis zum letzten Messwert darin. */
export type PeakShavingCapSegment = { startMs: number; endMs: number; capKw: number }

export type PeakShavingChartData = {
  /** Je Slot die Schwelle; `Infinity` für Perioden ohne Messwert oder ohne Schwelle > 0. */
  capKwByPeriod: number[]
  /** Chronologisch, nur Perioden mit endlicher Schwelle. */
  capSegments: PeakShavingCapSegment[]
  /** Chronologisch, höchstens `MAX_PEAK_SHAVING_POINTS`. */
  points: PeakShavingPoint[]
  /** Alle Viertelstunden über der Schwelle, vor der Begrenzung. */
  totalPoints: number
}

/**
 * Die Punkte und Schwellen des Kappungs-Diagramms (Weg 5). `null`, wenn Weg 5 im Kapitel nicht
 * steht oder keine belegte Periode eine Schwelle > 0 hat — dann gibt es kein Bild.
 */
export function peakShavingChartData(
  analysis: PdfReportAnalysis,
  loadProfile: Pick<LoadProfile, 'readings' | 'timezoneMeta'>,
  waysChapter: WaysChapter | null,
): PeakShavingChartData | null {
  if (!waysChapter?.statements.some((statement) => statement.id === 'ways_peak_shaving')) return null
  const caps = primaryEntryOf(analysis)?.dispatchTrace?.capKwByPeriod ?? []
  if (caps.length === 0) return null

  // „Belegt" wie im Lastgang-Chart: lokaler Monat mit mindestens einem Messwert.
  const perMonth = effectiveBillingModel(analysis.assumptions.billingModel) !== 'annual_max' && caps.length > 1
  const tz = loadProfile.timezoneMeta
  const slots = loadProfile.readings.map((r) => (perMonth ? localMonthIndex(Date.parse(r.ts), tz) : 0))
  const covered = new Set(slots)
  const capKwByPeriod = caps.map((kw, slot) =>
    covered.has(slot) && Number.isFinite(kw) && kw > 0 ? kw : Infinity,
  )
  if (!capKwByPeriod.some((kw) => Number.isFinite(kw))) return null

  const bounds = new Map<number, { startMs: number; endMs: number }>()
  loadProfile.readings.forEach((r, i) => {
    const ms = Date.parse(r.ts)
    const b = bounds.get(slots[i]!)
    if (!b) bounds.set(slots[i]!, { startMs: ms, endMs: ms })
    else b.endMs = Math.max(b.endMs, ms)
  })
  const capSegments = [...bounds.entries()]
    .filter(([slot]) => Number.isFinite(capKwByPeriod[slot]))
    .map(([slot, b]) => ({ ...b, capKw: capKwByPeriod[slot]! }))
    .sort((a, b) => a.startMs - b.startMs)

  const above: PeakShavingPoint[] = []
  loadProfile.readings.forEach((r, i) => {
    const capKw = capKwByPeriod[slots[i]!] ?? Infinity
    if (r.gridPowerKw > capKw) above.push({ ts: r.ts, kw: r.gridPowerKw, capKw })
  })

  const points =
    above.length > MAX_PEAK_SHAVING_POINTS
      ? [...above]
          .sort((a, b) => b.kw - a.kw)
          .slice(0, MAX_PEAK_SHAVING_POINTS)
          .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      : above
  return { capKwByPeriod, capSegments, points, totalPoints: above.length }
}

/** Die Bildunterschrift — die Anzahl steht immer dabei, die Begrenzung nur, wenn sie greift. */
export function peakShavingChartCaption(data: PeakShavingChartData): string {
  const count = new Intl.NumberFormat('de-AT').format(data.totalPoints)
  const limited =
    data.totalPoints > data.points.length
      ? ` Gezeichnet sind die ${new Intl.NumberFormat('de-AT').format(data.points.length)} höchsten.`
      : ''
  return (
    'Rote Punkte: Viertelstunden, die über der Kappschwelle ihres Monats lagen — der Speicher ' +
    'begrenzt sie auf die Schwelle. Die Linie zeigt die Schwelle je Monat. ' +
    `${count} Viertelstunden liegen über der Schwelle.${limited}`
  )
}
