import { displayedPriceLabel } from 'shared'
import type { MonthlyTariffComparison } from 'shared'

import { formatEur } from '@/lib/format'
import { CONTROLLED_WAY_LABEL, monthlyBatteryRef } from '@/lib/report-copy'
import type { ReportFigure, ReportStatement } from './statement'
import {
  primaryEntryOf,
  summaryWaysOf,
  unknownTariffWaysOf,
  type SummaryWay,
  type SummaryWays,
  type UnknownTariffWays,
} from './summary'
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

/**
 * Was an EINEM Weg anders gerechnet ist — die Kurzfassung für das Schlusskapitel
 * („Berechnungsmethodik je Kennzahl", `basis.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE STEHT HIER UND NICHT IM SCHLUSSKAPITEL, UND DAS IST DER GANZE PUNKT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Methodik-Liste führte bis hierher fest verdrahtete Absätze zu drei Wegen — der
 * Vergleichstarif und die Spitzenkappung kamen darin gar nicht vor, obwohl das Kapitel sie zeigt,
 * und die vorausschauende Fassung von Weg 4 war nirgends erwähnt. Ein Weg mehr im Kapitel hiess:
 * daran denken, an einer ganz anderen Stelle einen Absatz nachzutragen. Genau diese Fehlerklasse
 * schliesst sich, indem die Erklärung dort entsteht, wo der Weg selbst entsteht: `addWay` legt
 * Absatz UND Erklärung gemeinsam an, und das Schlusskapitel liest nur noch die Liste.
 *
 * ⚠ `id` und `title` werden NICHT eigens gesetzt — sie kommen aus dem Absatz des Wegs. Zwei
 * getrennt gepflegte Titel ergäben ein Dokument, in dem die Methodik einen Weg anders benennt als
 * das Kapitel, in dem er steht; der Leser fände ihn dann nicht wieder.
 */
export type WayMethodNote = {
  /** Die Kennung des Absatzes, zu dem diese Erklärung gehört (`ReportStatement.id`). */
  id: string
  /** Wortgleich der Titel jenes Absatzes. */
  title: string
  /** NUR, was an diesem Weg anders ist — die gemeinsame Rechnung steht einmal darüber. */
  body: string
  /**
   * `true` = dieser Weg ist KEINE Viertelstunden-Grösse und gehört nicht in dieselbe Aufzählung
   * wie die übrigen (heute allein die Spitzenkappung: eine Jahresgrösse aus dem Leistungspreis).
   * Der Renderer setzt ihn deshalb als eigenen Absatz statt als Listenzeile.
   */
  aside: boolean
}

export type WaysChapter = {
  bars: WaysBar[]
  /**
   * Die Bezugsgrösse der Balken, für den Achsentitel des Diagramms.
   *
   * ⚠ Sie steht hier und wird NICHT in der Chart-Komponente neu gebildet: der Achsentitel und die
   * Bildunterschrift darunter müssen dieselbe Zahl nennen, und die kommt aus dem Contract
   * (`dataQuality.coveredDays` über `summaryWaysOf`).
   */
  coveredDays: number
  /** Wie viele Wege das Kapitel FÜHRT — inklusive Weg 1 und, wenn er dasteht, Weg 5. */
  wayCount: number
  /** Ersetzt den Vorspann des Kapitels; `null` = der übliche (`WAYS_INTRO`). */
  intro: string | null
  figure: ReportFigure
  /** Die Absätze in Dokumentreihenfolge. Ein Weg, der nicht zutrifft, hat hier keinen Eintrag. */
  statements: ReportStatement[]
  /**
   * Je Absatz darüber genau eine Kurzerklärung, in derselben Reihenfolge — s. `WayMethodNote`.
   *
   * ⚠ DIE LÄNGEN SIND IMMER GLEICH, und zwar bauartbedingt: beide Listen entstehen ausschliesslich
   * über `addWay`.
   */
  methodNotes: WayMethodNote[]
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
  return summaryWaysOf(analysis) !== null || unknownTariffWaysOf(analysis) !== null
}

/**
 * Wie viele Wege dieses Dokument führt — gebildet, OHNE das Kapitel zu bauen.
 *
 * ⚠ Agenda und Kapitelüberschrift müssen dieselbe Zahl nennen; sie entsteht deshalb an genau einer
 * Stelle und wird von beiden gelesen (dasselbe Muster wie `context.hasWays`).
 */
export function waysCountOf(analysis: PdfReportAnalysis): number {
  const peak = peakShavingSavingOf(analysis) > 0 ? 1 : 0
  const ways = summaryWaysOf(analysis)
  if (!ways) {
    const unknown = unknownTariffWaysOf(analysis)
    if (!unknown) return 0
    return (unknown.baseline ? 1 : 0) + 1 + (unknown.controlledEur !== null ? 1 : 0) + peak
  }
  return 1 + ways.ways.length + peak
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
export function peakShavingSavingOf(analysis: PdfReportAnalysis): number {
  return primaryEntryOf(analysis)?.leistungspreisSavingPerYear ?? 0
}

const wayById = (ways: SummaryWays, id: SummaryWay['id']): SummaryWay | undefined =>
  ways.ways.find((way) => way.id === id)

/**
 * Die Beschriftung von Weg 5.
 *
 * ⚠ Exportiert, weil das Jahres-Kapitel (D6 Teil 3) denselben Weg in seinem Ersparnis-Kasten
 * führt. Derselbe Gegenstand mit zwei Beschriftungen in einem Dokument ist genau der Fehler, den
 * `CONTROLLED_WAY_LABEL` für Weg 4 bereits behoben hat.
 */
export const PEAK_SHAVING_WAY_LABEL = 'Kappung Ihrer Lastspitzen'

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

/**
 * Weg 4 in Kurzfassung — Fundstellen `cheapAgainstDailyMean` (`tou.ts`), `dailyPriceOrder`
 * (`daily-price-order.ts`) und `runCombinedDispatch` (`dispatch.ts`).
 *
 * ⚠ „MITTEL" UND NICHT „MEDIAN", und das ist der Satz, auf den es ankommt: die Schwelle ist das
 * arithmetische Mittel der Intervallpreise des jeweiligen LOKALEN Kalendertags. Ein Median stünde
 * bei einer schiefen Preiskurve woanders und markierte andere Stunden als günstig — eine hier
 * hingeschriebene Verwechslung beschriebe eine Steuerung, die so nie gefahren wurde.
 *
 * ⚠ Gekürzt ist gegenüber der früheren Fassung ausschliesslich das, was jetzt EINMAL im
 * gemeinsamen Absatz steht. Keine der drei Regeln (Tagesschwelle, die zwei Rückhalte-Schranken,
 * Vorrang des Spitzenschutzes) ist weggefallen.
 */
const LOAD_CONTROL_METHOD =
  'wie der Weg davor, aber auf dem simulierten Lastgang. Eine Viertelstunde gilt als günstig, wenn ' +
  'ihr Preis unter dem arithmetischen Mittel aller Viertelstundenpreise ihres eigenen ' +
  'Kalendertags liegt (Ortszeit, je Tag neu gebildet) — dann lädt der Speicher aus dem Netz. Bis ' +
  'zum Tagesende bleibt Kapazität für eine später noch günstigere Stunde frei und Energie für ' +
  'eine später noch teurere liegen. Daraus entsteht ein einziger, chronologischer Fahrplan mit ' +
  'mitgeführtem Ladezustand und Wirkungsgradverlust; der Spitzenschutz hat darin immer Vorrang ' +
  'vor dem Preis. Eine Faustregel je Viertelstunde, keine Zusicherung für den einzelnen Tag.'

/**
 * Der Zusatz, wenn Weg 4 die VORAUSSCHAUENDE Fassung trägt.
 *
 * ⚠ ER FEHLTE IN DER FRÜHEREN METHODIK-LISTE VOLLSTÄNDIG, obwohl der Absatz im Kapitel davor den
 * Kunden ausdrücklich darauf hinweist (`PREDICTIVE_NOTE`). Eine Methodik, die den Rückblick
 * beschreibt, während die Zahl aus einer Prognose stammt, ist genau die Sorte Erklärung, die wie
 * eine Erklärung aussieht und eine andere Rechnung beschreibt.
 *
 * ⚠ Getauscht ist allein die VERBRAUCHSERWARTUNG der Tages-Rangfolge; ausgeführt wird auf dem
 * echten Lastgang, und die Spitzenschutz-Schranken kommen weiterhin aus einem Rückblick-Lauf.
 */
const PREDICTIVE_METHOD =
  'Die Tages-Rangfolge sieht dabei nicht Ihren gemessenen Verbrauch, sondern eine Erwartung aus ' +
  'Ihren eigenen früheren Messwerten; ausgeführt wird der Fahrplan trotzdem auf dem echten ' +
  'Lastgang, und die Schranken des Spitzenschutzes kommen weiterhin aus einem Rückblick.'

/**
 * Weg 5 in Kurzfassung — und er ist der einzige Eintrag mit `aside: true`.
 *
 * ⚠ ER DARF NICHT IN DIE AUFZÄHLUNG DER ÜBRIGEN: die stehen alle für dieselbe
 * Viertelstunden-Rechnung mit je einem getauschten Stück. Diese Zahl entsteht aus einer ganz
 * anderen Grösse (dem abgerechneten kW-Wert) und über einen anderen Bezugszeitraum (ein Jahr).
 * Als weitere Zeile derselben Liste läse sie sich wie ein vierter Tarif.
 */
const PEAK_SHAVING_METHOD =
  'Diese Zahl entsteht nicht aus der Viertelstunden-Rechnung oben. Der Leistungspreis hängt am ' +
  'abgerechneten Leistungswert in kW und wird pro JAHR verrechnet; gerechnet wird, um wie viel ' +
  'der simulierte Fahrplan diesen Wert senkt, mal dem Satz Ihres Netzbetreibers — samt der ' +
  'Gebrauchsabgabe darauf, wo sie anfällt, denn mit dem Leistungspreis sinkt auch sie. Der abgerechnete ' +
  'Wert folgt dem Abrechnungsmodell Ihres Netzbetreibers und wird von der Mindestleistung nach ' +
  'unten begrenzt. Als Jahresgrösse gehört er zu keinem der Beträge darüber dazu.'

export function buildWaysChapter(analysis: PdfReportAnalysis): WaysChapter | null {
  const comparison = monthlyComparisonOf(analysis)
  if (!comparison) return null
  const ways = summaryWaysOf(analysis)
  if (!ways) {
    const unknown = unknownTariffWaysOf(analysis)
    return unknown ? buildUnknownTariffWaysChapter(analysis, unknown) : null
  }

  const isExisting = analysis.existingBatteryAnalysis != null
  const whose = monthlyBatteryRef(isExisting)
  const days = String(ways.coveredDays)

  const comparisonWay = wayById(ways, 'comparison_tariff')
  const switchWay = wayById(ways, 'tariff_switch')!
  /* K3b-2: `undefined`, wenn ohne Speicher gerechnet wurde — dann gibt es Weg 4 nicht, weder als
     Balken noch als Absatz. `waysCountOf` zählt ihn aus derselben Liste und ist damit schon mit. */
  const controlWay = wayById(ways, 'controlled')
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
  bars.push({
    key: 'uncontrolled',
    label: 'aWATTar ohne Steuerung',
    eur: switchWay.costEur,
    model: false,
  })
  if (controlWay) {
    bars.push({
      key: 'controlled',
      label: CONTROLLED_WAY_LABEL,
      eur: controlWay.costEur,
      model: true,
    })
  }

  /** „X gespart" bzw. „X MEHR gekostet" — ein Weg mit negativer Ersparnis senkt nichts. */
  const outcome = (way: SummaryWay, more: string, less: string): string =>
    way.eur > 0 ? `${formatEur(way.eur)} ${less}` : `${formatEur(Math.abs(way.eur))} ${more}`

  const statements: ReportStatement[] = []
  const methodNotes: WayMethodNote[] = []

  /*
   * ⚠ DER EINZIGE WEG, EINEN WEG ANZULEGEN — und das ist die Zusage, von der das Schlusskapitel
   * lebt (s. `WayMethodNote`): Absatz und Kurzerklärung entstehen in EINEM Aufruf, Kennung und
   * Titel der Erklärung kommen aus dem Absatz selbst. Ein Weg, der künftig dazukommt, bringt seine
   * Methodik damit mit, ohne dass irgendwo sonst eine Liste nachgezogen werden muss.
   */
  const addWay = (statement: ReportStatement, method: string, aside = false): void => {
    statements.push(statement)
    methodNotes.push({ id: statement.id, title: statement.title, body: method, aside })
  }

  addWay(
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
    /* ⚠ Kein Gedankenstrich am Satzanfang: der Renderer setzt bereits einen zwischen Titel und
       Text, und zwei hintereinander lasen sich im erzeugten PDF wie ein Einschub. */
    'die Bezugsgrösse. Gerechnet mit Ihrem festen Arbeitspreis und der Grundgebühr Ihres ' +
      'Lieferanten, auf dem gemessenen Lastgang.',
  )

  if (comparisonWay) {
    addWay({
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
        outcome(comparisonWay, 'mehr gekostet als Ihr heutiger Tarif.', 'weniger gekostet.') +
        ' Ein Festpreistarif bewegt sich über den Tag nicht, Ihr Speicher kann gegen ihn also ' +
        'nicht steuern: dieser Weg ist unabhängig davon, ob Sie einen Speicher haben.',
    },
    'getauscht sind allein Arbeitspreis und Grundgebühr des Lieferanten; Netzseite, Abgaben und ' +
      'Lastgang bleiben bit-genau dieselben.',
    )
  }

  addWay({
    id: 'ways_tariff_switch',
    title: 'aWATTar ohne Steuerung',
    amount: null,
    rows: [],
    body:
      'Der einfachste Weg mit Börsenpreis: derselbe Lastgang wie heute, aber zum Börsenpreis von ' +
      'aWATTar statt zu Ihrem festen Arbeitspreis — ohne jede Umstellung an Speicher oder ' +
      `Verbrauch. Über die ${days} gemessenen Tage hätte das ` +
      outcome(switchWay, 'mehr gekostet als Ihr heutiger Tarif, nicht weniger.', 'weniger gekostet.'),
    },
    'statt Ihres festen Arbeitspreises der Börsenpreis der jeweiligen Stunde, statt Ihrer ' +
      'Grundgebühr die von aWATTar. Die Netzseite hängt am Anschluss und nicht am Lieferanten und ' +
      'bleibt unverändert. Gerechnet auf dem rohen Lastgang: nichts wird verschoben, nichts ' +
      'gespeichert. Die verwendeten aWATTar-Preise sind die echten, historischen Stundenpreise ' +
      'genau dieses Zeitraums — keine Prognose und kein Durchschnittswert.',
  )

  if (controlWay) {
    addWay({
      id: 'ways_load_control',
      title: CONTROLLED_WAY_LABEL,
      amount: null,
      rows: [],
      body:
        `Zusätzlich zum Tarifwechsel wird mit ${whose} gezielt geladen: in den günstigen ` +
        'Viertelstunden lädt der Speicher aus dem Netz, während er Kapazität für die teureren ' +
        'Stunden desselben Tages zurückhält — der Schutz Ihrer Lastspitzen hat dabei weiterhin ' +
        'Vorrang. Über denselben Zeitraum hätte das, Tarifwechsel und Ladesteuerung zusammen, ' +
        outcome(controlWay, 'mehr gekostet als Ihr heutiger Tarif.', 'gespart.') +
        (ways.controlVariant === 'predictive' ? ` ${PREDICTIVE_NOTE}` : ''),
      },
      LOAD_CONTROL_METHOD + (ways.controlVariant === 'predictive' ? ` ${PREDICTIVE_METHOD}` : ''),
    )
  }

  if (peakSavingPerYear > 0) {
    addWay({
      id: 'ways_peak_shaving',
      title: PEAK_SHAVING_WAY_LABEL,
      amount: null,
      rows: [],
      /*
       * ⚠ `whose` ist eine DATIV-Fügung („Ihrem Speicher" / „der empfohlenen Batterie",
       * `monthlyBatteryRef`) und trägt deshalb nur nach „mit" — als Satzsubjekt ergäbe sie
       * „der empfohlenen Batterie senkt…". Am erzeugten PDF gemessen, nicht vermutet.
       */
      body: peakShavingBody(whose, peakSavingPerYear, days, true),
    },
      PEAK_SHAVING_METHOD,
      true,
    )
  }

  const wayCount = 1 + ways.ways.length + (peakSavingPerYear > 0 ? 1 : 0)

  return {
    bars,
    coveredDays: ways.coveredDays,
    wayCount,
    intro: null,
    methodNotes,
    figure: {
      caption:
        `Was Sie über die ${days} gemessenen Tage tatsächlich gezahlt hätten — je Weg ein Balken. ` +
        (peakSavingPerYear > 0
          ? 'Die Kappung Ihrer Lastspitzen ist hier nicht enthalten (Jahresgrösse, s. unten). '
          : '') +
        /* Kein `⚠` in Kundentext: die Report-Schrift trägt das Zeichen nicht, es verschwindet
           beim Rendern spurlos (am erzeugten PDF gemessen). */
        `Alle Beträge ${displayedPriceLabel(analysis)}.`,
      note: null,
    },
    statements,
  }
}

/** Der Absatz zu Weg 5 — `inSummarySpan`: gibt es eine Ersparnis-Spanne, von der er sich abgrenzt? */
function peakShavingBody(
  whose: string,
  peakSavingPerYear: number,
  days: string,
  inSummarySpan: boolean,
): string {
  return (
    'Ein Weg, der unabhängig von Ihrem Stromvertrag wirkt: Sie senken mit ' +
    `${whose} den abgerechneten Leistungswert, mit dem Ihr Netzbetreiber den Leistungspreis ` +
    `verrechnet. Das bringt ${formatEur(peakSavingPerYear)} pro Jahr. ` +
    'Diese Zahl ist eine JAHRESgrösse und bezieht sich damit auf einen anderen Zeitraum als ' +
    `die ${days} Tage der Balken darüber — sie wird deshalb nicht zu ihnen addiert` +
    (inSummarySpan ? ' und steht auch nicht in der Ersparnis-Spanne der Zusammenfassung' : '') +
    '. Sie kommt zu dem Weg, für den Sie sich beim Stromvertrag entscheiden, hinzu.'
  )
}

/** Vorspann bei unbekanntem Liefertarif — `WAYS_INTRO` verspricht, was der Strom HEUTE kostet. */
const UNKNOWN_TARIFF_WAYS_INTRO =
  'Was Ihr Strom mit einem Börsenpreis-Tarif gekostet hätte — Ihren heutigen Tarif kennen wir ' +
  'noch nicht.'

const UNKNOWN_TARIFF_SWITCH_METHOD =
  'der Börsenpreis der jeweiligen Stunde und die Grundgebühr von aWATTar. Die Netzseite hängt am ' +
  'Anschluss und nicht am Lieferanten. Gerechnet auf dem rohen Lastgang: nichts wird verschoben, ' +
  'nichts gespeichert. Die verwendeten aWATTar-Preise sind die echten, historischen Stundenpreise ' +
  'genau dieses Zeitraums — keine Prognose und kein Durchschnittswert.'

/**
 * Das Wege-Kapitel bei unbekanntem Liefertarif (§3.1a).
 *
 * ⚠ OHNE WEG 1: „Ihr Tarif heute" gibt es nicht, weder als Balken noch als Absatz. Ersparnis wird
 * nur gegen einen erfassten Vergleichstarif ausgewiesen (`baseline`); ohne ihn stehen die Wege mit
 * absoluten Kosten da, und der Wert der Ladesteuerung ist die Differenz der beiden aWATTar-Wege.
 */
function buildUnknownTariffWaysChapter(
  analysis: PdfReportAnalysis,
  ways: UnknownTariffWays,
): WaysChapter {
  const whose = monthlyBatteryRef(analysis.existingBatteryAnalysis != null)
  const days = String(ways.coveredDays)
  const baseline = ways.baseline
  const peakSavingPerYear = peakShavingSavingOf(analysis)

  /** Gegenüber dem Vergleichstarif — leer ohne ihn. */
  const againstBaseline = (costEur: number): string => {
    if (!baseline) return ''
    const diff = baseline.eur - costEur
    return diff > 0
      ? ` Gegenüber Ihrem Vergleichstarif sind das ${formatEur(diff)} weniger.`
      : ` Gegenüber Ihrem Vergleichstarif sind das ${formatEur(Math.abs(diff))} mehr.`
  }

  const bars: WaysBar[] = []
  const statements: ReportStatement[] = []
  const methodNotes: WayMethodNote[] = []
  const addWay = (statement: ReportStatement, method: string, aside = false): void => {
    statements.push(statement)
    methodNotes.push({ id: statement.id, title: statement.title, body: method, aside })
  }

  if (baseline) {
    bars.push({
      key: 'comparison',
      label: baseline.supplier ?? 'Ihr Vergleichstarif',
      eur: baseline.eur,
      model: false,
    })
    addWay(
      {
        id: 'ways_comparison_tariff',
        title: baseline.supplier ? `Ihr Vergleichstarif (${baseline.supplier})` : 'Ihr Vergleichstarif',
        amount: null,
        rows: [],
        body:
          'Der Tarif, den Sie selbst gefunden und uns genannt haben. Ihren heutigen Tarif kennen wir ' +
          'nicht; dieser Tarif ist deshalb die Bezugsgrösse der folgenden Wege. Über die ' +
          `${days} gemessenen Tage hätte er ${formatEur(baseline.eur)} für Energie, Netz und ` +
          'Abgaben gekostet — mit demselben Lastgang, denselben Netzentgelten und denselben ' +
          'gesetzlichen Abgaben wie die übrigen Wege.',
      },
      'die Bezugsgrösse, solange Ihr heutiger Tarif nicht bekannt ist. Gerechnet mit Arbeitspreis ' +
        'und Grundgebühr des Vergleichstarifs, auf dem gemessenen Lastgang.',
    )
  }

  bars.push({ key: 'uncontrolled', label: 'aWATTar ohne Steuerung', eur: ways.uncontrolledEur, model: false })
  addWay(
    {
      id: 'ways_tariff_switch',
      title: 'aWATTar ohne Steuerung',
      amount: null,
      rows: [],
      body:
        'Der einfachste Weg mit Börsenpreis: Ihr gemessener Lastgang zum Börsenpreis von aWATTar, ' +
        `ohne jede Umstellung an Speicher oder Verbrauch. Über die ${days} gemessenen Tage hätte ` +
        `das ${formatEur(ways.uncontrolledEur)} für Energie, Netz und Abgaben gekostet.` +
        againstBaseline(ways.uncontrolledEur) +
        (baseline
          ? ''
          : ' Ob das weniger ist als heute, zeigt erst der Vergleich mit Ihrer Stromrechnung.'),
    },
    UNKNOWN_TARIFF_SWITCH_METHOD,
  )

  if (ways.controlledEur !== null) {
    const controlValue = ways.uncontrolledEur - ways.controlledEur
    bars.push({ key: 'controlled', label: CONTROLLED_WAY_LABEL, eur: ways.controlledEur, model: true })
    addWay(
      {
        id: 'ways_load_control',
        title: CONTROLLED_WAY_LABEL,
        amount: null,
        rows: [],
        body:
          `Zusätzlich zum Börsenpreis wird mit ${whose} gezielt geladen: in den günstigen ` +
          'Viertelstunden lädt der Speicher aus dem Netz, während er Kapazität für die teureren ' +
          'Stunden desselben Tages zurückhält — der Schutz Ihrer Lastspitzen hat dabei weiterhin ' +
          `Vorrang. Über denselben Zeitraum hätte das ${formatEur(ways.controlledEur)} gekostet` +
          (controlValue > 0
            ? ` — ${formatEur(controlValue)} weniger als ohne Steuerung; das ist der Wert der Ladesteuerung.`
            : ' — nicht weniger als ohne Steuerung.') +
          againstBaseline(ways.controlledEur) +
          (ways.controlVariant === 'predictive' ? ` ${PREDICTIVE_NOTE}` : ''),
      },
      LOAD_CONTROL_METHOD + (ways.controlVariant === 'predictive' ? ` ${PREDICTIVE_METHOD}` : ''),
    )
  }

  if (peakSavingPerYear > 0) {
    addWay(
      {
        id: 'ways_peak_shaving',
        title: PEAK_SHAVING_WAY_LABEL,
        amount: null,
        rows: [],
        body: peakShavingBody(whose, peakSavingPerYear, days, false),
      },
      PEAK_SHAVING_METHOD,
      true,
    )
  }

  return {
    bars,
    coveredDays: ways.coveredDays,
    wayCount: statements.length,
    intro: UNKNOWN_TARIFF_WAYS_INTRO,
    methodNotes,
    figure: {
      caption:
        `Was Ihr Strom über die ${days} gemessenen Tage gekostet hätte — je Weg ein Balken. ` +
        (peakSavingPerYear > 0
          ? 'Die Kappung Ihrer Lastspitzen ist hier nicht enthalten (Jahresgrösse, s. unten). '
          : '') +
        `Alle Beträge ${displayedPriceLabel(analysis)}.`,
      note: null,
    },
    statements,
  }
}
