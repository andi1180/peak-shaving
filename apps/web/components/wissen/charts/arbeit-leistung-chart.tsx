'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

/*
 * SCHEMA „Arbeitspreis vs. Leistungspreis" (Pflichtenheft §6.5, §7.5).
 *
 * DIE AUSSAGE: Es ist DIESELBE Kurve — zwei Preise lesen sie nur verschieden.
 * Der Arbeitspreis sieht die FLÄCHE (alle kWh des Monats), der Leistungspreis
 * sieht EINEN PUNKT (die höchste Viertelstunde). Deshalb zwei Panels
 * nebeneinander mit identischen Daten und identischer Skala: Der Unterschied,
 * den der Leser sehen soll, ist die Markierung — nicht die Kurve. Zwei
 * verschiedene Kurven nebeneinander hätten genau die falsche Frage beantwortet
 * („warum sehen die anders aus?").
 *
 * §9.5 — KEINE ERFUNDENEN ZAHLEN, und hier besonders scharf: Die konkreten
 * Tarife der neuen Systematik stehen NICHT fest (die SNE-T-V ist zum
 * Redaktionsschluss nicht erlassen, s. Artikel). Wer hier „X ct/kWh" oder
 * „Y €/kW" hinschreibt, erfindet. Dieses Schema zeigt deshalb ein PRINZIP und
 * trägt bewusst KEINEN Preis, KEINE Einheit und KEINE Y-Achse.
 *
 * DREI EHRLICHKEITS-REGELN, übernommen von `components/branche/tagesverlauf-chart.tsx`
 * (dort ausführlich begründet) — sie gelten hier aus demselben Grund:
 *   1. KEINE Y-ACHSE — es gibt keine Einheit, also nichts zu beschriften.
 *   2. KEIN TOOLTIP — ein ablesbarer Wert wäre eine Messung, die es nicht gibt.
 *   3. KEIN CartesianGrid — Hilfslinien ohne Achse suggerieren einen Maßstab.
 *
 * FARBEN (DESIGN.md): als `var(--color-*)`-Strings direkt an Recharts — SVG erbt
 * CSS Custom Properties vom Ancestor, kein Hex im Code, White-Label bleibt möglich.
 * Navy = die Last selbst (der Anker). Der Akzent markiert in JEDEM Panel genau
 * das, worum es in diesem Panel geht — links die Fläche, rechts den einen Punkt.
 * Rot wäre naheliegend („die Spitze kostet"), ist aber für Kosten-ZAHLEN
 * reserviert und würde ein Schema alarmistisch einfärben.
 */

/** Ein Tag in Stundenschritten — grob genug, dass es niemand für einen Lastgang hält. */
const HOURLY: number[] = [
  30, 28, 27, 27, 29, 38, 70, 100, 82, 64, 58, 60, 66, 62, 54, 50, 52, 60, 74, 68, 56, 44, 36, 32,
]

/** Kopfraum, damit die Diagrammkante den Spitzen-Punkt nicht abschneidet. */
const Y_MAX = 116
const X_TICKS = [0, 6, 12, 18, 24]
const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }

function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

const DATA = HOURLY.map((load, hour) => ({ hour, load }))
/*
 * Schlusspunkt bei 24:00 — `stepAfter` zeichnet das Segment ZWISCHEN zwei
 * Punkten auf Höhe des linken; der letzte Punkt (23:00) hätte ohne Nachbarn kein
 * Segment und die Kurve endete sichtbar eine Stunde zu früh. Reine Zeichenlogik.
 * (Gleiche Mechanik und gleiche Begründung wie im Branchen-Chart.)
 */
const DATA_CLOSED = [...DATA, { hour: 24, load: HOURLY[HOURLY.length - 1] as number }]

const PEAK_LOAD = Math.max(...HOURLY)
const PEAK_HOUR = HOURLY.indexOf(PEAK_LOAD)

/** Gemeinsame Achsen beider Panels — identische Skala, sonst wäre der Vergleich falsch. */
function Axes() {
  return (
    <>
      <XAxis
        dataKey="hour"
        type="number"
        domain={[0, 24]}
        ticks={X_TICKS}
        // interval={0}: Ohne das darf Recharts bei Platzmangel Ticks verwerfen —
        // und tat es (am Bild aufgefallen, s. Branchen-Chart).
        interval={0}
        tickFormatter={hourToTime}
        tick={AXIS_TICK}
        stroke="var(--color-border-strong)"
        tickLine={false}
      />
      {/* Versteckt, aber vorhanden: Recharts braucht die Skala zum Zeichnen —
          sichtbar wäre sie eine Achse ohne Einheit. */}
      <YAxis domain={[0, Y_MAX]} hide />
    </>
  )
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-h4 text-ink">{title}</h3>
      <p className="mt-1 text-small text-text-muted">{hint}</p>
      {/*
       * `aria-hidden` + Textalternative: Das SVG ist reine Illustration. Seine
       * Aussage steht als Fließtext unmittelbar darüber im Artikel und in der
       * Bildunterschrift — die Information geht nicht verloren (WCAG 1.1.1).
       * Gleiche Lösung wie in den bestehenden Charts.
       */}
      <div aria-hidden="true" className="mt-4 h-[180px] w-full sm:h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ArbeitLeistungChart() {
  const t = useTranslations('Wissen.Charts.ArbeitLeistung')

  return (
    // Zwei Panels nebeneinander ab `sm`, darunter gestapelt. Der Vergleich ist
    // die Aussage — auf 375 px stehen sie untereinander, aber mit identischer
    // Skala, also bleibt er lesbar.
    <div className="grid gap-8 sm:grid-cols-2 sm:gap-6">
      <Panel title={t('workTitle')} hint={t('workHint')}>
        <AreaChart data={DATA_CLOSED} margin={{ top: 8, right: 22, bottom: 0, left: 22 }}>
          <Axes />
          {/*
           * Die FLÄCHE ist die Aussage: Der Arbeitspreis zählt jede Viertelstunde
           * mit — die ganze Fläche unter der Kurve.
           *
           * `fill` mit `fillOpacity`, NICHT `bg-accent/10`: Der Alpha-Modifier
           * schlägt auf unseren var()-Hex-Tokens STILL fehl (DESIGN.md „Kein
           * /alpha auf Token-Farben"). Recharts' eigenes `fillOpacity` ist ein
           * SVG-Attribut und davon unberührt — hier also erlaubt und korrekt.
           */}
          <Area
            type="stepAfter"
            dataKey="load"
            stroke="var(--color-navy)"
            strokeWidth={2}
            fill="var(--color-accent)"
            fillOpacity={0.16}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </Panel>

      <Panel title={t('powerTitle')} hint={t('powerHint')}>
        <LineChart data={DATA_CLOSED} margin={{ top: 8, right: 22, bottom: 0, left: 22 }}>
          <Axes />
          {/* Die Höhe der Spitze — gestrichelt und ruhig, sie ist Kontext, keine Serie. */}
          <ReferenceLine
            y={PEAK_LOAD}
            stroke="var(--color-text-muted)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <Line
            type="stepAfter"
            dataKey="load"
            stroke="var(--color-navy)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {/*
           * DER EINE PUNKT, um den sich der ganze Artikel dreht.
           *
           * `PEAK_HOUR + 0.5`: Bei `stepAfter` gilt der Wert einer Stunde für die
           * STUFE von h bis h+1. Auf `PEAK_HOUR` gesetzt klebte der Punkt an der
           * linken Kante der Stufe und sähe aus wie ein Fehler statt wie eine
           * Markierung (am Bild aufgefallen, s. Branchen-Chart).
           *
           * Weißer Ring, damit der Punkt auch auf der Linie ablesbar bleibt.
           * Steht NACH <Line> und liegt deshalb darüber — Recharts zeichnet in
           * Kind-Reihenfolge.
           */}
          <ReferenceDot
            x={PEAK_HOUR + 0.5}
            y={PEAK_LOAD}
            r={5}
            fill="var(--color-accent)"
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        </LineChart>
      </Panel>
    </div>
  )
}
