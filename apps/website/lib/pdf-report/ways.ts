import type { MonthlyTariffComparison } from 'shared'

import { formatEur } from '@/lib/format'
import { monthlyBatteryRef } from '@/lib/report-copy'
import type { ReportFigure, ReportStatement } from './statement'
import { primaryEntryOf, summaryWaysOf, type SummaryWay, type SummaryWays } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * D7 — das Kapitel „… Wege zu weniger Stromkosten", zwischen „Ihr Lastgang" und „Empfehlung und
 * Wirtschaftlichkeit".
 *
 * ── ⚠ FÜNF MÖGLICHE WEGE, UND JEDER STEHT NUR DA, WENN ER FÜR DIESEN KUNDEN ZUTRIFFT ──────────
 * (D7-Revision, Andreas, 21.09.2026 — sie ersetzt den MVP-Scope „zwei Wege" vom 16.09.2026.)
 *   1. Ihr Tarif heute — die BEZUGSGRÖSSE. Immer da, wenn es das Kapitel gibt.
 *   2. Der selbst gefundene Vergleichstarif — nur, wenn der Kunde in der Tarif-Station einen
 *      angegeben hat UND er netto hinterlegt ist (`comparisonTariffEur`).
 *   3. aWATTar ohne Ladesteuerung — immer.
 *   4. aWATTar mit Ladesteuerung — immer; VORAUSSCHAUEND, sobald die Engine das rechnen konnte,
 *      sonst die einfache Tagesmittel-Regel. Welche der beiden, sagt der Absatz selbst.
 *   5. Lastspitzenkappung — nur, wenn der Speicher den abgerechneten Leistungswert wirklich senkt
 *      (`leistungspreisSavingPerYear > 0`; darin stecken alle `peakShavingBlockers`, u. a.
 *      `controlType: 'static'` und „Tarif ohne Leistungspreis").
 *
 * ── ⚠ WEG 5 IST KEIN BALKEN, UND DAS IST KEINE DARSTELLUNGSFRAGE ──────────────────────────────
 * Die Balken sind KOSTEN über den gemessenen Zeitraum; Weg 5 ist eine ERSPARNIS pro Jahr aus dem
 * Leistungspreis, den der Monatsvergleich ausdrücklich nicht führt (`monthly-tariff-comparison.ts`).
 * Als fünfter Balken stünde er in einer anderen Einheit und über einem anderen Zeitraum in
 * derselben Achse. Er ist deshalb ein Absatz mit eigener Bezugsangabe — und er bleibt aus
 * demselben Grund ausserhalb der Kern-Spanne der Zusammenfassung (D8; s. `summaryWaysOf`).
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — dieselbe Regel wie überall sonst in
 * diesem Verzeichnis (s. `summary.ts`). Gerendert wird in `document.tsx`.
 *
 * ── ⚠ KEINE ZAHL WIRD HIER NEU GERECHNET ───────────────────────────────────────────────────────
 * Jeder Balken und jeder Betrag kommt aus `summaryWaysOf(...)` — derselben Ableitung, aus der auch
 * die Spanne der Zusammenfassung entsteht. Ein zweiter Rechenweg für eine dieser Zahlen liefe
 * irgendwann von ihr weg (#295). Weg 5 kommt aus `primaryEntryOf(...).leistungspreisSavingPerYear`,
 * der bereits validierten §3.7-Zuschreibung — auch das ist keine neue Rechnung.
 */

/** Ein Balken: ein Weg und seine Kosten über den gemessenen Zeitraum. */
export type WaysBar = {
  /** Stabiler Schlüssel für die Zeichnung (React-`key`, Farbwahl). */
  key: 'today' | 'comparison' | 'uncontrolled' | 'controlled'
  label: string
  eur: number
  /** Unterstellt dieser Balken eine Steuerung, die so noch nicht läuft? (Schraffur, D15 Block 2.) */
  model: boolean
}

export type WaysChapter = {
  bars: WaysBar[]
  /** Wie viele Wege das Kapitel FÜHRT — inklusive Weg 1 und, wenn er dasteht, Weg 5. */
  wayCount: number
  figure: ReportFigure
  /** Die Absätze in Dokumentreihenfolge. Ein Weg, der nicht zutrifft, hat hier keinen Eintrag. */
  statements: ReportStatement[]
}

function monthlyComparisonOf(analysis: PdfReportAnalysis): MonthlyTariffComparison | undefined {
  return analysis.tariffOptimization?.computable === true
    ? analysis.tariffOptimization.monthlyComparison
    : undefined
}

/**
 * Gibt es dieses Kapitel in diesem Dokument?
 *
 * ⚠ Dieselbe Bedingung wie die Spanne der Zusammenfassung (`summaryWaysOf`): ohne Monatsvergleich
 * gibt es weder die eine noch die Zahlen, aus denen dieses Kapitel besteht.
 */
export function hasWaysChapter(analysis: PdfReportAnalysis): boolean {
  return summaryWaysOf(analysis) !== null
}

/**
 * Wie viele Wege dieses Dokument führt — gebildet, OHNE das Kapitel zu bauen.
 *
 * ⚠ Agenda und Kapitelüberschrift müssen dieselbe Zahl nennen; sie entsteht deshalb an genau einer
 * Stelle und wird von beiden gelesen (dasselbe Muster wie `context.hasWays`).
 */
export function waysCountOf(analysis: PdfReportAnalysis): number {
  const ways = summaryWaysOf(analysis)
  if (!ways) return 0
  return 1 + ways.ways.length + (peakShavingSavingOf(analysis) > 0 ? 1 : 0)
}

/**
 * Weg 5 — was die Spitzenkappung im Jahr bringt. `0` heisst „dieser Weg trifft nicht zu".
 *
 * ⚠ Die Zahl beantwortet BEIDE Bedingungen aus dem Auftrag auf einmal: sie ist genau dann > 0,
 * wenn es einen Leistungspreis gibt UND der Speicher den abgerechneten Wert senkt. Alle Gründe,
 * aus denen sie 0 wird, stehen in `peakShavingBlockers` (`static_control`, `standard_profile`,
 * `estimated_pv`, `no_demand_charge`) — eine eigene Prüfung hier wäre eine zweite Auslegung
 * derselben Frage.
 */
function peakShavingSavingOf(analysis: PdfReportAnalysis): number {
  return primaryEntryOf(analysis)?.leistungspreisSavingPerYear ?? 0
}

const wayById = (ways: SummaryWays, id: SummaryWay['id']): SummaryWay | undefined =>
  ways.ways.find((way) => way.id === id)

/**
 * Der Hinweis zur vorausschauenden Ladesteuerung.
 *
 * ⚠ [ENTWURF — ANDREAS prüft den Wortlaut beim Testgate.] Die Zahl darüber beruht auf einer
 * PROGNOSE aus der eigenen Historie des Kunden und ist nicht live validiert
 * (`PREDICTIVE_CONTROL_VALUE_BASIS = 'foresight_unvalidated'`). Der Marker bleibt intern; hier
 * steht, was ein Kunde davon wissen muss.
 *
 * ⚠ `realizationRatio` steht bewusst NICHT im Kundenreport — nur der Euro-Wert und dieser Satz.
 */
const PREDICTIVE_NOTE =
  'Diese Zahl ist eine Vorausberechnung, keine Zusage: der Speicher plant seinen Tag am Vorabend ' +
  'mit den dann bekannten Börsenpreisen und einer Verbrauchserwartung aus Ihren eigenen ' +
  'Messwerten — nicht mit dem Wissen, was der Tag tatsächlich bringen wird. Weicht Ihr Verbrauch ' +
  'von dieser Erwartung ab, fällt das Ergebnis entsprechend anders aus.'

export function buildWaysChapter(analysis: PdfReportAnalysis): WaysChapter | null {
  const comparison = monthlyComparisonOf(analysis)
  const ways = summaryWaysOf(analysis)
  if (!comparison || !ways) return null

  const isExisting = analysis.existingBatteryAnalysis != null
  const whose = monthlyBatteryRef(isExisting)
  const days = String(ways.coveredDays)

  const comparisonWay = wayById(ways, 'comparison_tariff')
  const switchWay = wayById(ways, 'tariff_switch')!
  const controlWay = wayById(ways, 'controlled')!
  const peakSavingPerYear = peakShavingSavingOf(analysis)

  /* Weg 1 ist der erste Balken und der erste Absatz — nicht mehr nur die Kopfzahl in Kapitel 1. */
  const bars: WaysBar[] = [
    { key: 'today', label: 'Ihr Tarif heute', eur: ways.costTodayEur, model: false },
  ]
  if (comparisonWay) {
    bars.push({
      key: 'comparison',
      label: ways.comparisonSupplier ?? 'Ihr Vergleichstarif',
      eur: comparisonWay.costEur,
      model: false,
    })
  }
  bars.push(
    { key: 'uncontrolled', label: 'aWATTar ohne Steuerung', eur: switchWay.costEur, model: false },
    { key: 'controlled', label: `aWATTar mit ${whose}`, eur: controlWay.costEur, model: true },
  )

  /** „X gespart" bzw. „X MEHR gekostet" — ein Weg mit negativer Ersparnis senkt nichts. */
  const outcome = (way: SummaryWay, more: string, less: string): string =>
    way.eur > 0 ? `${formatEur(way.eur)} ${less}` : `${formatEur(Math.abs(way.eur))} ${more}`

  const statements: ReportStatement[] = [
    {
      id: 'ways_current',
      title: 'Ihr Tarif heute',
      amount: null,
      rows: [],
      body:
        `Die Bezugsgrösse für alles Weitere: mit Ihrem heutigen Vertrag haben Sie über die ${days} ` +
        `gemessenen Tage ${formatEur(ways.costTodayEur)} für Energie, Netz und Abgaben gezahlt. ` +
        'Jeder der folgenden Wege wird gegen genau diesen Betrag gerechnet — mit demselben ' +
        'Lastgang, denselben Netzentgelten und denselben gesetzlichen Abgaben.',
    },
  ]

  if (comparisonWay) {
    statements.push({
      id: 'ways_comparison_tariff',
      title: ways.comparisonSupplier
        ? `Ihr Vergleichstarif (${ways.comparisonSupplier})`
        : 'Ihr Vergleichstarif',
      amount: null,
      rows: [],
      body:
        'Der Tarif, den Sie selbst gefunden und uns genannt haben. Gerechnet wird er mit demselben ' +
        'Lastgang wie Ihr heutiger Vertrag; getauscht sind ausschliesslich der Arbeitspreis und ' +
        'die Grundgebühr des Lieferanten — Netzentgelt, Messpreis und Abgaben bleiben, was sie ' +
        `sind. Über die ${days} gemessenen Tage hätte das ` +
        outcome(comparisonWay, 'MEHR gekostet als Ihr heutiger Tarif.', 'weniger gekostet.') +
        ' Ein Festpreistarif bewegt sich über den Tag nicht, Ihr Speicher kann gegen ihn also ' +
        'nicht steuern: dieser Weg ist unabhängig davon, ob Sie einen Speicher haben.',
    })
  }

  statements.push({
    id: 'ways_tariff_switch',
    title: 'aWATTar ohne Steuerung',
    amount: null,
    rows: [],
    body:
      'Der einfachste Weg mit Börsenpreis: derselbe Lastgang wie heute, aber zum Börsenpreis von ' +
      'aWATTar statt zu Ihrem festen Arbeitspreis — ohne jede Umstellung an Speicher oder ' +
      `Verbrauch. Über die ${days} gemessenen Tage hätte das ` +
      outcome(switchWay, 'MEHR gekostet als Ihr heutiger Tarif, nicht weniger.', 'weniger gekostet.'),
  })

  statements.push({
    id: 'ways_load_control',
    title: `aWATTar mit ${whose}`,
    amount: null,
    rows: [],
    body:
      `Zusätzlich zum Tarifwechsel wird mit ${whose} gezielt geladen: in den günstigen ` +
      'Viertelstunden lädt der Speicher aus dem Netz, während er Kapazität für die teureren ' +
      'Stunden desselben Tages zurückhält — der Schutz Ihrer Lastspitzen hat dabei weiterhin ' +
      'Vorrang. Über denselben Zeitraum hätte das, Tarifwechsel und Ladesteuerung zusammen, ' +
      outcome(controlWay, 'mehr gekostet als Ihr heutiger Tarif.', 'gespart.') +
      (ways.controlVariant === 'predictive' ? ` ${PREDICTIVE_NOTE}` : ''),
  })

  if (peakSavingPerYear > 0) {
    statements.push({
      id: 'ways_peak_shaving',
      title: 'Kappung Ihrer Lastspitzen',
      amount: null,
      rows: [],
      /*
       * ⚠ `whose` ist eine DATIV-Fügung („Ihrem Speicher" / „der empfohlenen Batterie",
       * `monthlyBatteryRef`) und trägt deshalb nur nach „mit" — als Satzsubjekt ergäbe sie
       * „der empfohlenen Batterie senkt…". Am erzeugten PDF gemessen, nicht vermutet.
       */
      body:
        'Ein Weg, der unabhängig von Ihrem Stromvertrag wirkt: Sie senken mit ' +
        `${whose} den abgerechneten Leistungswert, mit dem Ihr Netzbetreiber den Leistungspreis ` +
        `verrechnet. Das bringt ${formatEur(peakSavingPerYear)} pro Jahr. ` +
        'Diese Zahl ist eine JAHRESgrösse und bezieht sich damit auf einen anderen Zeitraum als ' +
        `die ${days} Tage der Balken darüber — sie wird deshalb nicht zu ihnen addiert und steht ` +
        'auch nicht in der Ersparnis-Spanne der Zusammenfassung. Sie kommt zu dem Weg, für den ' +
        'Sie sich beim Stromvertrag entscheiden, hinzu.',
    })
  }

  const wayCount = 1 + ways.ways.length + (peakSavingPerYear > 0 ? 1 : 0)

  return {
    bars,
    wayCount,
    figure: {
      caption:
        `Was Sie über die ${days} gemessenen Tage tatsächlich gezahlt hätten — je Weg ein Balken. ` +
        (peakSavingPerYear > 0
          ? 'Die Kappung Ihrer Lastspitzen ist hier NICHT enthalten (Jahresgrösse, s. unten). '
          : '') +
        /* Kein `⚠` in Kundentext: die Report-Schrift trägt das Zeichen nicht, es verschwindet
           beim Rendern spurlos (am erzeugten PDF gemessen). */
        'Alle Beträge exkl. MwSt.',
      note: null,
    },
    statements,
  }
}
