'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BillingModel, DispatchTrace, LoadProfile } from 'shared'

import { downsampleMinMax, type SamplePoint } from '@/lib/downsample'
import { formatEur, formatKw } from '@/lib/format'
import { formatDateTimeLabel, formatDayLabel, localMonthIndex } from '@/lib/local-time'
import { Num } from './num'

type CaughtPeak = DispatchTrace['caughtPeaks'][number]
type PeakPoint = CaughtPeak & { x: number; y: number }

type CapSegment = { startMs: number; endMs: number; capKw: number }

/**
 * Kapp-Schwelle je Abrechnungsperiode als Segmente entlang der tatsächlich im Profil vorkommenden
 * Zeitstempel (nicht Kalendergrenzen) — robust gegen Lücken/Teiljahre. `annual_max` (bzw. ein
 * einzelner Cap-Wert) ⇒ EIN Segment über den ganzen Zeitraum. `monthly_*` ⇒ bis zu 12 Segmente
 * nach LOKALEM Monat (`capKwByPeriod`-Index = Monat−1, konsistent mit der Engine, §3.6.1).
 * Zwischen zwei Segmenten liegt der Monatswechsel real nur ~15 min auseinander — der lineare
 * Übergang zwischen den Segment-Randpunkten wirkt bei Jahresansicht wie ein Sprung, ohne dass ein
 * echter Stufentyp mit numerischer Zeitachse gebraucht wird.
 */
function buildCapSegments(
  loadProfile: LoadProfile,
  billingModel: BillingModel,
  capKwByPeriod: number[],
): CapSegment[] {
  const readings = loadProfile.readings
  if (readings.length === 0 || capKwByPeriod.length === 0) return []

  if (billingModel === 'annual_max' || capKwByPeriod.length === 1) {
    return [
      {
        startMs: Date.parse(readings[0]!.ts),
        endMs: Date.parse(readings[readings.length - 1]!.ts),
        capKw: capKwByPeriod[0]!,
      },
    ]
  }

  const bounds = new Map<number, { min: number; max: number }>()
  for (const r of readings) {
    const ms = Date.parse(r.ts)
    const month = localMonthIndex(ms, loadProfile.timezoneMeta)
    const b = bounds.get(month)
    if (!b) bounds.set(month, { min: ms, max: ms })
    else {
      if (ms < b.min) b.min = ms
      if (ms > b.max) b.max = ms
    }
  }

  return [...bounds.entries()]
    .sort((a, b) => a[1].min - b[1].min)
    .map(([month, b]) => ({ startMs: b.min, endMs: b.max, capKw: capKwByPeriod[month] ?? Infinity }))
}

function capAtMs(segments: CapSegment[], ms: number): number {
  for (const seg of segments) {
    if (ms >= seg.startMs && ms <= seg.endMs) return seg.capKw
  }
  return Infinity
}

function ChartTooltip({
  active,
  payload,
  label,
  timeZone,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number }>
  label?: number
  timeZone: string
}) {
  if (!active || !payload || payload.length === 0 || label == null) return null
  const load = payload.find((p) => p.dataKey === 'y')
  const cap = payload.find((p) => p.dataKey === 'cap')
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{formatDateTimeLabel(label, timeZone)}</p>
      {load && load.value != null && (
        <p className="text-text-muted">
          Bezug: <Num className="font-medium text-ink">{formatKw(load.value)}</Num>
        </p>
      )}
      {cap && cap.value != null && Number.isFinite(cap.value) && (
        <p className="text-text-muted">
          Kapp-Schwelle: <Num className="font-medium text-ink">{formatKw(cap.value)}</Num>
        </p>
      )}
    </div>
  )
}

/**
 * Wie viele Perioden-Höchstwerte in den abgerechneten kW-Wert eingehen — bestimmt, welchen Anteil
 * am jährlichen Leistungsentgelt EIN Perioden-Höchstwert trägt: `monthly_max_average` mittelt über
 * 12 Monate (eine Monats-Spitze trägt 1/12 ihres kW-Werts bei), `monthly_max_sum` summiert und
 * `annual_max` kennt nur den einen Jahres-Höchstwert (jeweils voller Beitrag → Divisor 1).
 */
const BILLED_PERIOD_DIVISOR: Record<BillingModel, number> = {
  annual_max: 1,
  monthly_max_sum: 1,
  monthly_max_average: 12,
}

export function LoadChart({
  loadProfile,
  dispatchTrace,
  billingModel,
  leistungspreisRatePerKwYear,
}: {
  loadProfile: LoadProfile
  dispatchTrace: DispatchTrace | undefined
  billingModel: BillingModel
  /** [ABGELEITET] Roher Leistungspreis-Satz (€/kW·a) — Basis der kontrafaktischen Spitzen-Kostengröße. */
  leistungspreisRatePerKwYear: number | null
}) {
  const [selectedPeak, setSelectedPeak] = useState<PeakPoint | null>(null)
  const tz = loadProfile.timezoneMeta

  const rawPoints = useMemo<SamplePoint[]>(
    () => loadProfile.readings.map((r) => ({ x: Date.parse(r.ts), y: r.gridPowerKw })),
    [loadProfile],
  )

  // Jahresübersicht min-max-downgesampelt (DESIGN.md-Vorbehalt zu 35.040 Punkten, s. lib/downsample.ts):
  // hält die Kurve flüssig, ohne echte Spitzen zu verschlucken. Die `caughtPeaks`-Marker kommen
  // unabhängig davon exakt aus dem Trace — kein Genauigkeitsverlust bei den anklickbaren Spitzen.
  const loadPoints = useMemo(() => downsampleMinMax(rawPoints), [rawPoints])

  const capSegments = useMemo(
    () => buildCapSegments(loadProfile, billingModel, dispatchTrace?.capKwByPeriod ?? []),
    [loadProfile, billingModel, dispatchTrace],
  )
  // Klein (≤12 Segmente) — kein Memo nötig, direkt vom bereits gememoized `capSegments` abgeleitet.
  const finiteCapSegments = capSegments.filter((s) => Number.isFinite(s.capKw))
  const capPoints = useMemo(
    () =>
      capSegments
        .filter((s) => Number.isFinite(s.capKw))
        .flatMap((seg) => [
          { x: seg.startMs, cap: seg.capKw },
          { x: seg.endMs, cap: seg.capKw },
        ]),
    [capSegments],
  )

  const peakPoints = useMemo<PeakPoint[]>(
    () => (dispatchTrace?.caughtPeaks ?? []).map((p) => ({ ...p, x: Date.parse(p.ts), y: p.originalKw })),
    [dispatchTrace],
  )

  const [minMs, maxMs] = useMemo(() => {
    if (rawPoints.length === 0) return [0, 1]
    return [rawPoints[0]!.x, rawPoints[rawPoints.length - 1]!.x]
  }, [rawPoints])

  const [minY, maxY] = useMemo(() => {
    let lo = 0
    let hi = 0
    for (const p of loadPoints) {
      if (p.y < lo) lo = p.y
      if (p.y > hi) hi = p.y
    }
    for (const seg of capSegments) if (Number.isFinite(seg.capKw) && seg.capKw > hi) hi = seg.capKw
    for (const p of peakPoints) if (p.y > hi) hi = p.y
    return [lo, hi * 1.05]
  }, [loadPoints, peakPoints, capSegments])

  const capAtSelected = selectedPeak ? capAtMs(capSegments, selectedPeak.x) : null
  const shavedKw = selectedPeak ? selectedPeak.originalKw - selectedPeak.residualKw : 0
  // KONTRAFAKTISCH und unabhängig von allen anderen Spitzen (§6.2): was diese Spitze ALLEIN an
  // jährlichem Leistungsentgelt trüge, wäre sie der abgerechnete Höchstwert ihrer Abrechnungsperiode
  // — Ursprungsbezug × Leistungspreis-Satz, geteilt durch die Zahl der in den abgerechneten Wert
  // eingehenden Perioden-Höchstwerte (monthly_max_average → ÷12). BEWUSST nicht `shavedKw × Satz`:
  // in den monthly_*-Modellen bestimmt je Abrechnungsperiode NUR die höchste Spitze den abgerechneten
  // Wert, die übrigen gekappten Spitzen derselben Periode tragen real €0 bei — eine als „Ersparnis je
  // Spitze" gelesene Zahl wäre dort irreführend. Dies ist eine Kosten-Exposition, keine Ersparnis.
  const counterfactualPeakCostPerYear =
    selectedPeak && leistungspreisRatePerKwYear != null
      ? (selectedPeak.originalKw * leistungspreisRatePerKwYear) / BILLED_PERIOD_DIVISOR[billingModel]
      : null

  return (
    <div className="flex flex-col gap-3">
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
              domain={[minY, maxY]}
              tickFormatter={(kw: number) => formatKw(kw)}
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              width={64}
            />
            <Tooltip content={<ChartTooltip timeZone={tz} />} isAnimationActive={false} />
            <Line
              data={loadPoints}
              dataKey="y"
              name="Lastgang"
              type="linear"
              dot={false}
              isAnimationActive={false}
              stroke="var(--color-text-muted)"
              strokeWidth={1.25}
              activeDot={{ r: 3 }}
            />
            {capPoints.length > 0 && (
              <Line
                data={capPoints}
                dataKey="cap"
                name="Kapp-Schwelle"
                type="linear"
                dot={false}
                isAnimationActive={false}
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                strokeDasharray="6 3"
              />
            )}
            {peakPoints.length > 0 && (
              <Scatter
                data={peakPoints}
                dataKey="y"
                name="Abgefangene Spitze"
                isAnimationActive={false}
                fill="var(--color-warning)"
                shape={(props: { cx?: number; cy?: number }) => (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={5}
                    fill="var(--color-warning)"
                    stroke="var(--color-surface)"
                    strokeWidth={1.5}
                    style={{ cursor: 'pointer' }}
                  />
                )}
                onClick={(data: unknown) => {
                  const point = (data as { payload?: PeakPoint } | PeakPoint) ?? null
                  const resolved =
                    point && 'payload' in point && point.payload ? point.payload : (point as PeakPoint)
                  if (resolved) setSelectedPeak(resolved)
                }}
                cursor="pointer"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {finiteCapSegments.length === 0 && (
        <p className="text-xs text-text-muted">
          Keine Kapp-Schwelle eingezeichnet — die gewählte Steuerung kappt keine Spitzen (statisch,
          nur Eigenverbrauch/Lastverschiebung).
        </p>
      )}

      {selectedPeak && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-alt p-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-ink">
              {formatDateTimeLabel(selectedPeak.x, tz)}
            </p>
            <button
              type="button"
              onClick={() => setSelectedPeak(null)}
              className="text-text-muted hover:text-ink"
              aria-label="Detail schließen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <p className="text-xs text-text-muted">Ursprünglicher Bezug</p>
              <Num className="font-medium text-ink">{formatKw(selectedPeak.originalKw)}</Num>
            </div>
            <div>
              <p className="text-xs text-text-muted">Nach Batterie</p>
              <Num className="font-medium text-ink">{formatKw(selectedPeak.residualKw)}</Num>
            </div>
            <div>
              <p className="text-xs text-text-muted">Abgefangen</p>
              <Num className="font-medium text-positive">{formatKw(shavedKw)}</Num>
            </div>
            <div>
              <p className="text-xs text-text-muted">Kapp-Schwelle</p>
              <Num className="font-medium text-ink">
                {capAtSelected != null && Number.isFinite(capAtSelected)
                  ? formatKw(capAtSelected)
                  : '—'}
              </Num>
            </div>
          </div>
          {counterfactualPeakCostPerYear != null && (
            <p className="text-xs text-text-muted">
              Diese Spitze allein entspräche{' '}
              <Num className="font-medium text-ink">
                {formatEur(counterfactualPeakCostPerYear)}
              </Num>{' '}
              / Jahr Leistungsentgelt, wäre sie der abgerechnete Höchstwert ihrer Abrechnungsperiode
              (Bezugshöhe zum Leistungspreis der Periode). Kontrafaktische Kostengröße — nicht die
              Ersparnis, die je Abrechnungsperiode nur die höchste Spitze bestimmt.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
