import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import { ChatTranscript } from '@/components/admin/chat-transcript'
import { OpenQuestionAnswerForm } from '@/components/admin/open-question-answer-form'
import type { StoredChatMessage } from '@/lib/project-chat/ports'
import {
  OPEN_QUESTIONS_HREF,
  OPEN_QUESTION_STATUS_LABEL,
  QUESTION_ANCHOR,
  hasStandingAssumption,
  readProjectMessages,
  readProjectQuestions,
  type ProjectQuestionRow,
} from '@/lib/admin/open-questions'
// Der Projektkopf wird seit der Admin-Projektliste aus `projects.ts` gelesen — eine Definition
// dieses Lesers, zwei Bereiche (Begründung im Kopf von `lib/admin/open-questions.ts`).
import { readAdminProject } from '@/lib/admin/projects'

/*
 * `/admin/rueckfragen/[projectId]` — die Rückfragen EINES Projekts, im Gesprächsverlauf (B24).
 *
 * ── ⚠ WARUM DIE SEITE AM PROJEKT HÄNGT UND NICHT AN DER EINZELNEN FRAGE ─────────────────────────
 * Ausführlich begründet im Kopf von `lib/admin/open-questions.ts`. Kurz: es gibt keinen Wrapper,
 * der EINE Frage liest (ihn über `admin_list_open_questions` nachzustellen liefe ab der 201. Frage
 * ins Leere), und der Kontext, den Martin zum Beantworten braucht, IST ohnehin das Projekt —
 * derselbe Verlauf, oft mehrere Fragen aus demselben Gespräch. Die Warteschlange springt per Anker
 * an die geklickte Frage.
 *
 * ── DREI WRAPPER, KEIN NEUER ────────────────────────────────────────────────────────────────────
 *   `public.admin_get_project`     — der Projektkopf (`is_admin()`-geprüft).
 *   `public.list_open_questions`   — die Fragen dieses Projekts.
 *   `public.list_project_messages` — der Verlauf.
 * Die beiden letzten sind NICHT `admin_*`-Funktionen und trotzdem richtig: sie entscheiden über
 * `platform.project_accessible`, und die trägt `or platform.is_admin()`. Ein eigener Zwilling wäre
 * eine zweite Definition desselben Zugriffs — und die zweite liefe beim nächsten Umbau anders.
 *
 * ⚠ `list_open_questions` hat die Vorgabe `p_status = null` (ALLE Status) — anders als
 * `admin_list_open_questions`, dessen Vorgabe `'open'` ist. Hier ist „alle" richtig: erledigte
 * Fragen desselben Projekts sind Kontext, keine Aufgabe. Sie stehen deshalb unten getrennt, ohne
 * Antwortfeld.
 *
 * ── WAS HIER AUSDRÜCKLICH NICHT PASSIERT ────────────────────────────────────────────────────────
 * Kein Schreiben in den Verlauf, kein Upload, kein Modellaufruf — ein Admin, der versehentlich in
 * ein fremdes Gespräch schreibt, wäre die teuerste Nebenwirkung dieser Seite. Der Verlauf ist
 * read-only und zeigt GENAU DAS, WAS DER KUNDE SIEHT (`visibleTranscript`, s.
 * `components/admin/chat-transcript.tsx`).
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/** Der Wrapper deckelt selbst bei 500; der Wert steht hier, damit die Kürzung benennbar bleibt. */
const MESSAGE_PAGE_SIZE = 500

export default async function AdminProjectQuestionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { projectId } = await params
  const supabase = await createClient()

  /*
   * Drei unabhängige Lesevorgänge, nebenläufig. Sie hängen nicht voneinander ab — und
   * hintereinander gefahren summierten sich drei Roundtrips zu einer sichtbaren Wartezeit auf einer
   * Seite, die Martin oft öffnet.
   */
  const [projectRes, questionsRes, messagesRes] = await Promise.all([
    supabase.rpc('admin_get_project', { p_id: projectId }),
    supabase.rpc('list_open_questions', { p_project_id: projectId, p_limit: 200 }),
    supabase.rpc('list_project_messages', { p_project_id: projectId, p_limit: MESSAGE_PAGE_SIZE }),
  ])
  if (projectRes.error) console.error('[admin/open-questions] admin_get_project:', projectRes.error)
  if (questionsRes.error)
    console.error('[admin/open-questions] list_open_questions:', questionsRes.error)
  if (messagesRes.error)
    console.error('[admin/open-questions] list_project_messages:', messagesRes.error)

  const project = readAdminProject(projectRes.data)

  if (project === null || project === 'not_found') {
    return (
      <Container className="py-10 sm:py-14">
        <p className="text-small">
          <Link
            href={OPEN_QUESTIONS_HREF}
            className="text-accent underline decoration-accent underline-offset-[3px]"
          >
            ← Zurück zu den Rückfragen
          </Link>
        </p>
        <div className="mt-6">
          <AdminError>
            {project === 'not_found'
              ? 'Dieses Projekt gibt es nicht (mehr).'
              : 'Das Projekt konnte nicht geladen werden. Bitte die Seite neu laden.'}
          </AdminError>
        </div>
      </Container>
    )
  }

  const questions = readProjectQuestions(questionsRes.data)
  const transcript = readProjectMessages(messagesRes.data)

  const rows =
    questions === null || questions === 'not_found' ? [] : questions.questions
  const open = rows.filter((row) => row.status === 'open')
  const closed = rows.filter((row) => row.status !== 'open')

  return (
    <Container className="py-10 sm:py-14">
      <p className="text-small">
        <Link
          href={OPEN_QUESTIONS_HREF}
          className="text-accent underline decoration-accent underline-offset-[3px]"
        >
          ← Zurück zu den Rückfragen
        </Link>
      </p>

      <header className="mt-6 border-b border-line pb-6">
        <h1 className="text-h2 text-ink">{project.customer_label}</h1>
        <p className="mt-2 text-caption text-text-muted">
          Projekt angelegt {formatDateTime(project.created_at)}
          {project.created_by_email && ` · von ${project.created_by_email}`}
          {project.account_id === null && ' · admin-geführt (kein Kundenkonto)'}
        </p>
      </header>

      <AdminSection
        id="offene-rueckfragen"
        title={open.length === 1 ? 'Offene Rückfrage' : 'Offene Rückfragen'}
        description="Älteste zuerst. Beantwortet wird hier — der Verlauf darunter ist der Kontext dazu."
      >
        {questions === null || questions === 'not_found' ? (
          <AdminError>
            Die Rückfragen dieses Projekts konnten nicht geladen werden. Das ist NICHT dasselbe wie
            „es liegt nichts an" — bitte die Seite neu laden.
          </AdminError>
        ) : open.length === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              In diesem Projekt ist derzeit keine Rückfrage offen.
            </p>
          </AdminPanel>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((row) => (
              <li key={row.id}>
                <OpenQuestionPanel row={row} projectId={projectId} />
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        id="gespraechsverlauf"
        title="Gesprächsverlauf"
        description="Genau das, was der Kunde sieht — interne Schritte (Werkzeugaufrufe) sind nicht enthalten."
      >
        {transcript === null || transcript === 'not_found' ? (
          <AdminError>
            Der Gesprächsverlauf konnte nicht geladen werden. Eine Rückfrage lässt sich ohne ihn
            beantworten — aber der Kontext fehlt dann.
          </AdminError>
        ) : (
          <AdminPanel>
            {/*
              Still gekürzt wäre der Kontext lückenhaft, ohne dass es auffiele: der Wrapper liefert
              die ÄLTESTEN Zeilen zuerst, ein zu langes Gespräch verlöre also sein ENDE — ausgerechnet
              die Turns, aus denen die Rückfrage entstand.
            */}
            {transcript.total > transcript.messages.length && (
              <p className="mb-4 rounded-md border border-warning-border bg-warning-subtle p-3 text-caption text-ink">
                Dieses Gespräch hat {transcript.total} Einträge; gezeigt werden die ersten{' '}
                {transcript.messages.length}. Die jüngsten Beiträge — und damit womöglich der Anlass
                der Rückfrage — fehlen hier.
              </p>
            )}
            <ChatTranscript rows={transcript.messages as unknown as StoredChatMessage[]} />
          </AdminPanel>
        )}
      </AdminSection>

      {closed.length > 0 && (
        <AdminSection
          id="erledigte-rueckfragen"
          title="Bereits erledigt"
          description="Kontext, keine Aufgabe — beantwortete und verworfene Rückfragen dieses Projekts."
        >
          <ul className="flex flex-col gap-4">
            {closed.map((row) => (
              <li key={row.id}>
                <ClosedQuestionPanel row={row} />
              </li>
            ))}
          </ul>
        </AdminSection>
      )}
    </Container>
  )
}

/** Eine offene Rückfrage samt Antwortfeld. */
function OpenQuestionPanel({ row, projectId }: { row: ProjectQuestionRow; projectId: string }) {
  const assumption = hasStandingAssumption(row)

  return (
    <AdminPanel>
      {/* Die Sprungmarke, auf die die Warteschlange zeigt. */}
      <div id={QUESTION_ANCHOR(row.id)} className="scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="text-caption text-text-muted">
            gestellt {formatDateTime(row.created_at)}
            {row.field_key && (
              <>
                {' · betrifft das Feld '}
                <span className="text-text">{row.field_key}</span>
              </>
            )}
          </p>
          {assumption && <Pill tone="negative">läuft mit Annahme</Pill>}
        </div>

        <p className="mt-3 whitespace-pre-wrap text-body text-ink">{row.question}</p>

        {/*
          ⚠ DER ZUSTAND, DEN DIESE SEITE ERSTMALS SICHTBAR MACHT (Delta §3.3, Weg b).
          `resolve_open_question('assumed')` lässt `status` auf `open` stehen: der Chat rechnet mit
          der Annahme weiter UND die Frage wartet weiterhin hier. Ohne diesen Block sähe sie aus wie
          eine unbeantwortete — und niemand wüsste, dass der Kunde bereits eine Zahl gesehen hat,
          die auf einer Vermutung beruht.
        */}
        {assumption && (
          <div className="mt-4 rounded-md border border-negative bg-negative-subtle p-3">
            <p className="text-caption font-medium text-ink">
              Der Chat rechnet bereits mit einer Annahme weiter
            </p>
            {row.resolution_value && (
              <p className="mt-2 whitespace-pre-wrap text-small text-ink">
                Angenommen: {row.resolution_value}
              </p>
            )}
            {row.assumption_note && (
              <p className="mt-2 whitespace-pre-wrap text-caption text-ink">
                Begründung: {row.assumption_note}
              </p>
            )}
            <p className="mt-2 text-caption text-ink">
              Die Annahme bleibt beim Beantworten stehen. Weicht die Antwort davon ab, ist zu
              prüfen, ob eine bereits gezeigte Rechnung zu korrigieren ist.
            </p>
          </div>
        )}

        {row.impact_note && (
          <p className="mt-3 text-caption text-text-muted">
            Auswirkung: <span className="text-text">{row.impact_note}</span>
          </p>
        )}

        <OpenQuestionAnswerForm
          questionId={row.id}
          projectId={projectId}
          hasAssumption={assumption}
        />
      </div>
    </AdminPanel>
  )
}

/** Eine erledigte Rückfrage — reine Anzeige, kein Antwortfeld. */
function ClosedQuestionPanel({ row }: { row: ProjectQuestionRow }) {
  return (
    <AdminPanel>
      <div id={QUESTION_ANCHOR(row.id)} className="scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="text-caption text-text-muted">
            gestellt {formatDateTime(row.created_at)}
            {row.answered_at && ` · erledigt ${formatDateTime(row.answered_at)}`}
          </p>
          <Pill tone={row.status === 'answered' ? 'positive' : 'neutral'}>
            {OPEN_QUESTION_STATUS_LABEL[row.status]}
          </Pill>
        </div>

        <p className="mt-3 whitespace-pre-wrap text-body text-ink">{row.question}</p>

        {row.resolution_value && (
          <p className="mt-3 whitespace-pre-wrap text-small text-text">
            Antwort: {row.resolution_value}
          </p>
        )}
        {/*
          ⚠ DIE ANNAHME BLEIBT AUCH NACH DER ANTWORT STEHEN (der Wrapper fasst sie nicht an) — sie
          belegt, WOMIT in der Zwischenzeit gerechnet wurde.

          Der Hinweis auf die mögliche Korrektur steht HIER und nicht in der Erfolgsmeldung des
          Formulars: die ist im Regelfall nie sichtbar, weil das Panel mit dem Erfolg verschwindet
          (gemessen, s. `components/admin/open-question-answer-form.tsx`). An dieser Stelle bleibt
          er dauerhaft stehen — und zwar genau dort, wo Annahme und Antwort nebeneinander zu sehen
          sind und sich vergleichen lassen.
        */}
        {row.assumption_note && (
          <div className="mt-3 rounded-md border border-warning-border bg-warning-subtle p-3">
            <p className="whitespace-pre-wrap text-caption text-ink">
              Zwischenzeitlich wurde angenommen: {row.assumption_note}
            </p>
            {row.status === 'answered' && (
              <p className="mt-2 text-caption text-ink">
                Weicht die Antwort davon ab, ist zu prüfen, ob eine bereits gezeigte Rechnung zu
                korrigieren ist.
              </p>
            )}
          </div>
        )}
      </div>
    </AdminPanel>
  )
}
