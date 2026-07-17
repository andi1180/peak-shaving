'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { PPA_PREIS_DATA, YEAR_TICKS, stepToYear } from '@/lib/ppa-preis-curve'

/*
 * GRAFIK „Spotmarktpreis vs. PPA-Preis" (Prompt 20, erster Inhaltsblock
 * /leistungen/ppa).
 *
 * DIE AUSSAGE: zwei Preislinien über einen illustrativen Vertragshorizont von
 * fünf Jahren — der volatile, gezackte Spotmarktpreis (Risiko) gegen den
 * flachen, über die Laufzeit fixierten PPA-Preis (Sicherheit). Die Aussage
 * steht in der FORM der Linien, nicht in Zahlen.
 *
 * ERSTE Grafik im Projekt mit JAHRES- statt Tagesachse: „Jahr 1"…„Jahr 5" sind
 * ein illustrativer Horizont, KEINE echten Kalenderjahre (s. `lib/ppa-preis-curve.ts`).
 *
 * EHRLICHKEITSREGELN übernommen von `pv-verbrauch-chart.tsx` /
 * `tagesverlauf-chart.tsx` (dort ausführlich begründet) — aus demselben Grund,
 * die Werte sind relativ, nicht real:
 *   1. KEINE Y-ACHSE (`hide`) — es gibt keine Einheit, keinen €/ct-Wert.
 *   2. KEIN TOOLTIP — ein ablesbarer Wert wäre ein Preis, den es nicht gibt.
 *   3. KEIN CartesianGrid — Hilfslinien ohne Y-Achse suggerieren einen Maßstab.
 * Die X-Achse (Vertragsjahre) bleibt sichtbar — sie verankert die Linien als
 * „über fünf Jahre", ohne eine Preishöhe zu behaupten.
 *
 * INTERPOLATION: `linear`, nicht `stepAfter`. Ein Preisverlauf ist kein
 * Viertelstunden-Lastgang (dort trägt die Stufe die „gehalten bis zum nächsten
 * Messwert"-Semantik); eine Preislinie wird verbunden gezeichnet. `linear` hält
 * die Zacken des Spotpreises scharf — genau der „volatil"-Charakter, den eine
 * geglättete Kurve verwischen würde.
 *
 * FARBEN (DESIGN.md): `var(--color-*)`-Strings direkt an Recharts, kein Hex.
 * DER AKZENT ERSCHEINT GENAU EINMAL: als PPA-Linie (Teal) — die ruhige, sichere
 * Antwort ist die Marke. Der Spotpreis läuft auf Navy (präsent, aber
 * Anker-Ton), damit der Teal nicht mit sich selbst konkurriert („Akzent sparsam").
 */

const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }

/**
 * Legende als HTML statt Recharts-`<Legend>` — trägt so unsere Tokens (gleiche
 * Entscheidung wie in den übrigen Charts). Beide Serien sind Linien; der
 * Charakter (gezackt vs. flach) steckt in der Kurve selbst, nicht im Marker.
 */
function LegendItem({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-small text-text-muted">
      <span
        aria-hidden="true"
        className="h-0 w-6 shrink-0 border-t-2"
        style={{ borderColor: color }}
      />
      {children}
    </li>
  )
}

export function PpaPreisChart() {
  const t = useTranslations('Leistungen.Pages.ppa.chart')

  return (
    <div>
      {/*
       * `aria-hidden` + Textalternative: Das SVG ist reine Illustration. Die
       * Aussage steht als Caption unter dem Diagramm (WCAG 1.1.1) — gleiche
       * Lösung wie in allen übrigen Chart-Komponenten.
       */}
      <div aria-hidden="true" className="h-[160px] w-full sm:h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={PPA_PREIS_DATA} margin={{ top: 8, right: 16, bottom: 0, left: 16 }}>
            <XAxis
              dataKey="step"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={YEAR_TICKS}
              interval={0}
              tickFormatter={(step: number) => t('yearTick', { n: stepToYear(step) })}
              tick={AXIS_TICK}
              stroke="var(--color-border-strong)"
              tickLine={false}
            />
            {/* Versteckt, aber vorhanden: Recharts braucht die Skala zum
                Zeichnen — sichtbar wäre sie eine Achse ohne Einheit. Etwas
                Kopfraum über/unter den Spitzen, damit die Kurve nicht an die
                Diagrammkante stößt. */}
            <YAxis domain={[30, 78]} hide />

            <Line
              type="linear"
              dataKey="spot"
              stroke="var(--color-navy)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="ppa"
              stroke="var(--color-accent)"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <LegendItem color="var(--color-navy)">{t('spotLabel')}</LegendItem>
        <LegendItem color="var(--color-accent)">{t('ppaLabel')}</LegendItem>
      </ul>
    </div>
  )
}
