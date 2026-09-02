'use client'

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BatteryCandidate, BatteryRoiSummary } from 'shared'

import { formatEur, formatKw, formatKwh1 } from '@/lib/format'
import { Num } from './num'

/**
 * Grenznutzen-Kurve: was bringt jede weitere Kilowattstunde Speicher noch? (02.09.2026)
 *
 * ── ⚠ DIE Y-ACHSE IST `netSavingOverHorizon`, NICHT `totalSavingPerYear` ──────────────────────
 * Die Jahresersparnis steigt mit der Kapazität fast immer weiter — sie beantwortet „bringt mehr
 * Speicher mehr", und darauf lautet die Antwort banalerweise ja. Die Frage des Kunden ist eine
 * andere: „ab wann zahlt der zusätzliche Speicher sich nicht mehr ein". Genau das ist
 * `netSavingOverHorizon` (`Jahresersparnis × Horizont − Nettoinvestition`, §3.9) — dieselbe
 * Grösse, nach der `rank.ts` sortiert und nach der die Zusatzspeicher-Sektion filtert. Eine
 * andere Kurve als der Report daneben wäre ein zweiter Massstab für dieselbe Entscheidung.
 *
 * ── ⚠ PUNKTWOLKE MIT VERBINDUNGSLINIE, KEINE GLATTE FUNKTION ─────────────────────────────────
 * Es sind fünf Katalog-Geräte, keine Messreihe über eine stetige Kapazitätsachse. Mit jedem Punkt
 * ändert sich ausser der Kapazität auch die LEISTUNG (und mitunter die Steuerungsart) — die Linie
 * verbindet also Geräte, sie interpoliert keine Zwischengrössen. Eine geglättete Kurve behauptete,
 * ein 32-kWh-Speicher liege auf ihr; den gibt es im Katalog nicht, und seinen Preis kennt niemand.
 * Deshalb `type="linear"`, sichtbare Punkte und ein Hinweis darunter.
 *
 * ── ⚠ ERSCHEINT AUCH, WENN ALLE PUNKTE NEGATIV SIND ──────────────────────────────────────────
 * Im Bestandsfall ist die Grafik die BEGRÜNDUNG des Klarsatzes „ein zusätzlicher Speicher lohnt
 * sich derzeit nicht" — sie zeigt, dass die Kurve durchgehend unter null liegt und nicht bloss
 * knapp danebenliegt. Sie hängt deshalb ausdrücklich NICHT am `netSavingOverHorizon > 0`-Filter
 * der Karten darunter; ein Klarsatz ohne Bild wäre eine Behauptung.
 */

type Point = { battery: BatteryCandidate } & Pick<
  BatteryRoiSummary,
  'netSavingOverHorizon' | 'amortizationYears' | 'netInvestment'
>

type Row = {
  capacityKwh: number
  netSaving: number
  name: string
  powerKw: number
  netInvestment: number
  amortizationYears: number
}

function BenefitTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Row }> }) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{row.name}</p>
      <p className="text-text-muted">
        <Num>{formatKwh1(row.capacityKwh)}</Num> · <Num>{formatKw(row.powerKw)}</Num>
      </p>
      <p className="text-text-muted">
        Netto über den Zeitraum:{' '}
        <Num className="font-medium text-ink">{formatEur(row.netSaving)}</Num>
      </p>
      <p className="text-text-muted">
        Nettoinvestition: <Num>{formatEur(row.netInvestment)}</Num>
      </p>
    </div>
  )
}

/** Nach aussen auf eine halbe Dekade runden — 0 bleibt 0, damit die Nulllinie exakt sitzt. */
function niceBound(value: number, direction: 'down' | 'up'): number {
  if (value === 0) return 0
  const step = Math.pow(10, Math.floor(Math.log10(Math.abs(value)))) / 2
  return direction === 'down' ? Math.floor(value / step) * step : Math.ceil(value / step) * step
}

export function MarginalBenefitChart({
  points,
  horizonYears,
  variant,
}: {
  points: Point[]
  horizonYears: number
  /** `addon` = Zusatzgeräte neben einer bestehenden Anlage (Differenzen), `catalog` = Neukauf. */
  variant: 'catalog' | 'addon'
}) {
  // Nicht-endliche Werte gehören nicht in eine Achse (ein `Infinity` zöge sie ins Unendliche und
  // machte alle übrigen Punkte unlesbar). Sortiert nach Kapazität — die Linie ist eine Achse,
  // keine Rangfolge, und `perBattery` ist nach Wirtschaftlichkeit sortiert.
  const rows: Row[] = points
    .filter((p) => Number.isFinite(p.netSavingOverHorizon) && Number.isFinite(p.battery.usableCapacityKwh))
    .map((p) => ({
      capacityKwh: p.battery.usableCapacityKwh,
      netSaving: p.netSavingOverHorizon,
      name: p.battery.name,
      powerKw: p.battery.maxPowerKw,
      netInvestment: p.netInvestment,
      amortizationYears: p.amortizationYears,
    }))
    .sort((a, b) => a.capacityKwh - b.capacityKwh)

  if (rows.length < 2) return null

  /*
   * ⚠ DIE NULLLINIE MUSS IMMER IM BILD SEIN — und die Achse trotzdem runde Zahlen tragen.
   * Beides ist am echten Bestandsfall gemessen: liegen alle fünf Punkte im Minus, skaliert
   * Recharts von selbst auf −4.000 bis −20.000, die Nulllinie fällt aus dem Sichtbereich, und die
   * Kurve sieht aus, als verliefe sie um eine Null herum, die irgendwo oben läge — ausgerechnet in
   * dem Fall, für den die Grafik gebaut ist. Ein hart auf [min, 0] gesetzter Bereich behebt das,
   * erzeugt dann aber Achsenbeschriftungen wie „−€ 3.422". Deshalb nach aussen auf eine halbe
   * Dekade gerundet: die Null ist drin UND die Ticks sind lesbar.
   */
  const values = rows.map((r) => r.netSaving)
  const lowerBound = niceBound(Math.min(0, ...values), 'down')
  const upperBound = niceBound(Math.max(0, ...values), 'up')

  const best = rows.reduce((a, b) => (b.netSaving > a.netSaving ? b : a))
  const allNegative = rows.every((r) => r.netSaving <= 0)

  return (
    <div
      className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid"
      data-testid="grenznutzen-kurve"
    >
      <p className="mb-1 text-sm font-medium text-ink">
        {variant === 'addon'
          ? 'Was bringt ein zusätzlicher Speicher — je Grösse'
          : 'Was bringt mehr Speicher — je Grösse'}
      </p>
      <p className="mb-3 text-xs text-text-muted">
        Netto über <Num>{horizonYears}</Num> Jahre, also Ersparnis abzüglich der Anschaffung
        {variant === 'addon' ? ' des Zusatzgeräts' : ''}. Über der Nulllinie rechnet sich das Gerät
        im Betrachtungszeitraum, darunter nicht. Alle Beträge exkl. MwSt.
      </p>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="capacityKwh"
              type="number"
              domain={['dataMin', 'dataMax']}
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => formatKwh1(v)}
              label={{
                value: 'Nutzbare Kapazität (bei der jeweiligen Geräteleistung)',
                position: 'insideBottom',
                offset: -12,
                style: { fontSize: 11, fill: 'var(--color-text-muted)' },
              }}
            />
            <YAxis
              /*
               * ⚠ DIE NULLLINIE MUSS IMMER IM BILD SEIN — gemessen am echten Bestandsfall, in dem
               * ALLE fünf Punkte negativ sind: Recharts skaliert dann auf −4.000 bis −20.000, die
               * `ReferenceLine y={0}` fällt aus dem Sichtbereich, und die Kurve sieht aus, als
               * verliefe sie um eine Nulllinie herum, die irgendwo oben läge. Genau in dem Fall,
               * für den die Grafik gebaut ist („keines rechnet sich"), wäre sie damit unlesbar.
               */
              domain={[lowerBound, upperBound]}
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => formatEur(v)}
              width={72}
            />
            <Tooltip content={<BenefitTooltip />} isAnimationActive={false} cursor={false} />
            {/* Die Nulllinie ist die eigentliche Aussage der Grafik — sie trennt „rechnet sich"
                von „rechnet sich nicht" und steht deshalb kräftiger als das Raster. */}
            <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeWidth={1} />
            <Line
              type="linear"
              dataKey="netSaving"
              name="Netto über den Betrachtungszeitraum"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--color-accent)', stroke: 'var(--color-surface)', strokeWidth: 1 }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 border-t border-border pt-3 text-xs text-text-muted">
        <p>
          {allNegative ? (
            <>
              <strong>Keine der Grössen liegt über der Nulllinie.</strong> Am nächsten kommt{' '}
              {best.name} mit <Num>{formatEur(best.netSaving)}</Num> — auch dort bleibt die
              Ersparnis über <Num>{horizonYears}</Num> Jahre unter der Anschaffung.
            </>
          ) : (
            <>
              Am meisten bleibt bei <strong>{best.name}</strong> übrig:{' '}
              <Num>{formatEur(best.netSaving)}</Num> über <Num>{horizonYears}</Num> Jahre.
              Grössere Geräte sparen zwar mehr, kosten aber auch mehr — die Kurve zeigt, ab wann das
              eine das andere nicht mehr einholt.
            </>
          )}
        </p>
        <p className="mt-2">
          Es sind die <Num>{rows.length}</Num> Geräte unseres Katalogs, keine stetige Kurve: mit der
          Kapazität ändert sich auch die Leistung. Die Linie verbindet die Punkte,{' '}
          <strong>sie interpoliert keine Zwischengrössen</strong> — ein Gerät, das dazwischen liegt,
          gibt es im Katalog nicht, und seinen Preis kennen wir nicht.
        </p>
      </div>
    </div>
  )
}
