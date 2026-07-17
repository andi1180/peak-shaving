'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { SMART_HEATING_DATA } from '@/lib/smart-heating-curve'

/*
 * GRAFIK „Konventionell vs. Smart Heating" (Prompt 19, erster Inhaltsblock von
 * /leistungen/smart-heating, `firstSectionGraphic`-Slot aus Prompt 18).
 *
 * DIE AUSSAGE: zwei Tageslastkurven — „Konventionell" läuft mit Heizlast auch
 * tagsüber mit (Tagesabschnitt sichtbar höher), „Smart Heating" verschiebt
 * dieselbe Heizenergie ins Nachtfenster (Tagesabschnitt flacher/niedriger,
 * dafür deutliche Ladespitze nachts). KEIN Kappungs-Marker/keine Kappungslinie
 * — anderes Thema (Peak Shaving, s. `components/home/hero-load-chart.tsx`).
 * Diese Grafik zeigt ausschließlich die zeitliche Verschiebung.
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
 * DER AKZENT ERSCHEINT GENAU EINMAL: als durchgezogene Linie von „Smart
 * Heating" — das Kernargument der Grafik (die bessere Steuerung). „Konventionell"
 * bleibt gedämpft und gestrichelt, damit der Teal nicht mit sich selbst
 * konkurriert (DESIGN.md „Akzent sparsam").
 */

const X_TICKS = [0, 6, 12, 18, 24]

/** Kopfraum über der Nacht-Ladespitze (120 im Datensatz) — sonst schneidet die
 *  Diagrammkante die Kurve an ihrem höchsten Punkt ab. */
const Y_MAX = 134

const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }

/** Stunde → „06:00" (auch für den angehängten Schlusspunkt bei hour=24 → „24:00"). */
function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/**
 * Legende als HTML statt Recharts-`<Legend>` — trägt so unsere Tokens (gleiche
 * Entscheidung wie in den übrigen Charts). Eigene, lokale Komponente statt
 * Import aus `tagesverlauf-chart.tsx`/`pv-verbrauch-chart.tsx`: dort gibt es
 * je andere Markerformen (Punkt/Fläche) für andere Aufrufer — ein gemeinsames
 * Primitiv für zwei Linienformen wäre mehr Abstraktion als Ersparnis.
 */
function LegendItem({
  dashed,
  color,
  children,
}: {
  dashed: boolean
  color: string
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

export function SmartHeatingChart() {
  const t = useTranslations('Leistungen.Pages.smartHeating.chart')

  /*
   * Schlusspunkt bei 24:00. `stepAfter` zeichnet das Segment ZWISCHEN zwei
   * Punkten auf Höhe des linken — der letzte Punkt (23 Uhr) hätte ohne
   * Nachbarn kein Segment, und die Kurven endeten sichtbar eine Stunde zu
   * früh. Der angehängte Punkt trägt dieselben Werte wie 23 Uhr; damit läuft
   * das letzte Segment flach bis zum Achsenende. Kein Datenpunkt, reine
   * Zeichenlogik (gleiche Mechanik wie in den übrigen Kurven-Charts).
   */
  const data = React.useMemo(() => {
    const last = SMART_HEATING_DATA[SMART_HEATING_DATA.length - 1]
    if (!last) return SMART_HEATING_DATA
    return [...SMART_HEATING_DATA, { ...last, hour: 24 }]
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
              Zeichenfläche hinaus — derselbe Bugfix wie in den übrigen
              Kurven-Charts (dort am Bild gefunden, hier von Anfang an gesetzt). */}
          <LineChart data={data} margin={{ top: 8, right: 22, bottom: 0, left: 22 }}>
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

            {/* „Konventionell" zuerst im JSX, damit „Smart Heating" (der
                Akzent) beim Überschneiden obenauf liegt (Recharts zeichnet in
                Kind-Reihenfolge). Gedämpft + gestrichelt: sie ist der
                Kontrast, nicht das Argument. */}
            <Line
              type="stepAfter"
              dataKey="conventional"
              stroke="var(--color-text-muted)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="smartHeating"
              stroke="var(--color-accent)"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <LegendItem dashed color="var(--color-text-muted)">
          {t('conventionalLabel')}
        </LegendItem>
        <LegendItem dashed={false} color="var(--color-accent)">
          {t('smartHeatingLabel')}
        </LegendItem>
      </ul>
    </div>
  )
}
