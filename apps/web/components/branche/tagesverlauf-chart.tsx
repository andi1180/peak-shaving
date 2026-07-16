'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { BrancheProfile } from '@/lib/branchen'

/*
 * DIAGRAMM „Typischer Tageslastverlauf (schematisch)" (Pflichtenheft §5.3 Nr. 2).
 *
 * §9.5 — KEINE ERFUNDENEN ZAHLEN: Die Kurve ist SCHEMATISCH. Sie ist keine
 * Kundenmessung, kein Rechenergebnis und kein Branchen-Benchmark. Die
 * Kennzeichnung steht sichtbar an der Sektion (Titel „(schematisch)" + Caption
 * „Illustratives Schema, keine Messdaten.", beide über messages/de.json) — nicht
 * nur hier im Code. Herkunft und Form der Werte: `lib/branchen.ts`.
 *
 * DREI BEWUSSTE ABWEICHUNGEN von `components/peak-shaving/load-curve-chart.tsx`
 * — alle mit derselben Begründung: Dieses Bild hat KEINE Einheit, und alles, was
 * ein Ablesen nahelegt, würde eine Messung behaupten, die es nicht gibt.
 *
 *   1. KEINE Y-ACHSE (`hide`). Die Werte sind relativ zur eigenen Tagesspitze.
 *      Eine beschriftete Achse bräuchte eine Einheit; eine unbeschriftete Achse
 *      wäre nur ein Strich. Die Aussage ist die FORM des Tages, nicht die Höhe.
 *   2. KEIN TOOLTIP. Der Flaggschiff-Chart hat einen, weil er echte kW-Werte
 *      trägt. Hier gäbe ein Tooltip eine Zahl aus, die nichts bedeutet — das
 *      wäre exakt die Scheingenauigkeit, die §5.3 Nr. 4 verbietet.
 *   3. KEIN CartesianGrid. Horizontale Hilfslinien ohne Y-Achse suggerieren
 *      einen Maßstab, den es nicht gibt. Der Flaggschiff-Chart hat sie, weil sie
 *      dort auf eine beschriftete kW-Achse zeigen.
 *
 * Was ÜBERNOMMEN ist, damit beide Diagramme als ein System lesen: `stepAfter`,
 * Strichstärke, die Achsen-Optik, `isAnimationActive={false}`, `dot={false}`,
 * die HTML-Legende und die Farbrollen (Navy = der Verlauf, gestrichelt-Muted =
 * die Schwelle).
 *
 * FARBEN (DESIGN.md): als `var(--color-*)`-Strings direkt an Recharts — SVG erbt
 * CSS Custom Properties vom Ancestor, es steht also kein Hex im Code und
 * White-Label bleibt möglich.
 *
 * DER AKZENT ERSCHEINT GENAU EINMAL: als Punkt auf der Lastspitze. Das ist der
 * eine Moment, um den sich die ganze Seite dreht — „an einer Stelle laut,
 * drumherum ruhig" (DESIGN.md). Rot (`--color-negative`) wäre naheliegend, weil
 * die Spitze Kosten treibt, ist aber reserviert für Zahlen mit Bedeutung und
 * würde ein Schema alarmistisch einfärben.
 */

/** Ticks alle 6 Stunden — mehr wird auf 375 px unleserlich. */
const X_TICKS = [0, 6, 12, 18, 24]

/**
 * Kopfraum über der Spitze (die Kurve läuft bis 100): ohne ihn schneidet die
 * Diagrammkante den Spitzen-Punkt halb ab.
 */
const Y_MAX = 112

const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }

/** Stunde → „06:00". */
function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/**
 * Legende als HTML statt Recharts-`<Legend>` — so tragen die Einträge unsere
 * Tokens (gleiche Entscheidung wie im Flaggschiff-Chart).
 *
 * Bewusst nicht aus `load-curve-chart.tsx` importiert: Dort sind alle drei
 * Marker Linien, hier ist einer ein Punkt. Eine gemeinsame Komponente für zwei
 * Aufrufer mit unterschiedlichen Markerformen wäre mehr Abstraktion als Ersparnis.
 */
function LegendItem({
  marker,
  color,
  children,
}: {
  marker: 'line' | 'dashed' | 'dot'
  color: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2 text-small text-text-muted">
      {marker === 'dot' ? (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-0 w-6 shrink-0 border-t-2"
          style={{ borderColor: color, borderStyle: marker === 'dashed' ? 'dashed' : 'solid' }}
        />
      )}
      {children}
    </li>
  )
}

export function TagesverlaufChart({ profile }: { profile: BrancheProfile }) {
  const t = useTranslations('Branchen.Chart')
  const { points, peakHour, peakLoad, capHint } = profile

  /*
   * Schlusspunkt bei 24:00. `stepAfter` zeichnet das Segment ZWISCHEN zwei
   * Punkten auf Höhe des linken — der letzte Punkt (23:00) hätte ohne Nachbarn
   * kein Segment, und die Kurve endete sichtbar eine Stunde zu früh. Der
   * angehängte Punkt trägt denselben Wert wie 23:00; damit läuft das letzte
   * Segment flach bis zum Achsenende, ohne einen Sprung an der rechten Kante.
   * Kein Datenpunkt, reine Zeichenlogik — deshalb hier und nicht in `lib/branchen.ts`.
   *
   * Der `last`-Guard ist für den Typprüfer (`noUncheckedIndexedAccess`), nicht
   * für die Laufzeit: `lib/branchen.ts` stellt 24 Punkte sicher und wirft sonst
   * beim Laden des Moduls.
   */
  const data = React.useMemo(() => {
    const last = points.at(-1)
    if (!last) return points
    return [...points, { hour: 24, relativeLoad: last.relativeLoad }]
  }, [points])

  return (
    <div>
      {/*
       * `aria-hidden` + Textalternative: Das SVG ist reine Illustration. Die
       * Aussage des Bildes steht als Fließtext unmittelbar darüber auf der Seite
       * (`chart.lead`) und ausführlich in „Kostentreiber" darunter — die
       * Information geht also nicht verloren (WCAG 1.1.1). Gleiche Lösung wie im
       * Flaggschiff-Chart.
       */}
      <div aria-hidden="true" className="h-[220px] w-full sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          {/*
           * `left`/`right` = 22, nicht die 12 aus dem ersten Wurf: Die
           * Randbeschriftungen „00:00" und „24:00" sitzen MITTIG über x=0 bzw.
           * x=24 und ragen damit über die Zeichenfläche hinaus. Der
           * Flaggschiff-Chart braucht das nicht — dort schiebt die sichtbare
           * Y-Achse (width=64) die Fläche ohnehin nach rechts. Hier ist die
           * Y-Achse ausgeblendet, und mit zu schmalem Rand ließ Recharts den
           * „00:00"-Tick still weg (am Bild aufgefallen, nicht am Code).
           */}
          <LineChart data={data} margin={{ top: 8, right: 22, bottom: 0, left: 22 }}>
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 24]}
              ticks={X_TICKS}
              // interval={0}: alle fünf Ticks stehen fest. Ohne das darf Recharts
              // bei Platzmangel selbst welche verwerfen — und tat es auch.
              interval={0}
              tickFormatter={hourToTime}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
            />
            {/* Versteckt, aber vorhanden: Recharts braucht die Skala zum Zeichnen —
                sichtbar wäre sie eine Achse ohne Einheit. */}
            <YAxis domain={[0, Y_MAX]} hide />

            {/* Die angedeutete Kappung — ruhig und gestrichelt, sie ist Kontext,
                keine Serie. Fehlt bewusst bei Profilen ohne ausgeprägte Spitze
                (Handel), s. `CAP_HINT` in lib/branchen.ts. */}
            {capHint === undefined ? null : (
              <ReferenceLine
                y={capHint}
                stroke="var(--color-text-muted)"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            )}

            {/*
             * `stepAfter`, nicht `monotone`: Ein Lastgang IST eine Treppe aus
             * Mittelwerten — dieselbe Begründung wie im Flaggschiff-Chart. Eine
             * weich interpolierte Kurve sähe zudem organisch-gestaltet aus und
             * würde die Schematik verschleiern, die hier ausdrücklich gemeint ist.
             */}
            <Line
              type="stepAfter"
              dataKey="relativeLoad"
              stroke="var(--color-navy)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />

            {/*
             * Der eine Akzent: der Moment, der den Leistungspreis setzt.
             *
             * `peakHour + 0.5`, nicht `peakHour`: Bei `stepAfter` gilt der Wert
             * einer Stunde für die STUFE von h bis h+1. Auf `peakHour` gesetzt
             * klebte der Punkt an der linken Kante der Stufe und sah aus wie ein
             * Fehler statt wie eine Markierung (am Bild aufgefallen). Die Mitte
             * der Stufe markiert das, was gemeint ist: diese Stunde.
             *
             * Weißer Ring, damit der Punkt auch auf der Linie ablesbar bleibt.
             * Steht NACH <Line> im JSX und liegt deshalb darüber — Recharts
             * zeichnet in Kind-Reihenfolge.
             */}
            <ReferenceDot
              x={peakHour + 0.5}
              y={peakLoad}
              r={4}
              fill="var(--color-accent)"
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <LegendItem marker="line" color="var(--color-navy)">
          {t('loadLabel')}
        </LegendItem>
        <LegendItem marker="dot" color="var(--color-accent)">
          {t('peakLabel')}
        </LegendItem>
        {capHint === undefined ? null : (
          <LegendItem marker="dashed" color="var(--color-text-muted)">
            {t('capLabel')}
          </LegendItem>
        )}
      </ul>
    </div>
  )
}
