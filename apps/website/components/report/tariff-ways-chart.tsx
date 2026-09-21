'use client'

import { useId } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatEur } from '@/lib/format'
import { monthlyBatteryRef } from '@/lib/report-copy'
import { CHART_COLORS } from '@/lib/pdf-report/theme'
import { Num } from './num'
import type { WaysTotals } from '@/lib/pdf-report/ways'

/**
 * D7 — die drei Balken des Kapitels „Zwei Wege zu weniger Stromkosten": Ihr Tarif heute, aWATTar
 * ohne Steuerung, aWATTar mit Ladesteuerung — je EIN Balken über den gesamten gemessenen Zeitraum.
 *
 * ── ⚠ KEIN VIERTER ODER FÜNFTER BALKEN ─────────────────────────────────────────────────────────
 * Kein Pauschaltarif-Vergleich, keine LP-optimale Bestmarke (D7, MVP-Scope „drei Balken"). Diese
 * Komponente kennt beide Grössen nicht und darf sie nicht dazubekommen, ohne dass D7 neu
 * entschieden wird.
 *
 * ── ⚠ DIESELBEN DREI FARBSTUFEN WIE `MonthlyTariffChart` ──────────────────────────────────────
 * Neutral für den Ist-Zustand, zwei zunehmend kräftige Akzentstufen für aWATTar — „so ist es heute
 * → so wäre es dort → so wäre es dort mit Ladesteuerung" steckt damit in der Helligkeit, genau wie
 * im Monatsvergleich. Die dritte Reihe trägt dieselbe Schraffur (D15 Block 2, Punkt 14): sie
 * unterstellt eine Ladesteuerung, die so noch nicht läuft.
 *
 * ── ⚠ DIE TOTALS KOMMEN FERTIG HEREIN ──────────────────────────────────────────────────────────
 * `sumCovered` läuft in `ways.ts` (derselbe Helfer wie in `MonthlyTariffChart` und der
 * Zusammenfassung) — diese Komponente rechnet nichts nach, sie zeichnet nur.
 */
/** Wortgleiches Muster zu `MonthTooltip` (`monthly-tariff-chart.tsx`) — vermeidet die Typprobleme
 * von `formatter`/`labelFormatter` bei `undefined`-Werten. */
function WaysTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: { label: string; value: number } }>
}) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-ink">{row.label}</p>
      <Num className="font-medium text-ink">{formatEur(row.value)}</Num>
    </div>
  )
}

export function TariffWaysChart({
  totals,
  isExisting,
}: {
  totals: WaysTotals
  /** Fährt die dritte Reihe die Anlage des Kunden oder die empfohlene Batterie? Nur der Wortlaut. */
  isExisting: boolean
}) {
  const modelPatternId = useId()
  const whose = monthlyBatteryRef(isExisting)

  const rows = [
    {
      key: 'today',
      label: 'Ihr Tarif heute',
      value: totals.currentTariffEur,
      color: 'var(--color-text-muted)',
      model: false,
    },
    {
      key: 'uncontrolled',
      label: 'aWATTar ohne Steuerung',
      value: totals.spotWithoutControlEur,
      color: CHART_COLORS.seriesSoft,
      model: false,
    },
    {
      key: 'controlled',
      label: `aWATTar mit ${whose}`,
      value: totals.spotWithBatteryEur,
      color: CHART_COLORS.series,
      model: true,
    },
  ] as const

  return (
    <div className="h-56 w-full" data-testid="zwei-wege-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <pattern
              id={modelPatternId}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" fill={CHART_COLORS.series} />
              <line x1="0" y1="0" x2="0" y2="5" stroke={CHART_COLORS.modelTint} strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke="var(--color-text-muted)" tick={{ fontSize: 11 }} interval={0} />
          <YAxis
            tickFormatter={(v: number) => formatEur(v)}
            stroke="var(--color-text-muted)"
            tick={{ fontSize: 11 }}
            width={64}
          />
          <Tooltip content={<WaysTooltip />} isAnimationActive={false} cursor={false} />
          <Bar dataKey="value" isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.key} fill={row.model ? `url(#${modelPatternId})` : row.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
