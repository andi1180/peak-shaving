'use client'

import { useMemo } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, XAxis, YAxis } from 'recharts'
import type { LoadProfile } from 'shared'

import { evenAxisTicks } from '@/lib/chart-ticks'
import { downsampleMinMax } from '@/lib/downsample'
import { formatKw } from '@/lib/format'
import { formatDayLabel } from '@/lib/local-time'
import type { PeakShavingCapSegment, PeakShavingPoint } from '@/lib/pdf-report/peak-shaving-chart'

/**
 * Nur im PDF (Weg 5): Lastgang, Kappschwelle je Monat und die Viertelstunden darüber. Anders als
 * `LoadChart` kleine Punkte und die Schwelle obenauf — bei tausend Punkten verschwände sie sonst.
 */
export function PeakShavingChart({
  loadProfile,
  capSegments,
  points,
}: {
  loadProfile: LoadProfile
  capSegments: PeakShavingCapSegment[]
  points: PeakShavingPoint[]
}) {
  const tz = loadProfile.timezoneMeta
  const load = useMemo(
    () => downsampleMinMax(loadProfile.readings.map((r) => ({ x: Date.parse(r.ts), y: r.gridPowerKw }))),
    [loadProfile],
  )
  const caps = capSegments.flatMap((s) => [
    { x: s.startMs, cap: s.capKw },
    { x: s.endMs, cap: s.capKw },
  ])
  const dots = points.map((p) => ({ x: Date.parse(p.ts), y: p.kw }))

  const minMs = load[0]?.x ?? 0
  const maxMs = load[load.length - 1]?.x ?? 1
  let lo = 0
  let hi = 0
  for (const p of load) {
    lo = Math.min(lo, p.y)
    hi = Math.max(hi, p.y)
  }
  const yAxis = evenAxisTicks(lo, hi * 1.05)

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={[minMs, maxMs]}
            tickFormatter={(ms: number) => formatDayLabel(ms, tz)}
            stroke="var(--color-text-muted)"
            tick={{ fontSize: 11 }}
            minTickGap={40}
          />
          <YAxis
            domain={yAxis ? yAxis.domain : ['auto', 'auto']}
            ticks={yAxis?.ticks}
            tickFormatter={(kw: number) => formatKw(kw)}
            stroke="var(--color-text-muted)"
            tick={{ fontSize: 11 }}
            width={64}
          />
          <Line
            data={load}
            dataKey="y"
            type="linear"
            dot={false}
            isAnimationActive={false}
            stroke="var(--color-text-muted)"
            strokeWidth={1.25}
          />
          <Scatter
            data={dots}
            dataKey="y"
            isAnimationActive={false}
            fill="var(--color-negative)"
            shape={(props: { cx?: number; cy?: number }) => (
              <circle cx={props.cx} cy={props.cy} r={2.5} fill="var(--color-negative)" />
            )}
          />
          <Line
            data={caps}
            dataKey="cap"
            type="linear"
            dot={false}
            isAnimationActive={false}
            stroke="var(--color-accent)"
            strokeWidth={2}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
