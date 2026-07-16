'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Num } from '@/components/ui/layout'
import { CAP_KW, EXAMPLE_LOAD_DATA, SLOTS_PER_DAY, slotToTime } from '@/lib/example-load-curve'

/*
 * DIAGRAMM „Lastgang vor/nach Kappung" (Pflichtenheft §5.2a, §7.5).
 *
 * §9.5 — KEINE ERFUNDENEN ZAHLEN: Die Kurve ist SYNTHETISCH und veranschaulicht
 * ausschließlich das Prinzip. Sie ist keine Kundenmessung, kein Rechenergebnis
 * und keine Aussage über ein erreichbares Ergebnis. Die Kennzeichnung steht
 * sichtbar am Diagramm (Eyebrow „Beispielhafte Darstellung" + Disclaimer
 * darunter, beide über messages/de.json) — nicht nur hier im Code.
 *
 * BEWUSST NICHT über `packages/engine` gerechnet: Das hier ist eine Illustration
 * für die Erklärseite, kein Rechenergebnis. Die Engine gehört dem Pro-Kalkulator
 * (§5.4); sie für eine Zeichnung zu importieren würde genau die Grenze
 * verwischen, die diese Seite erklärt — und den Rechenkern ins Marketing-Bundle
 * ziehen.
 *
 * FARBEN (DESIGN.md): Alle Serien als `var(--color-*)`-Strings direkt an Recharts
 * — SVG erbt CSS Custom Properties vom Ancestor, es steht also kein Hex im Code
 * und White-Label bleibt möglich. Bewusst NICHT `--color-negative`/`--color-positive`
 * für vorher/nachher: Rot/Grün sind für Kosten/Ersparnis reserviert und wären hier
 * Dekor. Stattdessen der Anker (Navy = Ist-Zustand) gegen den Akzent (Teal = die
 * Wirkung) und ein ruhiger neutraler Strich für die Schwelle.
 *
 * DATENQUELLE: `lib/example-load-curve.ts` (Prompt 14 herausgezogen) — dieselbe
 * Kurve trägt jetzt auch die kompakte Hero-Variante auf der Startseite
 * (`components/home/hero-load-chart.tsx`). Eine Quelle, zwei Ansichten: die
 * Zahlen können nicht auseinanderlaufen.
 */

const Y_MAX = 280

/** Ticks alle 4 Stunden (Slot = 4 × Stunde) — mehr wird auf 375 px unleserlich. */
const X_TICKS = [0, 16, 32, 48, 64, 80]

const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number }[]
  label?: number
}) {
  const t = useTranslations('PeakShaving.Chart')
  if (!active || !payload?.length || typeof label !== 'number') return null

  const before = payload.find((p) => p.dataKey === 'before')?.value
  const after = payload.find((p) => p.dataKey === 'after')?.value

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-caption">
      <p className="font-semibold text-ink">
        <Num>{t('tooltipTime', { time: slotToTime(label) })}</Num>
      </p>
      <ul className="mt-1.5 space-y-1">
        {[
          { key: 'before', name: t('seriesBefore'), value: before, color: 'var(--color-navy)' },
          { key: 'after', name: t('seriesAfter'), value: after, color: 'var(--color-accent)' },
        ].map((row) =>
          typeof row.value === 'number' ? (
            <li key={row.key} className="flex items-center gap-2 text-text-muted">
              <span
                aria-hidden="true"
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span>{row.name}</span>
              {/* tabular-nums: zwei Zahlen untereinander, die verglichen werden (§7.4). */}
              <Num className="ml-auto font-semibold text-ink">
                {row.value.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kW
              </Num>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  )
}

/** Legende als HTML statt Recharts-`<Legend>` — so tragen die Einträge unsere Tokens. */
function LegendItem({
  color,
  dashed,
  children,
}: {
  color: string
  dashed?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2 text-small text-text-muted">
      <span
        aria-hidden="true"
        className="h-0 w-6 shrink-0 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
      />
      {children}
    </li>
  )
}

export function LoadCurveChart() {
  const t = useTranslations('PeakShaving.Chart')

  return (
    <div>
      {/*
       * `aria-hidden` + Textalternative: Das SVG ist reine Illustration; ein
       * Screenreader kann 96 Datenpunkte nicht sinnvoll vorlesen. Die Aussage
       * des Bildes steht als Fließtext (`lead`) unmittelbar darüber auf der
       * Seite — die Information geht also nicht verloren (WCAG 1.1.1).
       */}
      <div aria-hidden="true" className="h-[260px] w-full sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={EXAMPLE_LOAD_DATA} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="slot"
              type="number"
              domain={[0, SLOTS_PER_DAY - 1]}
              ticks={X_TICKS}
              tickFormatter={slotToTime}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
            />
            <YAxis
              domain={[0, Y_MAX]}
              unit=" kW"
              width={64}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-border-strong)' }} />

            {/* Die Schwelle: ruhig und gestrichelt — sie ist Kontext, keine Serie. */}
            <ReferenceLine
              y={CAP_KW}
              stroke="var(--color-text-muted)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />

            {/*
             * `stepAfter`, nicht `monotone`: Ein Lastgang IST eine Treppe aus
             * Viertelstunden-MITTELWERTEN. Eine weich interpolierte Kurve würde
             * genau die Größe verschleiern, um die es auf dieser Seite geht.
             * `dot={false}` + `isAnimationActive={false}`: 96 Punkte, und der
             * Report-Charakter ist ruhig (§7.1) — hier wackelt nichts.
             */}
            <Line
              type="stepAfter"
              dataKey="before"
              stroke="var(--color-navy)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="after"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <LegendItem color="var(--color-navy)">{t('seriesBefore')}</LegendItem>
        <LegendItem color="var(--color-accent)">{t('seriesAfter')}</LegendItem>
        <LegendItem color="var(--color-text-muted)" dashed>
          {t('capLabel')}
        </LegendItem>
      </ul>
    </div>
  )
}
