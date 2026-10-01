import { formatEur } from '@/lib/format'
import { PDF_COLORS } from '@/lib/pdf-report/theme'
import {
  SAVINGS_DONUT_COLORS,
  type SavingsDonut,
  type SavingsDonutSegment,
} from '@/lib/pdf-report/savings-donut'

/**
 * Das Ringdiagramm des Jahreskapitels — nur im PDF, gerastert über `captureChart` wie die übrigen
 * Report-Charts. Reines SVG statt Recharts: es gibt keine Achsen, und die Beschriftungen brauchen
 * eine eigene Kollisionsregel.
 */

export const SAVINGS_DONUT_WIDTH_PX = 760
const HEIGHT_PX = 270
const CX = SAVINGS_DONUT_WIDTH_PX / 2
const CY = HEIGHT_PX / 2
const OUTER_R = 105
const INNER_R = 66
/** Abstand der Beschriftungsmitten auf einer Seite: zwei Zeilen à 13 px plus Luft. */
const LABEL_GAP_PX = 36
const LABEL_MIN_Y = 22
const LABEL_MAX_Y = HEIGHT_PX - 22

export const SAVINGS_DONUT_SELECTOR = 'svg[data-chart="savings-donut"]'

type Arc = { segment: SavingsDonutSegment; start: number; end: number }

/** Winkel in Grad ab 12 Uhr im Uhrzeigersinn → Punkt auf dem Kreis. */
function point(angleDeg: number, radius: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)]
}

function arcPath(start: number, end: number): string {
  const large = end - start > 180 ? 1 : 0
  const [x1, y1] = point(start, OUTER_R)
  const [x2, y2] = point(end, OUTER_R)
  const [x3, y3] = point(end, INNER_R)
  const [x4, y4] = point(start, INNER_R)
  return (
    `M ${x1} ${y1} A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${x2} ${y2} ` +
    `L ${x3} ${y3} A ${INNER_R} ${INNER_R} 0 ${large} 0 ${x4} ${y4} Z`
  )
}

type Label = { arc: Arc; side: 1 | -1; anchor: [number, number]; y: number }

/** Je Seite von oben nach unten auseinanderschieben, dann am unteren Rand zurück nach oben. */
function spread(labels: Label[]): void {
  labels.sort((a, b) => a.y - b.y)
  let floor = LABEL_MIN_Y
  for (const label of labels) {
    label.y = Math.max(label.y, floor)
    floor = label.y + LABEL_GAP_PX
  }
  let ceiling = LABEL_MAX_Y
  for (const label of [...labels].reverse()) {
    label.y = Math.min(label.y, ceiling)
    ceiling = label.y - LABEL_GAP_PX
  }
}

export function SavingsDonutChart({ donut }: { donut: SavingsDonut }) {
  // Winkel aus den angezeigten Prozent — das Bild zeigt dieselben Anteile wie die Beschriftung.
  let cursor = 0
  const arcs: Arc[] = donut.segments.map((segment) => {
    const start = cursor
    cursor += (segment.percent / 100) * 360
    return { segment, start, end: cursor }
  })

  const labels: Label[] = arcs
    .filter((arc) => arc.segment.labelInChart)
    .map((arc) => {
      const mid = (arc.start + arc.end) / 2
      const anchor = point(mid, OUTER_R + 3)
      const side = anchor[0] >= CX ? 1 : -1
      return { arc, side, anchor, y: point(mid, OUTER_R + 20)[1] }
    })
  spread(labels.filter((l) => l.side === 1))
  spread(labels.filter((l) => l.side === -1))

  return (
    <svg
      data-chart="savings-donut"
      width={SAVINGS_DONUT_WIDTH_PX}
      height={HEIGHT_PX}
      viewBox={`0 0 ${SAVINGS_DONUT_WIDTH_PX} ${HEIGHT_PX}`}
      role="img"
      aria-label={donut.title}
    >
      {arcs.map(({ segment, start, end }) => (
        <path
          key={segment.key}
          d={arcPath(start, end)}
          fill={SAVINGS_DONUT_COLORS[segment.key]}
          stroke="#ffffff"
          strokeWidth={2}
        />
      ))}

      <text x={CX} y={CY - 20} textAnchor="middle" fontSize={12} fill={PDF_COLORS.textMuted}>
        Summe
      </text>
      <text
        x={CX}
        y={CY + 7}
        textAnchor="middle"
        fontSize={22}
        fontWeight={700}
        fill={PDF_COLORS.ink}
      >
        {formatEur(donut.totalEur)}
      </text>
      <text x={CX} y={CY + 25} textAnchor="middle" fontSize={12} fill={PDF_COLORS.textMuted}>
        pro Jahr
      </text>

      {labels.map(({ arc, side, anchor, y }) => {
        const elbowX = CX + side * (OUTER_R + 30)
        const textX = elbowX + side * 6
        const anchorAttr = side === 1 ? 'start' : 'end'
        return (
          <g key={arc.segment.key}>
            <polyline
              points={`${anchor[0]},${anchor[1]} ${elbowX},${y} ${textX - side * 2},${y}`}
              fill="none"
              stroke={PDF_COLORS.textMuted}
              strokeWidth={1}
            />
            <text
              x={textX}
              y={y - 3}
              textAnchor={anchorAttr}
              fontSize={13}
              fontWeight={600}
              fill={PDF_COLORS.ink}
            >
              {arc.segment.label}
            </text>
            <text
              x={textX}
              y={y + 13}
              textAnchor={anchorAttr}
              fontSize={13}
              fill={PDF_COLORS.textMuted}
            >
              {`${formatEur(arc.segment.eur)} · ${arc.segment.percent} %`}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
