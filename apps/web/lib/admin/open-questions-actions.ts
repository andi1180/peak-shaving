'use server'

/**
 * Server Action des Rückfragen-Eingangs — die Anwendungsseite von
 * `public.admin_answer_open_question` (B24, zweiter Bauschritt).
 *
 * ── KEIN service_role, exakt wie die Lead-, Partner- und Analyse-Actions ────────────────────────
 * Der Wrapper ist `authenticated`-only und prüft `platform.is_admin()` INTERN als erste Anweisung.
 * Die Autorisierung hängt damit nicht an dieser Datei; ein Fehler hier kann keinem Nicht-Admin
 * Schreibzugriff verschaffen. Es kommt ein zweiter Grund dazu, und der wiegt hier schwerer als
 * sonst: der Wrapper schreibt `answered_by = auth.uid()`. Über `service_role` wäre die Spalte
 * strukturell leer — und WER geantwortet hat, ist bei einer Auskunft, mit der anschliessend
 * gerechnet wird, die halbe Aussage. Die `no-restricted-imports`-Erlaubnisliste wurde für diesen
 * Pfad NICHT erweitert.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES GIBT HIER AUSSCHLIESSLICH „BEANTWORTEN" — und das ist eine Eigenschaft des Wrappers
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `admin_answer_open_question` trägt den Zielstatus als LITERAL und nicht als Parameter (Muster
 * `admin_reject_partner_application`, B16-3d). Diese Funktion kann eine Frage weder annehmen noch
 * verwerfen; beides gäbe es für einen Admin über `resolve_open_question` — aber ausdrücklich nicht
 * über denselben Aufruf, damit Martins Antwort nicht versehentlich mit einem falschen Parameter zu
 * einer Annahme wird.
 *
 * Die Oberfläche bildet das eins zu eins ab: ein Feld, ein Knopf, kein Auswahlmenü für die Art der
 * Erledigung. Eine „Frage verwerfen"-Schaltfläche wäre ein neuer Vorgang mit eigener Begründung und
 * gehört nicht als Beiwerk in diesen Schritt.
 *
 * ── ⚠ ES GEHT KEINE NACHRICHT AN DEN KUNDEN RAUS ────────────────────────────────────────────────
 * Weder Mail noch Hinweis im Chat. Das ist der offene Punkt 6 aus Delta §3.3 und ausdrücklich NICHT
 * Teil dieses Schritts — anders als bei der Partner-Genehmigung (B16-4b) gibt es hier also nichts,
 * was nach der Transaktion noch schiefgehen könnte. Die Erfolgsmeldung sagt es im Klartext, damit
 * niemand den Vorgang für abgeschlossen hält: die Antwort steht in der Datenbank, der Kunde weiss
 * noch nichts davon.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { AdminState } from './schema'
import { OPEN_QUESTIONS_HREF, OPEN_QUESTIONS_PROJECT_HREF } from './open-questions'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const GONE = 'Diese Rückfrage gibt es nicht (mehr).'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

/**
 * Beantwortet eine Rückfrage: `status = 'answered'`, `resolution_kind = 'answered'`, Antworttext,
 * Urheber und Zeitpunkt — in EINEM Aufruf.
 *
 * ⚠ EINE BEREITS GETROFFENE ANNAHME BLEIBT DABEI STEHEN (der Wrapper fasst `assumption_note` nicht
 * an), und das ist kein Nebeneffekt: sie belegt, WOMIT in der Zwischenzeit gerechnet wurde — und
 * genau daran erkennt der nächste Schritt, ob eine bereits ausgelieferte Analyse über
 * `supersedes_id` zu korrigieren ist (Delta §3.3, „Korrektur nach Martins Antwort"). Die
 * Erfolgsmeldung weist darauf hin, wenn eine Annahme im Spiel war; sonst bliebe die einzige
 * Handlung, die aus dieser Antwort noch folgt, unsichtbar.
 */
export async function answerOpenQuestionAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '').trim()
  const projectId = String(formData.get('projectId') ?? '').trim()
  /*
   * Der Hinweis auf eine stehende Annahme kommt aus dem Formular und ist reine ANZEIGE. Er
   * entscheidet nichts — die Datenbank fasst `assumption_note` ohnehin nicht an. Er darf deshalb
   * auch nicht geprüft werden: gefälscht ändert er nur den Wortlaut einer Erfolgsmeldung.
   */
  const hadAssumption = String(formData.get('hadAssumption') ?? '') === '1'

  if (!id) return { formError: GONE }

  const answer = String(formData.get('answer') ?? '')
  const values = { answer }

  /*
   * Die Leerprüfung steht hier UND im Wrapper (`invalid_answer`), und das ist keine Verdopplung:
   * der Wrapper ist die harte Grenze (er sieht auch Aufrufe an diesem Formular vorbei), die Prüfung
   * hier liefert die Meldung AM FELD statt eines Status nach dem Roundtrip — und sie erspart einen
   * Schreibversuch, der nie etwas ändern könnte.
   */
  if (answer.trim() === '') {
    return {
      fieldErrors: {
        answer:
          'Bitte eine Antwort eintragen. Eine leere Antwort würde die Frage als beantwortet ' +
          'markieren, ohne dass irgendwo stünde, was gilt.',
      },
      values,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_answer_open_question', {
    p_question_id: id,
    p_answer: answer,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/open-questions] admin_answer_open_question:', error)
    return { formError: GENERIC, values }
  }

  const status = (data as { status?: unknown } | null)?.status
  switch (status) {
    case 'ok': {
      revalidatePath(OPEN_QUESTIONS_HREF)
      if (projectId) revalidatePath(OPEN_QUESTIONS_PROJECT_HREF(projectId))

      const base =
        'Antwort gespeichert. Die Rückfrage ist damit erledigt und verschwindet aus der ' +
        'Warteschlange. Der Kunde wird darüber NICHT automatisch benachrichtigt.'

      return {
        success: hadAssumption
          ? base +
            ' Die zuvor getroffene Annahme bleibt zur Nachvollziehbarkeit stehen — bitte prüfen, ' +
            'ob eine bereits gezeigte Rechnung damit zu korrigieren ist.'
          : base,
      }
    }
    case 'invalid_answer':
      // Erreichbar nur an der Feldprüfung oben vorbei (Leerzeichen-Eingabe fängt sie bereits ab).
      return { fieldErrors: { answer: 'Bitte eine Antwort eintragen.' }, values }
    case 'not_found':
      return { formError: GONE, values }
    default:
      console.error('[admin/open-questions] unerwartete Antwort:', data)
      return { formError: GENERIC, values }
  }
}
