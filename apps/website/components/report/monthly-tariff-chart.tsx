'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthlyTariffComparison } from 'shared'

import { formatEur, formatEur2 } from '@/lib/format'
import { Num } from './num'

/**
 * Monatsvergleich „Das zahlen Sie jetzt vs. mit aWATTar" (01.09.2026).
 *
 * ── ⚠ DREI REIHEN AUS EINER RECHNUNG, KEINE DAVON ALLEIN ───────────────────────────────────────
 * Ist-Tarif · aWATTar ohne Steuerung · aWATTar mit dem Speicher des Kunden. Alle drei kommen aus
 * demselben Contract-Feld (`tariffOptimization.monthlyComparison`) und entstehen gemeinsam oder
 * gar nicht — fehlt das Feld, rendert diese Komponente NICHTS, statt einer leeren Box (die
 * Aufrufstelle prüft das ebenfalls; hier steht die zweite Sperre für einen künftigen Aufrufer).
 *
 * ── ⚠ DER NAME STEHT DA: „aWATTar" ─────────────────────────────────────────────────────────────
 * Nicht mehr nur „Börsenpreise". Der Kunde wechselt zu einem konkreten Anbieter, und die Frage,
 * die er beantwortet haben will, lautet nicht „was machen Börsenpreise", sondern „was zahle ich
 * dort". Die übrigen Beschriftungen des Reports (Toggle in Schritt 2, die Ergebniskarte daneben)
 * sind davon bewusst unberührt geblieben — sie umzubenennen ist ein eigener Schritt.
 *
 * ── ⚠ KEIN LEISTUNGSPREIS IN DIESEN BALKEN ─────────────────────────────────────────────────────
 * Sie zeigen Arbeits- und Netz-Arbeitspreis sowie die anteiligen Grundgebühren (Delta 19). Der
 * Leistungspreis bleibt die bestehende Jahreszahl weiter oben im Report; ihn auf Monate zu
 * verteilen verlangte eine Aufteilungsregel, die es nicht gibt. Der Hinweistext unter dem Chart
 * sagt das.
 *
 * ── ⚠ DER AUSWEIS „WAS HIER EINGERECHNET IST" IST TEIL DER AUSSAGE, NICHT SCHMUCK ──────────────
 * Sobald Fixkosten in den Balken stecken, ist aus einer Ziffer nicht mehr ablesbar, woraus sie
 * besteht — und die Grundgebühren sind ausgerechnet der Posten, den ein Kunde beim Nachrechnen auf
 * seiner Rechnung sucht und sonst nicht wiederfindet. Der Block nennt deshalb jeden Bestandteil
 * einzeln, samt dem, was NICHT drin ist (Prinzip 5). Er steht im Druck mit da: auf einem
 * weitergereichten Blatt gibt es keinen Tooltip und keine Rückfragemöglichkeit.
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

/*
 * Ein neutraler Grundton für den Ist-Zustand und zwei zunehmend kräftige Akzentstufen für die
 * beiden aWATTar-Fälle — die Leserichtung „so ist es heute → so wäre es dort → so wäre es dort mit
 * Ihrem Speicher" steckt damit schon in der Helligkeit. Wie in `cost-chart.tsx` kein Hex im Code:
 * `color-mix()` leitet die Zwischenstufe live vom Akzentton ab, ein White-Label-Wechsel zieht sie
 * automatisch mit. Grün/Rot bleiben für Ersparnis/Kosten reserviert (DESIGN.md).
 */
const SERIES = [
  {
    key: 'currentTariffEur',
    label: 'Ihr Tarif heute',
    color: 'var(--color-text-muted)',
  },
  {
    key: 'spotWithoutControlEur',
    label: 'aWATTar ohne Steuerung',
    color: 'color-mix(in srgb, var(--color-accent) 50%, var(--color-surface))',
  },
  {
    key: 'spotWithBatteryEur',
    label: 'aWATTar mit Ihrem Speicher (Ladung optimiert)',
    color: 'var(--color-accent)',
  },
] as const

type Row = {
  month: string
  currentTariffEur: number | null
  spotWithoutControlEur: number | null
  spotWithBatteryEur: number | null
}

function MonthTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number | null }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {SERIES.map((s) => {
        const value = payload.find((p) => p.dataKey === s.key)?.value
        if (value == null) return null
        return (
          <p key={s.key} className="text-text-muted">
            {s.label}: <Num className="font-medium text-ink">{formatEur(value)}</Num>
          </p>
        )
      })}
    </div>
  )
}

/**
 * Summe über die belegten Monate — `null`-Monate tragen nichts bei (sie sind keine 0).
 *
 * ⚠ EXPORTIERT, WEIL ES EINEN ZWEITEN KONSUMENTEN GIBT: `tariff-optimization-card.tsx` entscheidet
 * an genau diesen Summen, ob es vor der Karte warnt (02.09.2026). Ein zweites Mal ausgeschrieben
 * könnten Legende und Warnung auseinanderlaufen — und dann stünde im selben Report eine Warnung
 * über Zahlen, die daneben anders summiert dastehen.
 */
export function sumCovered(values: (number | null)[]): number {
  return values.reduce<number>((sum, v) => (v == null ? sum : sum + v), 0)
}

export function MonthlyTariffChart({ comparison }: { comparison: MonthlyTariffComparison }) {
  const fixed = comparison.fixedCosts
  const rows: Row[] = MONTH_LABELS.map((month, i) => ({
    month,
    // ⚠ `null`, nicht 0: ein Nullbalken sähe aus wie „gemessen, kostet nichts". Recharts zeichnet
    // an dieser Stelle nichts — der Monat bleibt sichtbar leer, und das ist die Aussage.
    currentTariffEur: comparison.currentTariffEur[i] ?? null,
    spotWithoutControlEur: comparison.spotWithoutControlEur[i] ?? null,
    spotWithBatteryEur: comparison.spotWithBatteryEur[i] ?? null,
  }))

  const totals = {
    currentTariffEur: sumCovered(comparison.currentTariffEur),
    spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
    spotWithBatteryEur: sumCovered(comparison.spotWithBatteryEur),
  } as const

  return (
    <div
      className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid"
      data-testid="monatsvergleich-awattar"
    >
      <p className="mb-1 text-sm font-medium text-ink">Das zahlen Sie jetzt vs. mit aWATTar</p>
      <p className="mb-3 text-xs text-text-muted">
        Energie- und Netzkosten je Monat, inklusive Grundgebühren — Ihr Tarif, aWATTar ohne
        Steuerung und aWATTar mit Ihrem Speicher (Ladung optimiert). Alle Beträge exkl. MwSt.
      </p>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              interval={0}
            />
            <YAxis
              tickFormatter={(v: number) => formatEur(v)}
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              width={64}
            />
            <Tooltip content={<MonthTooltip />} isAnimationActive={false} cursor={false} />
            {SERIES.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legende MIT den Summen über die gemessenen Monate — die eigentliche Aussage des Charts
          steht damit auch dann da, wenn niemand die einzelnen Balken abliest (und im Druck, wo es
          keinen Tooltip gibt). */}
      <div className="mt-4 flex flex-col gap-1 text-xs text-text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            {s.label}:{' '}
            <Num className="font-medium text-ink">{formatEur(totals[s.key])}</Num>{' '}
            <span>
              über <Num>{comparison.coveredMonths}</Num> gemessene Monate
            </span>
          </span>
        ))}
        {/*
          Der Netto-Hinweis steht EINMAL unter dem Summen-Block und nicht an jeder der drei Zeilen:
          er gilt für alle drei gleichermassen, und dreimal wiederholt wäre er Lärm an genau der
          Stelle, an der ein Leser die Beträge vergleicht. An den einzelnen Monatsbalken und im
          Tooltip steht er bewusst gar nicht — die Chart-Unterzeile deckt sie mit ab.
        */}
        <span className="mt-1">Alle Beträge exkl. MwSt.</span>
      </div>

      {/*
        ── „Was hier eingerechnet ist" (Delta 19) ───────────────────────────────────────────────
        Eine Liste statt eines Fliesstexts: der Leser sucht einen einzelnen Posten („wo ist meine
        Grundgebühr?"), und in einem Absatz findet er ihn nicht. Die Beträge stehen daneben, weil
        „ist eingerechnet" ohne Zahl nicht nachrechenbar ist — und weil ein Kunde am Betrag sofort
        sieht, ob wir seine Gebühr richtig verstanden haben.
      */}
      <div
        className="mt-4 rounded-md border border-border bg-surface-alt px-4 py-3 text-xs text-text-muted print:break-inside-avoid"
        data-testid="monatsvergleich-bestandteile"
      >
        <p className="mb-2 font-medium text-ink">Was hier eingerechnet ist</p>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li>
            <strong>Arbeitspreis</strong> je Viertelstunde — im Ist-Tarif Ihr fester Satz, bei
            aWATTar der tatsächliche Börsenpreis jener Stunde.
          </li>
          <li>
            <strong>Netz-Arbeitspreis</strong> Ihres Netzbetreibers samt Netzverlustentgelt — in
            allen drei Reihen identisch, er hängt am Anschluss und nicht am Stromvertrag.
          </li>
          <li>
            <strong>Ladeverluste</strong> des Speichers: um eine Kilowattstunde einzuspeichern,
            muss mehr als eine bezogen werden. Die Reihe „mit Ihrem Speicher" trägt diesen
            Mehrbezug.
          </li>
          {fixed.networkBaseFeeEur > 0 && (
            <li>
              <strong>Netz-Grundpreis</strong> (Jahrespauschale), anteilig für{' '}
              <Num>{fixed.coveredDays}</Num> gemessene Tage:{' '}
              <Num className="text-ink">{formatEur2(fixed.networkBaseFeeEur)}</Num> — in allen drei
              Reihen gleich hoch, er verschiebt den Vergleich also nicht.
            </li>
          )}
          <li>
            <strong>Grundgebühr Ihres heutigen Lieferanten</strong>:{' '}
            {fixed.supplierFeeEurPerMonth > 0 ? (
              <>
                <Num className="text-ink">{formatEur2(fixed.supplierFeeEurPerMonth)}</Num>/Monat,
                anteilig <Num className="text-ink">{formatEur2(fixed.supplierBaseFeeEur)}</Num> —
                nur in „Ihr Tarif heute".
              </>
            ) : (
              <>
                nicht angegeben, gerechnet mit <Num className="text-ink">€ 0</Num>. Ihr heutiger
                Tarif erscheint dadurch eher zu günstig; die Zahl lässt sich in Schritt 2 nachtragen.
              </>
            )}
          </li>
          <li>
            <strong>Grundgebühr aWATTar</strong>:{' '}
            <Num className="text-ink">{formatEur2(fixed.awattarFeeEurPerMonth)}</Num>/Monat (netto),
            anteilig <Num className="text-ink">{formatEur2(fixed.awattarBaseFeeEur)}</Num> — nur in
            den beiden aWATTar-Reihen.
          </li>
          <li>
            <strong>Nicht</strong> eingerechnet: der Leistungspreis (€/kW·Jahr) — er bleibt die
            Jahreszahl weiter oben im Report; Umsatzsteuer — gerechnet wird durchgängig netto;
            Wechsel- oder Vertragskosten.
          </li>
        </ul>
      </div>

      <div className="mt-3 border-t border-border pt-3 text-xs text-text-muted">
        <p>
          Gemessen auf <Num>{comparison.coveredMonths}</Num> von 12 Monaten — nur Monate mit
          Messwerten sind gezeichnet, die übrigen bleiben leer und werden{' '}
          <strong>nicht hochgerechnet</strong>. Die Monatsgebühren sind{' '}
          <strong>anteilig nach den tatsächlich gemessenen Tagen</strong> gerechnet, nie als voller
          Monatsbetrag.
        </p>
        <p className="mt-2">
          Rückblickend gerechnet auf die tatsächlichen Marktpreise Ihres Zeitraums — kein
          Versprechen für die Zukunft. Die Ladesteuerung des Speichers folgt dabei einer einfachen
          Schwellenregel und ist noch nicht gegen ein rechnerisches Optimum geprüft:{' '}
          <strong>die Zahl gilt als vorläufige Untergrenze</strong>, mit besserer Steuerung eher
          mehr als weniger.
        </p>
      </div>
    </div>
  )
}
