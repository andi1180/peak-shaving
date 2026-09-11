'use client'

/**
 * Die Zählpunkt-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * Ein Zahlenfeld und ein Knopf, der speichert UND weitergeht — dieselbe Entscheidung wie bei der
 * Segment-Station und aus demselben Grund: zwei Wege nach vorn, von denen einer die Angabe
 * überspringt, wären einer zu viel.
 *
 * ⚠ DIESES FELD KANN ZÄHLPUNKTE ENTFERNEN. `admin_set_metering_point_count` legt fehlende an und
 * entfernt beim Verkleinern die ZULETZT angelegten. Der einzige Fall, in dem dabei etwas Gemessenes
 * verloren ginge, ist in der Datenbank abgefangen (`has_load_profile` — der gesamte Aufruf fällt
 * aus, nichts wird geändert); die Meldung dazu kommt mit konkreten Zahlen zurück und steht am Feld.
 * Der Hinweis unter dem Feld sagt das VORHER, denn nach dem Klick ist es entweder passiert oder
 * abgewiesen.
 *
 * ⚠ Eine Rückfrage vor dem Absenden gibt es bewusst NICHT: der gefährliche Fall ist der abgefangene,
 * und eine Bestätigung, die in den 99 % harmlosen Fällen erscheint (Zahl erhöhen, Zahl unverändert
 * bestätigen), erzieht dazu, sie wegzuklicken — dieselbe Überlegung wie in `new-project-form.tsx`.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { setMeteringPointCountAction } from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminField } from './ui'

const FIELD_ID = 'dateneingabe-zaehlpunkte'

export function DataEntryCountForm({
  projectId,
  /** Die Zahl der bereits angelegten Zählpunkte — 0, solange keiner existiert. */
  current,
  /** Wie viele davon bereits einen eingelesenen Lastgang tragen. */
  withLoadProfile,
}: {
  projectId: string
  current: number
  withLoadProfile: number
}) {
  const [state, formAction, isPending] = useActionState(
    setMeteringPointCountAction,
    ADMIN_INITIAL_STATE,
  )
  const error = state.fieldErrors?.count

  React.useEffect(() => {
    if (error) document.getElementById(FIELD_ID)?.focus()
  }, [error])

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      <input type="hidden" name="projectId" value={projectId} />

      <div className="max-w-xs">
        <AdminField
          id={FIELD_ID}
          name="count"
          label="Anzahl Zählpunkte"
          /*
           * ⚠ Die Vorbelegung ist der GESPEICHERTE Stand, nicht ein Vorschlag — nur so zeigt die
           * Station beim Zurückkommen, was wirklich gilt. Nach einer abgelehnten Eingabe gewinnt
           * `state.values`: die getippte Zahl muss stehen bleiben, sonst sucht man den Fehler an
           * einem Feld, das inzwischen wieder etwas anderes zeigt.
           */
          defaultValue={state.values?.count ?? (current > 0 ? String(current) : '')}
          inputMode="numeric"
          error={error}
          hint={
            current === 0
              ? 'Wie viele Zählpunkte hat dieser Betrieb? Für jeden entsteht ein eigener Satz Schritte.'
              : `Aktuell angelegt: ${current}${
                  withLoadProfile > 0
                    ? ` — davon ${withLoadProfile} mit eingelesenem Lastgang. Ein Verkleinern, das einen davon träfe, wird abgewiesen.`
                    : '.'
                }`
          }
          required
        />
      </div>

      <div>
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird gespeichert …' : 'Speichern und weiter'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird gespeichert …' : ''}
        </span>
      </div>
    </form>
  )
}
