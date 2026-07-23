import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { AdminError, AdminPanel, formatDateTime } from '@/components/admin/ui'
import {
  AnalysisUploadForm,
  type LeadOption,
  type SupersedableAnalysis,
} from '@/components/admin/analysis-upload-form'
import {
  ANALYSES_HREF,
  ANALYSIS_NEW_HREF,
  SUCCESSOR_SCAN_LIMIT,
  readAnalysisList,
} from '@/lib/admin/analyses'
import { readLeadList } from '@/lib/admin/leads'

/*
 * `/admin/analysen/neu` — Bündel und Ursprungsdatei hochladen (B14-2).
 *
 * ── DIE LEAD-SUCHE IST EIN EIGENES GET-FORMULAR ─────────────────────────────────────────────────
 * Dieselbe Bauart wie der Filter auf `/admin/leads` (B1-3): der Suchbegriff steht in der URL,
 * gefiltert wird in SQL (`admin_list_leads`, Freitext über E-Mail und Firma), es gibt keinen
 * zweiten Ort für den Suchzustand und es funktioniert ohne JavaScript.
 *
 * Es ist bewusst NICHT Teil des Upload-Formulars: ein verschachteltes Formular gibt es in HTML
 * nicht, und ein clientseitiger Suchdialog wäre ein eigener Datenweg neben dem, den die Lead-Liste
 * bereits hat. Der Preis ist ein Neuladen der Seite — die Oberfläche sagt deshalb ausdrücklich,
 * dass zuerst gesucht und dann die Dateien gewählt werden sollten.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

const LEAD_RESULT_LIMIT = 25

type RawQuery = Record<string, string | string[] | undefined>

function one(query: RawQuery, key: string): string {
  const value = query[key]
  return typeof value === 'string' ? value : ''
}

export default async function NewAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<RawQuery>
}) {
  // Kein Zugang → gar keinen Inhalt erzeugen. Was der Nutzer stattdessen SIEHT, entscheidet das
  // Layout; hier geht es darum, dass nichts entsteht, das mitgeschickt werden kann.
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const leadSearch = one(query, 'lead-suche').trim()
  const prefilledSupersedesId = one(query, 'ersetzt')

  const supabase = await createClient()

  /*
   * Zwei unabhängige Aufrufe. Die Lead-Suche läuft nur, wenn tatsächlich gesucht wurde — eine
   * ungefragte Liste der neuesten 25 Leads wäre eine Auswahl, aus der man versehentlich den
   * falschen nimmt, und die Zuordnung ist danach unveränderlich.
   */
  const [leadRes, analysesRes] = await Promise.all([
    leadSearch === ''
      ? Promise.resolve({ data: null, error: null })
      : supabase.rpc('admin_list_leads', {
          p_limit: LEAD_RESULT_LIMIT,
          p_offset: 0,
          p_search: leadSearch,
        }),
    supabase.rpc('admin_list_analyses', { p_limit: SUCCESSOR_SCAN_LIMIT, p_offset: 0 }),
  ])

  if (leadRes.error) console.error('[admin/analysen/neu] admin_list_leads:', leadRes.error)
  if (analysesRes.error)
    console.error('[admin/analysen/neu] admin_list_analyses:', analysesRes.error)

  const leadResult = leadSearch === '' ? null : readLeadList(leadRes.data)
  const leadOptions: LeadOption[] = (leadResult?.leads ?? []).map((lead) => ({
    id: lead.id,
    email: lead.email,
    company: lead.company,
  }))

  const analyses = readAnalysisList(analysesRes.data)
  const supersedable: SupersedableAnalysis[] = (analyses?.analyses ?? []).map((a) => ({
    id: a.id,
    customerLabel: a.customer_label,
    siteLabel: a.site_label,
    createdAt: formatDateTime(a.created_at),
  }))

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Analyse archivieren</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Der Rechner exportiert ein Bündel, hier wird es zusammen mit der Ursprungsdatei abgelegt.
          Was einmal abgelegt ist, bleibt unverändert: eine Korrektur ist eine neue Analyse, die die
          alte ersetzt.
        </p>
        <p className="mt-3 max-w-prose text-small text-text-muted">
          <Link
            href={ANALYSES_HREF}
            className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Zur Analysen-Liste
          </Link>
        </p>
      </header>

      {/* ── Lead-Suche (eigenes GET-Formular, s. Kopf) ────────────────────────────────────────── */}
      <AdminPanel className="mt-6">
        <form method="get" action={ANALYSIS_NEW_HREF} className="flex flex-col gap-3">
          {/* Damit eine Vorbelegung aus der Detailseite eine Suche überlebt. */}
          {prefilledSupersedesId && (
            <input type="hidden" name="ersetzt" value={prefilledSupersedesId} />
          )}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="lead-suche">Lead suchen (E-Mail oder Firma)</Label>
              <div className="mt-1.5">
                <Input
                  id="lead-suche"
                  name="lead-suche"
                  type="search"
                  defaultValue={leadSearch}
                  placeholder="teil einer Adresse oder Firma"
                />
              </div>
            </div>
            <Button type="submit" variant="secondary" size="md">
              Suchen
            </Button>
          </div>
          <p className="max-w-prose text-caption text-text-muted">
            Die Suche lädt die Seite neu — <strong>zuerst suchen, dann die Dateien wählen</strong>,
            sonst ist die Dateiauswahl danach wieder leer. Die Zuordnung ist optional; ohne sie
            bleibt die Analyse trotzdem über „Kunde“ auffindbar.
          </p>
        </form>
      </AdminPanel>

      <AdminPanel className="mt-6">
        {analyses === null ? (
          <AdminError>
            Die Liste der bestehenden Analysen konnte nicht geladen werden. Ein Upload ist trotzdem
            möglich — nur die Auswahl „ersetzt eine bestehende Analyse“ bleibt leer.
          </AdminError>
        ) : null}
        <AnalysisUploadForm
          leadOptions={leadOptions}
          leadSearch={leadSearch}
          supersedable={supersedable}
          prefilledSupersedesId={prefilledSupersedesId}
        />
      </AdminPanel>

      <p className="mt-6 max-w-prose text-caption text-text-muted">
        Es gibt bewusst keinen „Analyse speichern“-Knopf im Rechner und keinen zweiten Rechner hier:
        Kalkulator und Verwaltung sind getrennte Anwendungen mit getrennten Sitzungen, und das
        Archivieren einer betreuten Analyse soll eine bewusste Handlung sein — kein Nebeneffekt
        jedes Rechenlaufs. Der öffentliche Rechner behält damit unverändert die Zusage, dass
        Verbrauchsdaten den Browser nicht verlassen; das Bündel entsteht dort lokal.
      </p>
    </Container>
  )
}
