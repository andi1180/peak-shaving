import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import {
  PROJECTS_HREF,
  projectDataEntryHref,
  projectSegmentLabel,
  readAdminProject,
} from '@/lib/admin/projects'
import { OPEN_QUESTIONS_PROJECT_HREF } from '@/lib/admin/open-questions'

/*
 * `/admin/kalkulator-projekte/[id]` — der Projektkopf (B24, Teil 1 Schritt 1).
 *
 * ── WAS DIESE SEITE IST ─────────────────────────────────────────────────────────────────────────
 * Die Grundstruktur, an der die nächsten Schritte andocken: Kundenbezeichnung, Segment und Branche
 * (falls das Gespräch sie bestimmt hat), Zeitstempel — und zwei ausdrücklich als solche
 * gekennzeichnete Platzhalter für Dateneingabe und Report.
 *
 * ── ⚠ DIE PLATZHALTER SIND SICHTBAR UND NICHT FUNKTIONAL, UND DAS IST ABSICHT ──────────────────
 * Sie zu verstecken, bis es sie gibt, wäre die naheliegende Alternative und die schlechtere: der
 * Projektkopf sähe dann aus wie ein fertiger Bereich, dem etwas fehlt, statt wie einer, der auf
 * zwei benannte Schritte wartet. Dieselbe Haltung wie beim gesperrten „Kleingewerbe" im
 * Standardprofil-Einstieg (Delta 9b-1): was unfertig ist, steht sichtbar da und sagt, warum.
 *
 * Was sie NICHT tun: sie behaupten keine Zahl, keinen Zustand und keinen Fortschritt. Ein leerer
 * Fortschrittsbalken oder ein „0 Zählpunkte erfasst" wäre eine Angabe über einen Vorgang, den es
 * noch nicht gibt.
 *
 * ── EIN WRAPPER, EIN ROUNDTRIP ──────────────────────────────────────────────────────────────────
 * Gelesen wird ausschliesslich `public.admin_get_project`. Es liefert seit 20260911090000 auch
 * `segment` und `industry` (Rumpf erweitert, Signatur unverändert) — die naheliegende Alternative,
 * zusätzlich `public.get_project` zu rufen (das beides schon länger mitliefert und über
 * `platform.project_accessible` auch einem Admin offensteht), wäre ein zweiter Roundtrip für EINEN
 * Projektkopf und zwei Quellen für dieselbe Zeile.
 *
 * Die Zugangsprüfung läuft über dieselbe Funktion wie im Layout (`isCurrentUserAdmin`) — nicht
 * redundant, s. `lib/admin/guard.ts`.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function AdminProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params
  const supabase = await createClient()
  const res = await supabase.rpc('admin_get_project', { p_id: id })
  if (res.error) console.error('[admin/projects] admin_get_project:', res.error)

  const project = readAdminProject(res.data)

  if (project === null || project === 'not_found') {
    return (
      <Container className="py-10 sm:py-14">
        <header className="border-b border-line pb-6">
          <h1 className="text-h2 text-ink">Projekt</h1>
        </header>
        <AdminSection id="projekt" title="Nicht verfügbar">
          <AdminError>
            {project === 'not_found'
              ? 'Dieses Projekt gibt es nicht (mehr).'
              : 'Das Projekt konnte nicht geladen werden. Das ist NICHT dasselbe wie „gibt es nicht" — bitte die Seite neu laden.'}
          </AdminError>
          <p className="mt-4">
            <Link
              href={PROJECTS_HREF}
              className="text-small text-accent underline decoration-accent underline-offset-[3px]"
            >
              Zurück zur Projektliste
            </Link>
          </p>
        </AdminSection>
      </Container>
    )
  }

  const segment = projectSegmentLabel(project.segment)

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <p className="text-caption text-text-muted">
          <Link
            href={PROJECTS_HREF}
            className="underline decoration-line-strong underline-offset-[3px] hover:decoration-accent"
          >
            Kalkulator-Projekte
          </Link>
        </p>
        <h1 className="mt-2 text-h2 text-ink">{project.customer_label}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Ohne Segment steht hier nichts — NULL heisst „noch nicht bestimmt", nicht „Privat". */}
          {segment && <Pill tone="neutral">{segment}</Pill>}
          {project.industry && <Pill tone="neutral">{project.industry}</Pill>}
          {project.account_id === null && <Pill tone="neutral">ohne Kundenkonto</Pill>}
        </div>
      </header>

      <AdminSection id="stammdaten" title="Stammdaten">
        <AdminPanel>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Angabe label="Kundenbezeichnung">{project.customer_label}</Angabe>
            <Angabe
              label="Segment"
              hint={segment ? undefined : 'Das Gespräch hat es noch nicht bestimmt.'}
            >
              {segment ?? '—'}
            </Angabe>
            <Angabe
              label="Branche"
              hint={
                project.industry
                  ? 'Entscheidet, welcher Fragen-Pool im Gespräch gilt.'
                  : segment === 'Privat'
                    ? 'Bei einem Privat-Projekt bleibt sie leer.'
                    : 'Noch nicht bestimmt.'
              }
            >
              {project.industry ?? '—'}
            </Angabe>
            <Angabe label="Angelegt">{formatDateTime(project.created_at)}</Angabe>
            <Angabe label="Zuletzt geändert">{formatDateTime(project.updated_at)}</Angabe>
            <Angabe
              label="Angelegt von"
              hint={
                project.created_by_email
                  ? undefined
                  : 'Das Konto gibt es nicht mehr — das heisst NICHT „von niemandem angelegt".'
              }
            >
              {project.created_by_email ?? '—'}
            </Angabe>
          </dl>
        </AdminPanel>

        <p className="mt-4 text-small text-text-muted">
          Offene Rückfragen aus dem Gespräch stehen im Bereich{' '}
          <Link
            href={OPEN_QUESTIONS_PROJECT_HREF(project.id)}
            className="text-accent underline decoration-accent underline-offset-[3px]"
          >
            Rückfragen
          </Link>
          .
        </p>
      </AdminSection>

      {/*
        ⚠ VON DEN ZWEI PLATZHALTERN IST NOCH EINER ÜBRIG. Die Dateneingabe führt seit B24 Teil 1 an
        ihr Ziel — das Gespräch, in dem die Angaben des Projekts entstehen; der Report darunter
        wartet weiter. Der Unterschied soll am Aussehen ablesbar sein: Link gegen gestrichelten
        Kasten. Was BEIDE weiterhin nicht tun: eine Zahl, einen Zustand oder einen Fortschritt
        behaupten — ein „0 von 3 erfasst" wäre eine Angabe über einen Vorgang, den es nicht gibt.
      */}
      <AdminSection
        id="dateneingabe"
        title="Dateneingabe"
        description="Das Gespräch, in dem die Angaben des Projekts entstehen."
      >
        <AdminPanel>
          <p className="max-w-prose text-small text-text-muted">
            Zählpunkte, Lastgang und Tarifwerte werden im Gespräch erfasst. Gerechnet wird hier noch
            nichts — das ist ein eigener Schritt.
          </p>
          <p className="mt-4">
            <Link
              href={projectDataEntryHref(project.id)}
              className="text-small text-accent underline decoration-accent underline-offset-[3px]"
            >
              Dateneingabe öffnen
            </Link>
          </p>
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="report"
        title="Report"
        description="Noch nicht gebaut — folgt als eigener Schritt."
      >
        <Platzhalter>
          Hier entsteht die Auswertung über alle Zählpunkte des Projekts. Gerechnet wird
          unverändert in der Engine; dieser Bereich wählt aus, was davon im Report steht.
        </Platzhalter>
      </AdminSection>
    </Container>
  )
}

function Angabe({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-small text-text">{children}</dd>
      {hint && <p className="mt-0.5 text-caption text-text-muted">{hint}</p>}
    </div>
  )
}

function Platzhalter({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface-sunken p-4 sm:p-6">
      <p className="max-w-prose text-small text-text-muted">{children}</p>
    </div>
  )
}
