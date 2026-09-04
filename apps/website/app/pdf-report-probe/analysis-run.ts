import type { AnalysisResult, LoadProfile } from 'shared'

import type { AnalysisRequest, WorkerOutbound } from '@/lib/analysis-protocol'
import { DEFAULT_HORIZON_YEARS } from '@/lib/constants'
import {
  buildDetailChapter,
  detailChartPlan,
  type DetailChapter,
} from '@/lib/pdf-report/detail'
import {
  buildInsightChapter,
  insightChartPlan,
  summarizeHourFlow,
  type InsightChapter,
} from '@/lib/pdf-report/insight'
import {
  buildRecommendationChapter,
  type RecommendationChapter,
} from '@/lib/pdf-report/recommendation'
import { buildReportSummary, type ReportSummary } from '@/lib/pdf-report/summary'
import { buildSummaryProbePayload } from './summary-fixtures'
import type { SummaryProbeKind } from './summary-probe-kinds'

/**
 * B23c-1 — ein ECHTER Rechenlauf für den Prüfstand.
 *
 * ── ⚠ ES LÄUFT DER PRODUKTIONS-WORKER, NICHT EINE NACHGEBAUTE KETTE ───────────────────────────
 * `new Worker(new URL('../../lib/analysis.worker.ts', …))` — dieselbe Datei und derselbe Aufbau
 * wie in `use-analysis.ts`. Die Alternative wäre gewesen, hier `analyzeCurrentPeaks`,
 * `recommendBattery` und `buildExistingBatteryAnalysis` einzeln aufzurufen; das wäre eine ZWEITE
 * Orchestrierung derselben Rechnung, und sie liefe beim ersten Umbau des Workers von ihm weg. Was
 * die Executive Summary im Prüfstand zu sehen bekommt, ist dann bit-genau das, was sie im Rechner
 * zu sehen bekäme.
 *
 * ── WARUM `recompute` UND NICHT `run` ──────────────────────────────────────────────────────────
 * Beide laufen durch DIESELBE `computeAnalysis` (U2 Prompt C, ausdrücklich so gebaut) — der
 * einzige Unterschied ist die künstliche Fortschrittsanimation des Erstlaufs (§5 Schritt 3, rund
 * 1,5 s reine Wartezeit). Für einen Prüfstand ist das Wartezeit ohne Aussage; das ERGEBNIS ist in
 * beiden Fällen dasselbe Objekt.
 *
 * ⚠ `batteryOverride` bleibt aus: es gibt hier kein Annahmen-Panel, und ein Override wäre eine
 * Änderung an einer Batterie, die niemand vorgenommen hat.
 *
 * ── DER WORKER WIRD JE LAUF NEU ERZEUGT UND DANACH BEENDET ────────────────────────────────────
 * Ein Prüflauf ist ein einzelner Klick, kein Sitzungszustand. Ein über die Route hinweg gehaltener
 * Worker wäre ein zweiter Lebenszyklus neben `use-analysis.ts`, den niemand aufräumt.
 *
 * ── ⚠ DIE ABLEITUNG LÄUFT HIER MIT, UND ZWAR AUS EINEM BÜNDEL-GRUND ───────────────────────────
 * `buildReportSummary` ist DIE Produktionsfunktion, die das Dokument gleich aufruft — der
 * Prüfstand zeigt damit, was auf der Seite stehen wird, ohne es nachzubauen. Sie wird aber HIER
 * aufgerufen und nicht in `probe-client.tsx`: dort statisch importiert zöge sie den `shared`-Barrel
 * (samt der 2.501-Zeilen-PLZ-Tabelle aus B22b) in den First Load der Prüfroute — gemessen rund
 * 60 kB für eine Anzeige, die es erst NACH einem Klick gibt. Diese Datei wird ohnehin dynamisch
 * geladen; der Zuwachs landet damit im selben Chunk wie der Lastgang und die Preisreihe.
 */

/** Reissleine, damit ein hängender Lauf nicht als „Knopf tut nichts" endet. */
const PROBE_TIMEOUT_MS = 60_000

export type SummaryProbeRun = {
  result: AnalysisResult
  summary: ReportSummary
  /**
   * B23c-2 — was das Empfehlungs-Kapitel aus demselben Ergebnis ableitet. Ebenfalls DIE
   * Produktionsfunktion, hier aufgerufen und nicht nachgebaut: der Prüfstand zeigt, welche
   * Aussagen das Dokument gleich trägt und welche entfallen.
   */
  chapter: RecommendationChapter
  /**
   * B23c-3a — was das Kapitel „Kostenverlauf und ein Tag im Detail" aus demselben Ergebnis
   * ableitet. Wieder DIE Produktionsfunktion, hier aufgerufen und nicht nachgebaut.
   *
   * ⚠ `flowDay` bleibt hier `null`: welcher Tag im Bild steht, misst erst die Rasterung
   * (`charts.tsx` liest ihn aus dem gerenderten Baum). Der Prüfstand zeigt also, WAS das Kapitel
   * tragen wird, nicht die Tagesangabe — die steht nach dem Erzeugen im Ergebnisblock.
   */
  detail: DetailChapter
  /** Welcher Kosten-Chart entstehen wird — die ENTSCHEIDUNG, vor dem Erzeugen sichtbar. */
  detailCostKind: 'monthly' | 'cumulative' | null
  /** Ob überhaupt ein Energiefluss-Tag vorliegt (s. `detailChartPlan`). */
  detailFlowPlanned: boolean
  /**
   * Die Tage, die der Trace des Energiefluss-Eintrags TRÄGT — Etikett und Datum, unverändert aus
   * `DispatchTrace.representativeDays`.
   *
   * ⚠ Damit lässt sich der Tag, den die Komponente beim Rastern GEWÄHLT hat (`chart.flowDay`),
   * gegen die Datenlage halten, statt bloss festzustellen, dass irgendein Datum im Bild steht.
   * Der Prüfstand leitet daraus NICHTS ab — er zeigt, was zur Wahl stand.
   */
  detailFlowDays: { label: string; date: string }[]
  /**
   * B23c-3b-1 — was das Kapitel „Das Ladeverhalten Ihres Speichers" aus demselben Ergebnis
   * ableitet. Wieder DIE Produktionsfunktion, hier aufgerufen und nicht nachgebaut.
   */
  insight: InsightChapter
  /**
   * Die ENTSCHEIDUNG, vor dem Erzeugen sichtbar: entsteht das Kapitel überhaupt, und welches der
   * beiden Bilder trägt es? Beides kann einzeln entfallen — im Blocker-Fall beides zusammen, und
   * dann gibt es weder Kapitel noch Agenda-Eintrag.
   */
  insightPlanned: { chapter: boolean; hourFlow: boolean; chargePrice: boolean }
  /**
   * Die Rohzahlen des Heatmap-Rasters, ungerundet — stärkste Zelle, Hauptladestunde und wie viele
   * der 288 Zellen keinen Messwert tragen.
   *
   * ⚠ `emptyCells` ist die Grösse, an der sich „leer" von „gemessene Null" überhaupt trennen
   * lässt: bei einem Volljahres-Lastgang ist sie 0, und dann kann eine Farbstichprobe im Bild
   * keine gestrichelte Zelle finden, weil es keine gibt. Der Prüfstand zeigt sie, damit ein
   * Prüflauf nicht das Fehlen einer Zelle für einen Fehlschlag der Rasterung hält.
   */
  hourFlowSummary: { maxAbsKwh: number; peakHour: number; emptyCells: number } | null
  /**
   * B23c-2 — DER Lastgang, gegen den gerechnet wurde. Er reist mit heraus, weil das Dokument ihn
   * für das Diagramm braucht (`PdfReportInput.loadProfile`) und `DispatchTrace` bewusst keine
   * Rohreihe trägt.
   *
   * ⚠ Ausdrücklich DASSELBE Objekt, das in den Payload ging — nicht ein zweiter Aufruf von
   * `buildLoadProfileFixture()`. Zwei Lastgänge im selben Prüflauf wären eine Kurve, die zu einer
   * anderen Rechnung gehört als die Zahlen daneben, und man sähe es dem Bild nicht an.
   */
  loadProfile: LoadProfile
}

export async function runSummaryAnalysis(kind: SummaryProbeKind): Promise<SummaryProbeRun> {
  const payload = buildSummaryProbePayload(kind)
  const worker = new Worker(new URL('../../lib/analysis.worker.ts', import.meta.url))

  try {
    const result = await new Promise<AnalysisResult>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Der Rechenlauf hat nicht innerhalb von 60 s geantwortet.')),
        PROBE_TIMEOUT_MS,
      )

      worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
        const msg = event.data
        if (msg.type === 'recomputed') {
          clearTimeout(timer)
          resolve(msg.result)
        } else if (msg.type === 'error') {
          clearTimeout(timer)
          reject(new Error(msg.message))
        }
      }
      worker.onerror = (event) => {
        clearTimeout(timer)
        reject(new Error(event.message || 'Der Analyse-Worker ist abgestürzt.'))
      }

      const request: AnalysisRequest = {
        type: 'recompute',
        payload,
        horizonYears: DEFAULT_HORIZON_YEARS,
      }
      worker.postMessage(request)
    })
    const plan = detailChartPlan(result)
    const insight = insightChartPlan(result)
    const flowEntry = plan.flow
      ? (plan.flow.entries.find((e) => e.battery.id === plan.flow!.selectedBatteryId) ??
        plan.flow.entries[0])
      : undefined
    return {
      result,
      summary: buildReportSummary(result),
      chapter: buildRecommendationChapter(result),
      detail: buildDetailChapter(result),
      detailCostKind: plan.cost?.kind ?? null,
      detailFlowPlanned: plan.flow !== null,
      detailFlowDays: (flowEntry?.dispatchTrace?.representativeDays ?? []).map((d) => ({
        label: d.label,
        date: d.date,
      })),
      insight: buildInsightChapter(result),
      insightPlanned: {
        chapter: insight.hourFlow !== null || insight.chargePrice !== null,
        hourFlow: insight.hourFlow !== null,
        chargePrice: insight.chargePrice !== null,
      },
      hourFlowSummary: insight.hourFlow
        ? (() => {
            const summary = summarizeHourFlow(insight.hourFlow.grid)
            return {
              maxAbsKwh: summary.maxAbsKwh,
              peakHour: summary.peakHour,
              emptyCells: summary.emptyCells,
            }
          })()
        : null,
      loadProfile: payload.load.profile,
    }
  } finally {
    worker.terminate()
  }
}
