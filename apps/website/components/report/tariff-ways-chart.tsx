'use client'

import { useId } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

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
 * Auch `coveredDays` kommt fertig herein: der Achsentitel und die Bildunterschrift darunter müssen
 * dieselbe Zahl nennen.
 *
 * ── ⚠ EINE KOMPONENTE FÜR BEIDE WEGE (D2) ─────────────────────────────────────────────────────
 * Es gibt genau diese eine Zeichenimplementierung. Heute mountet sie nur der PDF-Pfad (über die
 * Rasterung in `charts.tsx`); der Bildschirm-Report zeigt das Wege-Kapitel noch nicht. Sobald er
 * es tut, bekommt er dieselben drei Angleichungen von selbst — auseinanderlaufen können die
 * beiden nicht, weil es nichts gibt, das auseinanderlaufen könnte.
 */
/**
 * Ein Kategorielabel auf so viele Zeilen umgebrochen, wie die Balkenbreite trägt (Zielbild:
 * „aWATTar,\neinfach\ngesteuert").
 *
 * ⚠ RECHARTS BRICHT TICKS NICHT VON SELBST UM — ein langes Label lief bisher einzeilig weiter und
 * überlappte das Nachbarlabel bzw. wurde am Rand abgeschnitten. Mit fünf Wegen und einem
 * Lieferantennamen als Label („aWATTar mit Ladesteuerung", „ENSTROGA") ist das der Regelfall, nicht
 * die Ausnahme.
 *
 * ⚠ Umbrochen wird an LEERZEICHEN, nie innerhalb eines Worts: ein getrennter Lieferantenname sähe
 * aus wie ein Tippfehler. Ein einzelnes Wort, das breiter als der Balken ist, bleibt deshalb lang.
 */
const TICK_LINE_HEIGHT_PX = 12

/**
 * Die Breite, mit der dieses Diagramm gerastert wird (`DETAIL_CHART_WIDTH_PX`, `charts.tsx`), und
 * die Breite der Werteachse. Beide gehen in die Zeilenlänge der Kategorielabels ein.
 *
 * ⚠ Die erste ist hier gespiegelt und nicht importiert: `charts.tsx` zieht den PDF-Pfad mit, und
 * diese Komponente darf davon nichts wissen (D2 — eine Zeichenimplementierung, kein PDF-Wissen
 * darin). Läuft der Rasterwert dort einmal weg, werden die Labels hier nur grosszügiger oder
 * knapper umgebrochen — nicht falsch.
 */
const CHART_WIDTH_PX = 760
const Y_AXIS_WIDTH_PX = 72

/** Platz für bis zu drei Zeilen Kategorielabel plus Grundlinie. */
const TICK_BLOCK_HEIGHT_PX = 3 * TICK_LINE_HEIGHT_PX + 8

function wrapLabel(label: string, maxChars: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of label.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (next.length > maxChars && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function CategoryTick({
  x,
  y,
  payload,
  maxChars,
}: {
  x?: number
  y?: number
  payload?: { value?: string }
  maxChars: number
}) {
  const lines = wrapLabel(String(payload?.value ?? ''), maxChars)
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      {lines.map((line, i) => (
        <text
          key={line + i}
          x={0}
          y={0}
          dy={12 + i * TICK_LINE_HEIGHT_PX}
          textAnchor="middle"
          fill="var(--color-text-muted)"
          fontSize={11}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

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
  bars,
  coveredDays,
  priceLabel = 'netto',
}: {
  bars: readonly WaysBar[]
  /** Die Bezugsgrösse der Balken — steht im Achsentitel, s. Kopf. */
  coveredDays: number
  /** H3: `netto` oder `inkl. 20 % USt`, passend zu den Beträgen in `bars`. */
  priceLabel?: string
}) {
  const modelPatternId = useId()

  /*
   * Wie viele Zeichen eine Zeile eines Kategorielabels trägt.
   *
   * ⚠ Bezugsgrösse ist die BALKENbreite und nicht die Spaltenbreite: ein Label, das über den
   * Balken hinausragt, sieht auch dann falsch zugeordnet aus, wenn es das Nachbarlabel noch nicht
   * berührt — und das Zielbild bricht genau an dieser Grenze um („aWATTar,\neinfach\ngesteuert").
   * Recharts lässt je Spalte rund 20 % Zwischenraum, davon noch ein kleiner Rand.
   *
   * Geschätzt statt gemessen: eine Textbreite ist im SVG erst nach dem Satz bekannt, und die
   * Komponente muss den Umbruch davor entscheiden. 6 px je Zeichen ist der Mittelwert von Inter
   * bei 11 px; die Untergrenze von 9 Zeichen verhindert, dass bei vielen Wegen jedes Wort auf einer
   * eigenen Zeile landet.
   */
  const barWidthPx = ((CHART_WIDTH_PX - Y_AXIS_WIDTH_PX) / bars.length) * 0.8
  const maxChars = Math.max(9, Math.floor((barWidthPx - 8) / 6))

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
    /*
     * ⚠ HÖHER ALS `h-56`, und das ist kein Layout-Geschmack: die drei Angleichungen brauchen
     * Platz, den es vorher nicht gab — die Wertelabels über den Balken (oben) und die bis zu
     * dreizeiligen Kategorielabels (unten). In der alten Höhe schnitte das eine das andere ab.
     */
    <div className="h-72 w-full" data-testid="wege-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 24, right: 8, bottom: TICK_BLOCK_HEIGHT_PX, left: 0 }}>
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
          {/* (c) Mehrzeilig und zentriert statt einzeilig — s. `CategoryTick`. */}
          <XAxis
            dataKey="label"
            stroke="var(--color-text-muted)"
            interval={0}
            height={TICK_BLOCK_HEIGHT_PX}
            tick={<CategoryTick maxChars={maxChars} />}
          />
          {/* (b) Der rotierte Achsentitel nennt die Bezugsgrösse, die sonst nur unter dem Bild steht. */}
          <YAxis
            tickFormatter={(v: number) => formatEur(v)}
            stroke="var(--color-text-muted)"
            tick={{ fontSize: 11 }}
            width={Y_AXIS_WIDTH_PX}
            label={{
              value: `Kosten über ${coveredDays} Tage (${priceLabel}, EUR)`,
              angle: -90,
              position: 'insideLeft',
              style: {
                textAnchor: 'middle',
                fill: 'var(--color-text-muted)',
                fontSize: 11,
              },
            }}
          />
          <Tooltip content={<WaysTooltip />} isAnimationActive={false} cursor={false} />
          <Bar dataKey="value" isAnimationActive={false}>
            {/* (a) Der Betrag fett über dem Balken — im Zielbild die auffälligste Zahl der Seite. */}
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v: unknown) => formatEur(Number(v))}
              fill="var(--color-ink)"
              fontSize={12}
              fontWeight={700}
            />
            {rows.map((row) => (
              <Cell key={row.key} fill={row.model ? `url(#${modelPatternId})` : row.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
