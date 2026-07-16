'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { CAP_KW, EXAMPLE_LOAD_DATA, SLOTS_PER_DAY, slotToTime } from '@/lib/example-load-curve'

/*
 * GRAFIK 1 (Prompt 14) — kompakte Hero-Fassung von „Lastgang vor/nach
 * Kappung". Kein Neubau der Aussage: dieselbe Kurve wie der ausführliche
 * Flaggschiff-Chart auf `/peak-shaving` (`components/peak-shaving/load-curve-chart.tsx`),
 * jetzt aus `lib/example-load-curve.ts` — nur die DARSTELLUNG ist neu, klein
 * genug für einen Platz neben der Headline.
 *
 * DIE DARSTELLUNGSREGELN SIND DIE VON `components/branche/tagesverlauf-chart.tsx`,
 * NICHT DIE DES VOLLEN FLAGGSCHIFF-CHARTS — das ist die ausdrückliche Vorgabe aus
 * Prompt 14 („keine Achsenwerte, wie tagesverlauf-chart"). Der volle Chart zeigt
 * echte kW auf einer beschrifteten Y-Achse plus Tooltip, weil er als „Beispielhafte
 * Darstellung mit synthetischen Werten" gekennzeichnet ist. Hier, direkt neben der
 * Headline, ist das zu viel Behauptung für ein Schema — deshalb dieselben drei
 * Ehrlichkeits-Regeln wie im Branchen-Chart (dort ausführlich begründet):
 *   1. KEINE Y-ACHSE — sichtbar wäre sie eine Achse ohne Zweck an dieser Stelle.
 *   2. KEIN TOOLTIP — ein ablesbarer kW-Wert wäre Scheingenauigkeit (§9.5).
 *   3. KEIN CartesianGrid — Hilfslinien ohne sichtbare Y-Achse suggerieren einen
 *      Maßstab, den es hier nicht gibt.
 * Die X-Achse (Tageszeit) bleibt sichtbar, exakt wie im Branchen-Chart — sie
 * verankert die Kurve als „ein Tag", ohne eine Höhe zu behaupten.
 *
 * FARBEN (DESIGN.md): `var(--color-*)`-Strings direkt an Recharts, kein Hex.
 * Der Akzent (Teal) erscheint hier für die Nachher-Kurve — derselbe Ort wie im
 * vollen Flaggschiff-Chart, damit beide Diagramme als ein System lesen.
 */

/** Ticks alle 6 Stunden (Slot = 4 × Stunde) — auf Hero-Kartenbreite genügt das. */
const X_TICKS = [0, 24, 48, 72, 96]

/** Kopfraum, damit die Diagrammkante die Spitze nicht abschneidet. */
const Y_MAX = 280

const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 11 }

/** Legende als HTML statt Recharts-`<Legend>` — trägt so unsere Tokens (gleiche Entscheidung wie in den übrigen Charts). */
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
    <li className="flex items-center gap-1.5 text-caption text-text-muted">
      <span
        aria-hidden="true"
        className="h-0 w-4 shrink-0 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
      />
      {children}
    </li>
  )
}

export function HeroLoadChart() {
  const t = useTranslations('Home.HeroChart')

  /*
   * Schlusspunkt bei 24:00 — `stepAfter` zeichnet das Segment ZWISCHEN zwei
   * Punkten auf Höhe des linken; der letzte echte Slot (23:45) hätte ohne
   * Nachbarn kein Segment und die Kurve endete sichtbar zu früh. Reine
   * Zeichenlogik, kein Datenpunkt (gleiche Mechanik wie im Branchen-Chart).
   */
  const data = React.useMemo(() => {
    const last = EXAMPLE_LOAD_DATA[EXAMPLE_LOAD_DATA.length - 1]
    if (!last) return EXAMPLE_LOAD_DATA
    return [...EXAMPLE_LOAD_DATA, { slot: SLOTS_PER_DAY, before: last.before, after: last.after }]
  }, [])

  return (
    <div>
      {/*
       * `aria-hidden` + Textalternative: reine Illustration, die Aussage steht
       * als Caption unter dem Diagramm (WCAG 1.1.1) — gleiche Lösung wie in
       * allen übrigen Chart-Komponenten.
       */}
      <div aria-hidden="true" className="h-[160px] w-full sm:h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          {/* `left`/`right` = 22, nicht 12: Die Randbeschriftungen „00:00"/„24:00"
              sitzen MITTIG über x=0 bzw. x=96 und ragen sonst über die
              Zeichenfläche hinaus (am Bild aufgefallen — gleiche Ursache wie im
              Branchen-Chart, dort ausführlich begründet). */}
          <LineChart data={data} margin={{ top: 8, right: 22, bottom: 0, left: 22 }}>
            <XAxis
              dataKey="slot"
              type="number"
              domain={[0, SLOTS_PER_DAY]}
              ticks={X_TICKS}
              interval={0}
              tickFormatter={slotToTime}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
            />
            {/* Versteckt, aber vorhanden: Recharts braucht die Skala zum
                Zeichnen — sichtbar wäre sie eine Achse ohne Zweck hier. */}
            <YAxis domain={[0, Y_MAX]} hide />

            {/* Die Kappungsschwelle — ruhig und gestrichelt, sie ist Kontext, keine Serie. */}
            <ReferenceLine
              y={CAP_KW}
              stroke="var(--color-text-muted)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />

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

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <LegendItem color="var(--color-navy)">{t('seriesBefore')}</LegendItem>
        <LegendItem color="var(--color-accent)">{t('seriesAfter')}</LegendItem>
        <LegendItem color="var(--color-text-muted)" dashed>
          {t('capLabel')}
        </LegendItem>
      </ul>
    </div>
  )
}
