'use client'

/**
 * Ein Knopf, der genau eine Server Action mit festen Werten auslöst (T4-4).
 *
 * Vier Verwendungen teilen sich diese eine Komponente: Ziel an/aus, Code an/aus, Rolle vergeben,
 * Rolle entziehen. Alle vier sind strukturell gleich — verborgene Felder + ein Knopf + eine mögliche
 * Ablehnung, die ANGEZEIGT werden muss (bei „Rolle entziehen" ist das der Lockout-Schutz, die
 * fachlich wichtigste Meldung des ganzen Bereichs).
 *
 * WARUM EINE EIGENE KOMPONENTE UND KEIN `<form action={serverAction}>` DIREKT IN DER ZEILE:
 * Ein blankes Formular kann keinen Rückgabewert anzeigen — die Ablehnung „das ist die letzte
 * Administrator-Rolle" fiele lautlos unter den Tisch, und der Klick sähe aus wie ein Erfolg.
 * `useActionState` braucht einen Hook, Hooks dürfen nicht in einer Schleife stehen — deshalb je
 * Zeile eine eigene Komponenten-Instanz mit eigenem Zustand.
 *
 * Progressive Enhancement bleibt gewahrt: es ist ein echtes `<form>`, das auch ohne JavaScript
 * abschickt; `useActionState` ergänzt nur Ladezustand und Fehleranzeige ohne Neuladen.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'

export type AdminAction = (prev: AdminState, formData: FormData) => Promise<AdminState>

export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'secondary',
  confirm,
  showSuccess = false,
}: {
  action: AdminAction
  /** Verborgene Formularwerte (z. B. `{ id, isActive: 'false' }`). */
  fields: Record<string, string>
  label: string
  pendingLabel: string
  variant?: 'primary' | 'secondary' | 'ghost'
  /**
   * Rückfrage vor dem Absenden. Bewusst nur dort gesetzt, wo ein Fehlklick jemandem den Zugang
   * nimmt (Rollen-Entzug) — nicht bei An/Aus-Schaltern, die man einfach zurückschaltet.
   */
  confirm?: string
  /**
   * Zeigt zusätzlich die Erfolgsmeldung der Action (B16-2, additiv — die vier bestehenden
   * Verwendungen bleiben unverändert).
   *
   * Gebraucht dort, wo der Erfolg eine FOLGE hat, die man am Zeilenzustand nicht sieht: Beim
   * Stilllegen eines Fachbetriebs wechselt zwar sichtbar die Markierung, aber nicht, dass seine
   * Landingpage ab sofort 404 antwortet und ein bereits verschickter Link damit ins Leere führt.
   */
  showSuccess?: boolean
}) {
  const [state, formAction, isPending] = useActionState(action, ADMIN_INITIAL_STATE)

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Nur eine Rückfrage — die Autorisierung liegt in der Datenbank, nicht hier.
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size="sm" disabled={isPending}>
        {isPending ? pendingLabel : label}
      </Button>
      {state.formError && (
        <p role="alert" className="mt-1.5 max-w-xs text-caption text-negative">
          {state.formError}
        </p>
      )}
      {showSuccess && state.success && (
        <p role="status" className="mt-1.5 max-w-xs text-caption text-text-muted">
          {state.success}
        </p>
      )}
    </form>
  )
}
