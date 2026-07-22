'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { resendConfirmationAction, signInAction } from '@/lib/auth/actions'
import { NEXT_PARAM, PASSWORT_VERGESSEN_HREF, REGISTRIEREN_HREF } from '@/lib/auth/config'
import { AUTH_INITIAL_STATE } from '@/lib/auth/schema'
import { AuthField, AuthFormError, AuthNotice, AuthSubmit, useFocusFirstError } from './form-parts'

const FIELD_ORDER = ['email', 'password'] as const

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations('Konto')
  const [state, formAction, isPending] = useActionState(signInAction, AUTH_INITIAL_STATE)
  const prefix = `login-${React.useId()}`
  useFocusFirstError(state.fieldErrors, FIELD_ORDER, prefix)

  const fe = state.fieldErrors
  return (
    <div className="flex flex-col gap-5">
      <form action={formAction} noValidate className="flex flex-col gap-4">
        {/*
          * Rücksprungziel (B10-2): Wer über eine geschützte Route hierher geleitet wurde, soll
          * nach dem Anmelden DORT landen und nicht auf `/konto`. Als verstecktes Feld statt über
          * die URL, weil die Server Action per POST läuft und den Query-String der Seite nicht
          * sieht. Die Seite hat den Wert bereits durch `sanitizeNext` geschickt; die Action prüft
          * ihn NOCH EINMAL — dieses Feld ist im Browser frei änderbar, und die Prüfung, die zählt,
          * ist die auf dem Server.
          */}
        {next && <input type="hidden" name={NEXT_PARAM} value={next} />}
        {state.formError && <AuthFormError>{t(`errors.${state.formError}`)}</AuthFormError>}
        <AuthField
          id={`${prefix}-email`}
          name="email"
          type="email"
          autoComplete="email"
          label={t('shared.emailLabel')}
          defaultValue={state.email}
          error={fe?.email ? t(`errors.${fe.email}`) : undefined}
          autoFocus
        />
        <AuthField
          id={`${prefix}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          label={t('shared.passwordLabel')}
          error={fe?.password ? t(`errors.${fe.password}`) : undefined}
        />
        <div className="text-small">
          <Link
            href={PASSWORT_VERGESSEN_HREF}
            className="font-medium text-accent hover:text-accent-hover"
          >
            {t('login.forgotLink')}
          </Link>
        </div>
        <AuthSubmit
          isPending={isPending}
          label={t('login.submit')}
          pendingLabel={t('shared.submitting')}
        />
      </form>

      {state.showResend && state.email && (
        <ResendConfirmation key={state.email} email={state.email} />
      )}

      <p className="text-small text-text-muted">
        {t('login.noAccount')}{' '}
        <Link href={REGISTRIEREN_HREF} className="font-medium text-accent hover:text-accent-hover">
          {t('login.registerLink')}
        </Link>
      </p>
    </div>
  )
}

/** Eigenes kleines Formular für „Bestätigungsmail erneut senden" (eigener Action-Zustand). */
function ResendConfirmation({ email }: { email: string }) {
  const t = useTranslations('Konto')
  const [state, formAction, isPending] = useActionState(
    resendConfirmationAction,
    AUTH_INITIAL_STATE,
  )

  if (state.resent) {
    return <AuthNotice>{t('login.resendDone')}</AuthNotice>
  }

  return (
    <form action={formAction} className="rounded-md border border-line bg-surface-sunken p-4">
      <p className="text-small text-text-muted">{t('login.resendPrompt')}</p>
      <input type="hidden" name="email" value={email} />
      <Button type="submit" variant="secondary" size="sm" className="mt-3" disabled={isPending}>
        {isPending ? t('shared.submitting') : t('login.resendButton')}
      </Button>
    </form>
  )
}
