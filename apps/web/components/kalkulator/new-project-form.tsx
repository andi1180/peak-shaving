'use client'

/**
 * „Neues Projekt starten" (B24, achter Bauschritt).
 *
 * Progressive Enhancement wie überall sonst im angemeldeten Bereich: ein echtes
 * `<form action={…}>` — das Anlegen funktioniert auch ohne JavaScript. `useActionState` fügt
 * Ladezustand und Fehleranzeige ohne Neuladen hinzu (Muster `components/redemption/redeem-code-form.tsx`).
 *
 * ── DIE BAUSTEINE SIND DIE GETEILTEN, NICHT EIGENE ──────────────────────────────────────────────
 * `AuthField`/`AuthSubmit`/`AuthFormError` (`components/auth/form-parts.tsx`) tragen bereits
 * Anmeldung, Registrierung, Passwort-Zurücksetzen und die Gutscheineinlösung. Ein eigener
 * Feld-Renderer daneben wäre eine zweite Auslegung derselben Fragen (wohin gehört der Fehler,
 * wann greift `aria-invalid`, wie sieht ein Ladezustand aus) — und die Abweichung fiele erst auf,
 * wenn ein Fix an einer der Stellen fehlt.
 *
 * ── KEIN ERFOLGSZUSTAND ─────────────────────────────────────────────────────────────────────────
 * Die Action leitet in den Chat des neuen Projekts um (sie wirft NEXT_REDIRECT). Wer ein Projekt
 * anlegt, will hineingehen; eine Erfolgsmeldung mit einem Link darunter machte aus einer Handlung
 * zwei.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'

import { AuthField, AuthFormError, AuthSubmit } from '@/components/auth/form-parts'
import { createProjectAction } from '@/lib/kalkulator/projects-actions'
import { NEW_PROJECT_INITIAL_STATE } from '@/lib/kalkulator/projects'

export function NewProjectForm() {
  const t = useTranslations('Projekte.new')
  const [state, formAction, isPending] = useActionState(
    createProjectAction,
    NEW_PROJECT_INITIAL_STATE,
  )
  const fieldId = `neues-projekt-${React.useId()}`

  return (
    <form action={formAction} noValidate className="mt-4 flex flex-col gap-4">
      {state.formError && <AuthFormError>{t(`errors.${state.formError}`)}</AuthFormError>}
      <AuthField
        id={fieldId}
        name="label"
        label={t('label')}
        autoComplete="off"
        defaultValue={state.label}
        error={state.fieldError ? t(`errors.${state.fieldError}`) : undefined}
        hint={t('placeholder')}
      />
      <AuthSubmit isPending={isPending} label={t('submit')} pendingLabel={t('submitting')} />
    </form>
  )
}
