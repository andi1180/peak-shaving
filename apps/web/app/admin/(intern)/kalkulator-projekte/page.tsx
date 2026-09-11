import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import { NewProjectForm } from '@/components/admin/new-project-form'
import {
  PROJECTS_HREF,
  projectHref,
  projectSegmentLabel,
  readAdminProjectList,
  type AdminProjectRow,
} from '@/lib/admin/projects'

/*
 * `/admin/kalkulator-projekte` — die Projektliste (B24, Teil 1 Schritt 1).
 *
 * ── DIE LÜCKE, DIE DIESE SEITE SCHLIESST ────────────────────────────────────────────────────────
 * `public.admin_list_projects` und `admin_create_project` liegen seit dem ersten Bauschritt bereit
 * (PR #169/#170) und hatten im gesamten Anwendungscode NULL Aufrufer: ein Admin konnte ein Projekt
 * bis heute nur im SQL-Editor anlegen und sehen. Die Kundensicht gibt es längst
 * (`/kalkulator/projekte`, achter Bauschritt) — die Admin-Sicht nicht.
 *
 * ── ⚠ DIE ADRESSE IST EIN GESCHWISTERPFAD VON `/admin/kalkulator`, KEIN UNTERPFAD ───────────────
 * `AdminNav` markiert aktiv bei Gleichheit ODER `startsWith('<href>/')`. `/admin/kalkulator/projekte`
 * fiele unter den bestehenden Punkt „Kalkulator", und zwei Punkte stünden gleichzeitig aktiv.
 * Ausführlich am Fundort der Konstante (`lib/admin/projects.ts`), gemessen von der Präfix-Probe
 * über alle Navigationspunkte.
 *
 * ── ⚠ OHNE PROJEKTE GIBT ES KEINE LEERE LISTE, SONDERN DAS FORMULAR ────────────────────────────
 * Der Anfangszustand dieses Bereichs ist „es gibt noch nichts" — und zwar auf Dauer für jeden, der
 * ihn zum ersten Mal öffnet. Eine Tabelle mit der Zeile „keine Einträge" beantwortet dort die
 * falsche Frage: was fehlt, ist nicht eine Erklärung, sondern der nächste Schritt. Sobald ein
 * Projekt da ist, steht die Liste oben und das Formular darunter.
 *
 * ── WAS ES HIER NICHT GIBT ──────────────────────────────────────────────────────────────────────
 * Kein Filter und keine Suche: `admin_list_projects` nimmt ausser der Seitenaufteilung nur
 * `p_account_id` entgegen, und eine Kontoauswahl gibt es im Admin-Bereich nicht. Ein Filter, der
 * nichts filtern kann, wäre eine Requisite.
 *
 * Die Zugangsprüfung läuft über dieselbe Funktion wie im Layout (`isCurrentUserAdmin`). Sie ist hier
 * NICHT redundant: dass das Layout `children` nicht rendert, verhindert nicht, dass diese Seite
 * gerendert und ins RSC-Flight-Payload geschrieben wird (ausführlich: `lib/admin/guard.ts`).
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

function pageHref(page: number): string {
  return page > 1 ? `${PROJECTS_HREF}?seite=${page}` : PROJECTS_HREF
}

export default async function AdminProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const page = Math.max(1, Number(typeof query.seite === 'string' ? query.seite : '1') || 1)

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_projects', {
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })
  if (res.error) console.error('[admin/projects] admin_list_projects:', res.error)

  const list = readAdminProjectList(res.data)
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1
  const leer = list !== null && list.total === 0

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Kalkulator-Projekte</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Jedes Projekt ist der Container für einen Kundenfall — Gespräch, Dokumente, offene
          Rückfragen und später die Zählpunkte.
        </p>
        <p className="mt-3 max-w-prose text-small text-text-muted">
          Hier angelegte Projekte laufen <span className="text-text">ohne Kundenkonto</span>: sie
          gehören COOLiN und werden stellvertretend geführt. Projekte, die ein Kunde selbst anlegt,
          erscheinen ebenfalls in dieser Liste.
        </p>
      </header>

      {/*
        Die Liste steht nur, wenn es etwas zu zeigen gibt — sonst führt die Seite direkt zum
        Formular (s. Kopf). Ein Ladefehler ist davon ausdrücklich AUSGENOMMEN: „konnte nicht geladen
        werden" darf nie wie „es gibt noch nichts" aussehen, sonst legt jemand ein zweites Projekt
        an, weil das erste scheinbar fehlt.
      */}
      {list === null ? (
        <AdminSection id="projekte" title="Projekte">
          <AdminError>
            Die Projekte konnten nicht geladen werden. Das ist NICHT dasselbe wie „es gibt noch
            keine" — bitte die Seite neu laden.
          </AdminError>
        </AdminSection>
      ) : leer ? null : (
        <AdminSection
          id="projekte"
          title="Projekte"
          description="Neueste zuerst."
        >
          <p className="mb-4 text-small text-text-muted">
            {list.total} {list.total === 1 ? 'Projekt' : 'Projekte'}
          </p>
          <ul className="flex flex-col gap-4">
            {list.projects.map((row) => (
              <li key={row.id}>
                <ProjectCard row={row} />
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav aria-label="Seiten" className="mt-6 flex items-center gap-4">
              {page > 1 && (
                <Link
                  href={pageHref(page - 1)}
                  className="text-small text-accent underline decoration-accent underline-offset-[3px]"
                >
                  Zurück
                </Link>
              )}
              <span className="text-small tabular-nums text-text-muted">
                Seite {page} von {pages}
              </span>
              {page < pages && (
                <Link
                  href={pageHref(page + 1)}
                  className="text-small text-accent underline decoration-accent underline-offset-[3px]"
                >
                  Weiter
                </Link>
              )}
            </nav>
          )}
        </AdminSection>
      )}

      <AdminSection
        id="neues-projekt"
        title="Neues Projekt"
        description={
          leer
            ? 'Es gibt noch kein Projekt — legen Sie hier das erste an.'
            : 'Legt ein Projekt ohne Kundenkonto an, das COOLiN stellvertretend führt.'
        }
      >
        <AdminPanel>
          <NewProjectForm />
        </AdminPanel>
      </AdminSection>
    </Container>
  )
}

function ProjectCard({ row }: { row: AdminProjectRow }) {
  const segment = projectSegmentLabel(row.segment)

  return (
    <AdminPanel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-h4 text-ink">
            <Link
              href={projectHref(row.id)}
              className="underline decoration-line-strong underline-offset-4 hover:decoration-accent"
            >
              {row.customer_label}
            </Link>
          </h3>
          <p className="mt-1 text-caption text-text-muted">
            angelegt {formatDateTime(row.created_at)}
            {row.created_by_email && ` · von ${row.created_by_email}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            ⚠ Ohne Segment steht hier NICHTS statt „Privat". `segment is null` heisst „das Gespräch
            hat es noch nicht bestimmt" — ein Vorgabewert behauptete eine Angabe, die niemand
            getroffen hat, und genau an ihr hängt, welcher Fragen-Pool gilt.
          */}
          {segment && <Pill tone="neutral">{segment}</Pill>}
          {row.industry && <Pill tone="neutral">{row.industry}</Pill>}
          {row.account_id === null && <Pill tone="neutral">ohne Kundenkonto</Pill>}
        </div>
      </div>
    </AdminPanel>
  )
}
