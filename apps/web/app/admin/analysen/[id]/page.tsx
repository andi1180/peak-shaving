import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { AdminError, AdminPanel, Pill, formatDateTime } from '@/components/admin/ui'
import {
  ANALYSES_HREF,
  ANALYSIS_NEW_HREF,
  SUCCESSOR_SCAN_LIMIT,
  analysisHref,
  analysisKindLabel,
  analysisSourceHref,
  buildSuccessorIndex,
  formatBytes,
  readAnalysisDetail,
  readAnalysisList,
  readStatus,
  shortSha,
} from '@/lib/admin/analyses'

/*
 * `/admin/analysen/[id]` — eine eingefrorene Analyse (B14-2).
 *
 * ── HIER WIRD NICHTS NACHGEBAUT ─────────────────────────────────────────────────────────────────
 * Kein Chart, keine Kennzahl, die nicht gespeichert ist, und ausdrücklich keine Neuberechnung.
 * Gezeigt wird, was in der Zeile steht — `inputs` und `result` als Rohtext zum Aufklappen. Eine
 * nachgebaute Report-Ansicht wäre eine zweite Darstellung derselben Zahlen, die mit jeder Änderung
 * am Rechner auseinanderliefe; und eine Neuberechnung wäre genau der Weg, auf dem eine eingefrorene
 * Baseline mit einem Aufruf verschwindet (B14-1, „TEIL 4 — Was es hier bewusst nicht gibt").
 *
 * ── DER BLOB WIRD NICHT MITGELADEN ──────────────────────────────────────────────────────────────
 * `admin_get_analysis` liefert die GRÖSSE der archivierten Datei, nicht die Datei. Sie fliesst erst
 * über die eigene Route (`./datei`), also auf ausdrückliche Anforderung. Ein Seitenaufruf, der
 * nebenbei mehrere hundert Kilobyte mitzieht, tut das unbemerkt und bei JEDEM Öffnen.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-small text-ink">{children}</dd>
    </div>
  )
}

/** Eine der fünf typisierten Auszüge als Kennzahl. */
function Metric({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div>
      <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-h3 text-ink">
        <Num>{value}</Num>
      </p>
      {note && <p className="mt-0.5 text-caption text-text-muted">{note}</p>}
    </div>
  )
}

/**
 * `inputs`/`result` zum Aufklappen.
 *
 * `<details>` statt eines Client-Zustands: die Seite braucht dafür kein JavaScript, und der Inhalt
 * steht im HTML — er soll sich kopieren und durchsuchen lassen. Der Preis ist, dass das vollständige
 * Ergebnis (samt Dispatch-Spuren) mit ausgeliefert wird, auch wenn niemand aufklappt; das ist bei
 * einer Verwaltungsseite, die genau dafür da ist, die richtige Seite der Abwägung.
 */
function JsonBlock({ title, value, hint }: { title: string; value: unknown; hint: string }) {
  return (
    <details className="mt-4 rounded-md border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-small font-medium text-ink">
        {title}
      </summary>
      <div className="border-t border-line px-4 py-3">
        <p className="mb-3 max-w-prose text-caption text-text-muted">{hint}</p>
        <div className="max-h-[32rem] overflow-auto rounded-md bg-surface-sunken p-3">
          <pre className="whitespace-pre text-caption text-ink">
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  )
}

export default async function AnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params
  const supabase = await createClient()

  const [detailRes, scanRes] = await Promise.all([
    supabase.rpc('admin_get_analysis', { p_id: id }),
    // Für Vorgängerin UND Nachfolgerin: die Zeile selbst kennt nur ihre Vorgängerin (`supersedes_id`),
    // und für beide Richtungen braucht es zusätzlich die Bezeichnung. Ein zweites
    // `admin_get_analysis` für die Vorgängerin zöge deren vollständiges `inputs`/`result` mit —
    // für eine einzige Beschriftung.
    supabase.rpc('admin_list_analyses', { p_limit: SUCCESSOR_SCAN_LIMIT, p_offset: 0 }),
  ])

  if (detailRes.error) console.error('[admin/analysen/[id]] admin_get_analysis:', detailRes.error)
  if (scanRes.error) console.error('[admin/analysen/[id]] admin_list_analyses:', scanRes.error)

  const status = readStatus(detailRes.data)
  const analysis = readAnalysisDetail(detailRes.data)

  if (status === 'not_found') {
    return (
      <Container className="py-10 sm:py-14">
        <h1 className="text-h2 text-ink">Analyse nicht gefunden</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Diesen Schlüssel gibt es nicht. Analysen werden nie gelöscht — der Link ist also veraltet
          oder falsch abgetippt.
        </p>
        <div className="mt-4">
          <Button asChild variant="secondary" size="md">
            <Link href={ANALYSES_HREF}>Zur Liste</Link>
          </Button>
        </div>
      </Container>
    )
  }

  if (!analysis) {
    return (
      <Container className="py-10 sm:py-14">
        <AdminError>
          Die Analyse konnte nicht geladen werden. Bitte laden Sie die Seite neu.
        </AdminError>
      </Container>
    )
  }

  const scan = readAnalysisList(scanRes.data)
  const rows = scan?.analyses ?? []
  const successor = buildSuccessorIndex(rows).get(analysis.id)
  const predecessor = analysis.supersedes_id
    ? rows.find((r) => r.id === analysis.supersedes_id)
    : undefined
  const scanIncomplete = (scan?.total ?? 0) > SUCCESSOR_SCAN_LIMIT

  const savedKw = analysis.baseline_billed_kw_before - analysis.baseline_billed_kw_after

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <p className="text-caption text-text-muted">
          <Link
            href={ANALYSES_HREF}
            className="rounded-sm text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Analysen
          </Link>
        </p>
        <h1 className="mt-2 text-h2 text-ink">{analysis.customer_label}</h1>
        <p className="mt-1 text-body text-text-muted">
          {analysis.site_label ?? 'ohne Standortangabe'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone={analysis.analysis_kind === 'betreut' ? 'positive' : 'neutral'}>
            {analysisKindLabel(analysis.analysis_kind)}
          </Pill>
          {successor && <Pill tone="neutral">ersetzt</Pill>}
        </div>
      </header>

      {/* ── Unveränderlichkeit: der Satz steht oben, nicht im Kleingedruckten ─────────────────── */}
      <div
        role="note"
        className="mt-6 max-w-prose rounded-md border border-warning-border bg-warning-subtle p-4"
      >
        <p className="text-small text-ink">
          <strong className="font-semibold">Diese Analyse ist unveränderlich.</strong> Eingaben,
          Ergebnis, Baseline und Quelldatei lassen sich nicht ändern — auch nicht über die
          Datenbank, auch nicht als Administrator. Eine Korrektur ist eine <em>neue</em> Analyse,
          die diese hier ersetzt; die alte bleibt vollständig lesbar, samt dem Fehler, den sie
          enthielt.{' '}
          <Link
            href={`${ANALYSIS_NEW_HREF}?ersetzt=${analysis.id}`}
            className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ersetzende Analyse hochladen
          </Link>{' '}
          — das Formular ist damit bereits vorbelegt.
        </p>
      </div>

      {/* ── Vorgängerin / Nachfolgerin ───────────────────────────────────────────────────────── */}
      {(successor || predecessor || analysis.supersedes_id) && (
        <AdminPanel className="mt-6">
          <h2 className="text-h4 text-ink">Ersetzungskette</h2>
          <ul className="mt-3 flex flex-col gap-2 text-small text-text-muted">
            {analysis.supersedes_id && (
              <li>
                Ersetzt:{' '}
                <Link
                  href={analysisHref(analysis.supersedes_id)}
                  className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {predecessor
                    ? `${predecessor.customer_label} — ${formatDateTime(predecessor.created_at)}`
                    : 'die Vorgängerin'}
                </Link>
              </li>
            )}
            {successor && (
              <li>
                <strong className="font-semibold text-ink">
                  Diese Analyse wurde inzwischen ersetzt:
                </strong>{' '}
                <Link
                  href={analysisHref(successor.id)}
                  className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {successor.customerLabel} — {formatDateTime(successor.createdAt)}
                </Link>
              </li>
            )}
          </ul>
          {scanIncomplete && !successor && (
            <p className="mt-3 max-w-prose text-caption text-negative">
              Hinweis: geprüft wurden nur die neuesten <Num>{SUCCESSOR_SCAN_LIMIT}</Num> Analysen.
              Bei <Num>{scan?.total ?? 0}</Num> Zeilen im Bestand kann eine Nachfolgerin bestehen,
              ohne hier zu erscheinen.
            </p>
          )}
        </AdminPanel>
      )}

      {/* ── Die fünf typisierten Auszüge ─────────────────────────────────────────────────────── */}
      <AdminPanel className="mt-6">
        <h2 className="text-h4 text-ink">Prognose-Baseline</h2>
        <p className="mt-1 max-w-prose text-small text-text-muted">
          Die Zahlen, gegen die 2027 gemessen wird. Sie stehen als eigene Spalten in der Datenbank
          und wurden beim Anlegen aus dem Ergebnis abgeleitet — nicht von Hand eingetragen.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
          <Metric
            label="Abgerechnet vorher"
            value={`${analysis.baseline_billed_kw_before.toFixed(2)} kW`}
          />
          <Metric
            label="Abgerechnet nachher"
            value={`${analysis.baseline_billed_kw_after.toFixed(2)} kW`}
            note={`Differenz ${savedKw.toFixed(2)} kW`}
          />
          <Metric
            label="Ersparnis"
            value={`${Math.round(analysis.baseline_annual_saving_eur).toLocaleString('de-AT')} €/Jahr`}
          />
          <Metric
            label="Empfehlung"
            value={analysis.recommended_battery_label ?? 'keine'}
            note={
              analysis.recommended_capacity_kwh !== null
                ? `${analysis.recommended_capacity_kwh} kWh nutzbar`
                : undefined
            }
          />
        </div>
      </AdminPanel>

      {/* ── Kopfdaten inkl. Engine-Fassung ───────────────────────────────────────────────────── */}
      <AdminPanel className="mt-6">
        <h2 className="text-h4 text-ink">Womit gerechnet wurde</h2>
        <p className="mt-1 max-w-prose text-small text-text-muted">
          Ohne den Stand der Engine wäre 2027 nicht einzuordnen, ob eine Abweichung von der Messung
          an der Anlage liegt oder an einer inzwischen korrigierten Rechnung.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Engine-Fassung">
            <span className="font-semibold">{analysis.engine_version}</span>
          </Field>
          <Field label="Engine-Commit">
            <code className="break-all text-caption">{analysis.engine_commit_sha}</code>
          </Field>
          <Field label="Gerechnet am">
            <Num>{formatDateTime(analysis.computed_at)}</Num>
          </Field>
          <Field label="Archiviert am">
            <Num>{formatDateTime(analysis.created_at)}</Num>
          </Field>
          <Field label="Archiviert von">
            {analysis.created_by_email ??
              (analysis.created_by ? 'Konto inzwischen gelöscht' : 'unbekannt')}
          </Field>
          <Field label="Lead">
            {analysis.lead_id ? (
              <Link
                href={`/admin/leads/${analysis.lead_id}`}
                className="rounded-sm text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Lead ansehen
              </Link>
            ) : (
              'keine Zuordnung'
            )}
          </Field>
        </dl>
      </AdminPanel>

      {/* ── Die archivierte Quelldatei ───────────────────────────────────────────────────────── */}
      <AdminPanel className="mt-6">
        <h2 className="text-h4 text-ink">Ursprungsdatei</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Dateiname">{analysis.source_file_name}</Field>
          <Field label="Prüfsumme (SHA-256, unkomprimiert)">
            <code className="break-all text-caption" title={analysis.source_file_sha256}>
              {shortSha(analysis.source_file_sha256)}
            </code>
          </Field>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button asChild variant="secondary" size="sm">
            <a href={analysisSourceHref(analysis.id)} download>
              Ursprungsdatei herunterladen ({formatBytes(analysis.source_file_gzip_bytes)}{' '}
              komprimiert)
            </a>
          </Button>
        </div>
        <p className="mt-3 max-w-prose text-caption text-text-muted">
          Die Datei fliesst nur auf diesen Klick — sie hängt nicht am Seitenaufruf. Beim Ausliefern
          wird sie entpackt und gegen die gespeicherte Prüfsumme geprüft; weicht sie ab, kommt keine
          Datei, sondern ein Fehler. Eine archivierte Datei, die niemand mehr gegen ihre Prüfsumme
          hält, ist eine Datei ohne Beleg.
        </p>
      </AdminPanel>

      {/* ── Eingaben und Ergebnis, wortgleich ────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-h4 text-ink">Eingaben und Ergebnis</h2>
        <p className="mt-1 max-w-prose text-small text-text-muted">
          Wortgleich wie berechnet. Hier wird nichts nachgerechnet und nichts nachgebaut — was Sie
          sehen, ist der gespeicherte Inhalt.
        </p>
        <JsonBlock
          title="Eingangsgrössen (inputs)"
          value={analysis.inputs}
          hint="Tarifparameter, Abrechnungsmodell, Finanzparameter, Batteriekatalog-Stand und die Annahmen aus dem editierbaren Panel — als WERTE. Es gibt bewusst keine Verweise auf Katalog- oder Tarifzeilen: ein Verweis änderte die eingefrorene Baseline still mit, sobald jemand die Konfiguration pflegt."
        />
        <JsonBlock
          title="Ergebnis (result)"
          value={analysis.result}
          hint="Der vollständige AnalysisResult aus dem Engine-Contract (§3.10 des Kalkulator-Pflichtenhefts), unverändert wie berechnet."
        />
      </section>
    </Container>
  )
}
