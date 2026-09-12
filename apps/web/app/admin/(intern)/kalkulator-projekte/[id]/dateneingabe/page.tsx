import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AdminError, AdminPanel, AdminSection, Pill } from '@/components/admin/ui'
import { DataEntryBattery } from '@/components/admin/data-entry-battery'
import { DataEntryCountForm } from '@/components/admin/data-entry-count-form'
import { DataEntryInvoice } from '@/components/admin/data-entry-invoice'
import { DataEntryLoadProfile } from '@/components/admin/data-entry-load-profile'
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
import { MAX_BATTERY_SPEC_FILE_BYTES, MAX_INVOICE_FILE_BYTES } from 'extractors'
import { MAX_PROJECT_DOCUMENT_BYTES } from 'shared'

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
 * ── ⚠ WAS ECHT IST UND WAS NICHT ───────────────────────────────────────────────────────────────
 * ECHT (schreibt in die Datenbank): das Segment, die Zahl der Zählpunkte, der LASTGANG je Zählpunkt
 * (Datei ablegen ODER Standardprofil aus dem Jahresverbrauch erzeugen — beide Zweige der Frage),
 * die RECHNUNGEN je Zählpunkt (PDFs ablegen, auslesen, den zusammengeführten Stand in den Entwurf
 * schreiben, oder die Werte von Hand eintragen) und seit der Batterie-Station die BESTEHENDE
 * ANLAGE je Zählpunkt (Freitext auslesen, Kenndaten in den Entwurf — oder die Frage nach einem
 * Speichervorschlag beantworten).
 * PLATZHALTER (Überschrift, ein Satz, Weiter): die zwei übrigen Stationen je Zählpunkt (PV, Tarif),
 * der KI-Check und die Abbruchprüfung. Jede bekommt ihren eigenen Auftrag; es gibt hier weiterhin
 * bewusst keine Klassifizierung und keinen Fragenkatalog.
 *
 * ⚠ WAS AUCH IN DEN DREI ECHTEN SCHRITTEN UNGEBAUT BLEIBT: eine Spalten-Zuordnungs-UI für
 * mehrdeutige Netzbetreiber-Exporte (solche Dateien werden benannt abgewiesen, statt geraten zu
 * werden), ein G-Profil für Kleingewerbe (Delta 8, auf Martin blockiert), ein Datenblatt-Upload für
 * die bestehende Batterie und eine Recherche nach Marke/Typ.
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
 * ── ZWEI WRAPPER AUF DIESER SEITE, KEIN NEUER, KEINE MIGRATION ────────────────────────────────
 *   `public.admin_get_project`    — der Projektkopf samt Segment (`is_admin()`-geprüft).
 *   `public.list_metering_points` — die Zählpunkte samt Entwurf (`project_accessible`, und die
 *                                   trägt seit dem Chat-Zustand `or platform.is_admin()`).
 * Die Schreibwege stehen in `lib/admin/data-entry-actions.ts` und sind dort aufgezählt; die
 * Rechnungs-Station kommt ohne einen neuen aus (sie schreibt ausschliesslich in den Entwurf).
 * `admin_get_project` ist als Zählpunkt-Leser ausdrücklich KEINE Alternative: es liefert nur den
 * Projektkopf und kennt die Zählpunkte gar nicht (Migration 20260911090000, TEIL 3).
 */

/** Rolle live gelesen, ein Entzug greift sofort (I10) — wie in jeder Admin-Route. */
export const dynamic = 'force-dynamic'

/**
 * ⚠ WEGEN DER RECHNUNGS-STATION, und sie ist die einzige, die ihn braucht.
 *
 * Ihr Upload löst bis zu zwölf Modellaufrufe aus. Sie laufen nebenläufig (s. dort), die Wanduhr-Zeit
 * ist also die eines einzelnen Scans — die liegt aber je nach Seitenzahl deutlich über den
 * Vorgabewerten der Plattform, und ein abgeschnittener Aufruf sähe für den Admin wie ein Ausfall
 * aus, während die Dateien längst abgelegt und bezahlt sind.
 *
 * ⚠ ER MUSS IN DIESER DATEI STEHEN. Next liest `maxDuration` aus den Exporten einer SEITEN-/
 * Route-Datei; in einem `'use server'`-Modul wird der Export kommentarlos ignoriert, und der Build
 * bleibt grün (an `apps/website/app/rechner/page.tsx` gemessen und dort ausführlich vermerkt).
 * 60 Sekunden, weil das die Obergrenze ist, die jeder Vercel-Tarif zulässt.
 */
export const maxDuration = 60

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

  /*
   * ⚠ DIE ZÄHLPUNKT-NUMMER IST EINE POSITION, KEINE KENNUNG. `list_metering_points` sortiert
   * „älteste zuerst" (Migration 20260911120000 TEIL 3), und `buildStations` nummeriert in genau
   * dieser Reihenfolge durch — der Zählpunkt zur Station `zp2-lastgang` ist also der ZWEITE
   * Eintrag der Liste. Es gibt bewusst keine Zählpunktnummer in der Datenbank (TEIL 6 der
   * Migration 20260911090000); wer hier eine stabile Kennung braucht, löst sie so auf und behandelt
   * die Nummer nicht als eine.
   *
   * `null` heisst „diese Station ist (noch) ein Platzhalter" — entweder ein anderer der fünf
   * Schritte oder, rein defensiv, ein Zählpunkt, den die Liste nicht trägt (kann nicht eintreten:
   * die Stationen entstehen aus ihrer Länge).
   */
  const lastgang = (() => {
    if (station.kind !== 'zaehlpunkt-schritt') return null
    const step = station.meteringPoint
    if (!step || step.step !== 'lastgang') return null
    const point = meteringPoints[step.number - 1]
    return point ? { point, number: step.number } : null
  })()

  /*
   * Dieselbe Auflösung für die Rechnungs-Station — bewusst eine ZWEITE Ableitung und nicht eine
   * verallgemeinerte: welcher Schritt gemeint ist, entscheidet die SCHRITT-KENNUNG, und die steht
   * damit je Station im Klartext da. Ein gemeinsamer Helfer mit der Kennung als Parameter spart
   * vier Zeilen und macht aus der Zuordnung eine Zeichenkette, die man beim Lesen der Seite nicht
   * mehr sieht — bei einer Station, die eine Datei entgegennimmt und an einen Zählpunkt schreibt,
   * ist das die falsche Sparsamkeit.
   */
  const rechnung = (() => {
    if (station.kind !== 'zaehlpunkt-schritt') return null
    const step = station.meteringPoint
    if (!step || step.step !== 'rechnung') return null
    const point = meteringPoints[step.number - 1]
    return point ? { point, number: step.number } : null
  })()

  /*
   * Und dieselbe für die Batterie-Station — die DRITTE Ableitung derselben Form, und weiterhin
   * bewusst keine verallgemeinerte: welcher Schritt gemeint ist, entscheidet die SCHRITT-KENNUNG,
   * und die steht damit je Station im Klartext da (ausführlich bei `rechnung`).
   */
  const batterie = (() => {
    if (station.kind !== 'zaehlpunkt-schritt') return null
    const step = station.meteringPoint
    if (!step || step.step !== 'batterie') return null
    const point = meteringPoints[step.number - 1]
    return point ? { point, number: step.number } : null
  })()

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
              /*
                ⚠ `=== 'upload'`, NICHT `!== null`: die Zahl speist einen Satz über die
                Verkleinerungs-Sperre, und `admin_set_metering_point_count` prüft dafür
                `source_document_id`. Ein Zählpunkt mit ERZEUGTEM Standardprofil trägt keine und
                lässt sich sehr wohl wegkürzen — ihn mitzuzählen behauptete eine Sperre, die es
                nicht gibt.
              */
              withLoadProfile={
                meteringPoints.filter((point) => point.profileSource === 'upload').length
              }
            />
          )}

          {station.kind === 'zaehlpunkt-schritt' && lastgang !== null && (
            <DataEntryLoadProfile
              projectId={project.id}
              meteringPoint={lastgang.point}
              meteringPointNumber={lastgang.number}
              maxBytes={MAX_PROJECT_DOCUMENT_BYTES}
              nextHref={next ? stationHref(project.id, next.id) : null}
              segment={currentSegment}
            />
          )}

          {station.kind === 'zaehlpunkt-schritt' && rechnung !== null && (
            /*
              ⚠ `MAX_INVOICE_FILE_BYTES` (6 MB), NICHT `MAX_PROJECT_DOCUMENT_BYTES` (20 MB) wie
              beim Lastgang — und hier gewinnt ausnahmsweise die Grenze des LESERS. Der
              Rechnungs-Scan schickt die Datei base64-kodiert an die API und wird oberhalb von
              6 MB abgewiesen; eine 20 MB genannte Grenze schickte den Admin in einen Fehlschlag,
              den die Oberfläche selbst angekündigt hat. Beim Lastgang ist es umgekehrt (dort ist
              die ABLAGE die engere), und es ist dieselbe Regel: es gilt die kleinere von beiden.
            */
            <DataEntryInvoice
              projectId={project.id}
              meteringPoint={rechnung.point}
              meteringPointNumber={rechnung.number}
              maxBytes={MAX_INVOICE_FILE_BYTES}
              nextHref={next ? stationHref(project.id, next.id) : null}
            />
          )}

          {station.kind === 'zaehlpunkt-schritt' && batterie !== null && (
            /*
              ⚠ `MAX_BATTERY_SPEC_FILE_BYTES` und NICHT `MAX_PROJECT_DOCUMENT_BYTES`: ein Datenblatt
              wird ausgelesen und ausdrücklich NICHT im Projekt abgelegt (s. `scanBatterySpecAction`)
              — die Grenze der Ablage gälte hier also für einen Weg, den es nicht gibt, und wäre
              ausserdem mehr, als der Scan annimmt. Für den zweiten Weg dieser Station (ein Satz in
              eigenen Worten) ist die Grenze eine Zeichenzahl und sitzt in der Server Action
              (`MAX_BATTERY_TEXT_CHARS`) — sie braucht kein Prop.
            */
            <DataEntryBattery
              maxBytes={MAX_BATTERY_SPEC_FILE_BYTES}
              projectId={project.id}
              meteringPoint={batterie.point}
              meteringPointNumber={batterie.number}
              nextHref={next ? stationHref(project.id, next.id) : null}
            />
          )}

          {station.kind === 'zaehlpunkt-schritt' &&
            lastgang === null &&
            rechnung === null &&
            batterie === null && (
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
          ⚠ EIN „WEITER" GIBT ES NUR AUF DEN PLATZHALTER-STATIONEN. Auf den echten Schritten IST der
          Speichern-Knopf der Weg nach vorn; ein Link daneben wäre ein zweiter, der die Angabe
          überspringt — genau das, was auf einer Station, die etwas erhebt, nicht passieren soll.
          Zurück gibt es dagegen überall ausser auf der allerersten Station: es schreibt nichts.

          ⚠ LASTGANG UND RECHNUNG SIND HIER AUSGENOMMEN und rendern ihren Weiter-Knopf SELBST. Beide
          sind kein reiner Platzhalter mehr, aber auch kein reiner Speichern-Schritt: beim Lastgang
          gibt es im „Nein"-Zweig nichts zu speichern und der Weg muss trotzdem weitergehen, im
          „Ja"-Zweig erst nach dem Einlesen; die Rechnungs-Station nimmt beliebig viele Dateien
          NACHEINANDER entgegen und darf deshalb nach jedem Vorgang weiterhin dastehen. Diese
          Unterscheidung kennt nur die Komponente, die den Zustand hält.
        */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {previous && (
            <Button asChild variant="secondary" size="md">
              <Link href={stationHref(project.id, previous.id)}>Zurück: {previous.title}</Link>
            </Button>
          )}
          {next &&
            station.kind !== 'segment' &&
            station.kind !== 'zaehlpunkte' &&
            lastgang === null &&
            rechnung === null &&
            batterie === null && (
              <Button asChild variant="primary" size="md">
                <Link href={stationHref(project.id, next.id)}>Weiter: {next.title}</Link>
              </Button>
            )}
        </div>
      </AdminSection>
    </Container>
  )
}
