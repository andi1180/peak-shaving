import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Select, Label } from '@/components/ui/input'
import {
  AdminError,
  AdminPanel,
  AdminTable,
  EmptyRow,
  Pill,
  Td,
  Th,
  formatDateTime,
} from '@/components/admin/ui'
import {
  ANALYSES_HREF,
  ANALYSIS_KINDS,
  ANALYSIS_NEW_HREF,
  SUCCESSOR_SCAN_LIMIT,
  analysisHref,
  analysisKindLabel,
  buildSuccessorIndex,
  readAnalysisList,
  readStatus,
  type AnalysisListRow,
  type SuccessorRef,
} from '@/lib/admin/analyses'

/*
 * `/admin/analysen` — die Liste der eingefrorenen Analysen (B14-2).
 *
 * ── WAS HIER NICHT PASSIERT ─────────────────────────────────────────────────────────────────────
 * Kein Rechnen, kein Nachrechnen, kein Chart. Gezeigt wird, was gespeichert ist. Der Grund steht in
 * der B14-1-Migration: eine 2027 neu gerechnete Baseline wäre eine Prognose, die 2026 niemand
 * abgegeben hat — und genau diese Prognose ist das Alleinstellungsmerkmal des Wirkungsnachweises.
 *
 * ── DIE KENNZEICHNUNG „ERSETZT" WIRD HIER GEBILDET, NICHT ABGEFRAGT ─────────────────────────────
 * `admin_list_analyses` liefert je Zeile nur `supersedes_id` — die VORGÄNGERIN. Die umgekehrte
 * Richtung („ist diese Zeile inzwischen ersetzt worden?") hat in B14-1 bewusst keinen eigenen
 * Wrapper. Sie entsteht deshalb aus einem zweiten Aufruf über die neuesten Zeilen: eine
 * Nachfolgerin entsteht immer SPÄTER als ihre Vorgängerin. Reicht das Fenster nicht (Bestand über
 * `SUCCESSOR_SCAN_LIMIT`), SAGT die Seite das — eine stille Obergrenze liest sich wie
 * Vollständigkeit.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

type RawQuery = Record<string, string | string[] | undefined>

function one(query: RawQuery, key: string): string {
  const value = query[key]
  return typeof value === 'string' ? value : ''
}

function pageHref(kind: string, page: number): string {
  const sp = new URLSearchParams()
  if (kind) sp.set('art', kind)
  if (page > 1) sp.set('seite', String(page))
  const qs = sp.toString()
  return qs ? `${ANALYSES_HREF}?${qs}` : ANALYSES_HREF
}

/** Die drei Zahlen, an denen 2027 gemessen wird — kompakt in einer Zelle, `tabular-nums`. */
function BaselineCell({ row }: { row: AnalysisListRow }) {
  return (
    <span className="text-caption text-text-muted">
      <Num>{row.baseline_billed_kw_before.toFixed(1)}</Num> →{' '}
      <Num>{row.baseline_billed_kw_after.toFixed(1)}</Num> kW ·{' '}
      <Num>{Math.round(row.baseline_annual_saving_eur)}</Num> €/Jahr
      {row.recommended_battery_label ? (
        <>
          <br />
          {row.recommended_battery_label}
          {row.recommended_capacity_kwh !== null ? (
            <>
              {' '}
              (<Num>{row.recommended_capacity_kwh}</Num> kWh)
            </>
          ) : null}
        </>
      ) : (
        <>
          <br />
          keine Empfehlung
        </>
      )}
    </span>
  )
}

function AnalysisRow({
  row,
  successor,
}: {
  row: AnalysisListRow
  successor: SuccessorRef | undefined
}) {
  return (
    <tr>
      <Td>
        <Link
          href={analysisHref(row.id)}
          className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.customer_label}
        </Link>
        {successor && (
          <span className="mt-1 block">
            {/*
             * Eine ersetzte Analyse bleibt vollständig lesbar (das ist der Zweck des Einfrierens) —
             * aber sie ist nicht mehr die geltende Baseline, und das muss man sehen, bevor man mit
             * ihr weiterarbeitet.
             */}
            <Pill tone="neutral">ersetzt</Pill>
          </span>
        )}
      </Td>
      <Td>{row.site_label ?? '—'}</Td>
      <Td>
        <Pill tone={row.analysis_kind === 'betreut' ? 'positive' : 'neutral'}>
          {analysisKindLabel(row.analysis_kind)}
        </Pill>
      </Td>
      <Td className="whitespace-nowrap">
        <Num>{formatDateTime(row.computed_at)}</Num>
      </Td>
      <Td>
        <BaselineCell row={row} />
      </Td>
      <Td>
        {row.lead_id ? (
          <Link
            href={`/admin/leads/${row.lead_id}`}
            className="rounded-sm text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Lead ansehen
          </Link>
        ) : (
          <span className="text-text-muted">keine Zuordnung</span>
        )}
      </Td>
    </tr>
  )
}

export default async function AdminAnalysesPage({
  searchParams,
}: {
  searchParams: Promise<RawQuery>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const kind = one(query, 'art')
  const page = Math.max(1, Number.parseInt(one(query, 'seite') || '1', 10) || 1)

  const supabase = await createClient()

  const [listRes, scanRes] = await Promise.all([
    supabase.rpc('admin_list_analyses', {
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      p_kind: kind === '' ? undefined : kind,
    }),
    // Der Nachfolger-Index (s. Kopf). Bewusst OHNE Filter: eine Nachfolgerin kann eine andere Art
    // tragen als ihre Vorgängerin, und eine gefilterte Sicht dürfte sie deshalb nicht übersehen.
    supabase.rpc('admin_list_analyses', { p_limit: SUCCESSOR_SCAN_LIMIT, p_offset: 0 }),
  ])

  if (listRes.error) console.error('[admin/analysen] admin_list_analyses:', listRes.error)
  if (scanRes.error) console.error('[admin/analysen] admin_list_analyses (Index):', scanRes.error)

  const result = readAnalysisList(listRes.data)
  const invalidFilter = readStatus(listRes.data) === 'invalid_filter'
  const scan = readAnalysisList(scanRes.data)
  const successors = buildSuccessorIndex(scan?.analyses ?? [])
  const scanIncomplete = (scan?.total ?? 0) > SUCCESSOR_SCAN_LIMIT

  const total = result?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Analysen</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Eingefrorene Auslegungen samt Prognose-Baseline und archivierter Ursprungsdatei. Sie
          werden nie nachgerechnet: 2027 wird gegen genau diese Zahlen gemessen, und eine neu
          gerechnete Baseline wäre eine Prognose, die 2026 niemand abgegeben hat.
        </p>
        <div className="mt-4">
          <Button asChild variant="primary" size="md">
            <Link href={ANALYSIS_NEW_HREF}>Analyse archivieren</Link>
          </Button>
        </div>
      </header>

      <AdminPanel className="mt-6">
        <form method="get" action={ANALYSES_HREF} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[16rem_auto] sm:items-end">
            <div>
              <Label htmlFor="filter-art">Art</Label>
              <div className="mt-1.5">
                <Select id="filter-art" name="art" defaultValue={kind}>
                  <option value="">alle</option>
                  {ANALYSIS_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {analysisKindLabel(k)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="secondary" size="md">
                Filtern
              </Button>
              <Button asChild variant="ghost" size="md">
                <Link href={ANALYSES_HREF}>Zurücksetzen</Link>
              </Button>
            </div>
          </div>
        </form>
      </AdminPanel>

      <section aria-labelledby="treffer" className="mt-8">
        <h2 id="treffer" className="text-h4 text-ink">
          {invalidFilter ? (
            'Treffer'
          ) : (
            <>
              <Num>{total}</Num> {total === 1 ? 'Analyse' : 'Analysen'}
            </>
          )}
        </h2>

        {invalidFilter ? (
          <div className="mt-4">
            <AdminError>
              Diese Art kennt die Datenbank nicht. Bitte setzen Sie den Filter zurück.
            </AdminError>
          </div>
        ) : result === null ? (
          <div className="mt-4">
            <AdminError>
              Die Analysen-Liste konnte nicht geladen werden. Bitte laden Sie die Seite neu.
            </AdminError>
          </div>
        ) : (
          <AdminPanel className="mt-4 p-0 sm:p-0">
            <div className="px-4 py-2 sm:px-6">
              <AdminTable>
                <thead>
                  <tr>
                    <Th>Kunde</Th>
                    <Th>Standort</Th>
                    <Th>Art</Th>
                    <Th>Gerechnet am</Th>
                    <Th>Baseline</Th>
                    <Th>Lead</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.analyses.length === 0 && (
                    <EmptyRow colSpan={6}>
                      Noch keine Analyse archiviert. Das ist am Anfang die richtige Antwort — die
                      erste entsteht mit der ersten betreuten Auslegung.
                    </EmptyRow>
                  )}
                  {result.analyses.map((row) => (
                    <AnalysisRow key={row.id} row={row} successor={successors.get(row.id)} />
                  ))}
                </tbody>
              </AdminTable>
            </div>

            {lastPage > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
                <p className="text-caption text-text-muted">
                  Seite <Num>{page}</Num> von <Num>{lastPage}</Num>
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 && (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={pageHref(kind, page - 1)}>Zurück</Link>
                    </Button>
                  )}
                  {page < lastPage && (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={pageHref(kind, page + 1)}>Weiter</Link>
                    </Button>
                  )}
                </div>
              </div>
            )}

            <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
              „Baseline“ ist die abgerechnete Leistung vorher → nachher und die prognostizierte
              Jahresersparnis — die drei Zahlen, gegen die 2027 gemessen wird. Sie stehen als eigene
              Spalten in der Datenbank und nicht nur im gespeicherten Ergebnis: eine
              jsonb-Pfadabfrage bräche still, sobald sich die Struktur ändert.
              {scanIncomplete && (
                <>
                  {' '}
                  <strong className="font-semibold text-negative">
                    Hinweis: die Kennzeichnung „ersetzt“ prüft nur die neuesten{' '}
                    <Num>{SUCCESSOR_SCAN_LIMIT}</Num> Analysen.
                  </strong>{' '}
                  Bei <Num>{scan?.total ?? 0}</Num> Zeilen im Bestand kann eine ältere Analyse
                  ersetzt sein, ohne hier so markiert zu werden.
                </>
              )}
            </p>
          </AdminPanel>
        )}
      </section>
    </Container>
  )
}
