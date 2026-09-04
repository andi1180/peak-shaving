'use client'

import { useState } from 'react'
import { Calculator, FileText, ImageDown } from 'lucide-react'
import type { AnalysisResult, LoadProfile, TariffSourceRef } from 'shared'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ReportPdfOutcome } from '@/lib/pdf-report/download'
import type { ChartProbeKind, ChartProbeReport } from './chart-runs'
import {
  defaultReportTitle,
  formatAnalysisPeriod,
  formatPrintedAt,
  reportSubtitle,
} from '@/lib/pdf-report/derive'
/*
 * ⚠ NUR DER TYP. `buildReportSummary` selbst wird in `analysis-run.ts` aufgerufen (dynamisch
 * geladen): statisch hier importiert zöge es den `shared`-Barrel samt PLZ-Tabelle in den First
 * Load dieser Route — gemessen rund 60 kB für eine Anzeige, die es erst nach einem Klick gibt.
 */
import type { BasisChapter } from '@/lib/pdf-report/basis'
import type { ComparisonChapter } from '@/lib/pdf-report/comparison'
import type { DetailChapter } from '@/lib/pdf-report/detail'
import type { InsightChapter } from '@/lib/pdf-report/insight'
import type { RecommendationChapter } from '@/lib/pdf-report/recommendation'
import type { ReportSummary } from '@/lib/pdf-report/summary'
import {
  SUMMARY_PROBE_KINDS,
  SUMMARY_PROBE_LABEL,
  type SummaryProbeKind,
} from './summary-probe-kinds'

/**
 * B23a/B23c-1 — Prüfstand-Oberfläche.
 *
 * ── B23c-1: DER PRÜFSTAND HAT JETZT EINEN ECHTEN RECHENLAUF ────────────────────────────────────
 * Bis hierher gab es keinen — die Ableitungen liefen gegen strukturelle Teilmengen (`Pick<…>`), und
 * das genügte, solange sie je ein einziges Feld lasen. Die Executive Summary liest sechs Felder und
 * trifft daran Abbruch-Entscheidungen; ein von Hand zusammengesetztes Ergebnis prüfte davon nichts.
 * `runSummaryAnalysis` schickt deshalb einen echten `CalculatorPayload` an den ECHTEN Analyse-Worker
 * (`analysis-run.ts`) und arbeitet mit dem, was herauskommt.
 *
 * ⚠ Der Umschalter „Ladeoptimierung berechenbar" ist damit ERSATZLOS entfallen. Er setzte
 * `tariffOptimization` von Hand; jetzt entscheidet die DATENLAGE des jeweiligen Falls darüber
 * (`blocker` liefert keine Börsenpreise), und der Titelvorschlag folgt einem gerechneten Wert statt
 * einem Häkchen.
 *
 * ── DIE ÜBRIGEN ABLEITUNGEN LAUFEN UNVERÄNDERT ECHT ────────────────────────────────────────────
 * `defaultReportTitle`, `reportSubtitle` und `formatAnalysisPeriod` sind DIE Produktionsfunktionen
 * aus `lib/pdf-report/derive.ts` — sie werden hier nicht nachgebaut. Untertitel und Zeitraum
 * bekommen weiterhin eine schmale Teilmenge herein: `reportSubtitle` liest genau `source`, und der
 * Umschalter dafür ist der einzige Weg, die zweite Fassung des Satzes überhaupt zu sehen.
 *
 * ── B23b: DREI EINZELN AUSLÖSBARE CHART-LÄUFE ─────────────────────────────────────────────────
 * Je Chart-TYP einer (kategorial/Balken · Raster/Heatmap · kontinuierlich mit grosser Punktzahl).
 * Jeder mountet die UNVERÄNDERTE Produktionskomponente abseits des Sichtfelds, rastert sie und legt
 * ein eigenständiges Mini-PDF mit genau diesem einen Bild ab. Getrennte Knöpfe und getrennte
 * Dateien, weil ein Sammellauf die Zahlen vermengte, um die es geht: Seitenverhältnis,
 * Farbstichprobe und — beim Lastgang — die Stützpunktzahl nach dem Downsampling.
 *
 * ⚠ `@react-pdf/renderer` wird hier NICHT importiert. Der Weg dorthin ist der dynamische Import in
 * `lib/pdf-report/download.ts`, und zwar erst im Klick-Handler — sonst läge der Lazy-Chunk (Spike
 * §3: ≈ 307 kB gzip) im First Load dieser Route.
 */

/**
 * Die Bilder eines Dokuments, in Dokumentreihenfolge — seit B23c-3b-1 fünf.
 *
 * ⚠ Als Liste und nicht je Bild ausgeschrieben: die Zeilen unterscheiden sich nur in Beschriftung
 * und Schlüssel, und Kopien liefen beim nächsten hinzukommenden Bild auseinander. Genau das ist
 * hier eingetreten und hat nichts gekostet — die zwei neuen Zeilen sind zwei Einträge.
 */
const CHART_FIGURES = [
  { key: 'load', label: 'Lastgang-Bild' },
  { key: 'cost', label: 'Kosten-Bild' },
  { key: 'flow', label: 'Energiefluss-Bild' },
  { key: 'hourFlow', label: 'Heatmap-Bild (nur Raster)' },
  { key: 'chargePrice', label: 'Ladepreis-Bild' },
  { key: 'comparison', label: 'Grenznutzen-Bild' },
] as const

/**
 * Die Herkunft, aus der `reportSubtitle` seine Fassung wählt.
 *
 * ── ⚠ B23c-4: DER UMSCHALTER IST ENTFALLEN, UND DAS IST EINE KORREKTUR ────────────────────────
 * Bis hierher gab es einen Ankreuzkasten, weil der Prüf-Lastgang ein gemessener war und seine
 * Herkunft nie wechselte — die zweite Fassung des Untertitels war anders nicht zu sehen. Seit dem
 * Prüffall `standardprofil` gibt es einen ECHTEN synthetischen Lastgang (aus DEM Generator, den
 * auch der Rechner benutzt), und der Umschalter wäre ab jetzt schädlich: er könnte auf einem Report
 * über ein Standardprofil „auf Basis Ihres Viertelstunden-Lastgangs" stehen lassen — genau die
 * Verwechslung, gegen die `reportSubtitle` ausdrücklich nicht editierbar ist.
 *
 * Vor dem ersten Rechenlauf gibt es noch keinen Lastgang; dann steht die Fassung des gemessenen
 * Falls da, weil vier der acht Prüffälle sie tragen.
 *
 * ⚠ B23c-2: die zwei Zeitstempel für den ZEITRAUM sind hier entfallen. Er kommt aus dem ECHTEN
 * Lastgang des Rechenlaufs — demselben, aus dem gleich das Diagramm entsteht. Eine zweite,
 * danebengeschriebene Zeitspanne wäre die Sorte Doppelung, die erst auffällt, wenn sie abweicht.
 */
function probeProfile(loadProfile: LoadProfile | null): Pick<LoadProfile, 'source'> {
  return { source: loadProfile?.source ?? 'net_signed' }
}

export function PdfReportProbe() {
  const [probeKind, setProbeKind] = useState<SummaryProbeKind>('bestand')
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [chapter, setChapter] = useState<RecommendationChapter | null>(null)
  const [detail, setDetail] = useState<{
    chapter: DetailChapter
    costKind: 'monthly' | 'cumulative' | null
    flowPlanned: boolean
    flowDays: { label: string; date: string }[]
  } | null>(null)
  const [insight, setInsight] = useState<{
    chapter: InsightChapter
    planned: { chapter: boolean; hourFlow: boolean; chargePrice: boolean }
    hourFlowSummary: { maxAbsKwh: number; peakHour: number; emptyCells: number } | null
  } | null>(null)
  const [comparison, setComparison] = useState<{
    chapter: ComparisonChapter
    planned: {
      chapter: boolean
      variant: 'addon' | 'catalog' | null
      points: number
      tableRows: number
    }
  } | null>(null)
  /*
   * B23c-3b-2 — das Heatmap-Raster des letzten Rechenlaufs, samt dem Namen der Batterie, zu der es
   * gehört. Es speist den Heatmap-Chart-Lauf darunter: nur so laufen die Zellproben („leer" gegen
   * „gemessene Null") an einem ECHTEN, gerechneten Raster statt am B23b-Fixture (D15).
   */
  const [hourFlowGrid, setHourFlowGrid] = useState<{
    grid: (number | null)[][]
    batteryName: string
  } | null>(null)
  /*
   * B23c-4 — das Schlusskapitel des letzten Rechenlaufs, samt der Herkunftsangabe und dem
   * Preisstand-Satz. Sie reisen mit, weil das Dokument sie als Eingang braucht
   * (`PdfReportInput.tariffSource`/`tariffVintage`) und der Prüfstand die ENTSCHEIDUNG vor dem
   * Erzeugen zeigen soll.
   */
  const [basis, setBasis] = useState<{
    chapter: BasisChapter
    noticeIds: string[]
    tariffSource: TariffSourceRef | null
  } | null>(null)
  /** Der Lastgang des Rechenlaufs — Grundlage des Diagramms UND des Zeitraums auf dem Deckblatt. */
  const [loadProfile, setLoadProfile] = useState<LoadProfile | null>(null)
  const [analysisKind, setAnalysisKind] = useState<SummaryProbeKind | null>(null)
  const [analysisMs, setAnalysisMs] = useState(0)
  const [analysisPending, setAnalysisPending] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [name, setName] = useState('Anna Gruber')
  const [company, setCompany] = useState('Bäckerei Gruber GmbH')
  const [address, setAddress] = useState('Hauptstraße 12\n2100 Korneuburg')
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<ReportPdfOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chartPending, setChartPending] = useState<ChartProbeKind | null>(null)
  const [chartReport, setChartReport] = useState<ChartProbeReport | null>(null)
  const [chartError, setChartError] = useState<string | null>(null)

  const subtitle = reportSubtitle(probeProfile(loadProfile))
  /* Aus dem echten Lastgang — vor dem ersten Lauf gibt es keinen, und dann auch keinen Zeitraum. */
  const period = loadProfile ? formatAnalysisPeriod(loadProfile) : null

  /*
   * ⚠ Solange NICHTS gerechnet ist, gibt es auch keinen Titelvorschlag — er hängt an
   * `tariffOptimization.computable` und damit an einem Ergebnis. Ein Vorschlag „auf Verdacht"
   * nennte „& Ladeoptimierung" womöglich auf einem Report, der sie gar nicht ausweist.
   */
  const suggestedTitle = analysis ? defaultReportTitle(analysis) : ''


  /*
   * Der Titel folgt dem Vorschlag, solange niemand ihn angefasst hat — sobald doch, gehört er dem
   * Nutzer. Dieselbe Regel wie im Gate-Dialog, nur dass sich der Vorschlag hier per Umschalter
   * ändern kann und die Nachführung deshalb sichtbar wird.
   */
  const [titleOverride, setTitleOverride] = useState<string | null>(null)
  const title = titleOverride ?? suggestedTitle

  async function handleAnalyse() {
    setAnalysisError(null)
    setAnalysis(null)
    setSummary(null)
    setChapter(null)
    setDetail(null)
    setInsight(null)
    setComparison(null)
    setHourFlowGrid(null)
    setLoadProfile(null)
    setAnalysisKind(null)
    setOutcome(null)
    setAnalysisPending(true)
    const started = performance.now()
    try {
      /* Zieht den Lastgang (35.040 Werte) und die Spotpreis-Reihe — erst hier, nicht beim Laden. */
      const { runSummaryAnalysis } = await import('./analysis-run')
      const run = await runSummaryAnalysis(probeKind, new Date())
      setAnalysisMs(performance.now() - started)
      setAnalysis(run.result)
      /* DIE Produktionsfunktion, gelaufen in `analysis-run.ts` — der Prüfstand zeigt, was das
         Dokument gleich rendern wird, statt es nachzubauen. */
      setSummary(run.summary)
      setChapter(run.chapter)
      setDetail({
        chapter: run.detail,
        costKind: run.detailCostKind,
        flowPlanned: run.detailFlowPlanned,
        flowDays: run.detailFlowDays,
      })
      setInsight({
        chapter: run.insight,
        planned: run.insightPlanned,
        hourFlowSummary: run.hourFlowSummary,
      })
      setComparison({ chapter: run.comparison, planned: run.comparisonPlanned })
      setBasis({
        chapter: run.basis,
        noticeIds: run.noticeIds,
        tariffSource: run.tariffSource,
      })
      setHourFlowGrid(
        run.hourFlowGrid
          ? {
              grid: run.hourFlowGrid,
              batteryName:
                run.result.existingBatteryAnalysis?.entry.battery.name ??
                run.result.perBattery.find((p) => p.battery.id === run.result.recommendation.batteryId)
                  ?.battery.name ??
                'Speicher aus dem Rechenlauf',
            }
          : null,
      )
      setLoadProfile(run.loadProfile)
      setAnalysisKind(probeKind)
      /* Ein neuer Fall bringt einen neuen Vorschlag — ein Titel von Hand bleibt trotzdem stehen. */
    } catch (cause) {
      setAnalysisError(cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    } finally {
      setAnalysisPending(false)
    }
  }

  async function handleGenerate() {
    if (!analysis || !loadProfile || !basis) return
    setError(null)
    setOutcome(null)
    setPending(true)
    try {
      const { downloadReportPdf } = await import('@/lib/pdf-report/download')
      const now = new Date()
      const result = await downloadReportPdf(
        {
          title,
          subtitle,
          customer: { name, company, address },
          period,
          printedAt: formatPrintedAt(now),
          analysis,
          loadProfile,
          /*
           * ⚠ AUS DEMSELBEN Rechenlauf wie das Ergebnis daneben — nicht hier ein zweites Mal
           * abgeleitet. Der Preisstand-Satz entsteht in `derive.ts` (er hängt an einem Stichtag)
           * und ist bereits in `run.basis` gebildet; ihn hier neu zu bilden wäre eine zweite
           * Ableitung derselben Aussage, die vom gezeigten Prüfstand abweichen könnte.
           */
          tariffSource: basis.tariffSource,
          tariffVintage: basis.chapter.tariffVintage,
        },
        now,
      )
      setOutcome(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    } finally {
      setPending(false)
    }
  }

  async function handleChart(kind: ChartProbeKind) {
    setChartError(null)
    setChartReport(null)
    setChartPending(kind)
    try {
      /* Zieht Recharts UND react-pdf — deshalb erst hier, nicht auf Modulebene. */
      const { runChartProbe } = await import('./chart-runs')
      /*
       * ⚠ Das Raster des letzten Rechenlaufs wird MITGEGEBEN, wenn es eines gibt — dann misst die
       * Heatmap-Probe an echten, gerechneten Zahlen (D15). Ohne Rechenlauf bleibt es der
       * B23b-Fixture-Lauf, der Vergleichsmassstab der dortigen Zahlen.
       */
      setChartReport(
        await runChartProbe(kind, {
          heatmapGrid: hourFlowGrid?.grid ?? null,
          heatmapBatteryName: hourFlowGrid?.batteryName,
        }),
      )
    } catch (cause) {
      setChartError(cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    } finally {
      setChartPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">PDF-Report-Prüfstand</h1>
        <p className="mt-1 text-sm text-text-muted">
          B23a — Dokumentgerüst (Deckblatt, Kopf-/Fusszeile mit Seitenzahl, Agenda mit
          Seitenverweisen, Methodik). B23c-1/2/3a/3b — Kernergebnisse, Empfehlung mit
          Lastgang-Diagramm, Kostenverlauf und Tages-Energiefluss, das Ladeverhalten
          (Stunden-Heatmap und Ø-Ladepreis) sowie Speichergrösse und Gerätewahl (Grenznutzen-Kurve
          und Vergleichstabelle), alle aus einem ECHTEN, hier im Browser gerechneten
          Ergebnis. Interne Route, nicht verlinkt, <code>noindex</code>. Der
          Export im Rechner ist davon unberührt und läuft weiter über den Druckdialog.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">Rechenlauf</p>
          <p className="text-xs text-text-muted">
            Derselbe Lastgang wie die Chart-Läufe (35.040 Viertelstundenwerte), gerechnet vom
            ECHTEN Analyse-Worker. Der Fall entscheidet über die Datenlage — nicht über die
            Darstellung: was auf der Kernergebnis-Seite steht, folgt daraus.
          </p>
          {SUMMARY_PROBE_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <input
                id={`probe-kind-${kind}`}
                type="radio"
                name="probe-kind"
                checked={probeKind === kind}
                onChange={() => setProbeKind(kind)}
              />
              {SUMMARY_PROBE_LABEL[kind]}
            </label>
          ))}
          <div>
            <Button
              id="probe-analyse"
              variant="secondary"
              onClick={() => void handleAnalyse()}
              disabled={analysisPending}
            >
              <Calculator className="h-4 w-4" />
              {analysisPending ? 'Wird gerechnet …' : 'Analyse rechnen'}
            </Button>
          </div>
        </div>

        {analysisError && (
          <p id="probe-analysis-error" role="alert" className="text-sm text-negative">
            {analysisError}
          </p>
        )}

        {analysis && summary && analysisKind && (
          <div id="probe-analysis" className="flex flex-col gap-1 text-sm">
            <p className="text-text-muted">
              Gerechnet: <strong id="probe-analysis-kind">{analysisKind}</strong> in{' '}
              <strong id="probe-analysis-ms">{Math.round(analysisMs)} ms</strong> ·
              Ladeoptimierung berechenbar:{' '}
              <strong id="probe-analysis-computable">
                {analysis.tariffOptimization?.computable === true ? 'ja' : 'nein'}
              </strong>{' '}
              · Bestandsanlage:{' '}
              <strong id="probe-analysis-existing">
                {analysis.existingBatteryAnalysis ? 'ja' : 'nein'}
              </strong>
            </p>
            <p className="text-text-muted">
              Kern-Kennzahl:{' '}
              <strong id="probe-headline">
                {summary.headline.peakValue} · {summary.headline.costValue}
              </strong>
            </p>
            <p className="text-text-muted">
              Kernaussagen der Seite:{' '}
              <strong id="probe-summary-ids">
                {summary.statements.map((s) => s.id).join(', ') || '—'}
              </strong>
            </p>
            {/*
              B23c-2 — was das Empfehlungs-Kapitel aus DEMSELBEN Ergebnis ableitet. Auch das ist die
              Produktionsfunktion (`buildRecommendationChapter`), gelaufen in `analysis-run.ts`; der
              Prüfstand zeigt, was gleich im Dokument steht, statt es nachzubauen.
            */}
            <p className="text-text-muted">
              Empfehlungs-Kapitel:{' '}
              <strong id="probe-chapter-ids">
                {[
                  chapter?.recommendation ? 'recommendation' : null,
                  chapter?.chart.capStatement ? 'cap_statement' : 'no_cap_note',
                  chapter?.loadControl ? 'load_control' : null,
                ]
                  .filter((v) => v !== null)
                  .join(', ')}
              </strong>
            </p>
            {chapter?.recommendation && (
              <p className="text-text-muted">
                Kaufaussage:{' '}
                <strong id="probe-chapter-recommendation">
                  {chapter.recommendation.title}
                  {chapter.recommendation.amount
                    ? ` — ${chapter.recommendation.amount.value}`
                    : ''}
                </strong>{' '}
                · Warnungen:{' '}
                <strong id="probe-chapter-warnings">
                  {chapter.recommendation.notes?.length ?? 0}
                </strong>
              </p>
            )}
            {/*
              B23c-3a — die ENTSCHEIDUNG des Detail-Kapitels, vor dem Erzeugen sichtbar: welcher
              Kosten-Chart entsteht (die beiden schliessen einander aus) und ob es überhaupt einen
              Energiefluss-Tag gibt. Wieder die Produktionsfunktion (`detailChartPlan` /
              `buildDetailChapter`), gelaufen in `analysis-run.ts`.
            */}
            {detail && (
              <p className="text-text-muted">
                Detail-Kapitel: Kosten-Chart{' '}
                <strong id="probe-detail-cost-kind">{detail.costKind ?? 'keiner'}</strong> ·
                Aufschlüsselung{' '}
                <strong id="probe-detail-cost-statement">
                  {detail.chapter.cost?.statement?.id ?? 'keine'}
                </strong>{' '}
                · Energiefluss-Tag vorhanden:{' '}
                <strong id="probe-detail-flow">{detail.flowPlanned ? 'ja' : 'nein'}</strong> ·
                Tage im Trace:{' '}
                <strong id="probe-detail-flow-days">
                  {detail.flowDays.map((d) => `${d.label}@${d.date}`).join(', ') || '—'}
                </strong>
                {detail.chapter.flowMissing && (
                  <>
                    {' '}
                    · Grund: <span id="probe-detail-flow-missing">{detail.chapter.flowMissing}</span>
                  </>
                )}
              </p>
            )}
            {/*
              B23c-3b-1 — die ENTSCHEIDUNG des Ladeverhalten-Kapitels, vor dem Erzeugen sichtbar.
              Es ist das erste Kapitel, das es nicht in jedem Dokument gibt: fehlen beide Bilder,
              entfallen Kapitel UND Agenda-Eintrag. Wieder die Produktionsfunktionen
              (`insightChartPlan` / `buildInsightChapter`), gelaufen in `analysis-run.ts`.
            */}
            {insight && (
              <p className="text-text-muted">
                Ladeverhalten-Kapitel:{' '}
                <strong id="probe-insight-chapter">
                  {insight.planned.chapter ? 'ja' : 'nein'}
                </strong>{' '}
                · Heatmap{' '}
                <strong id="probe-insight-hourflow">
                  {insight.planned.hourFlow ? 'ja' : 'nein'}
                </strong>{' '}
                · Ladepreis{' '}
                <strong id="probe-insight-chargeprice">
                  {insight.planned.chargePrice ? 'ja' : 'nein'}
                </strong>
                {insight.hourFlowSummary && (
                  <>
                    {' '}
                    · Stärkste Zelle{' '}
                    <strong id="probe-insight-maxabs">
                      {insight.hourFlowSummary.maxAbsKwh.toFixed(3)} kWh
                    </strong>{' '}
                    · Hauptladestunde{' '}
                    <strong id="probe-insight-peakhour">
                      {String(insight.hourFlowSummary.peakHour).padStart(2, '0')}
                    </strong>{' '}
                    · Zellen ohne Messwert{' '}
                    <strong id="probe-insight-empty">{insight.hourFlowSummary.emptyCells}</strong>
                  </>
                )}
              </p>
            )}
            {/*
              B23c-3b-2 — die ENTSCHEIDUNG des Kapitels „Speichergrösse und Gerätewahl", vor dem
              Erzeugen sichtbar: welche Fassung der Grenznutzen-Kurve entsteht, wie viele Punkte sie
              trägt, und ob darunter eine Tabelle oder der Klarsatz steht. Wieder die
              Produktionsfunktionen (`comparisonChartPlan` / `buildComparisonChapter`).
            */}
            {comparison && (
              <p className="text-text-muted">
                Gerätewahl-Kapitel:{' '}
                <strong id="probe-comparison-chapter">
                  {comparison.planned.chapter ? 'ja' : 'nein'}
                </strong>{' '}
                · Kurve{' '}
                <strong id="probe-comparison-variant">
                  {comparison.planned.variant ?? 'keine'}
                </strong>{' '}
                mit{' '}
                <strong id="probe-comparison-points">{comparison.planned.points}</strong> Punkten ·
                Aussage{' '}
                <strong id="probe-comparison-statement">
                  {comparison.chapter.statement.id}
                </strong>{' '}
                · Tabellenzeilen{' '}
                <strong id="probe-comparison-rows">{comparison.planned.tableRows}</strong>
              </p>
            )}
            {/*
              B23c-4 — die drei Hinweise bei der Kern-Kennzahl und die ENTSCHEIDUNGEN des
              Schlusskapitels, vor dem Erzeugen sichtbar. Wieder die Produktionsfunktionen
              (`buildReportSummary` / `buildBasisChapter` / `tariffVintageNote`).

              ⚠ Die Hinweis-Kennungen stehen als LISTE da und nicht als „ja/nein": gemessen wird,
              dass jeder Fall GENAU EINEN trägt — welcher, und vor allem welche beiden nicht.
            */}
            <p className="text-text-muted">
              Kennzahl-Hinweise:{' '}
              <strong id="probe-notices">
                {basis && basis.noticeIds.length > 0 ? basis.noticeIds.join(', ') : 'keine'}
              </strong>
            </p>
            {basis && (
              <p className="text-text-muted">
                Datenqualitäts-Kasten:{' '}
                <strong id="probe-basis-dataquality">
                  {basis.chapter.dataQuality ? 'ja' : 'nein'}
                </strong>{' '}
                · Blocker-Befund:{' '}
                <strong id="probe-basis-blocker">{basis.chapter.blocker ? 'ja' : 'nein'}</strong> ·
                Preisstand-Hinweis:{' '}
                <strong id="probe-basis-vintage">
                  {basis.chapter.tariffVintage ? 'ja' : 'nein'}
                </strong>{' '}
                · Tarifstand:{' '}
                <strong id="probe-basis-tariffsource">
                  {basis.tariffSource ? basis.tariffSource.tariffSetId : 'keiner gewählt'}
                </strong>
              </p>
            )}
            {/*
              ⚠ DIE ROHEN Werte der Annahmen-Tabelle, unverändert aus dem Contract — dieselben
              Felder, die `print-assumptions-snapshot.tsx` am Bildschirm liest. Sie stehen hier,
              damit ein Prüflauf die GEDRUCKTE Tabelle gegen die `AnalysisResult`-Instanz halten
              kann statt gegen die Ableitung, die sie erzeugt hat: der Vergleich zweier Ausgaben
              DERSELBEN Funktion ist eine Tautologie und fände ein falsch gelesenes Feld nicht.
            */}
            {analysis && (
              <p className="text-text-muted">
                Annahmen (roh):{' '}
                <strong id="probe-assumptions-raw">
                  {JSON.stringify({
                    billingModel: analysis.assumptions.billingModel,
                    horizonYears: analysis.assumptions.horizonYears,
                    energyPriceCtPerKwh: analysis.assumptions.energyPriceCtPerKwh,
                    einspeiseverguetungCtPerKwh: analysis.assumptions.einspeiseverguetungCtPerKwh,
                    roundTripEfficiency: analysis.assumptions.roundTripEfficiency,
                    battery: (() => {
                      const r =
                        analysis.perBattery.find(
                          (p) => p.battery.id === analysis.recommendation.batteryId,
                        ) ?? analysis.perBattery[0]
                      return r
                        ? {
                            name: r.battery.name,
                            pricePerKwh: r.battery.pricePerKwh,
                            totalInvestment: r.totalInvestment,
                            netInvestment: r.netInvestment,
                            taxEffectsIncluded: r.taxEffectsIncluded,
                          }
                        : null
                    })(),
                  })}
                </strong>
              </p>
            )}
            {/*
              ⚠ DER ROHE Befund, unverändert aus dem Contract — Seite, Grund und die Zeitbereiche
              als UTC-ISO. Er steht hier, damit ein Prüflauf den GEDRUCKTEN Text gegen die
              Datenlage halten kann statt bloss festzustellen, dass irgendein Zeitraum im Dokument
              steht (dieselbe Rolle wie `detailFlowDays` beim Energiefluss-Tag). Der Prüfstand
              leitet daraus NICHTS ab.
            */}
            {analysis?.tariffOptimization && !analysis.tariffOptimization.computable && (
              <p className="text-text-muted">
                Blocker (roh):{' '}
                <strong id="probe-blocker-raw">
                  {analysis.tariffOptimization.side} · {analysis.tariffOptimization.kind} ·{' '}
                  {analysis.tariffOptimization.ranges
                    .map((r) => `${r.fromIso}…${r.toIso}`)
                    .join(' | ') || 'keine Bereiche'}
                </strong>
              </p>
            )}
            {basis && (
              <ul id="probe-basis-assumptions" className="flex flex-col gap-0.5 text-text-muted">
                {basis.chapter.assumptions.rows.map((row) => (
                  <li key={row.label} data-row={row.label}>
                    {row.label}: {row.value}
                  </li>
                ))}
              </ul>
            )}
            <ul id="probe-summary" className="flex flex-col gap-0.5 text-text-muted">
              {summary.statements.map((statement) => (
                <li key={statement.id} data-statement={statement.id}>
                  {statement.title}
                  {statement.amount ? ` — ${statement.amount.value}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="probe-title">Titel des Dokuments</Label>
          <Input
            id="probe-title"
            value={title}
            onChange={(e) => setTitleOverride(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Vorschlag: <span id="probe-suggested-title">{suggestedTitle}</span>
          </p>
        </div>

        <p className="text-sm text-text-muted">
          Untertitel (abgeleitet, nicht editierbar): <strong id="probe-subtitle">{subtitle}</strong>
        </p>
        <p className="text-sm text-text-muted">
          Zeitraum (abgeleitet): <strong id="probe-period">{period ?? '—'}</strong>
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="probe-name">Name</Label>
            <Input id="probe-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="probe-company">Firma</Label>
            <Input id="probe-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="probe-address">Adresse (mehrzeilig, optional)</Label>
          <Textarea
            id="probe-address"
            value={address}
            rows={3}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div>
          {/*
            ⚠ GESPERRT, SOLANGE NICHTS GERECHNET IST — der Report trägt seit B23c-1 ein Ergebnis
            (`PdfReportInput.analysis` ist Pflicht), und ohne eines gibt es kein Dokument. Ein
            Knopf, der dann eine Ausnahme wirft, sähe wie ein Defekt aus.
          */}
          <Button
            id="probe-generate"
            onClick={() => void handleGenerate()}
            disabled={pending || analysis === null}
          >
            <FileText className="h-4 w-4" />
            {pending ? 'Wird erzeugt …' : 'PDF erzeugen'}
          </Button>
          {analysis === null && (
            <p className="mt-1 text-xs text-text-muted">
              Erst rechnen — die Kernergebnis-Seite entsteht aus dem Ergebnis, nicht aus Vorgaben.
            </p>
          )}
        </div>
      </div>

      {outcome && (
        <div id="probe-outcome" className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p>
            Datei: <strong>{outcome.fileName}</strong>
          </p>
          <p>
            Seiten: <strong id="probe-total-pages">{outcome.totalPages}</strong> · Durchläufe:{' '}
            <strong id="probe-passes">{outcome.passes}</strong> · Agenda mit Seitenzahlen:{' '}
            <strong id="probe-agenda-numbers">{outcome.agendaHasPageNumbers ? 'ja' : 'nein'}</strong>
          </p>
          {/*
            ⚠ `Chart-Rasterungen` muss der Zahl der tatsächlich gezeigten Bilder entsprechen —
            UNABHÄNGIG von der Zahl der Durchläufe daneben. Das ist die eine Zusage dieses
            Schritts, die man sonst nur behaupten könnte; der Zähler sitzt an der Rasterung
            (`charts.tsx`), nicht an ihrem Aufrufer.
          */}
          <p>
            Chart-Rasterungen für dieses Dokument:{' '}
            <strong id="probe-chart-builds">{outcome.chart.builds}</strong> · Dauer:{' '}
            <strong id="probe-report-chart-ms">{Math.round(outcome.chart.captureMs)} ms</strong> ·
            Kosten-Chart:{' '}
            <strong id="probe-report-cost-kind">{outcome.chart.costKind ?? 'keiner'}</strong> ·
            Energiefluss-Tag:{' '}
            <strong id="probe-report-flow-day">{outcome.chart.flowDay ?? '—'}</strong> ·
            Grenznutzen-Kurve:{' '}
            <strong id="probe-report-comparison-variant">
              {outcome.chart.comparisonVariant ?? 'keine'}
            </strong>
          </p>
          {CHART_FIGURES.map(({ key, label }) => {
            const fig = outcome.chart[key]
            return fig.px && fig.embeddedPt ? (
              <p key={key}>
                {label}:{' '}
                <strong id={`probe-report-${key}-px`}>
                  {fig.px.width} × {fig.px.height} px
                </strong>{' '}
                · Seitenverhältnis Bild:{' '}
                <strong id={`probe-report-${key}-raster-ratio`}>
                  {fig.aspectRatio?.toFixed(6)}
                </strong>{' '}
                · eingebettet mit{' '}
                <strong id={`probe-report-${key}-pt`}>
                  {fig.embeddedPt.width.toFixed(2)} × {fig.embeddedPt.height.toFixed(2)} pt
                </strong>
                {key === 'load' && (
                  <>
                    {' '}
                    · Stützpunkte der Kurve:{' '}
                    <strong id="probe-report-chart-vertices">{outcome.chart.loadVertices}</strong>
                  </>
                )}
              </p>
            ) : (
              <p key={key} id={`probe-report-${key}-missing`} className="text-text-muted">
                {label}: kein Bild{fig.error ? ` — ${fig.error}` : ' (für diesen Fall keines)'}
              </p>
            )
          })}
        </div>
      )}

      {error && (
        <p id="probe-error" role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">B23b — Chart als Rasterbild</h2>
          <p className="mt-1 text-sm text-text-muted">
            Drei strukturell verschiedene Chart-Typen, je ein eigener Lauf und ein eigenes Mini-PDF
            mit genau diesem einen Bild. Gemountet werden die unveränderten Report-Komponenten mit
            ihren echten Props, abseits des Sichtfelds.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            id="probe-chart-monthly"
            variant="secondary"
            onClick={() => void handleChart('monthly')}
            disabled={chartPending !== null}
          >
            <ImageDown className="h-4 w-4" />
            {chartPending === 'monthly' ? 'Wird erzeugt …' : 'Balken (Monatsvergleich)'}
          </Button>
          <Button
            id="probe-chart-heatmap"
            variant="secondary"
            onClick={() => void handleChart('heatmap')}
            disabled={chartPending !== null}
          >
            <ImageDown className="h-4 w-4" />
            {chartPending === 'heatmap' ? 'Wird erzeugt …' : 'Raster (Heatmap)'}
          </Button>
          <Button
            id="probe-chart-load"
            variant="secondary"
            onClick={() => void handleChart('load')}
            disabled={chartPending !== null}
          >
            <ImageDown className="h-4 w-4" />
            {chartPending === 'load' ? 'Wird erzeugt …' : 'Lastgang (35.040 Punkte)'}
          </Button>
        </div>

        {chartReport && (
          <div id="probe-chart-outcome" className="flex flex-col gap-2 text-sm">
            <p>
              <strong id="probe-chart-label">{chartReport.label}</strong> — Datei:{' '}
              <strong>{chartReport.fileName}</strong>
            </p>
            <p className="text-text-muted">
              Rasterbild:{' '}
              <strong id="probe-chart-px">
                {chartReport.widthPx} × {chartReport.heightPx} px
              </strong>{' '}
              · Seitenverhältnis Bild:{' '}
              <strong id="probe-chart-raster-ratio">
                {chartReport.rasterAspectRatio.toFixed(6)}
              </strong>{' '}
              · im PDF eingebettet mit{' '}
              <strong id="probe-chart-pt">
                {chartReport.imageWidthPt.toFixed(2)} × {chartReport.imageHeightPt.toFixed(2)} pt
              </strong>{' '}
              · Seitenverhältnis Einbettung:{' '}
              <strong id="probe-chart-image-ratio">{chartReport.imageAspectRatio.toFixed(6)}</strong>
            </p>
            <p className="text-text-muted">
              Dauer bis zum fertigen Raster:{' '}
              <strong id="probe-chart-ms">{Math.round(chartReport.captureMs)} ms</strong> ·
              Data-URI:{' '}
              <strong id="probe-chart-datalen">
                {Math.round(chartReport.dataUrlLength / 1024)} kB
              </strong>
            </p>

            {chartReport.vertices && (
              <p className="text-text-muted">
                Stützpunkte der Kurve — roh:{' '}
                <strong id="probe-chart-vertices-raw">{chartReport.vertices.raw}</strong> · im SVG
                gezeichnet:{' '}
                <strong id="probe-chart-vertices-drawn">{chartReport.vertices.drawn}</strong>
              </p>
            )}

            <ul id="probe-chart-colors" className="flex flex-col gap-0.5 text-text-muted">
              {chartReport.colorSamples.map((sample) => (
                <li
                  key={sample.hex}
                  data-hex={sample.hex}
                  data-pixels={sample.pixels}
                  data-exact-pixels={sample.exactPixels}
                  data-tolerance={sample.tolerance}
                >
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm align-middle"
                    style={{ backgroundColor: sample.hex }}
                    aria-hidden
                  />
                  {sample.label} (<code>{sample.token}</code> = {sample.hex}):{' '}
                  <strong className={sample.ok ? 'text-positive' : 'text-negative'}>
                    {sample.pixels} Bildpunkte
                  </strong>
                  {sample.tolerance > 0
                    ? ` (Toleranz ±${sample.tolerance} je Kanal; bit-genau: ${sample.exactPixels})`
                    : ' (bit-genau)'}
                </li>
              ))}
            </ul>

            {/*
              B23c-3b-1 — die Zellprobe: welche Farbe hat GENAU diese Zelle im fertigen Bild
              bekommen. Sie beantwortet als einzige die Frage „bleibt eine leere Zelle von einer
              gemessenen Null unterscheidbar" — eine blosse Farbzählung könnte das nicht, weil eine
              leere Zelle papierweiss ist und Papierweiss ohnehin überall steht.
            */}
            {chartReport.cellProbes && chartReport.cellProbes.length > 0 && (
              <ul id="probe-chart-cells" className="flex flex-col gap-0.5 text-text-muted">
                {chartReport.cellProbes.map((cell) => (
                  <li
                    key={cell.label}
                    data-hour={cell.hour}
                    data-month={cell.month}
                    data-value={cell.value === null ? 'null' : String(cell.value)}
                    data-hex={cell.hex}
                    data-border-style={cell.borderStyle}
                  >
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-border align-middle"
                      style={{ backgroundColor: cell.hex }}
                      aria-hidden
                    />
                    {cell.label} — Zelle [{cell.hour}h / Monat {cell.month + 1}], Wert{' '}
                    <code>{cell.value === null ? 'null' : cell.value}</code>: im Bild{' '}
                    <strong>{cell.hex}</strong> (berechnet <code>{cell.computed}</code>, Rand{' '}
                    <code>{cell.borderStyle}</code>)
                  </li>
                ))}
              </ul>
            )}

            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-text-muted">
              {chartReport.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        {chartError && (
          <p id="probe-chart-error" role="alert" className="text-sm text-negative">
            {chartError}
          </p>
        )}
      </div>
    </div>
  )
}
