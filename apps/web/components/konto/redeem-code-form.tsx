'use client'

/**
 * „Gutscheincode einlösen" auf der Kontoseite — der zweite Freischaltweg neben dem Checkout-Button.
 * Baut auf denselben Bausteinen wie die Auth-Formulare (`AuthField`/`AuthFormError`/`AuthNotice`),
 * damit Eingabe, Fehleranzeige und Ladezustand sich anfühlen wie überall sonst im Konto-Bereich.
 *
 * Progressive Enhancement: ein echtes `<form action={…}>` — die Einlösung funktioniert auch ohne
 * JavaScript. `useActionState` fügt nur den Ladezustand und die Fehleranzeige ohne Neuladen hinzu.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthField, AuthFormError, AuthNotice, AuthSubmit } from '@/components/auth/form-parts'
import { redeemCodeAction } from '@/lib/redemption/actions'
import { REDEEM_INITIAL_STATE } from '@/lib/redemption/schema'

export function RedeemCodeForm() {
  const t = useTranslations('Konto.redeem')
  const [state, formAction, isPending] = useActionState(redeemCodeAction, REDEEM_INITIAL_STATE)
  const fieldId = `redeem-${React.useId()}-code`

  // Erfolgsfall: die Seite rendert nach revalidatePath ohnehin den „aktives Abo"-Zustand und dieses
  // Formular verschwindet. Der Hinweis ist die Rückfalllinie, falls das Neurendern ausbleibt
  // (z. B. ohne JavaScript, wenn der Browser das Ergebnis der Action direkt anzeigt).
  if (state.status === 'redeemed') {
    return <AuthNotice>{t('status.redeemed')}</AuthNotice>
  }

  const fieldError = state.fieldErrors?.code
  // Ablehnungen (Code falsch/abgelaufen/…) hängen am FELD — der Nutzer korrigiert dort. Nur echte
  // Fehlschläge (kein Login, Infrastruktur) sind formular-weit.
  const rejection = state.status ? t(`status.${state.status}`) : undefined

  return (
    <form action={formAction} noValidate className="mt-4 flex flex-col gap-4">
      {state.formError && <AuthFormError>{t(`errors.${state.formError}`)}</AuthFormError>}
      <AuthField
        id={fieldId}
        name="code"
        label={t('label')}
        autoComplete="off"
        defaultValue={state.code}
        error={fieldError ? t(`errors.${fieldError}`) : rejection}
        hint={t('hint')}
      />
      <AuthSubmit isPending={isPending} label={t('submit')} pendingLabel={t('submitting')} />
    </form>
  )
}
