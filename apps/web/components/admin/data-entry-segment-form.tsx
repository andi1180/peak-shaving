'use client'

/**
 * Die Segment-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ── ZWEI KNÖPFE, KEIN EINGABEFELD UND KEINE AUSWAHLLISTE ────────────────────────────────────────
 * `platform.projects.segment` trägt einen CHECK auf genau zwei Werte, und `PROJECT_SEGMENTS`
 * spiegelt ihn. Bei zwei Möglichkeiten ist der Klick die Antwort: eine Auswahlliste plus
 * Speichern-Knopf wären zwei Handgriffe für eine Entscheidung, ein Textfeld erlaubte einen dritten
 * Wert, den die Datenbank ohnehin abwiese.
 *
 * ⚠ DER KNOPF SPEICHERT UND GEHT WEITER — es gibt daneben bewusst KEINEN eigenen „Weiter". Beides
 * wäre ein Weg nach vorn, und einer davon (der blosse Link) überspränge die Angabe, um die es auf
 * dieser Station geht. Wer über Zurück hierherkommt und nichts ändern will, klickt den bereits
 * gewählten Wert: `update_project_segment_industry` schreibt denselben Wert (`coalesce`) und die
 * Weiterleitung ist dieselbe.
 *
 * ⚠ EIN WECHSEL AUF „PRIVAT" LEERT EINE BEREITS GESETZTE BRANCHE NICHT. Das ist eine Eigenschaft
 * des Wrappers („Eine bereits gesetzte Branche ueberlebt einen spaeteren Segmentwechsel", Migration
 * 20260911170000) und keine Entscheidung dieser Oberfläche — sie steht hier, weil sie beim Klicken
 * nicht sichtbar ist. Die Branche ist in diesem Bauschritt keine Station des Wizards.
 *
 * Muster wie `new-project-form.tsx`: echtes `<form action={formAction}>` (funktioniert ohne
 * JavaScript), `useActionState` für Ladezustand und Fehleranzeige.
 */
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { setProjectSegmentAction } from '@/lib/admin/data-entry-actions'
import { PROJECT_SEGMENTS, PROJECT_SEGMENT_LABELS, type ProjectSegment } from '@/lib/admin/projects'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError } from './ui'

export function DataEntrySegmentForm({
  projectId,
  /** Das gespeicherte Segment, oder `null`, wenn noch keines bestimmt wurde. */
  current,
}: {
  projectId: string
  current: ProjectSegment | null
}) {
  const [state, formAction, isPending] = useActionState(
    setProjectSegmentAction,
    ADMIN_INITIAL_STATE,
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      <input type="hidden" name="projectId" value={projectId} />

      <div className="flex flex-wrap gap-3">
        {PROJECT_SEGMENTS.map((segment) => {
          const selected = segment === current
          return (
            <Button
              key={segment}
              type="submit"
              /*
               * Der gespeicherte Wert trägt den Akzent, der andere die Kontur. Die Markierung steht
               * zusätzlich als SATZ darunter: Farbe allein ist keine Auskunft (DESIGN.md — „Farbe
               * ist Information, kein Dekor", und sie ist die einzige, die nicht jeder sieht).
               */
              variant={selected ? 'primary' : 'secondary'}
              size="md"
              name="segment"
              value={segment}
              disabled={isPending}
            >
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {PROJECT_SEGMENT_LABELS[segment]}
            </Button>
          )
        })}
      </div>

      <p className="text-caption text-text-muted">
        {current === null
          ? 'Noch nicht bestimmt. Die Wahl entscheidet, welcher Fragen-Pool für dieses Projekt gilt.'
          : `Aktuell gespeichert: ${PROJECT_SEGMENT_LABELS[current]}. Ein erneuter Klick speichert denselben Wert und geht weiter.`}
      </p>

      <span role="status" aria-live="polite" className="sr-only">
        {isPending ? 'Wird gespeichert …' : ''}
      </span>
    </form>
  )
}
