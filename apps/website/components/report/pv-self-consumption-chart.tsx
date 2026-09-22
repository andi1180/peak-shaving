'use client'

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { PvValueMonth } from 'shared'

import { formatKwh } from '@/lib/format'
import { CHART_COLORS } from '@/lib/pdf-report/theme'

/**
 * „Geschätzter PV-Eigenverbrauch je Monat" — die Balken des Kapitels „Ihre PV-Anlage".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN AUSFALLMONAT IST KEIN NULLBALKEN, SONDERN EINE EIGENE KATEGORIE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Für einen Monat, in dem der Lastgang keinen Mittagseinbruch zeigt, wird bewusst KEINE Erzeugung
 * angesetzt (s. `shared/src/pv-value.ts`). Als 0 gezeichnet sähe das aus wie „geschätzt, und es kam
 * nichts heraus" — also wie eine Messung mit dem Ergebnis null. Der Balken entfällt deshalb ganz
 * und der Monat wird unter der Achse als „kein Ertrag erkennbar" markiert; dieselbe Unterscheidung
 * zwischen „keine Angabe" und „gemessene Null", die der Monatsvergleich mit seinen `null`-Monaten
 * trifft.
 *
 * ── ⚠ DIE MENGEN KOMMEN FERTIG HEREIN ─────────────────────────────────────────────────────────
 * Summiert wird in der Engine (`monthlyPvGeneration`); diese Komponente rechnet nichts nach und
 * entscheidet insbesondere nicht, welcher Monat ein Ausfallmonat ist.
 *
 * ── ⚠ EINE KOMPONENTE FÜR BEIDE WEGE (D2) ─────────────────────────────────────────────────────
 * Es gibt genau diese eine Zeichenimplementierung. Heute mountet sie nur der PDF-Pfad (über die
 * Rasterung in `charts.tsx`), wie beim Wege-Diagramm — der Bildschirm-Report zeigt das PV-Kapitel
 * nicht.
 */

const MONTH_LABELS = [
  'Jän',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
] as const

/** Die Beschriftung eines Ausfallmonats unter der Achse — kurz, weil sie mehrfach dastehen kann. */
const OUTAGE_TICK = 'kein Ertrag'

type Row = { label: string; kwh: number | null; outage: boolean }

/**
 * Die Achsenbeschriftung: Monat und, bei einem Ausfallmonat, der Grund darunter.
 *
 * ⚠ Der Hinweis steht an der ACHSE und nicht als Fussnote: ein fehlender Balken ohne Beschriftung
 * liest sich als vergessener Monat, und eine Fussnote fände beim Überfliegen niemand.
 */
function MonthTick({
  x,
  y,
  payload,
  rows,
}: {
  x?: number
  y?: number
  payload?: { value?: string; index?: number }
  rows: Row[]
}) {
  const row = rows[payload?.index ?? -1]
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fill="var(--color-text-muted)" fontSize={11}>
        {String(payload?.value ?? '')}
      </text>
      {row?.outage ? (
        <text x={0} y={0} dy={24} textAnchor="middle" fill={CHART_COLORS.dischargeEnd} fontSize={9}>
          {OUTAGE_TICK}
        </text>
      ) : null}
    </g>
  )
}

export function PvSelfConsumptionChart({ months }: { months: readonly PvValueMonth[] }) {
  /*
   * ⚠ Das Jahr steht NUR dann am Balken, wenn der Zeitraum einen Jahreswechsel überquert. Bei
   * einem Lastgang innerhalb eines Jahres wäre es an zwölf Balken dieselbe Zahl und damit Lärm;
   * über einen Jahreswechsel hinweg stünden sonst zwei „Jän" nebeneinander.
   */
  const multiYear = new Set(months.map((m) => m.year)).size > 1
  const rows: Row[] = months.map((month) => ({
    label: `${MONTH_LABELS[month.month - 1] ?? String(month.month)}${
      multiYear ? ` ${String(month.year).slice(2)}` : ''
    }`,
    /* ⚠ `null` und nicht 0 — Recharts zeichnet dort nichts, und genau das ist die Aussage. */
    kwh: month.selfConsumptionKwh,
    outage: month.outage,
  }))

  return (
    <div className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid">
      <p className="mb-1 text-sm font-medium text-ink">Geschätzter PV-Eigenverbrauch je Monat</p>
      <p className="mb-3 text-xs text-text-muted">
        Aus Ihrem echten Lastgang zurückgerechnet — Monate ohne erkennbaren Ertrag tragen bewusst
        keinen Balken.
      </p>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 16, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="var(--color-text-muted)"
              interval={0}
              height={40}
              tick={<MonthTick rows={rows} />}
            />
            <YAxis
              tickFormatter={(v: number) => formatKwh(v)}
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              width={72}
            />
            <Bar dataKey="kwh" isAnimationActive={false} fill={CHART_COLORS.series}>
              {rows.map((row) => (
                <Cell key={row.label} fill={CHART_COLORS.series} />
              ))}
              <LabelList
                dataKey="kwh"
                position="top"
                fontSize={10}
                fill="var(--color-ink)"
                /* ⚠ Recharts typt den Wert als `RenderableText` (auch `undefined`) — ein
                   Ausfallmonat trägt `null` und bekommt kein Label. */
                formatter={(value: unknown) =>
                  typeof value === 'number' ? formatKwh(value) : ''
                }
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
