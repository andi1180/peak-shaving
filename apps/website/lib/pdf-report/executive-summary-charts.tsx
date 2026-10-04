import { Circle, Line, Polygon, Svg, Text, View } from '@react-pdf/renderer'

import { formatEur } from '@/lib/format'
import { aboutYears, type BreakEvenBand } from './break-even-band'
import type { ExecutiveSummaryWay } from './executive-summary'
import { CHART_COLORS, PDF_COLORS } from './theme'

/**
 * Die zwei Diagramme der Vorderseite als native react-pdf-Zeichnung: Geometrie als Svg/View in den
 * festen Massen aus `EXEC_SLOTS`, Beschriftung als gewöhnlicher Text (Report-Schrift, € und Umlaute).
 */
const FONT_PT = 6.5
const LINE_PT = 8
/** Zeichenbreite in em für Inter, aufgerundet (gemessen ≈ 0,45) — nur für die Platzierung. */
const CHAR_EM = 0.5

const textWidth = (text: string): number => text.length * FONT_PT * CHAR_EM

type Size = { width: number; height: number }

// ── Wege-Balken ────────────────────────────────────────────────────────────────────────────────

export type WaysBar = {
  label: string
  valueEur: number
  valueText: string
  color: string
  recommended: boolean
  labelTop: number
  barTop: number
  barHeight: number
  barWidth: number
}

const BAR_MAX_PT = 11
const BAR_MIN_PT = 5

export function waysBarsOf(ways: ExecutiveSummaryWay[], labels: string[], slot: Size): WaysBar[] {
  const rowHeight = slot.height / ways.length
  const barHeight = Math.min(BAR_MAX_PT, rowHeight - LINE_PT - 3)
  if (barHeight < BAR_MIN_PT) throw new Error(`Wege-Balken: ${ways.length} Zeilen passen nicht`)
  const max = Math.max(...ways.map((way) => way.costPerYearEur))
  const valueTexts = ways.map((way) => formatEur(way.costPerYearEur))
  const scale = slot.width - Math.max(...valueTexts.map(textWidth)) - 4
  return ways.map((way, i) => ({
    label: labels[i]!,
    valueEur: way.costPerYearEur,
    valueText: valueTexts[i]!,
    color: way.isToday
      ? PDF_COLORS.textMuted
      : way.isRecommended
        ? CHART_COLORS.series
        : CHART_COLORS.seriesSoft,
    recommended: way.isRecommended,
    labelTop: i * rowHeight,
    barTop: i * rowHeight + LINE_PT,
    barHeight,
    barWidth: max > 0 ? Math.max(0, (way.costPerYearEur / max) * scale) : 0,
  }))
}

const label = (bold: boolean) => ({
  fontSize: FONT_PT,
  lineHeight: LINE_PT / FONT_PT,
  fontWeight: bold ? 700 : 400,
  color: PDF_COLORS.text,
})

export function ExecWaysChart({
  ways,
  labels,
  slot,
}: {
  ways: ExecutiveSummaryWay[]
  labels: string[]
  slot: Size
}) {
  return (
    <View style={{ width: slot.width, height: slot.height, position: 'relative' }}>
      {waysBarsOf(ways, labels, slot).map((bar) => (
        <View key={bar.label}>
          <Text
            style={[
              label(bar.recommended),
              { position: 'absolute', top: bar.labelTop, left: 0, width: slot.width },
            ]}
          >
            {bar.label}
          </Text>
          <View
            style={{
              position: 'absolute',
              top: bar.barTop,
              left: 0,
              width: bar.barWidth,
              height: bar.barHeight,
              backgroundColor: bar.color,
            }}
          />
          <Text
            style={[
              label(bar.recommended),
              {
                position: 'absolute',
                top: bar.barTop + (bar.barHeight - LINE_PT) / 2,
                left: bar.barWidth + 3,
              },
            ]}
          >
            {bar.valueText}
          </Text>
        </View>
      ))}
    </View>
  )
}

// ── Break-even-Band ────────────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type Placed = Rect & { text: string; bold?: boolean }

export type BreakEvenLayout = {
  plot: { left: number; right: number; top: number; bottom: number }
  upper: { from: Point; to: Point }
  lower: { from: Point; to: Point } | null
  investmentY: number
  markers: (Point & { label: Placed })[]
  investmentLabel: Placed
  legend: { text: string; color: string; x: number }[]
  ticks: Placed[]
}

const LEGEND_SWATCH_PT = 8
const UPPER_COLOR = CHART_COLORS.series
const LOWER_COLOR = CHART_COLORS.seriesSoft

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function crossesSegment(rect: Rect, from: Point, to: Point): boolean {
  const x0 = Math.max(rect.x, from.x)
  const x1 = Math.min(rect.x + rect.width, to.x)
  if (x0 > x1) return false
  const yAt = (x: number) => from.y + ((x - from.x) / (to.x - from.x)) * (to.y - from.y)
  const [ya, yb] = [yAt(x0), yAt(x1)]
  return Math.min(ya, yb) < rect.y + rect.height && Math.max(ya, yb) > rect.y
}

export function breakEvenLayoutOf(band: BreakEvenBand, slot: Size): BreakEvenLayout {
  const plot = {
    left: 1,
    right: slot.width - 1,
    top: LINE_PT + 4,
    bottom: slot.height - LINE_PT - 3,
  }
  const x = (years: number) => plot.left + (years / band.horizonYears) * (plot.right - plot.left)
  const y = (eur: number) => plot.bottom - (eur / band.yMaxEur) * (plot.bottom - plot.top)
  const origin = { x: x(0), y: y(0) }
  const end = (perYearEur: number) => ({
    x: x(band.horizonYears),
    y: y(perYearEur * band.horizonYears),
  })
  const upper = { from: origin, to: end(band.upper.perYearEur) }
  const lower = band.lower ? { from: origin, to: end(band.lower.perYearEur) } : null
  const investmentY = y(band.investmentEur)

  const segments = [upper, ...(lower ? [lower] : [])]
  const lines = [band.upper, ...(band.lower ? [band.lower] : [])]
  const points = lines
    .filter((line) => line.paybackYears !== null)
    .map((line) => ({ x: x(line.paybackYears!), y: investmentY, years: line.paybackYears! }))
  const placed: Rect[] = points.map((p) => ({ x: p.x - 2, y: p.y - 2, width: 4, height: 4 }))
  /** Kollidiert wird mit der Glyphenhöhe, nicht mit der vollen Zeile. */
  const fits = (box: Rect) => {
    const rect = { ...box, y: box.y + 1, height: box.height - 2 }
    return (
      rect.x >= 0 &&
      rect.x + rect.width <= slot.width &&
      rect.y >= plot.top - 2 &&
      rect.y + rect.height <= plot.bottom &&
      !(investmentY > rect.y && investmentY < rect.y + rect.height) &&
      !placed.some((other) => overlaps(rect, other)) &&
      !segments.some(({ from, to }) => crossesSegment(rect, from, to))
    )
  }
  /** Erste freie Position der Kandidaten, sonst die erste. */
  const place = (text: string, candidates: Point[], bold = false): Placed => {
    const width = textWidth(text)
    const rects = candidates.map((c) => ({ x: c.x, y: c.y, width, height: LINE_PT }))
    const rect = rects.find(fits) ?? rects[0]!
    placed.push(rect)
    return { ...rect, text, bold }
  }

  const investmentText = `Investition ${formatEur(band.investmentEur)}`
  const iw = textWidth(investmentText)
  const investmentLabel = place(investmentText, [
    { x: plot.left + 1, y: investmentY - LINE_PT - 1 },
    { x: plot.left + 1, y: investmentY + 1 },
    { x: plot.right - iw, y: investmentY - LINE_PT - 1 },
    { x: plot.right - iw, y: investmentY + 1 },
  ])

  const markers = points.map((point) => {
    const text = aboutYears(point.years)
    const w = textWidth(text)
    const label = place(text, [
      { x: point.x - 3 - w, y: point.y - LINE_PT - 1 },
      { x: point.x + 3, y: point.y + 1 },
      { x: point.x + 3, y: point.y - LINE_PT - 1 },
      { x: point.x - 3 - w, y: point.y + 1 },
    ])
    return { x: point.x, y: point.y, label }
  })

  const legendItems = [
    {
      text: band.upperBound ? 'Mit Stromspitzen (Höchstwert)' : 'Ihre Ersparnis',
      color: UPPER_COLOR,
    },
    ...(band.lower ? [{ text: 'Nur günstiges Laden', color: LOWER_COLOR }] : []),
  ]
  let cursor = 0
  const legend = legendItems.map((item) => {
    const entry = { ...item, x: cursor }
    cursor += LEGEND_SWATCH_PT + 2 + textWidth(item.text) + 8
    return entry
  })

  const mid = band.horizonYears / 2
  const tickY = plot.bottom + 2
  const midText = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(mid)
  const lastText = `${band.horizonYears} Jahre`
  const ticks: Placed[] = [
    { text: '0', x: plot.left, y: tickY, width: textWidth('0'), height: LINE_PT },
    {
      text: midText,
      x: x(mid) - textWidth(midText) / 2,
      y: tickY,
      width: textWidth(midText),
      height: LINE_PT,
    },
    {
      text: lastText,
      x: plot.right - textWidth(lastText),
      y: tickY,
      width: textWidth(lastText),
      height: LINE_PT,
    },
  ]

  return { plot, upper, lower, investmentY, markers, investmentLabel, legend, ticks }
}

const at = (rect: Placed, align: 'left' | 'right' = 'left') => ({
  ...label(rect.bold ?? false),
  position: 'absolute' as const,
  top: rect.y,
  left: rect.x,
  width: rect.width,
  textAlign: align,
  color: PDF_COLORS.textMuted,
})

export function ExecBreakEvenChart({ band, slot }: { band: BreakEvenBand; slot: Size }) {
  const l = breakEvenLayoutOf(band, slot)
  const { plot } = l
  return (
    <View style={{ width: slot.width, height: slot.height, position: 'relative' }}>
      <Svg
        width={slot.width}
        height={slot.height}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {l.lower && (
          <Polygon
            points={[l.upper.from, l.upper.to, l.lower.to].map((p) => `${p.x},${p.y}`).join(' ')}
            fill={CHART_COLORS.modelTint}
            fillOpacity={0.35}
          />
        )}
        <Line
          x1={plot.left}
          y1={plot.bottom}
          x2={plot.right}
          y2={plot.bottom}
          stroke={PDF_COLORS.border}
          strokeWidth={0.75}
        />
        {l.ticks.map((tick, i) => {
          const tx = i === 0 ? plot.left : i === 2 ? plot.right : tick.x + tick.width / 2
          return (
            <Line
              key={tick.text}
              x1={tx}
              y1={plot.bottom}
              x2={tx}
              y2={plot.bottom + 2}
              stroke={PDF_COLORS.textMuted}
              strokeWidth={0.5}
            />
          )
        })}
        <Line
          x1={plot.left}
          y1={l.investmentY}
          x2={plot.right}
          y2={l.investmentY}
          stroke={PDF_COLORS.textMuted}
          strokeWidth={0.75}
          strokeDasharray="3 2"
        />
        {l.lower && (
          <Line
            x1={l.lower.from.x}
            y1={l.lower.from.y}
            x2={l.lower.to.x}
            y2={l.lower.to.y}
            stroke={LOWER_COLOR}
            strokeWidth={1.25}
          />
        )}
        <Line
          x1={l.upper.from.x}
          y1={l.upper.from.y}
          x2={l.upper.to.x}
          y2={l.upper.to.y}
          stroke={UPPER_COLOR}
          strokeWidth={1.5}
        />
        {l.markers.map((m) => (
          <Circle key={m.label.text} cx={m.x} cy={m.y} r={2} fill={PDF_COLORS.ink} />
        ))}
        {l.legend.map((item) => (
          <Line
            key={item.text}
            x1={item.x}
            y1={LINE_PT / 2}
            x2={item.x + LEGEND_SWATCH_PT}
            y2={LINE_PT / 2}
            stroke={item.color}
            strokeWidth={item.color === UPPER_COLOR ? 1.5 : 1.25}
          />
        ))}
      </Svg>
      {l.legend.map((item) => (
        <Text
          key={item.text}
          style={[
            label(false),
            {
              position: 'absolute',
              top: 0,
              left: item.x + LEGEND_SWATCH_PT + 2,
              color: PDF_COLORS.textMuted,
            },
          ]}
        >
          {item.text}
        </Text>
      ))}
      <Text style={at(l.investmentLabel)}>{l.investmentLabel.text}</Text>
      {l.markers.map((m) => (
        <Text key={m.label.text} style={[at(m.label), { color: PDF_COLORS.ink }]}>
          {m.label.text}
        </Text>
      ))}
      {l.ticks.map((tick, i) => (
        <Text key={tick.text} style={at(tick, i === 2 ? 'right' : 'left')}>
          {tick.text}
        </Text>
      ))}
    </View>
  )
}
