'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { Num } from '@/components/ui/layout'

/*
 * DIAGRAMM „Lastgang vor/nach Entzerrung" (Pflichtenheft §6.5, §7.5).
 *
 * DIE AUSSAGE — und sie ist der fachliche Kern des ganzen Artikels: BEIDE Kurven
 * verbrauchen GLEICH VIEL ENERGIE. Nur die Spitze ist verschieden. Wer drei
 * Geräte gleichzeitig anlaufen lässt, zahlt ab 2027 für eine Viertelstunde, die
 * er auch versetzt hätte fahren können — ohne eine einzige kWh zu sparen.
 *
 * DESHALB IST DAS BEISPIEL SO GEBAUT, DASS DIE ENERGIE NACHWEISLICH GLEICH
 * BLEIBT (s. `SCENARIO` unten): drei Geräte à `DEVICE_KW` laufen je eine Stunde.
 * Gleichzeitig = 3 × DEVICE_KW für 1 h. Versetzt = 1 × DEVICE_KW für 3 h.
 * Fläche identisch, Spitze gedrittelt. Das ist keine Behauptung, sondern
 * Konstruktion — und `assertSameEnergy` prüft es beim Laden des Moduls, damit
 * eine spätere Änderung an den Zahlen die Aussage nicht STILL kaputt macht.
 *
 * §9.5 — ILLUSTRATIVES BEISPIEL, KEINE MESSDATEN: Die Werte sind frei gewählt,
 * nicht gemessen und kein Benchmark. Die Kennzeichnung steht SICHTBAR am
 * Diagramm (Bildunterschrift im Artikel: „Illustratives Beispiel …") — nicht nur
 * hier im Code. Die kW-Achse ist trotzdem beschriftet, anders als im reinen
 * Prinzip-Schema (`arbeit-leistung-chart.tsx`): Hier IST die Höhe die Aussage
 * („ein Drittel"), und eine Achse ohne Zahlen könnte sie nicht tragen. Dasselbe
 * Maß wie `components/peak-shaving/load-curve-chart.tsx`, das ebenfalls
 * synthetische kW zeigt und als „beispielhafte Darstellung" gekennzeichnet ist.
 *
 * FARBEN (DESIGN.md, gleiche Rollen wie im Flaggschiff-Chart): Navy = der
 * Ist-Zustand, Akzent = die Wirkung. Rot/Grün sind für Kosten/Ersparnis
 * reserviert und wären hier Dekor.
 */

/** Grundlast (Kühlung, Beleuchtung, Steuerung) — läuft in beiden Fällen gleich durch. */
const BASE_KW = 4
/** Ein Gerät (z. B. ein Kompressor, ein Ofen, eine Spülmaschine). */
const DEVICE_KW = 6
/** Drei davon. Gleichzeitig = 18 kW über der Grundlast; versetzt = 6 kW. */
const DEVICE_COUNT = 3
/** Jedes Gerät läuft eine Stunde. */
const RUN_HOURS = 1

/** Startstunde des gemeinsamen Anlaufs. */
const START_HOUR = 6

/**
 * Der Tag in Stundenschritten.
 *
 * `together`: alle drei Geräte laufen von START_HOUR bis START_HOUR+1.
 * `staggered`: Gerät 1 ab START_HOUR, Gerät 2 ab +1 h, Gerät 3 ab +2 h.
 */
function scenarioAt(hour: number): { hour: number; together: number; staggered: number } {
  const togetherOn = hour >= START_HOUR && hour < START_HOUR + RUN_HOURS
  const together = BASE_KW + (togetherOn ? DEVICE_COUNT * DEVICE_KW : 0)

  const staggeredOn = hour >= START_HOUR && hour < START_HOUR + DEVICE_COUNT * RUN_HOURS
  const staggered = BASE_KW + (staggeredOn ? DEVICE_KW : 0)

  return { hour, together, staggered }
}

const SCENARIO = Array.from({ length: 24 }, (_, hour) => scenarioAt(hour))

/**
 * Der Beweis der Kern-Aussage, als Zusicherung im Code.
 *
 * Beide Kurven müssen dieselbe Energie tragen — sonst wäre das Beispiel
 * unehrlich („weniger Spitze, weil weniger verbraucht" ist kein Peak Shaving,
 * sondern Verzicht). Stundenschritte -> die Summe der Stundenwerte IST die
 * Energie in kWh.
 *
 * Wirft beim Laden des Moduls, nicht im Browser: Ein Fehler hier ist ein Fehler
 * am Bild, den niemand bemerkt — die Kurve sähe weiterhin plausibel aus. Gleiche
 * Haltung wie `toProfile` in `lib/branchen.ts`.
 */
function assertSameEnergy(): void {
  const sum = (key: 'together' | 'staggered') =>
    SCENARIO.reduce((total, point) => total + point[key], 0)
  const a = sum('together')
  const b = sum('staggered')
  if (Math.abs(a - b) > 1e-9) {
    throw new Error(
      `Entzerrungs-Beispiel ist unehrlich: gleichzeitig ${a} kWh vs. versetzt ${b} kWh — ` +
        'beide Kurven müssen dieselbe Energie tragen, nur die Spitze darf sich unterscheiden.',
    )
  }
}
assertSameEnergy()

const PEAK_TOGETHER = Math.max(...SCENARIO.map((p) => p.together))
const PEAK_STAGGERED = Math.max(...SCENARIO.map((p) => p.staggered))

/** Schlusspunkt bei 24:00 — `stepAfter` braucht einen Nachbarn (s. Branchen-Chart). */
const DATA = (() => {
  const last = SCENARIO[SCENARIO.length - 1] as (typeof SCENARIO)[number]
  return [...SCENARIO, { ...last, hour: 24 }]
})()

const Y_MAX = Math.ceil((PEAK_TOGETHER + 4) / 5) * 5
const X_TICKS = [0, 6, 12, 18, 24]
const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }

function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/**
 * Legende als HTML statt Recharts-`<Legend>` — so tragen die Einträge unsere
 * Tokens (gleiche Entscheidung wie in den bestehenden Charts).
 */
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

export function EntzerrungChart() {
  const t = useTranslations('Wissen.Charts.Entzerrung')

  return (
    <div>
      {/* aria-hidden + Textalternative: Die Aussage steht als Fließtext im
          Artikel und zusätzlich in der Kennzahl-Zeile unter dem Chart, die
          NICHT aria-hidden ist — die Information geht nicht verloren (WCAG 1.1.1). */}
      <div aria-hidden="true" className="h-[240px] w-full sm:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          {/* `top: 16`: Der oberste Y-Tick sitzt MITTIG auf der Achsenkante — mit
              den 8 px des ersten Wurfs wurde „30 kW" oben abgeschnitten (am Bild
              aufgefallen, nicht am Code). */}
          <LineChart data={DATA} margin={{ top: 16, right: 22, bottom: 0, left: 0 }}>
            {/* Nur horizontale Linien, und die zeigen auf eine BESCHRIFTETE
                kW-Achse — anders als im Prinzip-Schema ist ein Grid hier korrekt. */}
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 24]}
              ticks={X_TICKS}
              interval={0}
              tickFormatter={hourToTime}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
            />
            {/* `width={64}` wie im Flaggschiff-Chart: Mit 44 px brach Recharts
                „30 kW" auf ZWEI Zeilen um („30" / „kW") — die Achse las sich wie
                zwei Spalten (am Bild aufgefallen). */}
            <YAxis
              domain={[0, Y_MAX]}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
              width={64}
              unit=" kW"
            />

            {/* Die beiden Spitzen als ruhige Bezugslinien — sie tragen die
                Aussage „ein Drittel" und sind Kontext, keine Serien. */}
            <ReferenceLine
              y={PEAK_TOGETHER}
              stroke="var(--color-navy)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <ReferenceLine
              y={PEAK_STAGGERED}
              stroke="var(--color-accent)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />

            {/* `stepAfter`: Ein Lastgang IST eine Treppe aus Mittelwerten — eine
                weich interpolierte Kurve würde ein Gerät zeigen, das langsam
                hochfährt. Genau das tut es hier nicht. */}
            <Line
              type="stepAfter"
              dataKey="together"
              stroke="var(--color-navy)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="staggered"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <LegendItem color="var(--color-navy)">{t('seriesTogether')}</LegendItem>
        <LegendItem color="var(--color-accent)">{t('seriesStaggered')}</LegendItem>
      </ul>

      {/*
       * Die Kern-Aussage als TEXT, nicht nur als Bild — und bewusst NICHT
       * aria-hidden: Wer das SVG nicht sieht, bekommt hier die ganze Pointe.
       * Die Zahlen kommen aus denselben Konstanten wie die Kurven, sind also
       * per Konstruktion konsistent (kein zweiter, handgepflegter Satz).
       */}
      <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-muted">{t('peakTogetherLabel')}</dt>
          <dd className="mt-0.5 text-h4 text-ink">
            <Num>{t('kw', { value: PEAK_TOGETHER })}</Num>
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('peakStaggeredLabel')}</dt>
          <dd className="mt-0.5 text-h4 text-accent">
            <Num>{t('kw', { value: PEAK_STAGGERED })}</Num>
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('energyLabel')}</dt>
          {/*
           * Die Energie ist in BEIDEN Fällen gleich — deshalb steht hier ein Wort
           * und keine Zahl. „24 kWh vs. 24 kWh" wäre die schwächere Aussage:
           * Der Punkt ist nicht, WIE VIEL verbraucht wird, sondern DASS es sich
           * nicht ändert.
           */}
          <dd className="mt-0.5 text-h4 text-ink">{t('energyValue')}</dd>
        </div>
      </dl>
    </div>
  )
}
