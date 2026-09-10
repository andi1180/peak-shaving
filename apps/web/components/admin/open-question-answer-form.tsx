'use client'

/**
 * Martins Antwort auf eine Rückfrage (B24, zehnter Bauschritt).
 *
 * ── EIN FELD, EIN KNOPF — und das ist eine Eigenschaft des Wrappers, keine Sparsamkeit ──────────
 * `admin_answer_open_question` trägt den Zielstatus als LITERAL (Muster
 * `admin_reject_partner_application`, B16-3d): diese Funktion kann ausschliesslich BEANTWORTEN.
 * Ein Auswahlmenü „beantworten / annehmen / verwerfen" bildete deshalb etwas ab, das dieser Aufruf
 * gar nicht kann — und die naheliegende Auflösung („dann nimm halt `resolve_open_question`") ist
 * genau die, die der Kommentar in der Migration ausschliesst: Martins Antwort soll nicht
 * versehentlich mit einem falschen Parameter zu einer Annahme werden.
 *
 * ── KEINE RÜCKFRAGE VOR DEM ABSCHICKEN, ANDERS ALS BEIM ABLEHNEN EINES ANTRAGS ─────────────────
 * Eine Antwort ist kein unumkehrbarer Vorgang im Sinn von B16-3/B1-3: es entsteht kein Datensatz,
 * den niemand mehr löschen kann, es wird nichts anonymisiert, und es geht keine Nachricht raus. Ein
 * Bestätigungshäkchen davor wäre Zeremonie — und Zeremonie an einer Stelle, die oft benutzt wird,
 * erzieht dazu, sie wegzuklicken.
 *
 * Muster wie `components/admin/partner-approval-form.tsx`: echtes `<form action={formAction}>`
 * (funktioniert ohne JavaScript), `useActionState` für Ladezustand und Fehler.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldHint, Label, Textarea } from '@/components/ui/input'
import { answerOpenQuestionAction } from '@/lib/admin/open-questions-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminSuccess } from './ui'

export function OpenQuestionAnswerForm({
  questionId,
  projectId,
  hasAssumption,
}: {
  questionId: string
  /** Nur für `revalidatePath` der Detailseite — die Frage identifiziert der Wrapper allein. */
  projectId: string
  /**
   * Steht zu dieser Frage bereits eine ANNAHME (Weg b)? Reine ANZEIGE: sie ändert am Schreibvorgang
   * nichts (die Annahme bleibt ohnehin stehen), sie ändert den Wortlaut der Erfolgsmeldung — und
   * damit den einzigen Hinweis darauf, dass eine bereits gezeigte Rechnung zu prüfen ist.
   */
  hasAssumption: boolean
}) {
  const [state, formAction, isPending] = useActionState(
    answerOpenQuestionAction,
    ADMIN_INITIAL_STATE,
  )
  const fieldId = `answer-${questionId}`
  const hintId = `${fieldId}-hint`
  const error = state.fieldErrors?.answer

  React.useEffect(() => {
    if (error) document.getElementById(fieldId)?.focus()
  }, [error, fieldId])

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ GEMESSEN: DIE ERFOLGSMELDUNG ERSCHEINT IM REGELFALL NIE — UND DAS IST RICHTIG SO
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Nach dem Erfolg lädt `revalidatePath` die Projektseite neu, und die beantwortete Frage wandert
   * aus dem Abschnitt „Offene Rückfragen" in „Bereits erledigt". Dabei verschwindet dieses Panel —
   * und mit ihm dieses Formular samt seinem `useActionState`-Zustand. Im Browser gemessen: schon
   * 400 ms nach dem Klick sind 0 Antwortfelder da und „Bereits erledigt" steht auf der Seite; die
   * Meldung ist zu keinem Zeitpunkt sichtbar. Dieselbe Beobachtung wie bei der Partner-Genehmigung
   * (B16-4a, dort ebenfalls im Bau gemessen).
   *
   * Daraus folgt NICHT, dass eine Rückmeldung fehlt — sie ist nur eine andere und eine bessere:
   * die Frage steht sichtbar mit ihrer Antwort unter „Bereits erledigt". Daraus folgt aber sehr
   * wohl, dass nichts Wichtiges NUR in dieser Meldung stehen darf. Die zwei Aussagen, auf die es
   * ankommt, stehen deshalb DAUERHAFT auf der Seite und nicht hier:
   *   – „der Kunde wird nicht benachrichtigt" → im Seitenkopf und im Hinweis unter diesem Feld,
   *     also VOR dem Absenden statt danach;
   *   – „eine zwischenzeitliche Annahme ist zu prüfen" → an der erledigten Frage selbst.
   *
   * Der Zweig bleibt trotzdem stehen: er kostet nichts und ist die richtige Anzeige, falls das
   * Panel je überlebt (etwa wenn die Detailseite nicht aufgefrischt wird). Entfernt wäre der Erfolg
   * dann still.
   */
  const erledigt = Boolean(state.success)

  return (
    <form action={formAction} noValidate className="mt-4 flex flex-col gap-3">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <input type="hidden" name="id" value={questionId} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="hadAssumption" value={hasAssumption ? '1' : '0'} />

      <div>
        <Label htmlFor={fieldId}>Antwort</Label>
        <div className="mt-1.5">
          <Textarea
            id={fieldId}
            name="answer"
            rows={4}
            defaultValue={state.values?.answer}
            placeholder="Der gemessene Wert liegt bei … / Die Anlage hat …"
            aria-invalid={error ? true : undefined}
            aria-describedby={hintId}
            disabled={erledigt}
          />
        </div>
        <FieldHint id={hintId} tone={error ? 'error' : 'muted'}>
          {error ??
            'Die Antwort wird am Projekt gespeichert und im Gespräch weiterverwendet. Der Kunde ' +
              'wird darüber nicht automatisch benachrichtigt.'}
        </FieldHint>
      </div>

      <div>
        <Button type="submit" variant="primary" size="md" disabled={isPending || erledigt}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird gespeichert …' : 'Rückfrage beantworten'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird gespeichert …' : ''}
        </span>
      </div>
    </form>
  )
}
