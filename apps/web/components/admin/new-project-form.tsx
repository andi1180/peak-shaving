'use client'

/**
 * Das Anlage-Formular der Kalkulator-Projektliste (B24, Teil 1 Schritt 1).
 *
 * ── BEZEICHNUNG, LAND (PFLICHT, OHNE VORAUSWAHL), PLZ (OPTIONAL) ────────────────────────────────
 * Das Land bestimmt später die Preisquelle; ein vorausgewähltes würde ein vergessenes still als AT
 * rechnen lassen. Segment und Branche entstehen im Gespräch (`set_segment`/`set_industry`), der
 * Zählpunkt-Inhalt kommt mit der Dateneingabe; ausführlich begründet in `lib/admin/projects-actions.ts`.
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
import {
  COUNTRIES,
  COUNTRY_LABELS,
  isCountry,
  normalizePostalCodeFor,
  type Country,
} from 'shared/country'
import { createAdminProjectAction } from '@/lib/admin/projects-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import {
  COUNTRY_REQUIRED,
  postalCodeFormatError,
  postalCodeHint,
  postalCodeMaxLength,
} from '@/lib/admin/project-country'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from './ui'

const FIELD_ID = 'neues-projekt-label'
const COUNTRY_FIELD_ID = 'neues-projekt-land'
const POSTAL_FIELD_ID = 'neues-projekt-plz'

export function NewProjectForm() {
  const [state, formAction, isPending] = useActionState(
    createAdminProjectAction,
    ADMIN_INITIAL_STATE,
  )
  const error = state.fieldErrors?.customerLabel
  const initialCountry = state.values?.country
  // Ohne Vorauswahl: '' = noch nicht gewählt. Kontrolliert, weil React unkontrollierte Felder nach
  // jeder Action zurücksetzt und das Land sonst nach dem Anlegen wieder leer wäre.
  const [country, setCountry] = React.useState<Country | ''>(
    isCountry(initialCountry) ? initialCountry : '',
  )
  const [clientErrors, setClientErrors] = React.useState<{ country?: string; postalCode?: string }>(
    {},
  )

  // Dieselbe Regel wie die Server Action (ohne deren PLZ-Ortstabelle, die nicht ins Browser-Bündel
  // gehört); die Action bleibt die wirksame Grenze.
  function validateBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    const plz = String(new FormData(event.currentTarget).get('postalCode') ?? '').trim()
    const errors: { country?: string; postalCode?: string } = {}
    if (country === '') errors.country = COUNTRY_REQUIRED
    else if (plz !== '' && normalizePostalCodeFor(country, plz) === null) {
      errors.postalCode = postalCodeFormatError(country)
    }
    if (Object.keys(errors).length > 0) {
      event.preventDefault()
      setClientErrors(errors)
      return
    }
    setClientErrors({})
  }

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
    <form
      action={formAction}
      onSubmit={validateBeforeSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
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

      <div className="max-w-xs">
        <AdminSelect
          id={COUNTRY_FIELD_ID}
          name="country"
          label="Land"
          value={country}
          onValueChange={(value) => {
            setCountry(isCountry(value) ? value : '')
            setClientErrors({})
          }}
          error={clientErrors.country ?? state.fieldErrors?.country}
          hint="Pflicht — bestimmt später die Preisquelle der Rechnung."
        >
          <option value="">Bitte wählen …</option>
          {COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {COUNTRY_LABELS[code]}
            </option>
          ))}
        </AdminSelect>
      </div>

      <div className="max-w-xs">
        <AdminField
          id={POSTAL_FIELD_ID}
          name="postalCode"
          label="Postleitzahl (optional)"
          inputMode="numeric"
          maxLength={country === '' ? 8 : postalCodeMaxLength(country)}
          defaultValue={state.values?.postalCode}
          error={clientErrors.postalCode ?? state.fieldErrors?.postalCode}
          hint={country === '' ? 'Zuerst das Land wählen.' : postalCodeHint(country)}
        />
      </div>

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
