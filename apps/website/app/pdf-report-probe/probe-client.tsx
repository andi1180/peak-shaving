'use client'

import { useState } from 'react'
import { Calculator, FileText, ImageDown } from 'lucide-react'
import type { AnalysisResult, LoadProfile } from 'shared'

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

/** Nur das eine Feld, das `reportSubtitle` tatsächlich liest — plus die zwei für den Zeitraum. */
function probeProfile(
  standardProfile: boolean,
): Pick<LoadProfile, 'source' | 'readings' | 'timezoneMeta'> {
  return {
    source: standardProfile ? 'standard_profile' : 'net_signed',
    timezoneMeta: 'Europe/Vienna',
    /* Erster und letzter Zeitstempel genügen — `formatAnalysisPeriod` liest genau die zwei. */
    readings: [
      { ts: '2024-12-31T23:00:00.000Z', gridPowerKw: 0 },
      { ts: '2025-12-31T22:45:00.000Z', gridPowerKw: 0 },
    ],
  }
}

export function PdfReportProbe() {
  const [standardProfile, setStandardProfile] = useState(false)
  const [probeKind, setProbeKind] = useState<SummaryProbeKind>('bestand')
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [summary, setSummary] = useState<ReportSummary | null>(null)
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

  const subtitle = reportSubtitle(probeProfile(standardProfile))
  const period = formatAnalysisPeriod(probeProfile(standardProfile))

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
    setAnalysisKind(null)
    setOutcome(null)
    setAnalysisPending(true)
    const started = performance.now()
    try {
      /* Zieht den Lastgang (35.040 Werte) und die Spotpreis-Reihe — erst hier, nicht beim Laden. */
      const { runSummaryAnalysis } = await import('./analysis-run')
      const run = await runSummaryAnalysis(probeKind)
      setAnalysisMs(performance.now() - started)
      setAnalysis(run.result)
      /* DIE Produktionsfunktion, gelaufen in `analysis-run.ts` — der Prüfstand zeigt, was das
         Dokument gleich rendern wird, statt es nachzubauen. */
      setSummary(run.summary)
      setAnalysisKind(probeKind)
      /* Ein neuer Fall bringt einen neuen Vorschlag — ein Titel von Hand bleibt trotzdem stehen. */
    } catch (cause) {
      setAnalysisError(cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    } finally {
      setAnalysisPending(false)
    }
  }

  async function handleGenerate() {
    if (!analysis) return
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
      setChartReport(await runChartProbe(kind))
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
          Seitenverweisen, Methodik). B23c-1 — Kernergebnisse aus einem ECHTEN, hier im Browser
          gerechneten Ergebnis. Interne Route, nicht verlinkt, <code>noindex</code>. Der Export im
          Rechner ist davon unberührt und läuft weiter über den Druckdialog.
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

        <label className="flex items-center gap-2 text-sm">
          <input
            id="probe-standard-profile"
            type="checkbox"
            checked={standardProfile}
            onChange={(e) => setStandardProfile(e.target.checked)}
          />
          Standardlastprofil statt gemessenem Lastgang (<code>source</code>)
        </label>

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
