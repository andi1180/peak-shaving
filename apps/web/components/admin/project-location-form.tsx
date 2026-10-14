'use client'

/**
 * Stammdaten: Land und Postleitzahl eines Projekts ändern — die einzige Pflegestelle. Die PV-Station
 * zeigt den Standort nur an und verweist hierher. Beide Werte werden gemeinsam gespeichert (der
 * DB-Check koppelt das PLZ-Format ans Land).
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import {
  COUNTRIES,
  COUNTRY_LABELS,
  isCountry,
  normalizePostalCodeFor,
  type Country,
} from 'shared/country'

import { Button } from '@/components/ui/button'
import {
  postalCodeFormatError,
  postalCodeHint,
  postalCodeMaxLength,
} from '@/lib/admin/project-country'
import { updateProjectLocationAction } from '@/lib/admin/projects-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from './ui'

export function ProjectLocationForm({
  projectId,
  country,
  postalCode,
}: {
  projectId: string
  country: Country
  postalCode: string | null
}) {
  const [state, formAction, isPending] = useActionState(
    updateProjectLocationAction,
    ADMIN_INITIAL_STATE,
  )
  const [selected, setSelected] = React.useState<Country>(country)
  const [clientError, setClientError] = React.useState<string | undefined>()
  React.useEffect(() => setSelected(country), [country])

  // Dieselbe Regel wie die Server Action; die Action bleibt die wirksame Grenze.
  function validateBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    const plz = String(new FormData(event.currentTarget).get('postalCode') ?? '').trim()
    if (plz !== '' && normalizePostalCodeFor(selected, plz) === null) {
      event.preventDefault()
      setClientError(postalCodeFormatError(selected))
      return
    }
    setClientError(undefined)
  }

  return (
    <form
      action={formAction}
      onSubmit={validateBeforeSubmit}
      noValidate
      className="mt-6 flex flex-col gap-3 border-t border-line pt-6"
    >
      <h3 className="text-small font-semibold text-ink">Standort ändern</h3>
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      <input type="hidden" name="projectId" value={projectId} />

      <div className="max-w-xs">
        <AdminSelect
          id="projekt-stammdaten-land"
          name="country"
          label="Land"
          value={selected}
          onValueChange={(value) => {
            if (isCountry(value)) {
              setSelected(value)
              setClientError(undefined)
            }
          }}
          error={state.fieldErrors?.country}
        >
          {COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {COUNTRY_LABELS[code]}
            </option>
          ))}
        </AdminSelect>
      </div>

      <div className="max-w-xs">
        <AdminField
          id="projekt-stammdaten-plz"
          name="postalCode"
          label="Postleitzahl"
          inputMode="numeric"
          maxLength={postalCodeMaxLength(selected)}
          defaultValue={postalCode ?? ''}
          error={clientError ?? state.fieldErrors?.postalCode}
          hint={`${postalCodeHint(selected)} Leer lassen = unverändert.`}
        />
      </div>

      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Standort speichern
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird gespeichert …' : ''}
        </span>
      </div>
    </form>
  )
}
