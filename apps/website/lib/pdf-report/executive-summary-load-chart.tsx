import { Circle, Line, Polyline, Rect, Svg, Text, View } from '@react-pdf/renderer'

import type { DailyPeak } from './daily-peaks'
import { label, LINE_PT, textWidth } from './executive-summary-charts'
import type { PeakShavingCapSegment } from './peak-shaving-chart'
import { CHART_COLORS, PDF_COLORS } from './theme'

/**
 * Das Lastgang-Diagramm der Vorderseite: ein Balken je Messtag (Tagesspitze), mit Speicher-Begrenzung
 * die Treppenlinie je Abrechnungszeitraum und der Teil darüber in der Akzentfarbe. Native
 * react-pdf-Zeichnung in den festen Massen aus `EXEC_SLOTS`, wie die übrigen Diagramme der Seite.
 */
type Size = { width: number; height: number }

export type LoadInput = { dailyPeaks: DailyPeak[]; capSegments: PeakShavingCapSegment[] | null }

/** Teilt eine Tagesspitze an der Begrenzung; ohne Begrenzung bleibt alles Basis. */
export function splitAtCap(value: number, cap: number | null): { base: number; above: number } {
  if (cap === null || value <= cap) return { base: value, above: 0 }
  return { base: cap, above: value - cap }
}

const DAY_MS = 86_400_000
const MONTHS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Die Begrenzung des Zeitraums, in dem der Tag liegt (Tagesmitte, damit Zeitzonen-Grenzen nicht kippen). */
function capOfDay(day: string, segments: PeakShavingCapSegment[] | null): number | null {
  if (!segments) return null
  const noon = dayMs(day) + DAY_MS / 2
  return segments.find((s) => s.startMs <= noon && noon < s.endMs)?.capKw ?? null
}

/** 1, 1,2, 1,5, 2, 2,5, … × 10^k — die nächste runde Obergrenze. */
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(value))
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * exp >= value)!
  return step * exp
}

export type LoadBar = {
  day: string
  peakKw: number
  capKw: number | null
  base: number
  above: number
  x: number
  width: number
}

export type LoadChartLayout = {
  plot: { left: number; right: number; top: number; bottom: number }
  yMaxKw: number
  y: (kw: number) => number
  bars: LoadBar[]
  /** Treppenlinie, je zusammenhängender Strecke eine Punktfolge. */
  capLines: { x: number; y: number }[][]
  ticks: { text: string; y: number }[]
  months: { text: string; x: number; width: number }[]
  legend: { text: string; kind: 'base' | 'above' | 'cap'; x: number; row: number }[]
  /** Je Kalendertag die gezeichnete Begrenzung (für die Prüfung gegen das Modell). */
  capByDay: Map<string, number>
  /** Ein Punkt an der Spitze jedes Tages über der Begrenzung (`splitAtCap(…).above > 0`). */
  dots: { day: string; x: number; y: number; peakKw: number }[]
}

const SWATCH_PT = 8
const LEGEND_GAP_PT = 10
const Y_GUTTER_PT = 30

export function loadChartOf(load: LoadInput, slot: Size): LoadChartLayout | null {
  if (load.dailyPeaks.length === 0) return null
  const hasCap = (load.capSegments?.length ?? 0) > 0

  // Legende: eine Zeile, wenn sie passt, sonst zwei.
  const items = [
    { text: 'Höchste Leistung pro Tag', kind: 'base' as const },
    ...(hasCap
      ? [
          { text: 'Spitzen, die der Speicher abfängt', kind: 'above' as const },
          { text: 'Begrenzung mit Speicher (Höchstwert)', kind: 'cap' as const },
        ]
      : []),
  ]
  const itemWidth = (text: string) => SWATCH_PT + 3 + textWidth(text)
  const oneRow =
    items.reduce((sum, item) => sum + itemWidth(item.text), 0) +
      LEGEND_GAP_PT * (items.length - 1) <=
    slot.width
  let cursor = 0
  let row = 0
  const legend = items.map((item) => {
    if (!oneRow && cursor > 0 && cursor + itemWidth(item.text) > slot.width) {
      row += 1
      cursor = 0
    }
    const entry = { ...item, x: cursor, row }
    cursor += itemWidth(item.text) + LEGEND_GAP_PT
    return entry
  })

  const plot = {
    left: Y_GUTTER_PT,
    right: slot.width,
    top: (row + 1) * LINE_PT + 6,
    bottom: slot.height - LINE_PT - 2,
  }

  const firstMs = dayMs(load.dailyPeaks[0]!.day)
  const lastMs = dayMs(load.dailyPeaks.at(-1)!.day)
  const days = Math.round((lastMs - firstMs) / DAY_MS) + 1
  const slotWidth = (plot.right - plot.left) / days
  // Dünne Balken mit Abstand; bei sehr vielen Tagen lückenlos (leicht überlappend gegen Haarlinien).
  const gap = slotWidth >= 2 ? slotWidth * 0.25 : 0
  const barWidth = gap > 0 ? slotWidth - gap : slotWidth + 0.3
  const xOfIndex = (i: number) => plot.left + i * slotWidth

  const capByDay = new Map<string, number>()
  for (let i = 0; i < days; i += 1) {
    const day = dayKey(firstMs + i * DAY_MS)
    const cap = capOfDay(day, load.capSegments)
    if (cap !== null) capByDay.set(day, cap)
  }

  const maxKw = Math.max(...load.dailyPeaks.map((p) => p.peakKw), ...[...capByDay.values()])
  const yMaxKw = niceCeil(maxKw)
  const y = (kw: number) => plot.bottom - (Math.max(0, kw) / yMaxKw) * (plot.bottom - plot.top)

  const bars = load.dailyPeaks.map((p) => {
    const i = Math.round((dayMs(p.day) - firstMs) / DAY_MS)
    const capKw = capByDay.get(p.day) ?? null
    return {
      day: p.day,
      peakKw: p.peakKw,
      capKw,
      ...splitAtCap(p.peakKw, capKw),
      x: xOfIndex(i) + gap / 2,
      width: barWidth,
    }
  })

  // Treppenlinie: waagrecht über die Tage eines Zeitraums, senkrecht beim Wechsel.
  const capLines: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] | null = null
  let previousCap = 0
  for (let i = 0; i <= days; i += 1) {
    const cap = i < days ? (capByDay.get(dayKey(firstMs + i * DAY_MS)) ?? null) : null
    if (current && cap !== previousCap) current.push({ x: xOfIndex(i), y: y(previousCap) })
    if (cap === null) {
      current = null
      continue
    }
    if (!current) capLines.push((current = []))
    if (cap !== previousCap || current.length === 0) current.push({ x: xOfIndex(i), y: y(cap) })
    previousCap = cap
  }

  const kw = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 })
  const ticks = [0, yMaxKw / 2, yMaxKw].map((v, i) => ({
    text: i === 2 ? `${kw.format(v)} kW` : kw.format(v),
    y: y(v),
  }))

  // Monatskürzel an der Mitte der sichtbaren Tage des Monats, nur wenn sie frei stehen.
  const months: LoadChartLayout['months'] = []
  for (let i = 0; i < days;) {
    const start = new Date(firstMs + i * DAY_MS)
    let end = i
    while (
      end + 1 < days &&
      new Date(firstMs + (end + 1) * DAY_MS).getUTCMonth() === start.getUTCMonth()
    )
      end += 1
    const text = MONTHS[start.getUTCMonth()]!
    const width = textWidth(text)
    const center = (xOfIndex(i) + xOfIndex(end + 1)) / 2
    const x = Math.min(Math.max(center - width / 2, plot.left), plot.right - width)
    const previous = months.at(-1)
    if (!previous || x >= previous.x + previous.width + 4) months.push({ text, x, width })
    i = end + 1
  }

  const dots = bars
    .filter((bar) => bar.above > 0)
    .map((bar) => ({
      day: bar.day,
      x: bar.x + bar.width / 2,
      y: y(bar.peakKw),
      peakKw: bar.peakKw,
    }))

  return { plot, yMaxKw, y, bars, capLines, ticks, months, legend, capByDay, dots }
}

/** Slate 400 — grau, aber heller als `textMuted`, damit der Akzentteil darüber trägt. */
const BASE_COLOR = '#94a3b8'
/** Die Begrenzungslinie bleibt in der Akzentfarbe; was darüber liegt, ist rot markiert. */
const CAP_COLOR = CHART_COLORS.series
const ABOVE_COLOR = '#fca5a5'
export const DOT_COLOR = '#dc2626'
const DOT_RADIUS_PT = 1.2

const muted = { ...label(false), color: PDF_COLORS.textMuted }

export function ExecLoadChart({ load, slot }: { load: LoadInput; slot: Size }) {
  const l = loadChartOf(load, slot)
  if (!l) return null
  const { plot } = l
  return (
    <View style={{ width: slot.width, height: slot.height, position: 'relative' }}>
      <Svg
        width={slot.width}
        height={slot.height}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {l.ticks.slice(1).map((tick) => (
          <Line
            key={tick.text}
            x1={plot.left}
            y1={tick.y}
            x2={plot.right}
            y2={tick.y}
            stroke={PDF_COLORS.border}
            strokeWidth={0.5}
          />
        ))}
        {l.bars.map((bar) => (
          <Rect
            key={bar.day}
            x={bar.x}
            y={l.y(bar.base)}
            width={bar.width}
            height={plot.bottom - l.y(bar.base)}
            fill={BASE_COLOR}
          />
        ))}
        {l.bars
          .filter((bar) => bar.above > 0)
          .map((bar) => (
            <Rect
              key={`above-${bar.day}`}
              x={bar.x}
              y={l.y(bar.peakKw)}
              width={bar.width}
              height={l.y(bar.base) - l.y(bar.peakKw)}
              fill={ABOVE_COLOR}
            />
          ))}
        <Line
          x1={plot.left}
          y1={plot.bottom}
          x2={plot.right}
          y2={plot.bottom}
          stroke={PDF_COLORS.textMuted}
          strokeWidth={0.5}
        />
        {/* Weisser Saum unter der Linie: sie liegt genau auf der Grenze Grau/Rot. */}
        {l.capLines.map((points, i) => (
          <Polyline
            key={`halo-${i}`}
            points={points.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke="#ffffff"
            strokeWidth={2.4}
            fill="none"
          />
        ))}
        {l.capLines.map((points, i) => (
          <Polyline
            key={i}
            points={points.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke={CAP_COLOR}
            strokeWidth={1.2}
            strokeDasharray="4 2"
            fill="none"
          />
        ))}
        {l.dots.map((dot) => (
          <Circle
            key={`dot-${dot.day}`}
            cx={dot.x}
            cy={dot.y}
            r={DOT_RADIUS_PT}
            fill={DOT_COLOR}
            stroke="#ffffff"
            strokeWidth={0.4}
          />
        ))}
        {l.legend.map((item) => {
          const cy = item.row * LINE_PT + LINE_PT / 2
          return item.kind === 'cap' ? (
            <Line
              key={item.text}
              x1={item.x}
              y1={cy}
              x2={item.x + SWATCH_PT}
              y2={cy}
              stroke={CAP_COLOR}
              strokeWidth={1.2}
              strokeDasharray="4 2"
            />
          ) : item.kind === 'above' ? (
            <Circle
              key={item.text}
              cx={item.x + SWATCH_PT / 2}
              cy={cy}
              r={DOT_RADIUS_PT + 0.4}
              fill={DOT_COLOR}
            />
          ) : (
            <Rect
              key={item.text}
              x={item.x}
              y={cy - 3}
              width={SWATCH_PT}
              height={6}
              fill={BASE_COLOR}
            />
          )
        })}
      </Svg>
      {l.legend.map((item) => (
        <Text
          key={item.text}
          style={[
            muted,
            { position: 'absolute', top: item.row * LINE_PT, left: item.x + SWATCH_PT + 3 },
          ]}
        >
          {item.text}
        </Text>
      ))}
      {l.ticks.map((tick) => (
        <Text
          key={tick.text}
          style={[
            muted,
            {
              position: 'absolute',
              top: tick.y - LINE_PT / 2,
              left: 0,
              width: Y_GUTTER_PT - 4,
              textAlign: 'right',
            },
          ]}
        >
          {tick.text}
        </Text>
      ))}
      {l.months.map((month) => (
        <Text
          key={month.text + month.x}
          style={[muted, { position: 'absolute', top: plot.bottom + 2, left: month.x }]}
        >
          {month.text}
        </Text>
      ))}
    </View>
  )
}
