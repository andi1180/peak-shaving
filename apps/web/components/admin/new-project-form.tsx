'use client'

/**
 * Das Anlage-Formular der Kalkulator-Projektliste (B24, Teil 1 Schritt 1).
 *
 * ── EIN FELD, EIN KNOPF — und das ist eine Eigenschaft der Aufgabe, keine Sparsamkeit ───────────
 * Ein Projekt ist in diesem Schritt ein leerer Container: die Bezeichnung ist die einzige Angabe,
 * die es beim Anlegen überhaupt gibt. Segment und Branche entstehen im Gespräch (`set_segment`/
 * `set_industry`), der Zählpunkt-Inhalt kommt mit der Dateneingabe. Felder dafür wären hier
 * Requisiten — sichtbar, aber ohne Wirkung; ausführlich begründet in `lib/admin/projects-actions.ts`.
 *
 * ── KEINE RÜCKFRAGE VOR DEM ABSCHICKEN ──────────────────────────────────────────────────────────
 * Ein Projekt anzulegen ist kein unumkehrbarer Vorgang im Sinn von B16-3/B1-3: es wird nichts
 * anonymisiert, es geht keine Nachricht raus, und ein versehentlich angelegtes Projekt ist eine
 * Zeile mehr in einer Liste. Ein Bestätigungshäkchen wäre Zeremonie — und Zeremonie an einer
 * Stelle, die oft benutzt wird, erzieht dazu, sie wegzuklicken.
 *
 * Muster wie `components/admin/open-question-answer-form.tsx` (B24) und
 * `components/admin/partner-approval-form.tsx` (B16-4a): echtes `<form action={formAction}>`
 * (funktioniert ohne JavaScript), `useActionState` für Ladezustand und Fehler.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createAdminProjectAction } from '@/lib/admin/projects-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminField, AdminSuccess } from './ui'

const FIELD_ID = 'neues-projekt-label'

export function NewProjectForm() {
  const [state, formAction, isPending] = useActionState(
    createAdminProjectAction,
    ADMIN_INITIAL_STATE,
  )
  const error = state.fieldErrors?.customerLabel

  React.useEffect(() => {
    if (error) document.getElementById(FIELD_ID)?.focus()
  }, [error])

  /*
   * ⚠ Anders als beim Beantworten einer Rückfrage ERSCHEINT die Erfolgsmeldung hier wirklich:
   * `revalidatePath` frischt die Liste darüber auf, dieses Panel bleibt aber stehen (es ist kein
   * Teil der Liste). Sie ist damit der einzige Ort, an dem steht, was gerade passiert ist — die
   * neue Zeile allein sagt nicht, dass sie neu ist.
   *
   * Das Feld wird nach dem Erfolg NICHT geleert und nicht gesperrt: der wahrscheinlichste nächste
   * Schritt ist ein zweites Projekt, und `state.values` trägt die letzte Eingabe ohnehin zurück.
   */
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <AdminField
        id={FIELD_ID}
        name="customerLabel"
        label="Kundenbezeichnung"
        defaultValue={state.values?.customerLabel}
        placeholder="z. B. Hotel Alpenblick oder Bäckerei Gruber"
        error={error}
        hint={
          'Der Name, an dem Sie das Projekt in der Liste wiedererkennen. Er wird am Projekt ' +
          'gespeichert und bleibt lesbar, auch wenn später ein Kundenkonto dazukommt oder wegfällt.'
        }
        required
      />

      <div>
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird angelegt …' : 'Projekt anlegen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird angelegt …' : ''}
        </span>
      </div>
    </form>
  )
}
