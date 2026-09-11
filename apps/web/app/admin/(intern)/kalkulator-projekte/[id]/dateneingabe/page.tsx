import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AdminError, AdminPanel, AdminSection, Pill } from '@/components/admin/ui'
import { DataEntryCountForm } from '@/components/admin/data-entry-count-form'
import { DataEntrySegmentForm } from '@/components/admin/data-entry-segment-form'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/layout'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import {
  STATION_PARAM,
  buildStations,
  firstParamValue,
  resolveStation,
  stationHref,
} from '@/lib/admin/data-entry-stations'
import { readMeteringPointList } from '@/lib/admin/metering-points'
import {
  PROJECTS_HREF,
  PROJECT_SEGMENTS,
  projectHref,
  projectSegmentLabel,
  readAdminProject,
  type ProjectSegment,
} from '@/lib/admin/projects'
import { createClient } from '@/lib/supabase/server'

/*
 * `/admin/kalkulator-projekte/[id]/dateneingabe` — der Dateneingabe-Wizard (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIESE ROUTE IST UMGEWIDMET: SIE TRUG BIS PR #188 DEN PROJEKT-CHAT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Chat ist damit aus dem ADMIN-Bereich verschwunden — für den Kunden bleibt er unverändert
 * unter `/kalkulator/projekte/[id]`, und der Rückfragen-Bereich zeigt den Verlauf weiterhin
 * (read-only, `components/admin/chat-transcript.tsx`). Was hier an seine Stelle tritt, ist der
 * geführte Weg durch dieselben Angaben: Segment, Zählpunkte, und je Zählpunkt fünf Schritte.
 *
 * ── ⚠ WAS IN DIESEM SCHRITT ECHT IST UND WAS NICHT ─────────────────────────────────────────────
 * ECHT (schreibt in die Datenbank): das Segment und die Zahl der Zählpunkte.
 * PLATZHALTER (Überschrift, ein Satz, Weiter): die fünf Stationen je Zählpunkt, der KI-Check und
 * die Abbruchprüfung. Ziel dieses Bauschritts ist die durchklickbare REIHENFOLGE, nicht der Inhalt
 * — jede der Platzhalter-Stationen bekommt ihren eigenen Auftrag. Es gibt deshalb hier bewusst
 * keinen Upload, keine Klassifizierung und keinen Fragenkatalog.
 *
 * ── DIE POSITION STEHT IN DER URL, DIE REIHENFOLGE IM DATENBANKSTAND ───────────────────────────
 * `?station=…`. Weiter und Zurück sind gewöhnliche Links; die Seite wird bei jedem Schritt neu
 * gerendert und leitet die Liste der Stationen aus zwei echten Angaben ab (Segment gesetzt? wie
 * viele Zählpunkte?). Damit gibt es keinen zweiten Ort, an dem ein Fortschritt behauptet werden
 * könnte, der nicht in den Daten steht. Die Regeln stehen in `lib/admin/data-entry-stations.ts`.
 *
 * ── ⚠ EIN NICHT LESBARER ZÄHLPUNKT-STAND SPERRT DEN WIZARD ─────────────────────────────────────
 * `readMeteringPointList` liefert `null`, wenn der Wrapper nicht `ok` gemeldet hat — ausdrücklich
 * unterschieden von „keine Zählpunkte". Die Verwechslung wäre hier teuer: bei 0 zeigt der Wizard
 * das Zählpunkt-Formular, und das kann eine bestehende Zahl VERKLEINERN. Ein Lesefehler brächte
 * einen Admin damit dazu, eine Zahl einzutragen, die einen vorhandenen Zählpunkt entfernt.
 * Ausführlich im Kopf von `lib/admin/metering-points.ts`.
 *
 * ── ZUGANG: DIE ADMINROLLE, UND SONST NICHTS ───────────────────────────────────────────────────
 * Wortgleich zu `/admin/kalkulator` (B18-4) und unverändert gegenüber PR #188: ein Entitlement ist
 * die Erlaubnis eines KUNDEN, ein verkauftes Produkt zu benutzen — ein Admin ist kein Kunde seines
 * eigenen Werkzeugs. `lib/admin/data-entry-ui.test.ts` pinnt das, weil ein später „zur
 * Vereinheitlichung" ergänzter Aufruf in keinem Build sichtbar wäre.
 *
 * ── DREI WRAPPER, KEIN NEUER, KEINE MIGRATION ──────────────────────────────────────────────────
 *   `public.admin_get_project`                — der Projektkopf samt Segment (`is_admin()`-geprüft).
 *   `public.list_metering_points`             — die Zählpunkte (`project_accessible`, und die trägt
 *                                               seit dem Chat-Zustand `or platform.is_admin()`).
 *   `public.update_project_segment_industry`  ┐ die beiden Schreibwege, aufgerufen aus
 *   `public.admin_set_metering_point_count`   ┘ `lib/admin/data-entry-actions.ts`.
 * `admin_get_project` ist als Zählpunkt-Leser ausdrücklich KEINE Alternative: es liefert nur den
 * Projektkopf und kennt die Zählpunkte gar nicht (Migration 20260911090000, TEIL 3).
 */

/** Rolle live gelesen, ein Entzug greift sofort (I10) — wie in jeder Admin-Route. */
export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/** Rahmen für die Fälle, in denen es keinen Wizard zu zeigen gibt. */
function DataEntryProblem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Dateneingabe</h1>
      </header>
      <AdminSection id="projekt" title={title}>
        <AdminError>{children}</AdminError>
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

/**
 * Eine Station, die es in diesem Bauschritt noch nicht gibt.
 *
 * Sie sagt im Klartext, dass sie leer IST — ein Platzhalter, der so aussieht wie ein fertiger
 * Schritt, sähe aus wie etwas Kaputtes. Dieselbe Haltung wie bei der Report-Kachel auf der
 * Projekt-Detailseite.
 */
function StationPlaceholder({ note }: { note: string }) {
  return (
    <p className="max-w-prose text-small text-text-muted">
      Folgt als eigener Schritt. <span className="text-text-muted">{note}</span>
    </p>
  )
}

export default async function AdminProjectDataEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const projectRes = await supabase.rpc('admin_get_project', { p_id: id })
  if (projectRes.error) console.error('[admin/dateneingabe] admin_get_project:', projectRes.error)

  const project = readAdminProject(projectRes.data)

  /*
   * Dieselben zwei Ausgänge wie auf der Detailseite und aus demselben Grund: „gibt es nicht" und
   * „konnte nicht geladen werden" sind verschiedene Aussagen. Eine 404 für den zweiten Fall
   * schickte Martin ein Projekt suchen, das es sehr wohl gibt.
   */
  if (project === null || project === 'not_found') {
    return (
      <DataEntryProblem title="Nicht verfügbar">
        {project === 'not_found'
          ? 'Dieses Projekt gibt es nicht (mehr).'
          : 'Das Projekt konnte nicht geladen werden. Das ist NICHT dasselbe wie „gibt es nicht" — bitte die Seite neu laden.'}
      </DataEntryProblem>
    )
  }

  const meteringRes = await supabase.rpc('list_metering_points', { p_project_id: project.id })
  if (meteringRes.error)
    console.error('[admin/dateneingabe] list_metering_points:', meteringRes.error)

  const meteringPoints = readMeteringPointList(meteringRes.data)

  // ⚠ Fail closed — s. Kopf. `null` ist NICHT „keine Zählpunkte".
  if (meteringPoints === null) {
    return (
      <DataEntryProblem title="Zählpunkte nicht lesbar">
        Die Zählpunkte dieses Projekts konnten nicht gelesen werden. Der Wizard wird deshalb gar
        nicht erst angezeigt: seine Reihenfolge hängt an ihrer Anzahl, und das Zählpunkt-Formular
        könnte eine bestehende Zahl verkleinern. Bitte die Seite neu laden.
      </DataEntryProblem>
    )
  }

  const segmentSet = project.segment !== null && project.segment !== ''
  const stations = buildStations({ segmentSet, meteringPointCount: meteringPoints.length })

  const requested = firstParamValue(query[STATION_PARAM])
  const { station, index, redirectRequired } = resolveStation(stations, requested)
  // Die Adresse nannte eine Station, die es für dieses Projekt nicht gibt — Umleitung statt Fehler,
  // damit die URL nicht weiter etwas Falsches behauptet.
  if (redirectRequired) redirect(stationHref(project.id, station.id))

  const previous = stations[index - 1] ?? null
  const next = stations[index + 1] ?? null

  const segmentLabel = projectSegmentLabel(project.segment)
  const currentSegment = (PROJECT_SEGMENTS as readonly string[]).includes(project.segment ?? '')
    ? (project.segment as ProjectSegment)
    : null

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <p className="text-caption text-text-muted">
          <Link
            href={projectHref(project.id)}
            className="underline decoration-line-strong underline-offset-[3px] hover:decoration-accent"
          >
            {project.customer_label}
          </Link>
        </p>
        <h1 className="mt-2 text-h2 text-ink">Dateneingabe</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {segmentLabel && <Pill tone="neutral">{segmentLabel}</Pill>}
          {project.industry && <Pill tone="neutral">{project.industry}</Pill>}
          {project.account_id === null && <Pill tone="neutral">ohne Kundenkonto</Pill>}
        </div>
        <p className="mt-4 max-w-prose text-small text-text-muted">
          Schritt für Schritt durch die Angaben des Projekts. Gerechnet wird hier noch nichts.
        </p>
      </header>

      <AdminSection id="station" title={station.title}>
        {/*
          Die Zählung nennt die Gesamtzahl mit, weil sie nicht feststeht: sie wächst mit jedem
          Zählpunkt um fünf. „Schritt 4" allein sagte nicht, wie weit es noch ist.
        */}
        <p className="text-caption text-text-muted">
          Schritt {index + 1} von {stations.length}
        </p>

        <AdminPanel className="mt-4">
          {station.kind === 'segment' && (
            <DataEntrySegmentForm projectId={project.id} current={currentSegment} />
          )}

          {station.kind === 'zaehlpunkte' && (
            <DataEntryCountForm
              projectId={project.id}
              current={meteringPoints.length}
              withLoadProfile={meteringPoints.filter((point) => point.hasLoadProfile).length}
            />
          )}

          {station.kind === 'zaehlpunkt-schritt' && (
            <StationPlaceholder
              note={`Hier wird später der Schritt „${station.title}" ausgefüllt.`}
            />
          )}

          {station.kind === 'ki-check' && (
            <StationPlaceholder note="Hier prüft später die KI die gesammelten Angaben auf Widersprüche." />
          )}

          {station.kind === 'abbruchpruefung' && (
            <StationPlaceholder note="Hier wird später entschieden, ob die Datenlage für eine Rechnung reicht." />
          )}

          {station.kind === 'ende' && (
            <p className="max-w-prose text-small text-text-muted">
              Alle Stationen dieses Teils sind durchlaufen.{' '}
              <span className="text-text-muted">Weiter zu Teil 2 — folgt als eigener Schritt.</span>
            </p>
          )}
        </AdminPanel>

        {/*
          ⚠ EIN „WEITER" GIBT ES NUR AUF DEN PLATZHALTER-STATIONEN. Auf den beiden echten Schritten
          IST der Speichern-Knopf der Weg nach vorn; ein Link daneben wäre ein zweiter, der die
          Angabe überspringt — genau das, was auf einer Station, die etwas erhebt, nicht passieren
          soll. Zurück gibt es dagegen überall ausser auf der allerersten Station: es schreibt nichts.
        */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {previous && (
            <Button asChild variant="secondary" size="md">
              <Link href={stationHref(project.id, previous.id)}>Zurück: {previous.title}</Link>
            </Button>
          )}
          {next && station.kind !== 'segment' && station.kind !== 'zaehlpunkte' && (
            <Button asChild variant="primary" size="md">
              <Link href={stationHref(project.id, next.id)}>Weiter: {next.title}</Link>
            </Button>
          )}
        </div>
      </AdminSection>
    </Container>
  )
}
