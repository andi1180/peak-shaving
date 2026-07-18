'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { requestPasswordResetAction } from '@/lib/auth/actions'
import { ANMELDEN_HREF } from '@/lib/auth/config'
import { AUTH_INITIAL_STATE } from '@/lib/auth/schema'
import { AuthField, AuthFormError, AuthNotice, AuthSubmit, useFocusFirstError } from './form-parts'

const FIELD_ORDER = ['email'] as const

export function ForgotPasswordForm() {
  const t = useTranslations('Konto')
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    AUTH_INITIAL_STATE,
  )
  const prefix = `forgot-${React.useId()}`
  useFocusFirstError(state.fieldErrors, FIELD_ORDER, prefix)

  if (state.emailSent) {
    // Bewusst dieselbe Meldung, egal ob die Adresse registriert ist (J5 + Enumeration-Schutz).
    return (
      <AuthNotice>
        <p className="text-body font-semibold text-ink">{t('forgotPassword.sentTitle')}</p>
        <p className="mt-2">{t('forgotPassword.sentBody')}</p>
      </AuthNotice>
    )
  }

  const fe = state.fieldErrors
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
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
      <AuthSubmit
        isPending={isPending}
        label={t('forgotPassword.submit')}
        pendingLabel={t('shared.submitting')}
      />
      <p className="text-small text-text-muted">
        <Link href={ANMELDEN_HREF} className="font-medium text-accent hover:text-accent-hover">
          {t('forgotPassword.backToLogin')}
        </Link>
      </p>
    </form>
  )
}
