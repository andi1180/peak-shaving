'use client'

/**
 * „Gutscheincode einlösen" — der Freischaltweg neben dem Checkout-Button.
 * Baut auf denselben Bausteinen wie die Auth-Formulare (`AuthField`/`AuthFormError`/`AuthNotice`),
 * damit Eingabe, Fehleranzeige und Ladezustand sich anfühlen wie überall sonst im Konto-Bereich.
 *
 * ── ZWEI AUFRUFORTE, EIN FORMULAR (B10-4) ───────────────────────────────────────────────────────
 * `/konto` (ohne `redirectTo` — der Nutzer bleibt dort) UND die Anfrage-Seite des Pro-Kalkulators
 * (`components/peak-shaving/calculator-access-request.tsx`, mit `redirectTo` — der Nutzer wollte in
 * den Rechner). Deshalb liegt die Datei seit B10-4 unter `components/redemption/` statt unter
 * `components/konto/`: sie gehört dem Einlösemechanismus, nicht einer Seite. Eine Kopie hätte
 * bedeutet, dass der nächste Fix an einer der beiden Stellen fehlt.
 *
 * Progressive Enhancement: ein echtes `<form action={…}>` — die Einlösung funktioniert auch ohne
 * JavaScript. `useActionState` fügt nur den Ladezustand und die Fehleranzeige ohne Neuladen hinzu.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthField, AuthFormError, AuthNotice, AuthSubmit } from '@/components/auth/form-parts'
import { NEXT_PARAM } from '@/lib/auth/config'
import { redeemCodeAction } from '@/lib/redemption/actions'
import { REDEEM_INITIAL_STATE } from '@/lib/redemption/schema'

export function RedeemCodeForm({
  /**
   * Seiten-INTERNER Pfad, auf den eine erfolgreiche Einlösung weiterleitet. Ohne Wert bleibt der
   * Nutzer, wo er ist (Verhalten von `/konto`, unverändert).
   */
  redirectTo,
}: {
  redirectTo?: string
}) {
  const t = useTranslations('Konto.redeem')
  const [state, formAction, isPending] = useActionState(redeemCodeAction, REDEEM_INITIAL_STATE)
  const fieldId = `redeem-${React.useId()}-code`

  // Erfolgsfall OHNE Weiterleitung: die Seite rendert nach revalidatePath ohnehin den „aktives
  // Abo"-Zustand und dieses Formular verschwindet. Der Hinweis ist die Rückfalllinie, falls das
  // Neurendern ausbleibt (z. B. ohne JavaScript, wenn der Browser das Ergebnis der Action direkt
  // anzeigt). Mit `redirectTo` kommt dieser Zweig gar nicht erst zum Zug — die Action wirft dann
  // NEXT_REDIRECT, statt einen Zustand zurückzugeben.
  if (state.status === 'redeemed') {
    return <AuthNotice>{t('status.redeemed')}</AuthNotice>
  }

  const fieldError = state.fieldErrors?.code
  // Ablehnungen (Code falsch/abgelaufen/…) hängen am FELD — der Nutzer korrigiert dort. Nur echte
  // Fehlschläge (kein Login, Infrastruktur) sind formular-weit.
  const rejection = state.status ? t(`status.${state.status}`) : undefined

  return (
    <form action={formAction} noValidate className="mt-4 flex flex-col gap-4">
      {/*
       * Rücksprungziel — nur dort gesetzt, wo die Einlösung auf einer Seite geschieht, auf der der
       * Nutzer eigentlich etwas anderes vorhatte. Der Wert steht im Browser und ist dort frei
       * änderbar; die Action prüft ihn deshalb ein ZWEITES Mal (`sanitizeNext`, kein Open Redirect).
       * Dasselbe Muster wie das `next`-Feld des Anmeldeformulars (B10-2) — und derselbe Grund: die
       * Prüfung, die zählt, ist die auf dem Server.
       */}
      {redirectTo && <input type="hidden" name={NEXT_PARAM} value={redirectTo} />}
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
