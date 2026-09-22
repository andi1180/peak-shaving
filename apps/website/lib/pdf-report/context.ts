import type { BatteryResultEntry, BatteryRoiEntry } from 'shared'

import { hasAdviceChapter } from './advice'
import { dataQualityNoticeOf, pvOutageNoticeOf } from './basis'
import { comparisonChartPlan, hasComparisonChapter, type ComparisonChartPlan } from './comparison'
import { detailChartPlan, hasMonthlyChapter, type DetailChartPlan } from './detail'
import { insightChartPlan, type InsightChartPlan } from './insight'
import { hasRecommendationChapter } from './recommendation'
import type { ReportNotice } from './statement'
import { primaryEntryOf, recommendedEntryOf } from './summary'
import type { PdfReportInput } from './types'
import { hasWaysChapter, waysCountOf } from './ways'
import { hasAnnualScenarioChapter } from './annual-scenario'
import { hasPvValueChapter } from './pv-value'

/**
 * Report-Baukasten B1 — die Zwischenwerte, die für EIN Dokument genau einmal entstehen.
 *
 * ── ⚠ WARUM DAS EINE ORCHESTRIERUNGS- UND KEINE ABLEITUNGSFRAGE IST ───────────────────────────
 * Dasselbe Muster wie bei den Chart-Bildern (`charts.tsx`), aus demselben Grund: das Dokument wird
 * zwei- bis dreimal gerendert (`render.tsx`: messen · mit Zahlen · im Wächterfall ohne Zahlen), und
 * jede Kapitel-Komponente lief bisher je Durchlauf durch ihre eigene Ableitung. Die sieben Werte
 * hier wurden dadurch 2- bis 6-mal je Dokument gebildet — teils in DERSELBEN Ableitung an zwei
 * Orten (`insightChartPlan` in `hasInsightChapter` UND in `buildInsightChapter`), teils in drei
 * fast wortgleichen Fassungen derselben Regel (`recommendedEntryOf`).
 *
 * Die Funktionen sind rein, die Ergebnisse waren also schon bisher gleich. Was fehlte, war die
 * ZUSAGE: sobald eine dieser Ableitungen eine Verzweigung bekommt, die nicht allein am
 * `AnalysisResult` hängt, laufen zwei Aufrufe im selben Dokument auseinander — und man sähe es dem
 * Blatt nicht an, weil die Bildunterschrift und der Absatz daneben aus verschiedenen Aufrufen
 * stammen. Genau diese Klasse Fehler schliesst ein einmal gebildeter Kontext aus.
 *
 * ── ⚠ DER KONTEXT GEHT NICHT IN DIE BAUSTEIN-ERZEUGER ─────────────────────────────────────────
 * Er wird ausschliesslich an die sieben KAPITEL-Fassaden gereicht, und die geben daraus die
 * WERTE weiter, die ihre Bausteine heute schon bekommen (`buildLoadControl(analysis, entry)`). Kein
 * Baustein-Erzeuger nimmt einen `ReportBuildContext` entgegen — täte er es, wäre die enge Signatur
 * dahin, die heute lesbar macht, WOVON eine Aussage abhängt.
 *
 * ── ⚠ WAS HIER BEWUSST NICHT STEHT ────────────────────────────────────────────────────────────
 * `charts.flowDay` — die Tagesbeschriftung, die die Energiefluss-Komponente beim Rastern
 * TATSÄCHLICH getragen hat. Sie ist keine Ableitung aus `analysis`, sondern eine Ablesung am
 * gerenderten Baum (`charts.tsx`, `readEnergyFlowDay`); hier geführt wäre sie eine Behauptung über
 * ein Bild statt einer Messung an ihm. Sie reist deshalb weiterhin über `buildReportCharts`.
 */
export type ReportBuildContext = {
  /** Der primäre Block: im Bestandsfall die Anlage des Kunden, sonst die Empfehlung. */
  primaryEntry: BatteryResultEntry | undefined
  /** Das empfohlene KATALOG-Gerät — im Bestandsfall ein anderes als `primaryEntry`. */
  recommendedEntry: BatteryRoiEntry | undefined
  /** Welcher Kosten-Chart und welcher Energiefluss-Tag (Kapitel 3). */
  detailPlan: DetailChartPlan
  /** Welche der beiden Ladeverhalten-Grafiken entstehen (Kapitel 5). */
  insightPlan: InsightChartPlan
  /** Die Grenznutzen-Kurve, oder `null` bei weniger als zwei zeichenbaren Punkten (Kapitel 6). */
  comparisonPlan: ComparisonChartPlan | null
  /**
   * D5 — der PV-Befund des Schlusskapitels; `null` heisst „keine PV, nichts gefunden ODER vom
   * Admin abgewählt" (Baukasten C). An ihm hängt der Methodik-Absatz `method_pv_outage`.
   */
  pvOutage: ReportNotice | null
  /**
   * Der Datenqualitäts-Hinweis des Schlusskapitels; `null` heisst „keine Warnung ODER vom Admin
   * abgewählt". An ihm hängt der Verweis in der Datenquellen-Tabelle.
   *
   * ⚠ Er steht seit Baukasten C hier und nicht mehr nur in der Kapitel-Fassade, aus demselben
   * Grund wie `pvOutage`: die Registry und das Kapitel müssen DIESELBE Antwort bekommen, sonst
   * zeigt der Katalog einen Baustein, den das Dokument weglässt.
   */
  dataQuality: ReportNotice | null
  /** D7 — Kapitel „… Wege zu weniger Stromkosten", zwischen Lastgang und Empfehlung. */
  hasWays: boolean
  /** Wie viele Wege es führt (D7-Revision) — Agenda und Überschrift zählen daraus. */
  waysCount: number
  /** D6 Teil 3 — Kapitel „Was wäre, wenn wir ein ganzes Jahr hätten?", direkt hinter den Wegen. */
  hasAnnualScenario: boolean
  /** Kapitel „Ihre PV-Anlage" — der rekonstruierte „ohne PV"-Vergleich, hinter der Hochrechnung. */
  hasPvValue: boolean
  /** Kapitel 4 — Monatsvergleich als eigenes Kapitel. */
  hasMonthly: boolean
  /** Kapitel 5 — Ladeverhalten. */
  hasInsight: boolean
  /** Kapitel 6 — Speichergrösse und Gerätewahl. */
  hasComparison: boolean
  /**
   * Kapitel 2 — Empfehlung und Wirtschaftlichkeit. `false` im Bestandsfall, dessen Gerätewahl
   * „Nein" sagt — s. `hasRecommendationChapter` (`recommendation.ts`).
   */
  hasRecommendation: boolean
  /**
   * Kapitel „Unser Vorschlag", zwischen Methodik und Schlusskapitel. `false`, wenn weder ein
   * Vorschlag zutrifft noch eine Herkunftsangabe belegt ist — s. `hasAdviceChapter`.
   */
  hasAdvice: boolean
}

/**
 * Bildet den Kontext. EINMAL je Erzeugung aufrufen, nach `buildReportCharts` und vor dem ersten
 * Renderdurchlauf (`render.tsx`) — derselbe Zeitpunkt und dieselbe Zusage wie bei den Bildern.
 *
 * ⚠ Jeder Wert ist EXAKT die Berechnung, die bisher an der jeweiligen Aufrufstelle stand; neue
 * Logik entsteht hier keine. `hasInsight` liest dafür den bereits gebildeten `insightPlan`, statt
 * `hasInsightChapter` aufzurufen — das ist wortgleich dessen Rumpf (`insight.ts`) und spart den
 * zweiten Aufbau desselben Plans, den genau diese Datei abschaffen soll.
 */
export function buildReportContext(input: PdfReportInput): ReportBuildContext {
  const analysis = input.analysis
  const insightPlan = insightChartPlan(analysis)

  return {
    primaryEntry: primaryEntryOf(analysis),
    recommendedEntry: recommendedEntryOf(analysis),
    detailPlan: detailChartPlan(analysis),
    insightPlan,
    comparisonPlan: comparisonChartPlan(analysis),
    pvOutage: pvOutageNoticeOf(input),
    dataQuality: dataQualityNoticeOf(input),
    hasWays: hasWaysChapter(analysis),
    waysCount: waysCountOf(analysis),
    hasAnnualScenario: hasAnnualScenarioChapter(analysis),
    hasPvValue: hasPvValueChapter(analysis),
    hasMonthly: hasMonthlyChapter(analysis),
    hasInsight: insightPlan.hourFlow !== null || insightPlan.chargePrice !== null,
    hasComparison: hasComparisonChapter(analysis),
    hasRecommendation: hasRecommendationChapter(analysis),
    /* ⚠ Das einzige Kapitel-Prädikat, das die EINGABE liest und nicht nur das Ergebnis: die
       Herkunftsangaben der Tarifseite stehen dort (`tariffSource`/`tariffProvenance`). */
    hasAdvice: hasAdviceChapter(input),
  }
}
