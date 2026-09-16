'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { Database } from '@/db-types'
import {
  defaultReportTitle,
  formatAnalysisPeriod,
  reportSubtitle,
} from '@/lib/pdf-report/derive'
import {
  REPORT_UNAVAILABLE,
  buildReportInputFromRenderRequest,
  readRenderRequest,
  type ReportRenderRequest,
} from '@/lib/pdf-report/build-report-input'

/**
 * D12 Abschluss — die Leseseite einer Report-Übergabe.
 *
 * Sie holt eine fremd gerechnete Analyse (`public.get_report_render_request`), baut daraus die
 * Eingangsgrössen des Dokuments und erzeugt das PDF im Browser. Gerechnet wird hier NICHTS: das
 * Ergebnis steht fertig in der Übergabe, und ein zweiter Lauf an dieser Stelle wäre eine zweite
 * Zahl zu derselben Auslegung.
 *
 * ── ⚠ UNANGEMELDET, UND DAS IST DIE ENTSCHEIDUNG DER MIGRATION ────────────────────────────────
 * `apps/website` hat keine Anmeldung. Was den Zugriff begrenzt, ist die unratbare Kennung, das
 * Fehlen jeder Auflistungsfunktion und `expires_at` — nicht diese Seite. Sie fügt deshalb auch
 * keine eigene „Prüfung" hinzu, die den Eindruck einer Absicherung erweckte, die es nicht gibt.
 *
 * ── ⚠ DAS PDF ENTSTEHT AUF KLICK UND NICHT BEIM LADEN ─────────────────────────────────────────
 * `downloadReportPdf` holt beim ERSTEN Aufruf einer Sitzung den Lazy-Chunk (≈ 307 kB gzip) und
 * rastert danach sechs Bilder; der Knopf trägt dafür den Ladezustand, den `download.ts` ausdrücklich
 * verlangt. Ein Download, der sich beim Seitenaufbau von selbst auslöst, hätte keinen Ort für
 * diesen Zustand — und der Browser blockte ihn ohne Nutzergeste ohnehin.
 */

/*
 * Der anon-Lesezugang. Dieselben drei `auth`-Einstellungen wie in `lib/tariff-data/client.ts` und
 * aus demselben Grund: supabase-js legte sonst von sich aus einen Sitzungsschlüssel im
 * `localStorage` an — eine Speicherung auf dem Endgerät im Sinne von §165 TKG, die dieser Seite
 * einen Cookie-Banner einbrächte, obwohl sich hier niemand anmeldet.
 *
 * ⚠ Die literalen `process.env.NEXT_PUBLIC_*`-Ausdrücke sind Pflicht: Next ersetzt zur Bauzeit
 * genau diesen Text, ein dynamischer Zugriff bliebe im Browser `undefined`.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

type ViewState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; request: ReportRenderRequest }

export function ReportRenderView({ requestId }: { requestId: string }) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [pending, setPending] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      /*
       * Eine nicht eingerichtete Umgebung endet in DERSELBEN Meldung: „wir konnten nicht fragen"
       * verrät sonst, dass es an der Seite und nicht an der Kennung liegt — und für den Leser
       * ändert es an der Lage nichts.
       */
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        if (active) setState({ kind: 'unavailable' })
        return
      }
      const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const readout = readRenderRequest(
        await supabase.rpc('get_report_render_request', { p_id: requestId }),
      )
      if (!active) return
      setState(
        readout.status === 'ok'
          ? { kind: 'ready', request: readout.request }
          : { kind: 'unavailable' },
      )
    }

    void load()
    return () => {
      active = false
    }
  }, [requestId])

  async function handleGenerate(request: ReportRenderRequest) {
    setError(null)
    setFileName(null)
    setPending(true)
    try {
      /* Zieht `@react-pdf/renderer` — deshalb erst hier, nicht auf Modulebene (s. `download.ts`). */
      const { downloadReportPdf } = await import('@/lib/pdf-report/download')
      const now = new Date()
      const outcome = await downloadReportPdf(
        buildReportInputFromRenderRequest(request, now),
        now,
      )
      setFileName(outcome.fileName)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    } finally {
      setPending(false)
    }
  }

  if (state.kind === 'loading') {
    return <p className="text-sm text-text-muted">Report wird geladen …</p>
  }

  if (state.kind === 'unavailable') {
    return (
      <p id="report-unavailable" className="text-sm text-ink">
        {REPORT_UNAVAILABLE}
      </p>
    )
  }

  /*
   * ⚠ DIE ANZEIGE LÄUFT ÜBER DIESELBEN ABLEITUNGEN WIE DAS DOKUMENT (`derive.ts`) — aber NICHT über
   * `buildReportInputFromRenderRequest`: das braucht einen Zeitpunkt, und einen hier im Rendern zu
   * nehmen hiesse, bei jedem Durchlauf einen anderen zu nehmen als den, mit dem gleich das PDF
   * entsteht. Was oben steht, ist damit Zeile für Zeile das, was auch auf dem Deckblatt steht.
   */
  const { analysisResult, loadProfile, meta } = state.request
  const period = formatAnalysisPeriod(loadProfile)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{defaultReportTitle(analysisResult)}</h1>
        <p className="mt-1 text-sm text-text-muted">{reportSubtitle(loadProfile)}</p>
        {meta.customerLabel && <p className="mt-3 text-sm text-ink">{meta.customerLabel}</p>}
        {period && <p className="text-sm text-text-muted">Ausgewerteter Zeitraum: {period}</p>}
      </div>

      <div>
        <Button onClick={() => void handleGenerate(state.request)} disabled={pending}>
          <FileText className="h-4 w-4" />
          {pending ? 'Wird erzeugt …' : 'Report als PDF herunterladen'}
        </Button>
        {fileName && (
          <p className="mt-2 text-sm text-text-muted">
            Heruntergeladen: <strong>{fileName}</strong>
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-negative">
            Der Report konnte nicht erzeugt werden: {error}
          </p>
        )}
      </div>
    </div>
  )
}
