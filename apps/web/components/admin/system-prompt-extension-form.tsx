'use client'

/**
 * Das Pflegeformular einer System-Prompt-Erweiterung (B24 Station 6).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ JE ART EINE EIGENE INSTANZ MIT EIGENEM `useActionState` — das ist der Kern dieser Datei
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Seite rendert diese Komponente ZWEIMAL (Kunden-Chat und Energieberater). Jede Instanz hält
 * ihren eigenen Zustand, weil beide Formulare DIESELBE Server Action rufen: Ein geteilter Zustand
 * bedeutete, dass die Erfolgsmeldung der einen Kette die der anderen überschreibt — und schlimmer,
 * dass ein Feldfehler am Energieberater-Text unter dem Kunden-Feld erschiene. Dieselbe Überlegung
 * wie bei den getrennten Wartezuständen der Rechnung-Station (Upload gegen Entfernen).
 *
 * Muster wie `open-question-answer-form.tsx`: echtes `<form action={formAction}>` (funktioniert
 * ohne JavaScript), `useActionState` für Ladezustand und Fehler.
 *
 * ── DIE ART REIST ALS VERSTECKTES FELD, NICHT ALS AUSWAHL ─────────────────────────────────────
 * Ein Auswahlmenü „für welchen Prompt?" gäbe es nur EINMAL auf der Seite und machte aus zwei
 * nebeneinander lesbaren Ständen einen, den man erst umschalten muss. Die Art ist hier keine
 * Eingabe, sondern eine Eigenschaft dieses Formulars — die Server Action prüft sie trotzdem gegen
 * die bekannte Wertemenge (ein verstecktes Feld ist nicht vertrauenswürdiger als jedes andere).
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldHint, Label, Textarea } from '@/components/ui/input'
import { saveSystemPromptExtensionAction } from '@/lib/admin/system-prompt-extensions-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { PromptExtensionKind } from '@/lib/admin/system-prompt-extensions'
import { AdminError, AdminSuccess } from './ui'

export function SystemPromptExtensionForm({
  kind,
  currentText,
  hint,
}: {
  kind: PromptExtensionKind
  /** Der offene Stand als Vorbelegung — leer, wenn für diese Art noch nichts gesetzt ist. */
  currentText: string
  /** Was unter dem Feld steht, solange kein Fehler da ist. Je Art verschieden (s. Seite). */
  hint: React.ReactNode
}) {
  const [state, formAction, isPending] = useActionState(
    saveSystemPromptExtensionAction,
    ADMIN_INITIAL_STATE,
  )
  const fieldId = `prompt-${kind}`
  const hintId = `${fieldId}-hint`
  const error = state.fieldErrors?.text

  React.useEffect(() => {
    if (error) document.getElementById(fieldId)?.focus()
  }, [error, fieldId])

  return (
    <form action={formAction} noValidate className="flex flex-col gap-3">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <input type="hidden" name="kind" value={kind} />

      <div>
        <Label htmlFor={fieldId}>Text der Erweiterung</Label>
        <div className="mt-1.5">
          {/*
            Unkontrolliert mit `defaultValue`: Nach einem abgelehnten Absenden behält der Browser
            ohnehin, was getippt wurde — `state.values` steht davor, damit auch ein Lauf ohne
            JavaScript die Eingabe zurückbekommt statt sie zu verlieren.
          */}
          <Textarea
            id={fieldId}
            name="text"
            rows={10}
            defaultValue={state.values?.text ?? currentText}
            placeholder="Frag zuerst nach … / Formuliere kurz und ohne Fachjargon …"
            aria-invalid={error ? true : undefined}
            aria-describedby={hintId}
          />
        </div>
        <FieldHint id={hintId} tone={error ? 'error' : 'muted'}>
          {error ?? hint}
        </FieldHint>
      </div>

      <div>
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird gespeichert …' : ''}
        </span>
      </div>
    </form>
  )
}
