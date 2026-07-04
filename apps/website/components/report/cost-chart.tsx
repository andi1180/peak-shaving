'use client'

import { useId, useMemo } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisResult } from 'shared'

import { formatEur } from '@/lib/format'
import { Num } from './num'

type Entry = AnalysisResult['perBattery'][number]

type YearPoint = {
  year: number
  without: number
  with: number
  base: number
  band: number
}

/**
 * Kumulierte Kosten über den Horizont — linear fortgeschrieben, exakt konsistent mit der
 * ROI-Formel (`packages/engine/src/roi/roi.ts`): `netSavingOverHorizon = totalSavingPerYear ×
 * horizonYears − netInvestment`. Bei Jahr `horizonYears` gilt `without(h) − with(h) =
 * netSavingOverHorizon` per Konstruktion (keine zweite, abweichende Rechnung, Prinzip 2).
 * Break-even (`without(y) = with(y)`) liegt exakt bei `y = netInvestment / totalSavingPerYear =
 * amortizationYears` — dieselbe bereits im Contract geführte Zahl, hier nur visualisiert.
 */
function buildYearSeries(entry: Entry, currentCostPerYear: number, horizonYears: number): YearPoint[] {
  const points: YearPoint[] = []
  for (let year = 0; year <= horizonYears; year++) {
    const without = currentCostPerYear * year
    const withBattery = entry.netInvestment + (currentCostPerYear - entry.totalSavingPerYear) * year
    points.push({
      year,
      without,
      with: withBattery,
      base: Math.min(without, withBattery),
      band: Math.abs(without - withBattery),
    })
  }
  return points
}

function CostTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number }>
  label?: number
}) {
  if (!active || !payload || payload.length === 0 || label == null) return null
  const without = payload.find((p) => p.dataKey === 'without')
  const withBattery = payload.find((p) => p.dataKey === 'with')
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">Jahr {label}</p>
      {without && without.value != null && (
        <p className="text-text-muted">
          Ohne Batterie: <Num className="font-medium text-ink">{formatEur(without.value)}</Num>
        </p>
      )}
      {withBattery && withBattery.value != null && (
        <p className="text-text-muted">
          Mit Batterie: <Num className="font-medium text-ink">{formatEur(withBattery.value)}</Num>
        </p>
      )}
    </div>
  )
}

// Ein einziger Akzentton, drei monotone Helligkeitsstufen (DESIGN.md: kein erfundenes
// drittes Kategorie-Farbschema, Grün/Rot/Bernstein bleiben für Ersparnis/Kosten/Warnung
// reserviert). `color-mix()` leitet die Stufen live von `--color-accent` ab, damit ein
// White-Label-Wechsel des Akzenttons automatisch beide Stufen mitzieht (kein Hex im Code).
// Reihenfolge/Helligkeit gegen den Skill-Validator geprüft (OKLCH-Lightness-Band, ΔL≥0,06
// je Nachbarpaar, Hellstufe ≥2:1 Kontrast auf `--color-surface`) — nicht frei gegriffen.
const BREAKDOWN = [
  {
    key: 'leistungspreisSavingPerYear',
    label: 'Spitzenkappung (Leistungspreis)',
    color: 'var(--color-accent)',
    textColor: 'var(--color-on-accent)',
  },
  {
    key: 'selfConsumptionSavingPerYear',
    label: 'Eigenverbrauch',
    color: 'color-mix(in srgb, var(--color-accent) 85%, var(--color-surface))',
    textColor: 'var(--color-ink)',
  },
  {
    key: 'loadShiftSavingPerYear',
    label: 'Tarifbewusstes Laden',
    color: 'color-mix(in srgb, var(--color-accent) 65%, var(--color-surface))',
    textColor: 'var(--color-ink)',
  },
] as const

type SegmentLabelProps = {
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  value?: unknown
  textColor: string
}

// Direkte Segment-Beschriftung (Ziel: ohne Hover lesbar, nicht nur Tooltip/Legende).
// Schmale Segmente (z. B. ein kleiner Anteil neben einer dominanten Spitzenkappung) können
// den Text nicht aufnehmen — dann bewusst NICHT reinquetschen/clippen (marks-and-anatomy:
// "never overflow or clip"), der Betrag bleibt über die Legende darunter sichtbar.
function SegmentLabel({ x, y, width, height, value, textColor }: SegmentLabelProps) {
  const numX = Number(x)
  const numY = Number(y)
  const numWidth = Number(width)
  const numHeight = Number(height)
  const numValue = Number(value)
  if (!numValue || numValue <= 0 || [numX, numY, numWidth, numHeight].some(Number.isNaN)) return null
  const text = formatEur(numValue)
  const estimatedTextWidth = text.length * 6.5 + 8
  if (numWidth < estimatedTextWidth) return null
  return (
    <text
      x={numX + numWidth / 2}
      y={numY + numHeight / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
      fill={textColor}
      className="tabular-nums"
    >
      {text}
    </text>
  )
}

// Kompaktes, separates stacked-Bar (§6.2 "getrennt sichtbar") — zeigt die Zusammensetzung der
// JÄHRLICHEN Ersparnis. Anteile sind über den Horizont konstant (lineares Modell, keine sich
// ändernden Raten), ein einzelner Balken pro Kategorie genügt (keine 1x-pro-Jahr-Wiederholung nötig).
function SavingsBreakdownBar({ entry }: { entry: Entry }) {
  const row = {
    name: 'Ersparnis/Jahr',
    leistungspreisSavingPerYear: entry.leistungspreisSavingPerYear,
    selfConsumptionSavingPerYear: entry.selfConsumptionSavingPerYear,
    loadShiftSavingPerYear: entry.loadShiftSavingPerYear,
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="h-10 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[row]} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip
              isAnimationActive={false}
              formatter={(value, _name, item) => [
                formatEur(Number(value)),
                BREAKDOWN.find((b) => b.key === item.dataKey)?.label ?? '',
              ]}
            />
            {BREAKDOWN.map((b) => (
              <Bar key={b.key} dataKey={b.key} stackId="s" fill={b.color} isAnimationActive={false}>
                <LabelList dataKey={b.key} content={(props) => <SegmentLabel {...props} textColor={b.textColor} />} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {BREAKDOWN.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: b.color }}
              aria-hidden
            />
            {b.label}: <Num className="font-medium text-ink">{formatEur(entry[b.key])}</Num>
          </span>
        ))}
      </div>
    </div>
  )
}

export function CostChart({
  entry,
  currentLeistungspreisCostPerYear,
  horizonYears,
}: {
  entry: Entry
  currentLeistungspreisCostPerYear: number
  horizonYears: number
}) {
  const gradientId = useId()
  const points = useMemo(
    () => buildYearSeries(entry, currentLeistungspreisCostPerYear, horizonYears),
    [entry, currentLeistungspreisCostPerYear, horizonYears],
  )

  // Bruchteil der X-Achse (0..1), an dem "mit Batterie" günstiger wird als "ohne" — für den
  // Gradient-Hard-Cut der Bandfläche (rot davor/"unter Wasser", grün danach/realisierte Ersparnis).
  // `amortizationYears` ist dieselbe Contract-Zahl wie in der RecommendationCard — keine Neuberechnung.
  const breakEvenFraction = !Number.isFinite(entry.amortizationYears)
    ? 1.5 // nie amortisiert im Horizont → Band durchgehend rot
    : Math.max(0, Math.min(1, entry.amortizationYears / horizonYears))

  return (
    <div className="flex flex-col gap-4">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset={breakEvenFraction} stopColor="var(--color-negative)" stopOpacity={0.18} />
                <stop offset={breakEvenFraction} stopColor="var(--color-positive)" stopOpacity={0.18} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="year"
              type="number"
              domain={[0, horizonYears]}
              tickFormatter={(y: number) => `${y}`}
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              label={{ value: 'Jahr', position: 'insideBottomRight', offset: -4, fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(v: number) => formatEur(v)}
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              width={72}
            />
            <Tooltip content={<CostTooltip />} isAnimationActive={false} />
            <Area
              dataKey="base"
              stackId="band"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
            />
            <Area
              dataKey="band"
              stackId="band"
              stroke="none"
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              legendType="none"
            />
            <Line
              dataKey="without"
              name="Ohne Batterie"
              type="linear"
              dot={false}
              isAnimationActive={false}
              stroke="var(--color-text-muted)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <Line
              dataKey="with"
              name="Mit Batterie"
              type="linear"
              dot={false}
              isAnimationActive={false}
              stroke="var(--color-accent)"
              strokeWidth={2}
            />
            {Number.isFinite(entry.amortizationYears) && entry.amortizationYears <= horizonYears && (
              <ReferenceLine
                x={entry.amortizationYears}
                stroke="var(--color-ink)"
                strokeDasharray="3 3"
                label={{ value: 'Break-even', position: 'top', fontSize: 11, fill: 'var(--color-ink)' }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-text-muted" aria-hidden style={{ borderTop: '2px dashed var(--color-text-muted)' }} />
          Ohne Batterie
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" aria-hidden style={{ backgroundColor: 'var(--color-accent)' }} />
          Mit Batterie
        </span>
      </div>
      <SavingsBreakdownBar entry={entry} />
    </div>
  )
}
