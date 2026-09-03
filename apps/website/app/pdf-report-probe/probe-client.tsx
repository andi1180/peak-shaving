'use client'

import { useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import type { AnalysisResult, LoadProfile } from 'shared'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ReportPdfOutcome } from '@/lib/pdf-report/download'
import {
  defaultReportTitle,
  formatAnalysisPeriod,
  formatPrintedAt,
  reportSubtitle,
} from '@/lib/pdf-report/derive'

/**
 * B23a — Prüfstand-Oberfläche.
 *
 * ── DIE ABLEITUNGEN LAUFEN ECHT, DIE EINGANGSGRÖSSEN SIND SYNTHETISCH ──────────────────────────
 * `defaultReportTitle`, `reportSubtitle` und `formatAnalysisPeriod` sind DIE Produktionsfunktionen
 * aus `lib/pdf-report/derive.ts` — sie werden hier nicht nachgebaut. Was synthetisch ist, sind ihre
 * Eingaben: der Prüfstand hat keinen Rechenlauf, und einen zu erfinden hiesse, ein vollständiges
 * `AnalysisResult` zusammenzusetzen, von dem die Ableitung ein einziges Feld liest. Genau deshalb
 * nehmen die drei Funktionen strukturelle Teilmengen entgegen (`Pick<…>`).
 *
 * ⚠ `@react-pdf/renderer` wird hier NICHT importiert. Der Weg dorthin ist der dynamische Import in
 * `lib/pdf-report/download.ts`, und zwar erst im Klick-Handler — sonst läge der Lazy-Chunk (Spike
 * §3: ≈ 307 kB gzip) im First Load dieser Route.
 */

/** Nur die zwei Felder, die `defaultReportTitle` bzw. `reportSubtitle` tatsächlich lesen. */
type ProbeToggles = { tariffLever: boolean; standardProfile: boolean }

function probeResult(toggles: ProbeToggles): Pick<AnalysisResult, 'tariffOptimization'> {
  return { tariffOptimization: toggles.tariffLever ? { computable: true } : undefined }
}

function probeProfile(
  toggles: ProbeToggles,
): Pick<LoadProfile, 'source' | 'readings' | 'timezoneMeta'> {
  return {
    source: toggles.standardProfile ? 'standard_profile' : 'net_signed',
    timezoneMeta: 'Europe/Vienna',
    /* Erster und letzter Zeitstempel genügen — `formatAnalysisPeriod` liest genau die zwei. */
    readings: [
      { ts: '2024-12-31T23:00:00.000Z', gridPowerKw: 0 },
      { ts: '2025-12-31T22:45:00.000Z', gridPowerKw: 0 },
    ],
  }
}

export function PdfReportProbe() {
  const [tariffLever, setTariffLever] = useState(true)
  const [standardProfile, setStandardProfile] = useState(false)
  const [name, setName] = useState('Anna Gruber')
  const [company, setCompany] = useState('Bäckerei Gruber GmbH')
  const [address, setAddress] = useState('Hauptstraße 12\n2100 Korneuburg')
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<ReportPdfOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggles = useMemo(() => ({ tariffLever, standardProfile }), [tariffLever, standardProfile])
  const suggestedTitle = defaultReportTitle(probeResult(toggles))
  const subtitle = reportSubtitle(probeProfile(toggles))
  const period = formatAnalysisPeriod(probeProfile(toggles))

  /*
   * Der Titel folgt dem Vorschlag, solange niemand ihn angefasst hat — sobald doch, gehört er dem
   * Nutzer. Dieselbe Regel wie im Gate-Dialog, nur dass sich der Vorschlag hier per Umschalter
   * ändern kann und die Nachführung deshalb sichtbar wird.
   */
  const [titleOverride, setTitleOverride] = useState<string | null>(null)
  const title = titleOverride ?? suggestedTitle

  async function handleGenerate() {
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">PDF-Report-Prüfstand</h1>
        <p className="mt-1 text-sm text-text-muted">
          B23a — Dokumentgerüst (Deckblatt, Kopf-/Fusszeile mit Seitenzahl, Agenda mit
          Seitenverweisen, Methodik). Interne Route, nicht verlinkt, <code>noindex</code>. Der
          Export im Rechner ist davon unberührt und läuft weiter über den Druckdialog.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            id="probe-tariff-lever"
            type="checkbox"
            checked={tariffLever}
            onChange={(e) => setTariffLever(e.target.checked)}
          />
          Ladeoptimierung berechenbar (<code>tariffOptimization.computable</code>)
        </label>
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
          <Button id="probe-generate" onClick={() => void handleGenerate()} disabled={pending}>
            <FileText className="h-4 w-4" />
            {pending ? 'Wird erzeugt …' : 'PDF erzeugen'}
          </Button>
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
    </div>
  )
}
