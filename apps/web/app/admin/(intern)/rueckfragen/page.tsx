import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/input'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import {
  OPEN_QUESTIONS_HREF,
  OPEN_QUESTION_FILTER_ALL,
  OPEN_QUESTION_STATUSES,
  OPEN_QUESTION_STATUS_LABEL,
  OPEN_QUESTIONS_PROJECT_HREF,
  QUESTION_STALE_DAYS,
  hasStandingAssumption,
  isOpenQuestionStatus,
  questionAgeInDays,
  readOpenQuestionQueue,
  type OpenQuestionQueueRow,
  type OpenQuestionStatus,
} from '@/lib/admin/open-questions'

/*
 * `/admin/rueckfragen` — Martins Posteingang, QUER über alle Projekte (B24, zehnter Bauschritt).
 *
 * ── DIE LÜCKE, DIE DIESE SEITE SCHLIESST ────────────────────────────────────────────────────────
 * Seit dem dritten Bauschritt kann der Chat eine Frage an Martin stellen (Weg a aus Delta §3.3);
 * seit PR #179 kann ein Kunde sie auslösen. Sichtbar war sie bis heute NUR in der Datenbank — der
 * Wrapper `public.admin_list_open_questions` liegt seit dem zweiten Bauschritt bereit und hatte
 * null Aufrufer im Anwendungscode. Eine Rückfrage, die niemand sieht, ist dasselbe wie keine.
 *
 * ── ⚠ ÄLTESTE ZUERST, UND ES WIRD HIER NICHT NACHSORTIERT ───────────────────────────────────────
 * Der Wrapper sortiert `created_at` AUFSTEIGEND — entgegen der Gewohnheit jedes anderen
 * `admin_list_*` dieses Repos, und mit ausdrücklicher Begründung: ein Posteingang wird von vorne
 * abgearbeitet; bei `desc` läge die am längsten wartende Frage am Ende der letzten Seite, also
 * ausgerechnet der Kunde, der am längsten hängt. Diese Seite übernimmt die Reihenfolge unverändert.
 *
 * ── ⚠ „OFFEN" HEISST NICHT „UNBEARBEITET" ───────────────────────────────────────────────────────
 * `resolve_open_question('assumed')` (Weg b) lässt `status` auf `open` STEHEN: der Chat rechnet mit
 * einer Annahme weiter UND die Frage wartet weiterhin auf Martin. Genau das ist die Zusage aus
 * Delta §3.3, und diese Seite ist die erste Stelle, an der sie sichtbar wird — als eigene
 * Markierung an der Zeile, nicht als Status. Ohne sie sähe eine mit Annahme laufende Frage aus wie
 * eine unbeantwortete, und niemand wüsste, dass der Kunde bereits eine Zahl gesehen hat.
 *
 * ── DER FILTER IST EIN ECHTES GET-FORMULAR ──────────────────────────────────────────────────────
 * Kein Client-Zustand, keine Server Action: der Filter IST die URL (Muster `/admin/leads` B1-3 und
 * `/admin/partner-antraege` B16-3). Damit funktioniert die Ansicht ohne JavaScript, ist teilbar und
 * kann nicht mit der Adresszeile auseinanderlaufen.
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

function pageHref(status: string, page: number): string {
  const sp = new URLSearchParams()
  // Der leere Wert („Alle") steht ausdrücklich in der URL — sonst fiele die Seite auf die
  // Vorgabe „nur offene" zurück und der Filter ginge beim Blättern verloren.
  sp.set('status', status)
  if (page > 1) sp.set('seite', String(page))
  return `${OPEN_QUESTIONS_HREF}?${sp.toString()}`
}

/**
 * „Offen" trägt den Warnton: es ist der einzige Zustand dieser Liste, der eine Handlung verlangt.
 * Beantwortet ist positiv (erledigt), verworfen neutral (erledigt, aber ohne Auskunft).
 */
function statusTone(status: OpenQuestionStatus): 'warning' | 'positive' | 'neutral' {
  if (status === 'open') return 'warning'
  if (status === 'answered') return 'positive'
  return 'neutral'
}

export default async function AdminOpenQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const rawStatus = typeof query.status === 'string' ? query.status : undefined

  /*
   * ⚠ DER FILTERWERT WIRD IMMER AUSDRÜCKLICH ÜBERGEBEN — auch der Vorgabefall.
   *
   * `admin_list_open_questions(p_status text default 'open', …)`: ein WEGGELASSENER Parameter heisst
   * dort „nur offene", nicht „alle". Verliesse sich diese Seite darauf, hinge ihre Voreinstellung
   * stillschweigend daran, dass die Vorgabe der Datenbank dieselbe bleibt — eine spätere Änderung
   * dort verschöbe, was die Liste zeigt, ohne dass hier eine Zeile anders aussähe.
   *
   * Ein UNBEKANNTER Wert wird NICHT stillschweigend auf „alle" zurückgesetzt: er geht an die
   * Datenbank, und die antwortet mit `invalid_filter`. Sonst hielte man ein ungefiltertes Ergebnis
   * für ein gefiltertes (dieselbe Regel wie in `admin_list_leads`, B1-3).
   */
  const effectiveStatus =
    rawStatus === undefined
      ? 'open'
      : rawStatus === OPEN_QUESTION_FILTER_ALL
        ? OPEN_QUESTION_FILTER_ALL
        : rawStatus
  const status = isOpenQuestionStatus(effectiveStatus) ? effectiveStatus : null
  const page = Math.max(1, Number(typeof query.seite === 'string' ? query.seite : '1') || 1)

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_open_questions', {
    p_status: effectiveStatus,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })
  if (res.error) console.error('[admin/open-questions] admin_list_open_questions:', res.error)

  const list = readOpenQuestionQueue(res.data)
  const pages = list && list !== 'invalid_filter' ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1
  // Einmal je Seitenaufruf gebildet: alle Zeilen sollen gegen DENSELBEN Stichtag gealtert werden.
  const now = new Date()

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Rückfragen</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Fragen, die der Kalkulator-Chat nicht selbst beantworten kann und an uns weitergibt —
          quer über alle Projekte, <span className="text-text">älteste zuerst</span>.
        </p>
        <p className="mt-3 max-w-prose text-small text-text-muted">
          Beantwortet wird auf der Projektseite: dort steht der Gesprächsverlauf dazu. Eine Antwort
          wird am Projekt gespeichert — der Kunde wird darüber{' '}
          <span className="text-text">nicht</span> automatisch benachrichtigt.
        </p>
      </header>

      <AdminSection
        id="rueckfragen-filter"
        title="Warteschlange"
        description="Älteste zuerst — eine Rückfrage soll nicht liegen bleiben."
      >
        <AdminPanel>
          {/* Echtes GET-Formular: der Filter IST die URL (s. Kopf). */}
          <form
            method="get"
            action={OPEN_QUESTIONS_HREF}
            className="flex flex-wrap items-end gap-4"
          >
            <div>
              <Label htmlFor="status">Status</Label>
              <div className="mt-1.5">
                <Select id="status" name="status" defaultValue={effectiveStatus}>
                  <option value={OPEN_QUESTION_FILTER_ALL}>Alle</option>
                  {OPEN_QUESTION_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {OPEN_QUESTION_STATUS_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button type="submit" variant="secondary" size="md">
              Filtern
            </Button>
            {effectiveStatus !== 'open' && (
              <Link
                href={OPEN_QUESTIONS_HREF}
                className="text-small text-accent underline decoration-accent underline-offset-[3px]"
              >
                Nur offene zeigen
              </Link>
            )}
          </form>
        </AdminPanel>

        {list === 'invalid_filter' ? (
          <AdminError>
            Der Statusfilter „{rawStatus}" ist unbekannt. Die Liste zeigt deshalb NICHTS — ein
            ungefiltertes Ergebnis wäre hier als gefiltertes zu lesen.
          </AdminError>
        ) : list === null ? (
          <AdminError>
            Die Rückfragen konnten nicht geladen werden. Das ist NICHT dasselbe wie „es liegt nichts
            an" — bitte die Seite neu laden.
          </AdminError>
        ) : list.questions.length === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              {status === 'open'
                ? 'Nichts offen — alle Rückfragen sind beantwortet.'
                : status
                  ? `Keine Rückfragen mit dem Status „${OPEN_QUESTION_STATUS_LABEL[status]}".`
                  : 'Es gibt noch keine Rückfragen.'}
            </p>
          </AdminPanel>
        ) : (
          <>
            <p className="mb-4 text-small text-text-muted">
              {list.total} {list.total === 1 ? 'Rückfrage' : 'Rückfragen'}
              {status ? ` mit dem Status „${OPEN_QUESTION_STATUS_LABEL[status]}"` : ''}
            </p>
            <ul className="flex flex-col gap-4">
              {list.questions.map((row) => (
                <li key={row.id}>
                  <QuestionCard row={row} now={now} />
                </li>
              ))}
            </ul>

            {pages > 1 && (
              <nav aria-label="Seiten" className="mt-6 flex items-center gap-4">
                {page > 1 && (
                  <Link
                    href={pageHref(effectiveStatus, page - 1)}
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
                    href={pageHref(effectiveStatus, page + 1)}
                    className="text-small text-accent underline decoration-accent underline-offset-[3px]"
                  >
                    Weiter
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </AdminSection>
    </Container>
  )
}

function QuestionCard({ row, now }: { row: OpenQuestionQueueRow; now: Date }) {
  const age = questionAgeInDays(row.created_at, now)
  const stale = row.status === 'open' && age !== null && age >= QUESTION_STALE_DAYS
  const assumption = hasStandingAssumption(row)
  const href = OPEN_QUESTIONS_PROJECT_HREF(row.project_id, row.id)

  return (
    <AdminPanel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-h4 text-ink">
            <Link
              href={href}
              className="underline decoration-line-strong underline-offset-4 hover:decoration-accent"
            >
              {row.customer_label}
            </Link>
          </h3>
          <p className="mt-1 text-caption text-text-muted">
            gestellt {formatDateTime(row.created_at)}
            {age !== null && ` · seit ${age} ${age === 1 ? 'Tag' : 'Tagen'} offen`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Die Annahme steht VOR dem Status, weil sie die Auskunft ist, die man beim Überfliegen
            braucht: Bei dieser Frage rechnet der Chat bereits mit einer Vermutung weiter — der
            Kunde hat also schon eine Zahl gesehen.
          */}
          {assumption && <Pill tone="negative">läuft mit Annahme</Pill>}
          {stale && <Pill tone="warning">liegt seit {age} Tagen</Pill>}
          <Pill tone={statusTone(row.status)}>{OPEN_QUESTION_STATUS_LABEL[row.status]}</Pill>
        </div>
      </div>

      {/*
        Die Frage steht schon in der Liste — sie ist der Grund, eine Zeile überhaupt zu öffnen.
        Gekürzt wird sie in der DARSTELLUNG (`line-clamp`), nicht im Datenpfad.
      */}
      <p className="mt-4 line-clamp-3 whitespace-pre-wrap text-small text-text">{row.question}</p>

      {row.field_key && (
        <p className="mt-2 text-caption text-text-muted">
          Betrifft das Feld <span className="text-text">{row.field_key}</span>
        </p>
      )}

      <p className="mt-4">
        <Link
          href={href}
          className="text-small text-accent underline decoration-accent underline-offset-[3px]"
        >
          Im Gesprächsverlauf ansehen und beantworten
        </Link>
      </p>
    </AdminPanel>
  )
}
