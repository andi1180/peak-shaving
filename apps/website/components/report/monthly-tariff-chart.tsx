'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  displayedPriceBasis,
  sumCovered,
  tariffWayCosts,
  VAT_INCLUSIVE_LABEL,
  type MonthlyTariffComparison,
} from 'shared'

import { formatEur, formatEur2 } from '@/lib/format'
import { CONTROLLED_WAY_LABEL, monthlyBatteryRef, vatNote } from '@/lib/report-copy'
import { Num } from './num'
import { CHART_COLORS } from '@/lib/pdf-report/theme'
import { useId } from 'react'

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
 * Ihrem Speicher" steckt damit schon in der Helligkeit. Die Zwischenstufe kommt wie in
 * `cost-chart.tsx` aus `CHART_COLORS` (D15 Block 2) und wird nicht mehr hier gerechnet.
 * Grün/Rot bleiben für Ersparnis/Kosten reserviert (DESIGN.md Zeile 51).
 */
/**
 * Die drei Reihen.
 *
 * ⚠ Die dritte hing bis zum 21.09.2026 am FALL — „aWATTar mit" plus Possessivum („Ihrem
 * Speicher" bzw. „der empfohlenen Batterie"), dazu „(Ladung optimiert)". Sie heisst jetzt überall gleich
 * (`CONTROLLED_WAY_LABEL`) — derselbe Gegenstand trug im selben Dokument sonst drei
 * Beschriftungen. Wessen Speicher gesteuert wird, sagt der Fliesstext daneben.
 */
const SERIES =
  [
    {
      key: 'currentTariffEur',
      label: 'Ihr Tarif heute',
      color: 'var(--color-text-muted)',
    },
    {
      key: 'spotWithoutControlEur',
      label: 'aWATTar ohne Steuerung',
      color: CHART_COLORS.seriesSoft,
    },
    {
      key: 'controlledEur',
      label: CONTROLLED_WAY_LABEL,
      color: CHART_COLORS.series,
      /*
       * D15 Block 2, Punkt 14 — die einzige MODELLIERTE der drei Reihen: sie unterstellt eine
       * Ladesteuerung, die so noch nicht läuft. Die Schraffur trägt diese Einschränkung IM BILD,
       * statt sie nur im Text daneben zu behaupten; das Zielbild macht es an seiner Säule
       * „rechnerisches Optimum" genauso.
       *
       * ⚠ Die Fläche bleibt der volle Akzent und wird NICHT aufgehellt. Die drei Reihen lesen
       * sich über zunehmende Helligkeit als „heute → dort → dort mit Speicher" (s. Kopf); ein
       * heller Modellton kehrte diese Leiter an ihrem Ende um. Die Schraffur kommt dazu, sie
       * ersetzt nichts.
       */
      model: true,
    },
  ] as const

type Row = {
  month: string
  currentTariffEur: number | null
  spotWithoutControlEur: number | null
  controlledEur: number | null
}

/**
 * Balken und Legendensummen des Charts. Die gesteuerte Reihe liest dieselbe Auswahl wie die
 * Monatstabelle (`buildMonthly`) und das Wege-Kapitel: `tariffWayCosts` entscheidet, ob die
 * vorausschauende oder die einfache Reihe Weg 4 ist.
 *
 * K3b-2: Ohne Speicher (leerer Katalog, kein Bestand) gibt es die dritte Reihe nicht — Balken,
 * Tooltip und Legende lesen dieselbe Auswahl, sonst beschriftete die Legende eine Säule, die
 * niemand zeichnet.
 */
export function monthlyChartData(comparison: MonthlyTariffComparison): {
  rows: Row[]
  totals: Record<(typeof SERIES)[number]['key'], number>
  hasControlled: boolean
  /** `false` bei unbekanntem Liefertarif — dann gibt es „Ihr Tarif heute" nicht. */
  hasCurrent: boolean
} {
  const { controlVariant, controlledEur } = tariffWayCosts(comparison)
  const controlled =
    controlVariant === 'predictive'
      ? comparison.spotWithPredictiveControlEur
      : controlVariant === 'simple'
        ? comparison.spotWithBatteryEur
        : undefined

  const rows: Row[] = MONTH_LABELS.map((month, i) => ({
    month,
    // ⚠ `null`, nicht 0: ein Nullbalken sähe aus wie „gemessen, kostet nichts". Recharts zeichnet
    // an dieser Stelle nichts — der Monat bleibt sichtbar leer, und das ist die Aussage.
    currentTariffEur: comparison.currentTariffEur?.[i] ?? null,
    spotWithoutControlEur: comparison.spotWithoutControlEur[i] ?? null,
    controlledEur: controlled?.[i] ?? null,
  }))

  return {
    rows,
    totals: {
      // Ohne Reihe nie angezeigt (`hasCurrent`); die 0 füllt nur den Record.
      currentTariffEur: comparison.currentTariffEur ? sumCovered(comparison.currentTariffEur) : 0,
      spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
      controlledEur: controlledEur ?? 0,
    },
    hasControlled: controlled != null,
    hasCurrent: comparison.currentTariffEur !== null,
  }
}

/**
 * ⚠ Die Reihen kommen HEREIN und werden nicht neben dem Chart ein zweites Mal gebildet: eine
 * eigene Liste im Tooltip zeigte beim nächsten Umformulieren eine andere Beschriftung als die
 * Legende daneben.
 */
function MonthTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number | null }>
  label?: string
  series?: readonly (typeof SERIES)[number][]
}) {
  if (!active || !payload || payload.length === 0 || !series) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {series.map((s) => {
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
 * ⚠ DIE DEFINITION IST MIT B23c-1 NACH `packages/shared` (`real-saving.ts`) GEWANDERT, weil ein
 * VIERTER Konsument dazugekommen ist: die Executive Summary des PDF-Reports. Der liegt in einem
 * eigenen Lazy-Chunk und darf diese Datei nicht importieren — sie zieht Recharts, und eine
 * Chart-Bibliothek im PDF-Weg wäre Fracht für etwas, das gar nicht zeichnet.
 *
 * Hier steht der Name weiterhin, damit die drei bestehenden Konsumenten (die Legende unten,
 * `recommendation-card.tsx`, `tariff-optimization-card.tsx`) unverändert bleiben — sie sind auf
 * derselben Seite wie dieser Chart, und ein Import aus dem Nachbarmodul ist dort die kürzere
 * Aussage. Beim Cutover, wenn die Bildschirm-Karten ohnehin angefasst werden, ziehen sie direkt
 * auf `shared` um und diese Zeile fällt weg.
 */
export { sumCovered }

export function MonthlyTariffChart({
  comparison,
  isExisting,
  storageNote = null,
}: {
  comparison: MonthlyTariffComparison
  /** Fährt die dritte Reihe die Anlage des Kunden oder die Empfehlung? Entscheidet nur den Wortlaut. */
  isExisting: boolean
  /**
   * Gerät, Investition und Urteil zur Speicherreihe (`catalogStorageNote`). Im PDF-Raster bleibt er
   * weg — dort steht er in der Bildunterschrift (`detail.ts`).
   */
  storageNote?: string | null
}) {
  /* Eigene Kennung je Instanz — zwei Charts auf einem Blatt teilten sonst ein `<pattern>`. */
  const modelPatternId = useId()
  const whose = monthlyBatteryRef(isExisting)
  const gross = displayedPriceBasis(comparison) === 'gross'
  const fixed = comparison.fixedCosts
  const { rows, totals, hasControlled, hasCurrent } = monthlyChartData(comparison)
  const series = SERIES.filter(
    (s) =>
      (hasControlled || s.key !== 'controlledEur') && (hasCurrent || s.key !== 'currentTariffEur'),
  )

  return (
    <div
      className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid"
      data-testid="monatsvergleich-awattar"
    >
      <p className="mb-1 text-sm font-medium text-ink">Das zahlen Sie jetzt vs. mit aWATTar</p>
      <p className="mb-3 text-xs text-text-muted">
        Energie- und Netzkosten je Monat, inklusive Grundgebühren — Ihr Tarif, aWATTar ohne
        Steuerung und {CONTROLLED_WAY_LABEL}. Alle Beträge {vatNote(comparison)}.
      </p>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {/*
                Die Schraffur der Modell-Reihe. `patternUnits="userSpaceOnUse"` statt
                `objectBoundingBox`: die Streifen sollen über alle zwölf Balken DENSELBE Neigung
                und Breite haben — an der Balkenhöhe ausgerichtet liefe ein niedriger Monat mit
                anderem Muster als ein hoher, und das Muster sähe aus wie eine zweite Aussage.
              */}
              <pattern id={modelPatternId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="5" height="5" fill={CHART_COLORS.series} />
                <line x1="0" y1="0" x2="0" y2="5" stroke={CHART_COLORS.modelTint} strokeWidth="2" />
              </pattern>
            </defs>
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
            <Tooltip content={<MonthTooltip series={series} />} isAnimationActive={false} cursor={false} />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={'model' in s && s.model ? `url(#${modelPatternId})` : s.color}
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
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={
                'model' in s && s.model
                  ? {
                      backgroundColor: s.color,
                      backgroundImage: `repeating-linear-gradient(45deg, ${CHART_COLORS.modelTint} 0 2px, transparent 2px 5px)`,
                    }
                  : { backgroundColor: s.color }
              }
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
        {hasControlled && storageNote && <span className="mt-1 text-ink">{storageNote}</span>}
        <span className="mt-1">Alle Beträge {vatNote(comparison)}.</span>
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
            muss mehr als eine bezogen werden. Die Reihe „mit {whose}" trägt diesen Mehrbezug.
          </li>
          {fixed.networkBaseFeeEur > 0 && (
            <li>
              <strong>Netz-Grundpreis</strong> (Jahrespauschale), anteilig für{' '}
              <Num>{fixed.coveredDays}</Num> gemessene Tage:{' '}
              <Num className="text-ink">{formatEur2(fixed.networkBaseFeeEur)}</Num> — in allen drei
              Reihen gleich hoch, er verschiebt den Vergleich also nicht.
            </li>
          )}
          {fixed.meteringFeeEur > 0 && (
            <li>
              <strong>Messpreis</strong> Ihres Netzbetreibers, anteilig:{' '}
              <Num className="text-ink">{formatEur2(fixed.meteringFeeEur)}</Num> — ebenfalls in
              allen drei Reihen, der Zähler hängt am Anschluss.
            </li>
          )}
          <li>
            <strong>Abgaben auf den Bezug</strong>: Elektrizitätsabgabe und EAG-Förderbeitrag je
            Kilowattstunde, die EAG-Pauschale anteilig mit{' '}
            <Num className="text-ink">{formatEur2(fixed.eagFlatFeeEur)}</Num> — unabhängig vom
            Lieferanten und deshalb in allen drei Reihen gleich hoch. Dazu, wo sie anfällt, die
            Gebrauchsabgabe auf Netz- und Energiepreis samt Grundgebühren; sie folgt dem
            Energiepreis der jeweiligen Reihe.
          </li>
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
            <Num className="text-ink">{formatEur2(fixed.awattarFeeEurPerMonth)}</Num>/Monat (
            {gross ? VAT_INCLUSIVE_LABEL : 'netto'}), anteilig{' '}
            <Num className="text-ink">{formatEur2(fixed.awattarBaseFeeEur)}</Num> — nur in den
            beiden aWATTar-Reihen.
          </li>
          <li>
            <strong>Nicht</strong> eingerechnet: der Leistungspreis (€/kW·Jahr) — er bleibt die
            Jahreszahl weiter oben im Report;{' '}
            {gross
              ? `Wechsel- oder Vertragskosten. Gerechnet wird netto, gezeigt ${VAT_INCLUSIVE_LABEL}.`
              : 'Umsatzsteuer — gerechnet wird durchgängig netto; Wechsel- oder Vertragskosten.'}
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
          Versprechen für die Zukunft.{' '}
          {/* Derselbe Abgleich wie im Methodik-Kapitel (`methodologyItemsFor`): die Reihe entscheidet den Wortlaut. */}
          {comparison.spotWithPredictiveControlEur != null ? (
            <>
              Die Ladesteuerung des Speichers plant dabei jeweils am Vorabend mit einer
              Verbrauchserwartung aus Ihrer eigenen Verbrauchshistorie; ausgeführt wird trotzdem auf
              Ihrem echten Lastgang. Ihren tatsächlichen Verbrauch des nächsten Tages kennt sie
              also nicht im Voraus.
            </>
          ) : (
            <>
              Die Ladesteuerung des Speichers folgt dabei einer einfachen Schwellenregel und ist
              noch nicht gegen ein rechnerisches Optimum geprüft:{' '}
              <strong>die Zahl gilt als vorläufige Untergrenze</strong>, mit besserer Steuerung
              eher mehr als weniger.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
