'use client'

/**
 * Einzelabfrage der Sperrliste (B1-3).
 *
 * Die Liste hält NUR SHA-256-Werte der normalisierten Adressen (B1-1: eine Liste von Personen, die
 * Löschung verlangt haben, darf nicht selbst als benutzbare Verteilerliste taugen). Für Menschen ist
 * eine Hash-Liste nicht lesbar — die Abfrage EINER Adresse ist deshalb die einzige sinnvolle
 * Darstellung. Das ist eine Folge des Entwurfs, kein Mangel.
 *
 * Muster wie die übrigen Admin-Formulare: echtes `<form action={formAction}>` (funktioniert ohne
 * JavaScript), `useActionState` für Ladezustand und Rückmeldung, die Eingabe bleibt nach einer
 * Antwort stehen.
 */
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { lookupSuppressionAction } from '@/lib/admin/leads-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminField, AdminSuccess } from './ui'

export function SuppressionLookup() {
  const [state, formAction, isPending] = useActionState(
    lookupSuppressionAction,
    ADMIN_INITIAL_STATE,
  )

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <div className="max-w-md">
        <AdminField
          id="suppression-email"
          name="email"
          label="E-Mail-Adresse"
          type="email"
          defaultValue={state.values?.email}
          placeholder="name@firma.at"
          error={state.fieldErrors?.email}
          hint="Groß-/Kleinschreibung und Leerzeichen spielen keine Rolle — geprüft wird die normalisierte Adresse."
        />
      </div>

      <div>
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending ? 'wird geprüft …' : 'Nachsehen'}
        </Button>
      </div>
    </form>
  )
}
