'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Area, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { PV_VERBRAUCH_DATA } from '@/lib/pv-verbrauch-curve'

/*
 * GRAFIK „PV-Erzeugung vs. Verbrauch" (Prompt 16, Hero-Bereich
 * /leistungen/pv-speicher).
 *
 * DIE AUSSAGE: zwei Kurven über einen Tag — Erzeugung und Verbrauch — und die
 * eingefärbte Fläche dazwischen ist das, was der Speicher NICHT zusätzlich
 * ausgleichen muss: der Anteil, den beide Kurven ohnehin gemeinsam abdecken
 * (`eigenverbrauch = min(erzeugung, verbrauch)`, s. `lib/pv-verbrauch-curve.ts`).
 *
 * KEINE Lastspitze, kein Kappungs-Marker: anderes Thema (Peak Shaving) — s.
 * `components/home/hero-load-chart.tsx`. Diese Grafik hat bewusst keinen
 * Bezug zu einer Kappungsschwelle.
 *
 * EHRLICHKEITSREGELN übernommen von `components/branche/tagesverlauf-chart.tsx`
 * (dort ausführlich begründet) — aus demselben Grund, die Werte sind relativ,
 * nicht real gemessen:
 *   1. KEINE Y-ACHSE (`hide`) — es gibt keine Einheit.
 *   2. KEIN TOOLTIP — ein ablesbarer Wert wäre eine Messung, die es nicht gibt.
 *   3. KEIN CartesianGrid — Hilfslinien ohne Y-Achse suggerieren einen Maßstab.
 * Die X-Achse (Tageszeit) bleibt sichtbar — sie verankert die Kurven als „ein
 * Tag", ohne eine Höhe zu behaupten.
 *
 * FARBEN (DESIGN.md): `var(--color-*)`-Strings direkt an Recharts, kein Hex.
 * DER AKZENT ERSCHEINT GENAU EINMAL: als Füllung der Eigenverbrauchs-Fläche —
 * das visuelle Kernargument der Grafik. Beide Kurven selbst bleiben auf
 * Anker-Tönen (Navy/Ink), damit der Teal nicht mit sich selbst konkurriert
 * (DESIGN.md „Akzent sparsam").
 */

const X_TICKS = [0, 6, 12, 18, 24]

/** Kopfraum über der Erzeugungs-Spitze (79 im Datensatz) — sonst schneidet die
 *  Diagrammkante die Kurve halb ab. */
const Y_MAX = 92

const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }

/** Stunde → „06:00" (auch für den angehängten Schlusspunkt bei hour=24 → „24:00"). */
function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/**
 * Legende als HTML statt Recharts-`<Legend>` — trägt so unsere Tokens (gleiche
 * Entscheidung wie in den übrigen Charts). Eigener Marker `area` (gefülltes
 * Quadrat) für die Eigenverbrauchs-Fläche — bewusst nicht aus
 * `tagesverlauf-chart.tsx` importiert: dort gibt es keinen Flächen-Marker
 * (andere Aufrufer, andere Markerformen, dort ausführlich begründet).
 */
function LegendItem({
  marker,
  color,
  children,
}: {
  marker: 'line' | 'area'
  color: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2 text-small text-text-muted">
      {marker === 'area' ? (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-0 w-6 shrink-0 border-t-2"
          style={{ borderColor: color }}
        />
      )}
      {children}
    </li>
  )
}

export function PvVerbrauchChart() {
  const t = useTranslations('Leistungen.Pages.pvSpeicher.chart')

  /*
   * Schlusspunkt bei 24:00. `stepAfter` zeichnet das Segment ZWISCHEN zwei
   * Punkten auf Höhe des linken — der letzte Punkt (23 Uhr) hätte ohne
   * Nachbarn kein Segment, und die Kurven endeten sichtbar eine Stunde zu
   * früh. Der angehängte Punkt trägt dieselben Werte wie 23 Uhr; damit läuft
   * das letzte Segment flach bis zum Achsenende. Kein Datenpunkt, reine
   * Zeichenlogik (gleiche Mechanik wie im Branchen-Chart).
   */
  const data = React.useMemo(() => {
    const last = PV_VERBRAUCH_DATA[PV_VERBRAUCH_DATA.length - 1]
    if (!last) return PV_VERBRAUCH_DATA
    return [...PV_VERBRAUCH_DATA, { ...last, hour: 24 }]
  }, [])

  return (
    <div>
      {/*
       * `aria-hidden` + Textalternative: Das SVG ist reine Illustration. Die
       * Aussage steht als Caption unter dem Diagramm (WCAG 1.1.1) — gleiche
       * Lösung wie in allen übrigen Chart-Komponenten.
       */}
      <div aria-hidden="true" className="h-[160px] w-full sm:h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          {/* `left`/`right` = 22, nicht 12: Die Randbeschriftungen „00:00"/„24:00"
              sitzen MITTIG über x=0 bzw. x=24 und ragen sonst über die
              Zeichenfläche hinaus — derselbe Bugfix wie in
              `tagesverlauf-chart.tsx`/`hero-load-chart.tsx` (dort am Bild
              gefunden, hier von Anfang an gesetzt). */}
          <ComposedChart data={data} margin={{ top: 8, right: 22, bottom: 0, left: 22 }}>
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 24]}
              ticks={X_TICKS}
              // interval={0}: alle fünf Ticks stehen fest. Ohne das darf
              // Recharts bei Platzmangel selbst welche verwerfen.
              interval={0}
              tickFormatter={hourToTime}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
            />
            {/* Versteckt, aber vorhanden: Recharts braucht die Skala zum
                Zeichnen — sichtbar wäre sie eine Achse ohne Einheit. */}
            <YAxis domain={[0, Y_MAX]} hide />

            {/*
             * Die Überlappung — das Kernargument der Grafik. Steht ZUERST im
             * JSX (Recharts zeichnet in Kind-Reihenfolge), damit die Fläche
             * unter beiden Linien liegt und sie nicht verdeckt.
             *
             * `fillOpacity`, NICHT `bg-accent/10`: Der Alpha-Modifier schlägt
             * auf unseren `var()`-Hex-Tokens still fehl (DESIGN.md „Kein
             * /alpha auf Token-Farben"). Recharts' eigenes `fillOpacity` ist
             * ein SVG-Attribut und davon unberührt — gleiche Lösung wie in
             * `arbeit-leistung-chart.tsx`.
             */}
            <Area
              type="stepAfter"
              dataKey="eigenverbrauch"
              stroke="none"
              fill="var(--color-accent)"
              fillOpacity={0.18}
              isAnimationActive={false}
            />

            <Line
              type="stepAfter"
              dataKey="erzeugung"
              stroke="var(--color-navy)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="verbrauch"
              stroke="var(--color-ink)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <LegendItem marker="line" color="var(--color-navy)">
          {t('erzeugungLabel')}
        </LegendItem>
        <LegendItem marker="line" color="var(--color-ink)">
          {t('verbrauchLabel')}
        </LegendItem>
        <LegendItem marker="area" color="var(--color-accent)">
          {t('eigenverbrauchLabel')}
        </LegendItem>
      </ul>
    </div>
  )
}
