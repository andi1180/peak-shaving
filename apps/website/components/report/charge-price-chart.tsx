'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MonthlyChargePrice } from 'shared'

import { formatKwh1 } from '@/lib/format'
import { Num } from './num'

/**
 * Ø-Ladepreis je Monat — hat die Ladesteuerung die günstigen Stunden getroffen? (02.09.2026)
 *
 * ── ⚠ OHNE DEN MONATSDURCHSCHNITT IST DIE GRAFIK WERTLOS ──────────────────────────────────────
 * „Im März zu 7,2 ct geladen" ist keine Auskunft — teuer oder günstig ist das erst gegenüber dem,
 * was in diesem März überhaupt zu zahlen war. Die gestrichelte Linie ist deshalb kein Beiwerk: sie
 * ist der Preis, den ein Speicher zahlte, der blind über den Monat verteilt lädt (ungewichtetes
 * Mittel ALLER Intervalle). Liegt der Ladebalken darunter, hat die Steuerung tatsächlich gewählt.
 *
 * ── ⚠ ERSCHEINT NUR MIT ECHTER PREISKURVE — UND DIESE BEDINGUNG PRÜFT DIE ENGINE ──────────────
 * `monthlyChargePrice` entsteht ausschliesslich, wenn der Delta-4-Hebel angefordert UND rechenbar
 * war (s. `trace.ts`). Die Oberfläche prüft deshalb nur, ob das Feld da ist — eine hier
 * nachgebaute Zweitprüfung an `tariffOptimization.computable` könnte davon abweichen, und die
 * Frage „darf ich diese Zahlen zeigen" hat einen Ort (dieselbe Regel wie beim Monatsvergleich).
 *
 * ── ⚠ DIE MENGE STEHT DANEBEN, WEIL EIN PREIS OHNE SIE NICHTS WIEGT ───────────────────────────
 * Ein Monat mit 4 kWh Ladung und einem sehr guten Preis sagt wenig; die geladene Menge (netzseitig,
 * also die BEZAHLTE) steht deshalb im Tooltip und als Summe darunter.
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

const CHARGE_COLOR = 'var(--color-accent)'
const DISCHARGE_COLOR = 'color-mix(in srgb, var(--color-accent) 45%, var(--color-surface))'
const AVERAGE_COLOR = 'var(--color-text-muted)'

type Row = {
  month: string
  charge: number | null
  discharge: number | null
  average: number | null
  chargedKwh: number | null
}

const formatCt = (v: number): string =>
  `${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 }).format(v)} ct`

function PriceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ payload?: Row }>
  label?: string
}) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {row.charge != null && (
        <p className="text-text-muted">
          Geladen zu: <Num className="font-medium text-ink">{formatCt(row.charge)}</Num>/kWh
        </p>
      )}
      {row.discharge != null && (
        <p className="text-text-muted">
          Entladen zu: <Num className="font-medium text-ink">{formatCt(row.discharge)}</Num>/kWh
        </p>
      )}
      {row.average != null && (
        <p className="text-text-muted">
          Monatsdurchschnitt: <Num>{formatCt(row.average)}</Num>/kWh
        </p>
      )}
      {row.chargedKwh != null && (
        <p className="mt-1 text-text-muted">
          Geladene Menge: <Num>{formatKwh1(row.chargedKwh)}</Num>
        </p>
      )}
    </div>
  )
}

export function ChargePriceChart({ price }: { price: MonthlyChargePrice }) {
  const rows: Row[] = MONTH_LABELS.map((month, i) => ({
    month,
    // ⚠ `null`, nicht 0 — sonst behauptete ein Nullbalken einen Preis, den nie jemand bezahlt hat.
    charge: price.chargeCtPerKwh[i] ?? null,
    discharge: price.dischargeCtPerKwh[i] ?? null,
    average: price.averageCtPerKwh[i] ?? null,
    chargedKwh: price.chargedKwh[i] ?? null,
  }))

  // Gesamtzahlen: mengengewichtet über alle Monate — Σ(Preis × Menge) / Σ Menge. Das arithmetische
  // Mittel der Monatspreise wäre eine andere Grösse (jeder Monat gleich schwer, egal wie viel er
  // trägt) und liesse einen einzelnen schwachen Monat die Aussage kippen.
  let chargedKwh = 0
  let chargeCost = 0
  let dischargedKwh = 0
  let dischargeCost = 0
  let measuredMonths = 0
  let betterThanAverage = 0
  for (let i = 0; i < 12; i++) {
    const c = price.chargeCtPerKwh[i]
    const kwh = price.chargedKwh[i]
    const avg = price.averageCtPerKwh[i]
    if (avg != null) measuredMonths += 1
    if (c != null && kwh != null && kwh > 0) {
      chargedKwh += kwh
      chargeCost += c * kwh
      if (avg != null && c < avg) betterThanAverage += 1
    }
    const d = price.dischargeCtPerKwh[i]
    const dKwh = price.dischargedKwh[i]
    if (d != null && dKwh != null && dKwh > 0) {
      dischargedKwh += dKwh
      dischargeCost += d * dKwh
    }
  }
  const overallCharge = chargedKwh > 0 ? chargeCost / chargedKwh : null
  const overallDischarge = dischargedKwh > 0 ? dischargeCost / dischargedKwh : null

  return (
    <div
      className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid"
      data-testid="ladepreis-chart"
    >
      <p className="mb-1 text-sm font-medium text-ink">Zu welchem Preis wird geladen?</p>
      <p className="mb-3 text-xs text-text-muted">
        Ø-Arbeitspreis der Lade- und Entladestunden je Monat, gewichtet mit der jeweiligen Menge —
        gegen den Monatsdurchschnitt aller Stunden (gestrichelt). Alle Beträge exkl. MwSt.
      </p>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              interval={0}
            />
            <YAxis
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => formatCt(v)}
              width={64}
            />
            <Tooltip content={<PriceTooltip />} isAnimationActive={false} cursor={false} />
            <Bar dataKey="charge" name="Geladen zu" fill={CHARGE_COLOR} isAnimationActive={false} />
            <Bar
              dataKey="discharge"
              name="Entladen zu"
              fill={DISCHARGE_COLOR}
              isAnimationActive={false}
            />
            {/* `connectNulls={false}`: über einen Monat ohne Messwert wird NICHT durchgezogen — eine
                Linie über die Lücke behauptete einen Durchschnitt, den es dort nicht gibt. */}
            <Line
              type="linear"
              dataKey="average"
              name="Monatsdurchschnitt"
              stroke={AVERAGE_COLOR}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={{ r: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: CHARGE_COLOR }}
            aria-hidden
          />
          Geladen zu:{' '}
          <Num className="font-medium text-ink">
            {overallCharge == null ? '—' : `${formatCt(overallCharge)}/kWh`}
          </Num>{' '}
          <span>
            über <Num>{formatKwh1(chargedKwh)}</Num> bezogen
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: DISCHARGE_COLOR }}
            aria-hidden
          />
          Entladen zu:{' '}
          <Num className="font-medium text-ink">
            {overallDischarge == null ? '—' : `${formatCt(overallDischarge)}/kWh`}
          </Num>{' '}
          <span>
            über <Num>{formatKwh1(dischargedKwh)}</Num> abgegeben
          </span>
        </span>
        <span className="mt-1">
          In <Num>{betterThanAverage}</Num> von <Num>{measuredMonths}</Num> gemessenen Monaten lag
          der Ladepreis unter dem Monatsdurchschnitt.
        </span>
      </div>

      <div className="mt-3 border-t border-border pt-3 text-xs text-text-muted">
        <p>
          Die geladene Menge ist die am <strong>Netz bezogene</strong>, also die bezahlte — im
          Speicher kommt davon der Wirkungsgrad-Anteil an. Auf den Preis wirkt das nicht, auf die
          Menge sehr wohl.
        </p>
        <p className="mt-2">
          Rückblickend gerechnet auf die tatsächlichen Marktpreise Ihres Zeitraums — kein
          Versprechen für die Zukunft. Die Ladesteuerung folgt einer einfachen Schwellenregel und
          ist noch nicht gegen ein rechnerisches Optimum geprüft:{' '}
          <strong>der Abstand zum Durchschnitt gilt als Untergrenze</strong>, mit besserer Steuerung
          eher mehr.
        </p>
      </div>
    </div>
  )
}
