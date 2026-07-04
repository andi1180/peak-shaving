'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisResult } from 'shared'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatKw, formatKwh } from '@/lib/format'
import { formatDayLabel, formatTimeLabel } from '@/lib/local-time'
import { Num } from './num'

type Entry = AnalysisResult['perBattery'][number]
type RepresentativeDay = NonNullable<Entry['dispatchTrace']>['representativeDays'][number]
type DayLabel = RepresentativeDay['label']

type FlowPoint = {
  x: number
  netz: number
  pv: number
  batterie: number
  verbrauch: number
  soc: number
}

const dayTabLabel: Record<DayLabel, string> = {
  worst_caught_peak: 'Teuerste abgefangene Spitze',
  pv_strong: 'Starke PV-Einspeisung',
}

function buildPoints(day: RepresentativeDay): FlowPoint[] {
  return day.intervals.map((iv) => ({
    x: Date.parse(iv.ts),
    netz: iv.gridPowerKw,
    pv: iv.pvGenerationKw,
    batterie: iv.batteryPowerKw,
    // §6.2/trace.ts: Verbrauch = Netzbezug − Batterieleistung + Brutto-PV (der „4. Strom").
    verbrauch: iv.gridPowerKw - iv.batteryPowerKw + iv.pvGenerationKw,
    soc: iv.socKwh,
  }))
}

function FlowTooltip({
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
  const get = (key: string) => payload.find((p) => p.dataKey === key)?.value
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{formatTimeLabel(label, timeZone)}</p>
      <p className="text-text-muted">
        Verbrauch: <Num className="font-medium text-ink">{formatKw(get('verbrauch') ?? 0)}</Num>
      </p>
      <p className="text-text-muted">
        Netzbezug: <Num className="font-medium text-ink">{formatKw(get('netz') ?? 0)}</Num>
      </p>
      <p className="text-text-muted">
        PV-Erzeugung: <Num className="font-medium text-ink">{formatKw(get('pv') ?? 0)}</Num>
      </p>
      <p className="text-text-muted">
        Batterie: <Num className="font-medium text-ink">{formatKw(get('batterie') ?? 0)}</Num> (
        {(get('batterie') ?? 0) >= 0 ? 'lädt' : 'entlädt'})
      </p>
      <p className="mt-1 text-text-muted">
        Ladezustand: <Num className="font-medium text-ink">{formatKwh(get('soc') ?? 0)}</Num>
      </p>
    </div>
  )
}

const LEGEND = [
  { key: 'verbrauch', label: 'Verbrauch', color: 'var(--color-ink)' },
  { key: 'netz', label: 'Netzbezug', color: 'var(--color-text-muted)' },
  { key: 'pv', label: 'PV-Erzeugung', color: 'var(--color-accent)' },
  { key: 'batterie', label: 'Batterie (+laden/−entladen)', color: 'var(--color-accent-hover)' },
] as const

/**
 * Chart 3 — Tages-Energiefluss (§6.2): vier Ströme über 24h in 15-min-Schritten, direkt aus
 * `representativeDays` der GERADE ausgewählten Batterie (kein zweiter Dispatch, Prinzip 2/3 —
 * reine Darstellung des bereits im Trace stehenden Tages, s. packages/engine/src/simulation/trace.ts).
 *
 * Default-Tag: `worst_caught_peak`. Kappt die gewählte Batterie nie (static, §3.6/OP#5) oder war
 * die Kappung zu schwach, um einen Top-Peak zu senken, fehlt dieser Tag sauber — dann Fallback auf
 * `pv_strong`, sonst ein erkennbarer, erklärter Leerzustand (KEIN Crash, keine stille leere Fläche).
 * Existieren beide Tage, ist `pv_strong` als sekundäre Ansicht per Toggle erreichbar.
 *
 * EXPLIZITE AUSNAHME vom sonstigen Report-Ruhe-Prinzip (§6.1/DESIGN.md, hier bewusst NICHT
 * `isAnimationActive={false}`): dieser eine Chart darf "leichte Interaktion/Animation" haben (§6.2)
 * — anders als Chart 1/2. Der Tages-Wechsel remounted den Chart (key=Datum) und animiert erneut.
 */
export function EnergyFlowChart({
  perBattery,
  selectedBatteryId,
  onSelectBattery,
  timeZone,
}: {
  perBattery: Entry[]
  selectedBatteryId: string
  onSelectBattery: (id: string) => void
  /** `loadProfile.timezoneMeta` (DST-bewusst, s. LoadChart) — ein einzelner Kalendertag hängt
   * ebenso an der lokalen Wanduhr wie die Jahresübersicht. */
  timeZone: string
}) {
  const [preferredTab, setPreferredTab] = useState<DayLabel | null>(null)

  const entry = perBattery.find((p) => p.battery.id === selectedBatteryId) ?? perBattery[0]!

  const days = entry.dispatchTrace?.representativeDays ?? []
  const worstDay = days.find((d) => d.label === 'worst_caught_peak')
  const pvDay = days.find((d) => d.label === 'pv_strong')

  const activeLabel: DayLabel | null =
    preferredTab === 'worst_caught_peak' && worstDay
      ? 'worst_caught_peak'
      : preferredTab === 'pv_strong' && pvDay
        ? 'pv_strong'
        : worstDay
          ? 'worst_caught_peak'
          : pvDay
            ? 'pv_strong'
            : null

  const activeDay =
    activeLabel === 'worst_caught_peak' ? worstDay : activeLabel === 'pv_strong' ? pvDay : undefined

  const points = useMemo(() => (activeDay ? buildPoints(activeDay) : []), [activeDay])
  const [minMs, maxMs] = useMemo(() => {
    if (points.length === 0) return [0, 1]
    return [points[0]!.x, points[points.length - 1]!.x]
  }, [points])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">Tages-Energiefluss</p>
          <p className="text-xs text-text-muted">Netz / PV / Batterie / Verbrauch über 24 h</p>
        </div>
        <Select value={selectedBatteryId} onValueChange={onSelectBattery}>
          <SelectTrigger className="w-56" aria-label="Batterie für Energiefluss-Chart">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {perBattery.map((p) => (
              <SelectItem key={p.battery.id} value={p.battery.id}>
                {p.battery.name} ({p.battery.controlType === 'static' ? 'statisch' : 'dynamisch'})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeDay && worstDay && pvDay && (
        <div className="flex gap-1.5 text-xs">
          {(['worst_caught_peak', 'pv_strong'] as const).map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setPreferredTab(label)}
              className={
                activeLabel === label
                  ? 'rounded-full bg-accent px-3 py-1 font-medium text-accent-foreground transition-colors'
                  : 'rounded-full border border-border px-3 py-1 text-text-muted transition-colors hover:text-ink'
              }
            >
              {dayTabLabel[label]}
            </button>
          ))}
        </div>
      )}

      {activeDay ? (
        <>
          <p className="text-xs text-text-muted">{formatDayLabel(minMs, timeZone)}</p>
          <div key={activeDay.date} className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[minMs, maxMs]}
                  tickFormatter={(ms: number) => formatTimeLabel(ms, timeZone)}
                  stroke="var(--color-text-muted)"
                  tick={{ fontSize: 11 }}
                  minTickGap={32}
                />
                <YAxis
                  tickFormatter={(kw: number) => formatKw(kw)}
                  stroke="var(--color-text-muted)"
                  tick={{ fontSize: 11 }}
                  width={64}
                />
                <Tooltip content={<FlowTooltip timeZone={timeZone} />} />
                <ReferenceLine y={0} stroke="var(--color-border)" />
                <Area
                  dataKey="verbrauch"
                  name="Verbrauch"
                  type="monotone"
                  dot={false}
                  stroke="var(--color-ink)"
                  strokeWidth={1.5}
                  fill="var(--color-ink)"
                  fillOpacity={0.06}
                />
                <Area
                  dataKey="pv"
                  name="PV-Erzeugung"
                  type="monotone"
                  dot={false}
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  fill="var(--color-accent)"
                  fillOpacity={0.15}
                />
                <Line
                  dataKey="netz"
                  name="Netzbezug"
                  type="monotone"
                  dot={false}
                  stroke="var(--color-text-muted)"
                  strokeWidth={1.5}
                />
                <Line
                  dataKey="batterie"
                  name="Batterie"
                  type="monotone"
                  dot={false}
                  stroke="var(--color-accent-hover)"
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {LEGEND.map((l) => (
              <span key={l.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4"
                  aria-hidden
                  style={{ backgroundColor: l.color }}
                />
                {l.label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-alt p-6 text-center">
          <span className="text-xs font-medium text-text-muted">
            Kein Energiefluss-Tag verfügbar
          </span>
          <span className="max-w-sm text-xs text-text-muted">
            {entry.battery.controlType === 'static'
              ? `${entry.battery.name} ist statisch gesteuert — sie kappt keine Spitzen (nur Eigenverbrauch/Lastverschiebung), daher gibt es keinen Tag mit einer abgefangenen Spitze.`
              : `Für ${entry.battery.name} wurde im Betrachtungszeitraum keine Spitze abgefangen.`}{' '}
            Zusätzlich liegt kein PV-Erzeugungsprofil vor, das einen alternativen Tag liefern
            könnte.
          </span>
        </div>
      )}
    </div>
  )
}
