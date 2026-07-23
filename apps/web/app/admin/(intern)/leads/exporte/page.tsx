import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import {
  AdminError,
  AdminPanel,
  AdminTable,
  EmptyRow,
  Td,
  Th,
  formatDateTime,
} from '@/components/admin/ui'
import { LEADS_HREF, readExports } from '@/lib/admin/leads'

/*
 * `/admin/leads/exporte` — das Protokoll der Bestands-Ausfuhren (B2-1).
 *
 * ── WARUM ES DIESE SEITE GIBT ────────────────────────────────────────────────────────────────────
 * Eine ausgeführte Datei verlässt den Wirkungsbereich des Systems vollständig: sie liegt danach in
 * einem Downloads-Ordner, in einem Mailpostfach, in einem fremden Werkzeug. Bei einem Datenvorfall
 * ist „wer hatte wann eine Kopie und wovon" die erste Frage — und ohne diese Seite wäre das
 * Protokoll zwar vorhanden, aber unlesbar. Ein Protokoll, in das niemand hineinsehen kann,
 * beantwortet im Ernstfall nichts.
 *
 * ── VIER SPALTEN, KEINE KOPIE DER DATEN ──────────────────────────────────────────────────────────
 * Was in der Datei stand, steht hier NICHT — nur wie viele Zeilen es waren und welcher Filter
 * angewandt war. Ein inhaltsführendes Protokoll wäre eine zweite, dauerhafte Kopie genau der Daten,
 * deren Verbreitung es dokumentieren soll.
 *
 * ── HIER LÄSST SICH NICHTS LÖSCHEN ───────────────────────────────────────────────────────────────
 * Es gibt keinen Wrapper dafür, und es soll keinen geben: ein Protokoll, das der Handelnde selbst
 * bereinigen kann, ist keins. Dieselbe Haltung wie bei der Sperrliste (B1-3) und bei
 * `platform.job_runs` (B4-1).
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/** Bewusst mehr als eine Bildschirmseite: das Protokoll wächst langsam, ein Blättern lohnt nicht. */
const LIMIT = 100

export default async function AdminExportsPage() {
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_exports', { p_limit: LIMIT })
  if (res.error) console.error('[admin/leads] admin_list_exports:', res.error)

  const exports = readExports(res.data)

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <Link
          href={LEADS_HREF}
          className="rounded-sm text-small text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Zurück zur Liste
        </Link>
        <h1 className="mt-3 text-h2 text-ink">Ausfuhren</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Jede Ausfuhr des Bestands hinterlässt hier genau einen Eintrag — Zeitpunkt, Konto,
          Zeilenzahl und der angewandte Filter. Der Inhalt der Datei wird bewusst nicht mitgeschrieben:
          das wäre eine zweite, dauerhafte Kopie genau der Daten, deren Verbreitung dieses Protokoll
          dokumentiert.
        </p>
      </header>

      <AdminPanel className="mt-6 p-0 sm:p-0">
        <div className="px-4 py-2 sm:px-6">
          {exports === null ? (
            <div className="py-4">
              <AdminError>
                Das Ausfuhr-Protokoll konnte nicht geladen werden. Bitte laden Sie die Seite neu.
              </AdminError>
            </div>
          ) : (
            <AdminTable>
              <thead>
                <tr>
                  <Th>Zeitpunkt</Th>
                  <Th>Konto</Th>
                  <Th>Zeilen</Th>
                  <Th>Filter</Th>
                </tr>
              </thead>
              <tbody>
                {exports.length === 0 && (
                  <EmptyRow colSpan={4}>
                    Es wurde noch nie eine Ausfuhr erzeugt.
                  </EmptyRow>
                )}
                {exports.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap">
                      <Num>{formatDateTime(row.exported_at)}</Num>
                    </Td>
                    <Td>
                      {/*
                        * Ein fehlendes Konto heisst hier IMMER „gelöscht", nie „gab es nicht":
                        * `exported_by` entsteht aus `auth.uid()` und ist beim Schreiben nie leer
                        * (der Wrapper verlangt eine Adminrolle, und die hängt an einer Sitzung).
                        * Leer wird die Spalte nur durch ON DELETE SET NULL. Anders als bei
                        * `last_edited_by` am Lead ist der Wert also NICHT zweideutig — dort kann
                        * „nie bearbeitet" dahinterstecken, hier nicht.
                        */}
                      {row.exported_by_email ?? 'ein inzwischen gelöschtes Konto'}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Num>{row.row_count}</Num>
                    </Td>
                    <Td>{row.filter_summary}</Td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          )}
        </div>
        <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
          Einträge lassen sich hier nicht entfernen, und es gibt dafür auch keinen Weg über die
          Serverseite — ein Protokoll, das der Handelnde selbst bereinigen kann, ist keins. Angezeigt
          werden die letzten <Num>{LIMIT}</Num> Ausfuhren.
        </p>
      </AdminPanel>
    </Container>
  )
}
