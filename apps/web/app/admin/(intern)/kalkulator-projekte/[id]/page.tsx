import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import { EnergyAdvisorDialog } from '@/components/admin/energy-advisor-dialog'
import { ActionButton } from '@/components/admin/action-button'
import { createReportRenderRequestAction } from '@/lib/admin/report-render-actions'
import {
  REPORT_OPTIONAL_SECTIONS_FIELD,
  REPORT_OPTIONAL_SECTIONS_MARKER,
  type ReportOptionalSection,
} from 'shared'
import { readMeteringPointList } from '@/lib/admin/metering-points'
import {
  PROJECTS_HREF,
  projectDataEntryHref,
  projectSegmentLabel,
  readAdminProject,
} from '@/lib/admin/projects'
import { OPEN_QUESTIONS_PROJECT_HREF } from '@/lib/admin/open-questions'
import { loadProjectMessages } from '@/lib/project-chat/supabase-ports'
import { visibleTranscript } from '@/lib/project-chat/transcript'

/*
 * `/admin/kalkulator-projekte/[id]` — der Projektkopf (B24, Teil 1 Schritt 1).
 *
 * ── WAS DIESE SEITE IST ─────────────────────────────────────────────────────────────────────────
 * Die Grundstruktur, an der die nächsten Schritte andocken: Kundenbezeichnung, Segment und Branche
 * (falls das Gespräch sie bestimmt hat), Zeitstempel, die Dateneingabe, die KI-Prüfung — und seit
 * D12 Teil 2 der Report-Bereich, der nicht mehr Platzhalter ist.
 *
 * ── ⚠ DER REPORT-BEREICH RECHNET SEIT D12 TEIL 2 TATSÄCHLICH ──────────────────────────────────
 * Je Zählpunkt ein Auslöser: er lässt die Engine laufen und legt aus dem Ergebnis eine kurzlebige
 * Übergabe an (`platform.report_render_requests`). Seit dem D12-Abschluss steht daneben der Link
 * auf die Leseseite in `apps/website`, die daraus das PDF erzeugt — im Browser des Admins, wie im
 * Rechner selbst.
 *
 * ⚠ GENAU EIN ZÄHLPUNKT JE AUSLÖSER (D13). Es gibt bewusst keinen Knopf „alle rechnen": eine
 * zusammengefasste Sicht über mehrere Zählpunkte ist eine eigene Rechnung, kein Stapellauf.
 *
 * ── ⚠ OHNE ZÄHLPUNKTE STEHT DA EIN SATZ, KEIN KNOPF ───────────────────────────────────────────
 * Dieselbe Haltung wie bisher beim Platzhalter: was nicht geht, steht sichtbar da und sagt, warum.
 * `readMeteringPointList` liefert `null`, wenn der Wrapper NICHT `ok` gemeldet hat — das ist nicht
 * dasselbe wie „keine Zählpunkte", und die beiden Fälle sagen hier deshalb Verschiedenes.
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
  const kiCheckMessages = await loadProjectMessages(project.id, 'ki_check')
  const kiCheckTranscript = visibleTranscript(kiCheckMessages)

  // `null` heisst „nicht gelesen", nicht „keine Zählpunkte" — s. Kopf von `lib/admin/metering-points.ts`.
  const pointsRes = await supabase.rpc('list_metering_points', { p_project_id: project.id })
  if (pointsRes.error) console.error('[admin/projects] list_metering_points:', pointsRes.error)
  const meteringPoints = readMeteringPointList(pointsRes.data)

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
        ⚠ KEIN PLATZHALTER MEHR ÜBRIG. Dateneingabe, KI-Prüfung und Report führen alle drei an ihr
        Ziel. Was keiner von ihnen tut: eine Zahl, einen Zustand oder einen Fortschritt behaupten —
        ein „0 von 3 erfasst" wäre eine Angabe über einen Vorgang, den es nicht gibt.
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
        id="ki-pruefung"
        title="KI-Prüfung"
        description="Der Energieberater prüft die erfassten Angaben dieses Projekts gegen den Lastgang."
      >
        <AdminPanel>
          <p className="max-w-prose text-small text-text-muted">
            Läuft unabhängig vom Stand der Zählpunkte — die Prüfung öffnet sich auch dann, wenn die
            Dateneingabe noch nicht vollständig ist.
          </p>
          <div className="mt-4">
            <EnergyAdvisorDialog projectId={project.id} initialTranscript={kiCheckTranscript} />
          </div>
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="report"
        title="Report"
        description="Rechnet einen Zählpunkt durch und legt daraus eine Übergabe für den Report-Renderer an."
      >
        <AdminPanel>
          <p className="max-w-prose text-small text-text-muted">
            Gerechnet wird unverändert in der Engine. Die Übergabe läuft nach 24 Stunden ab — der
            Link daneben öffnet sie und erzeugt das PDF. Die vier Abschnitte unten sind optional;
            alles Übrige steht in jedem Report.
          </p>
          {meteringPoints === null ? (
            <AdminError>
              Die Zählpunkte konnten nicht geladen werden. Das ist NICHT dasselbe wie „es gibt
              keine" — bitte die Seite neu laden.
            </AdminError>
          ) : meteringPoints.length === 0 ? (
            <p className="mt-4 text-small text-text-muted">
              Dieses Projekt hat noch keinen Zählpunkt. Gerechnet wird je Zählpunkt — erfasst
              werden sie in der Dateneingabe.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {meteringPoints.map((point, index) => (
                <li key={point.id} className="flex flex-col gap-2">
                  <p className="text-small text-text">
                    Zählpunkt {index + 1}
                    {point.profileSource === null && (
                      <span className="text-text-muted"> — ohne Lastgang</span>
                    )}
                  </p>
                  <ActionButton
                    action={createReportRenderRequestAction}
                    fields={{ projectId: project.id, meteringPointId: point.id }}
                    label={`Zählpunkt ${index + 1} rechnen`}
                    pendingLabel="Wird gerechnet …"
                    showSuccess
                  >
                    <OptionalSections meteringPointId={point.id} />
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
        </AdminPanel>
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

/**
 * Report-Baukasten C — die vier abwählbaren Bausteine, je Zählpunkt.
 *
 * ⚠ DIE BESCHRIFTUNGEN SIND NICHT DIE INTERNEN KENNUNGEN. `hour_flow` sagt einem Vertriebler
 * nichts; „Stunden-Heatmap" beschreibt, was auf dem Blatt steht. Die Kennung reist trotzdem als
 * Wert mit — sie ist es, die der Report auswertet.
 *
 * ⚠ STANDARDMÄSSIG ALLE VIER AKTIV: der Report ist damit derselbe wie vor diesem Schritt, und wer
 * nichts anfasst, bekommt nichts Unerwartetes.
 */
const OPTIONAL_SECTION_LABELS: { id: ReportOptionalSection; label: string; hint: string }[] = [
  {
    id: 'hour_flow',
    label: 'Stunden-Heatmap',
    hint: 'Wann der Speicher über das Jahr lädt und entlädt.',
  },
  {
    id: 'charge_price',
    label: 'Ø-Ladepreis je Monat',
    hint: 'Was der Strom im Schnitt kostet, wenn geladen wird.',
  },
  {
    id: 'data_quality',
    label: 'Datenqualitäts-Hinweis',
    hint: 'Meldet Lücken und Auffälligkeiten im Lastgang.',
  },
  {
    id: 'pv_outage',
    label: 'PV-Auffälligkeit',
    hint: 'Monate, in denen die PV-Anlage keinen Beitrag gezeigt hat.',
  },
]

function OptionalSections({ meteringPointId }: { meteringPointId: string }) {
  return (
    <fieldset className="mb-3 border-0 p-0">
      <legend className="text-caption text-text-muted">Optionale Abschnitte</legend>
      {/*
        ⚠ Der Marker unterscheidet „alle vier abgewählt" von „dieses Formular führt die Auswahl
        gar nicht" — ein unangekreuztes Kontrollkästchen sendet nichts (s. `readOptionalSections`).
      */}
      <input type="hidden" name={REPORT_OPTIONAL_SECTIONS_MARKER} value="1" />
      <ul className="mt-1.5 flex flex-col gap-1">
        {OPTIONAL_SECTION_LABELS.map(({ id, label, hint }) => {
          const inputId = `${REPORT_OPTIONAL_SECTIONS_FIELD}-${meteringPointId}-${id}`
          return (
            <li key={id} className="flex items-start gap-2">
              <input
                id={inputId}
                type="checkbox"
                name={REPORT_OPTIONAL_SECTIONS_FIELD}
                value={id}
                defaultChecked
                className="mt-0.5 accent-accent"
              />
              <label htmlFor={inputId} className="text-small text-text">
                {label} <span className="text-caption text-text-muted">— {hint}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
