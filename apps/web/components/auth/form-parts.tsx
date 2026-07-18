'use client'

/**
 * Geteilte Bausteine der Auth-Formulare (T4-2). Ein Satz statt vier Kopien — die Formulare
 * (Registrierung/Login/Passwort) sind strukturell gleich (ein Feld-Slot, ein Submit, ein
 * Formular-Fehler), nur die Felder unterscheiden sich. Bauen auf den vorhandenen UI-Primitiven
 * (`Input`/`Label`/`FieldHint`, `Button`) und den bestehenden Fehler-/Fokus-Mustern
 * (kontakt-form.tsx / gratis-check-form.tsx) auf.
 */
import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldHint, Input, Label } from '@/components/ui/input'

/**
 * Ein Feld mit Label + genau EINEM Hinweis-Slot: der Fehler ERSETZT den Hilfetext (nie zwei
 * Meldungen übereinander), aria-invalid/aria-describedby korrekt verdrahtet.
 */
export function AuthField({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
  defaultValue,
  autoFocus,
  error,
  hint,
}: {
  id: string
  name: string
  label: string
  type?: string
  autoComplete?: string
  defaultValue?: string
  autoFocus?: boolean
  /** Bereits aufgelöster Fehlertext (kein Key). */
  error?: string
  /** Hilfetext, wenn kein Fehler. */
  hint?: React.ReactNode
}) {
  const hintId = `${id}-hint`
  const showHint = Boolean(error) || Boolean(hint)
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">
        <Input
          id={id}
          name={name}
          type={type}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={showHint ? hintId : undefined}
        />
      </div>
      {showHint && (
        <FieldHint id={hintId} tone={error ? 'error' : 'muted'}>
          {error ?? hint}
        </FieldHint>
      )}
    </div>
  )
}

/** Submit-Button mit Ladezustand (Spinner + disabled + SR-Ansage), volle Breite. */
export function AuthSubmit({
  isPending,
  label,
  pendingLabel,
}: {
  isPending: boolean
  label: string
  pendingLabel: string
}) {
  return (
    <>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isPending}>
        {isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
        {isPending ? pendingLabel : label}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {isPending ? pendingLabel : ''}
      </span>
    </>
  )
}

/** Formular-weiter Fehler (role=alert, rot). Muster wie kontakt-form.tsx. */
export function AuthFormError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-negative bg-negative-subtle p-4">
      <p className="text-small font-semibold text-negative">{children}</p>
    </div>
  )
}

/** Erfolgs-/Bestätigungs-Hinweis (role=status, ruhig). */
export function AuthNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-md border border-line bg-surface-sunken p-4 text-small text-text-muted"
    >
      {children}
    </div>
  )
}

/**
 * Fokussiert nach einem Submit das erste fehlerhafte Feld (Muster wie kontakt-form.tsx). Die
 * Effekt-Abhängigkeit `fieldErrors` wechselt nur, wenn die Action ein neues Ergebnis liefert.
 */
export function useFocusFirstError(
  fieldErrors: Partial<Record<string, string>> | undefined,
  order: readonly string[],
  idPrefix: string,
) {
  React.useEffect(() => {
    if (!fieldErrors) return
    const first = order.find((name) => fieldErrors[name])
    if (first) document.getElementById(`${idPrefix}-${first}`)?.focus()
  }, [fieldErrors, order, idPrefix])
}
