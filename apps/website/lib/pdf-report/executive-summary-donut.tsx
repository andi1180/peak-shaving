import { Circle, Path, Svg, Text, View } from '@react-pdf/renderer'

import { formatEur } from '@/lib/format'
import { fitFontSize } from './executive-summary-charts'
import type { ExecutiveSummary } from './executive-summary'
import { DOT_COLOR } from './executive-summary-load-chart'
import { buildSavingsDonut, type SavingsDonutSegmentKey } from './savings-donut'
import { CHART_COLORS, PDF_COLORS } from './theme'

/**
 * „Woher die Ersparnis kommt" auf der Vorderseite: die Aufteilung der Jahreszahl aus
 * `buildSavingsDonut` (Tarifwechsel, günstig laden, Spitzen) als nativer Ring mit Legende.
 * Farben wie die übrigen Diagramme der Seite: aWATTar-Balken, empfohlener Balken, Lastgang-Punkte.
 */
const LABELS: Record<SavingsDonutSegmentKey, string> = {
  switch: 'Wechsel zu aWATTar',
  control: 'Speicher lädt günstig',
  peak: 'Weniger Spitzen (Höchstwert)',
}
const COLORS: Record<SavingsDonutSegmentKey, string> = {
  switch: CHART_COLORS.seriesSoft,
  control: CHART_COLORS.series,
  peak: DOT_COLOR,
}

export type ExecDonutSegment = {
  key: SavingsDonutSegmentKey
  label: string
  eur: number
  amount: string
  color: string
  /** Winkel im Uhrzeigersinn ab 12 Uhr, in Grad. */
  startDeg: number
  endDeg: number
}

export type ExecDonut = {
  qualifier: string
  total: string
  totalEur: number
  segments: ExecDonutSegment[]
}

/**
 * Nur mit Speicherblock, wenn Tarifwechsel und Speicher etwas beitragen (`buildSavingsDonut` verlangt
 * beides); bei unbekanntem Tarif gibt es keinen Tarifwechsel-Anteil und damit keinen Ring.
 */
export function execDonutOf(summary: ExecutiveSummary): ExecDonut | null {
  const st = summary.storage
  const switchStage = summary.stages.find((stage) => stage.id === 'ohne-anschaffung')
  if (!st || !switchStage) return null
  const donut = buildSavingsDonut({
    switchEur: switchStage.savingPerYearEur,
    controlEur: st.loadShiftEur,
    peakEur: st.peakEur,
  })
  if (!donut) return null
  let angle = 0
  const segments = donut.segments.map((s) => {
    const sweep = (s.eur / donut.totalEur) * 360
    const segment = {
      key: s.key,
      label: LABELS[s.key],
      eur: s.eur,
      amount: formatEur(s.eur),
      color: COLORS[s.key],
      startDeg: angle,
      endDeg: angle + sweep,
    }
    angle += sweep
    return segment
  })
  return {
    qualifier: st.upperBound ? 'bis zu' : 'rund',
    total: formatEur(donut.totalEur),
    totalEur: donut.totalEur,
    segments,
  }
}

const RING_PT = 88
const STROKE_PT = 15
const LEGEND_GAP_PT = 10

function point(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
}

/** Ein Ringsegment als Bogen (Mittellinie des Strichs). */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const a = point(cx, cy, r, startDeg)
  const b = point(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`
}

const small = { fontSize: 8, lineHeight: 1.2, color: PDF_COLORS.textMuted }

export function ExecSavingsDonut({
  donut,
  slot,
}: {
  donut: ExecDonut
  slot: { width: number; height: number }
}) {
  const c = RING_PT / 2
  const r = (RING_PT - STROKE_PT) / 2
  const hole = RING_PT - 2 * STROKE_PT
  const legendWidth = slot.width - RING_PT - LEGEND_GAP_PT
  return (
    <View
      style={{ width: slot.width, height: slot.height, flexDirection: 'row', alignItems: 'center' }}
    >
      <View style={{ width: RING_PT, height: RING_PT, position: 'relative' }}>
        <Svg width={RING_PT} height={RING_PT}>
          {donut.segments.length === 1 ? (
            <Circle
              cx={c}
              cy={c}
              r={r}
              stroke={donut.segments[0]!.color}
              strokeWidth={STROKE_PT}
              fill="none"
            />
          ) : (
            donut.segments.map((s) => (
              <Path
                key={s.key}
                d={arcPath(c, c, r, s.startDeg, s.endDeg)}
                stroke={s.color}
                strokeWidth={STROKE_PT}
                fill="none"
              />
            ))
          )}
        </Svg>
        <View
          style={{
            position: 'absolute',
            top: STROKE_PT,
            left: STROKE_PT,
            width: hole,
            height: hole,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={small}>{donut.qualifier}</Text>
          <Text
            style={{
              fontSize: fitFontSize(donut.total, hole - 4, 13, true),
              lineHeight: 1.15,
              fontWeight: 700,
              color: PDF_COLORS.ink,
            }}
          >
            {donut.total}
          </Text>
        </View>
      </View>
      <View style={{ width: legendWidth, marginLeft: LEGEND_GAP_PT }}>
        {donut.segments.map((s, i) => (
          <View key={s.key} style={{ flexDirection: 'row', marginTop: i === 0 ? 0 : 5 }}>
            <Svg width={8} height={10}>
              <Circle cx={3} cy={5} r={3} fill={s.color} />
            </Svg>
            <View style={{ width: legendWidth - 8 }}>
              <Text style={{ ...small, color: PDF_COLORS.text }}>{s.label}</Text>
              <Text
                style={{ fontSize: 8.5, lineHeight: 1.2, fontWeight: 700, color: PDF_COLORS.ink }}
              >
                {s.amount}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export const EXEC_DONUT_LEGEND_LABEL_WIDTH = (slotWidth: number) =>
  slotWidth - RING_PT - LEGEND_GAP_PT - 8
