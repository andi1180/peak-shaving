import type { Metadata } from 'next'
import Link from 'next/link'

import { ProjectChat } from '@/components/kalkulator/project-chat'
import { AdminError, AdminSection, Pill } from '@/components/admin/ui'
import { Container } from '@/components/ui/layout'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { PROJECTS_HREF, projectHref, projectSegmentLabel, readAdminProject } from '@/lib/admin/projects'
import { loadProjectDocuments, loadProjectMessages } from '@/lib/project-chat/supabase-ports'
import { visibleTranscript } from '@/lib/project-chat/transcript'
import { createClient } from '@/lib/supabase/server'

/*
 * `/admin/kalkulator-projekte/[id]/dateneingabe` — der Projekt-Chat im Admin-Bereich (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIES IST DIE ERSTE ADMIN-SEITE, DIE IN EIN PROJEKT-GESPRÄCH SCHREIBT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bis hierher war jede Admin-Ansicht eines Gesprächs read-only, und `components/admin/chat-transcript.tsx`
 * nennt den Grund im Klartext: „ein Admin, der versehentlich in ein fremdes Gespräch schreibt, wäre
 * die teuerste denkbare Nebenwirkung dieser Seite." Das galt und gilt für den RÜCKFRAGEN-Bereich —
 * dort beantwortet Martin eine Frage und hat im Gespräch selbst nichts verloren.
 *
 * Diese Seite hat einen anderen Zweck, und er steht im Datenmodell: ein Projekt darf `account_id
 * = null` tragen, also admin-geführt sein (B24, erster Bauschritt — „eigenes COOLiN-Projekt oder
 * stellvertretend für einen Kunden ohne Konto"). Für genau diese Projekte gibt es sonst überhaupt
 * keinen Weg in den Chat: die Kundenroute verlangt ein EIGENTUM (`get_my_project`), und ein
 * admin-geführtes Projekt hat keinen Eigentümer. Die Dateneingabe wäre damit für den Fall
 * unerreichbar, für den sie gebaut wurde.
 *
 * ⚠ DIE NEBENWIRKUNG IST DAMIT NICHT VERSCHWUNDEN, SONDERN SICHTBAR GEMACHT. Gemessen am Schema:
 * `platform.project_messages` trägt Rolle, Blöcke und Zeitstempel — und KEINE Urheber-Spalte. Was
 * ein Admin hier schreibt, steht als `role = 'user'` im Verlauf und ist von einer Nachricht des
 * Kunden nicht unterscheidbar; in dessen eigener Ansicht erscheint sie unter „Sie". Für ein
 * admin-geführtes Projekt ist das richtig (es gibt keinen zweiten Menschen). Für ein Projekt MIT
 * Kundenkonto ist es eine Folge, die man kennen muss, bevor man tippt — deshalb steht sie genau
 * dort als Hinweis auf der Seite und nicht nur in diesem Kommentar.
 *
 * ── ZUGANG: DIE ADMINROLLE, UND SONST NICHTS ───────────────────────────────────────────────────
 * Wortgleich zu `/admin/kalkulator` (B18-4): ein Entitlement ist die Erlaubnis eines KUNDEN, ein
 * verkauftes Produkt zu benutzen — ein Admin ist kein Kunde seines eigenen Werkzeugs. Prüfte diese
 * Seite `calculator_pro`, müsste sich Andreas einen Gutscheincode ausstellen, um ein Projekt zu
 * bearbeiten, das er selbst angelegt hat. `lib/admin/project-chat-ui.test.ts` pinnt das, weil ein
 * später „zur Vereinheitlichung" ergänzter Aufruf in keinem Build sichtbar wäre.
 *
 * ── DREI WRAPPER, KEIN NEUER, KEINE MIGRATION ──────────────────────────────────────────────────
 *   `public.admin_get_project`      — der Projektkopf (`is_admin()`-geprüft).
 *   `public.list_project_messages`  — der Verlauf.
 *   `public.list_project_documents` — die Unterlagen.
 * Die beiden letzten sind keine `admin_*`-Funktionen und trotzdem richtig: sie entscheiden über
 * `platform.project_accessible`, und die trägt seit dem zweiten Bauschritt `or platform.is_admin()`.
 * Dasselbe gilt für alles, was der Chat von hier aus auslöst — `get_project`, `append_project_message`,
 * `check_chat_rate_limit` (dort ist ein Admin ausgenommen und wird auch nicht gezählt). Es war
 * deshalb KEINE Zeile Datenbank zu ändern; die Sperre sass ausschliesslich auf Seitenebene.
 *
 * ── ⚠ DER INTL-KONTEXT KOMMT VON AUSSEN — GEMESSEN, NICHT ANGENOMMEN ───────────────────────────
 * `ProjectChat` ist eine Client-Komponente und ruft `useTranslations('Projekte.chat'|'…status'|'…upload')`.
 * `/admin` liegt ausserhalb von `app/(site)/[locale]` und hat trotzdem einen Provider:
 * `components/admin/root-shell.tsx` umschliesst beide Admin-Root-Layouts mit `<NextIntlClientProvider>`
 * OHNE `messages`-Prop, und die Server-Variante löst das zu `await getMessages()` auf — also zum
 * vollständigen `messages/de.json`. Am laufenden Server gegengeprüft (anonym auf `/admin/anmelden`,
 * derselben Hülle): `inputLabel`, `emptyTranscript`, `attachedHint` und `limit_unavailable` stehen
 * je einmal im ausgelieferten Flight-Payload, eine Positivkontrolle auf ein nicht vorhandenes Wort
 * liefert 0.
 *
 * Deshalb steht hier KEIN zweiter, lokaler Provider: er schriebe dieselben Namespaces ein zweites
 * Mal in einen Payload, der sie ohnehin schon vollständig trägt. Was stattdessen nötig ist, ist ein
 * WÄCHTER — diese Route hängt jetzt an einer Eigenschaft von `root-shell.tsx`, die dort aus einem
 * ANDEREN Grund steht (die locale-bewussten UI-Primitives). Wer den Provider dort entfernt, bricht
 * diesen Chat, und zwar erst zur Laufzeit. `lib/admin/project-chat-ui.test.ts` hält es fest.
 */

/** Rolle live gelesen, ein Entzug greift sofort (I10) — wie in jeder Admin-Route. */
export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function AdminProjectDataEntryPage({
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

  /*
   * Dieselben zwei Ausgänge wie auf der Detailseite und aus demselben Grund: „gibt es nicht" und
   * „konnte nicht geladen werden" sind verschiedene Aussagen. Eine 404 für den zweiten Fall
   * schickte Martin ein Projekt suchen, das es sehr wohl gibt.
   */
  if (project === null || project === 'not_found') {
    return (
      <Container className="py-10 sm:py-14">
        <header className="border-b border-line pb-6">
          <h1 className="text-h2 text-ink">Dateneingabe</h1>
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

  /*
   * Verlauf und Unterlagen parallel — beide hängen an derselben Zugangsentscheidung, die die
   * Datenbank in jedem der beiden Wrapper ohnehin noch einmal selbst trifft.
   *
   * ⚠ Beide Leser kommen aus `lib/project-chat/supabase-ports.ts`, also aus derselben Datei, aus
   * der die Kundenroute sie holt. Ein eigener Admin-Leser daneben wäre eine zweite Auslegung
   * derselben Antwort (Obergrenze, kaputte Zeilen, Rollen-Prüfung), und die Abweichung fiele erst
   * auf, wenn Martin einen anderen Verlauf sieht als der Kunde.
   */
  const [messages, documents] = await Promise.all([
    loadProjectMessages(project.id),
    loadProjectDocuments(project.id),
  ])

  const segment = projectSegmentLabel(project.segment)

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
          {segment && <Pill tone="neutral">{segment}</Pill>}
          {project.industry && <Pill tone="neutral">{project.industry}</Pill>}
          {project.account_id === null && <Pill tone="neutral">ohne Kundenkonto</Pill>}
        </div>
        <p className="mt-4 max-w-prose text-small text-text-muted">
          Das Gespräch sammelt die Angaben des Projekts — Zählpunkte, Lastgang, Tarifwerte. Es ist
          derselbe Verlauf, den der Kunde in seinem Konto sieht; gerechnet wird hier noch nichts.
        </p>
      </header>

      {/*
        ⚠ NUR BEI EINEM PROJEKT MIT KUNDENKONTO. Bei einem admin-geführten Projekt gibt es keinen
        zweiten Menschen, dem etwas erscheinen könnte — der Hinweis wäre dort eine Warnung ohne
        Gegenüber und stünde bald als Möbelstück da. Die Aussage ist eine Tatsache über das Schema
        (`project_messages` hat keine Urheber-Spalte), keine Vermutung; s. Kopf dieser Datei.
      */}
      {project.account_id !== null && (
        <div
          role="note"
          className="mt-8 rounded-md border border-warning-border bg-warning-subtle p-4"
        >
          <p className="max-w-prose text-small text-ink">
            <strong className="font-medium">Dieses Projekt gehört einem Kundenkonto.</strong> Was
            Sie hier schreiben, erscheint im Chat des Kunden — und dort als seine eigene Nachricht:
            der Verlauf führt keine Urheber. Für eine Rückfrage an den Kunden gibt es den Bereich{' '}
            <Link
              href="/admin/rueckfragen"
              className="text-accent underline decoration-accent underline-offset-[3px]"
            >
              Rückfragen
            </Link>
            .
          </p>
        </div>
      )}

      <AdminSection id="gespraech" title="Gespräch">
        <div className="max-w-3xl">
          <ProjectChat
            projectId={project.id}
            /*
             * Die Auswahl trifft `visibleTranscript` — SERVERSEITIG und an genau einer Stelle,
             * dieselbe Funktion wie auf der Kundenroute und im Rückfragen-Bereich.
             * `tool_call`/`tool_result` erreichen den Browser damit gar nicht erst; sie stehen
             * weder im Markup noch im Flight-Payload.
             */
            initialTranscript={visibleTranscript(messages)}
            initialDocuments={documents.map((document) => ({
              id: document.id,
              filename: document.original_filename,
            }))}
          />
        </div>
      </AdminSection>
    </Container>
  )
}
