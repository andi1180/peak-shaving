'use client'

import { useId } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatEur } from '@/lib/format'
import { CHART_COLORS } from '@/lib/pdf-report/theme'
import { Num } from './num'
import type { WaysBar } from '@/lib/pdf-report/ways'

/**
 * D7 — die Balken des Wege-Kapitels: je EIN Balken über den gesamten gemessenen Zeitraum.
 *
 * ── ⚠ DREI ODER VIER BALKEN, JE KUNDE (D7-Revision, 21.09.2026) ───────────────────────────────
 * Ihr Tarif heute · optional der selbst gefundene Vergleichstarif · aWATTar ohne Steuerung ·
 * aWATTar mit Ladesteuerung. Welche davon es gibt, entscheidet `ways.ts`; diese Komponente
 * zeichnet, was sie bekommt, und zählt selbst nichts ab.
 *
 * ── ⚠ DIE LASTSPITZENKAPPUNG IST HIER KEIN BALKEN ─────────────────────────────────────────────
 * Sie ist eine Jahres-ERSPARNIS, die Balken sind Zeitraum-KOSTEN — zwei Einheiten auf einer Achse.
 * Begründung im Kopf von `ways.ts`.
 *
 * ── ⚠ DIESELBEN FARBSTUFEN WIE `MonthlyTariffChart` ───────────────────────────────────────────
 * Neutral für den Ist-Zustand, zunehmend kräftige Akzentstufen für die Alternativen. Der
 * Ladesteuerungs-Balken trägt zusätzlich die Schraffur (D15 Block 2, Punkt 14): er unterstellt
 * eine Steuerung, die so noch nicht läuft.
 *
 * ── ⚠ DIE BETRÄGE KOMMEN FERTIG HEREIN ─────────────────────────────────────────────────────────
 * `sumCovered` läuft in `summary.ts` — diese Komponente rechnet nichts nach, sie zeichnet nur.
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

export function TariffWaysChart({ bars }: { bars: readonly WaysBar[] }) {
  const modelPatternId = useId()

  /* Der erste Balken ist immer „Ihr Tarif heute" und bleibt neutral; die Alternativen werden von
     links nach rechts kräftiger — dieselbe Leserichtung wie im Monatsvergleich. */
  const rows = bars.map((bar, i) => ({
    key: bar.key,
    label: bar.label,
    value: bar.eur,
    color:
      i === 0
        ? 'var(--color-text-muted)'
        : i === bars.length - 1
          ? CHART_COLORS.series
          : CHART_COLORS.seriesSoft,
    model: bar.model,
  }))

  return (
    <div className="h-56 w-full" data-testid="wege-chart">
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
