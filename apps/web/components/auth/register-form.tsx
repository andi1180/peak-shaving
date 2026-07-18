'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { signUpAction } from '@/lib/auth/actions'
import { ANMELDEN_HREF } from '@/lib/auth/config'
import { AUTH_INITIAL_STATE } from '@/lib/auth/schema'
import { AuthField, AuthFormError, AuthNotice, AuthSubmit, useFocusFirstError } from './form-parts'

const FIELD_ORDER = ['email', 'password'] as const

export function RegisterForm() {
  const t = useTranslations('Konto')
  const [state, formAction, isPending] = useActionState(signUpAction, AUTH_INITIAL_STATE)
  const prefix = `register-${React.useId()}`
  useFocusFirstError(state.fieldErrors, FIELD_ORDER, prefix)

  if (state.emailSent) {
    return (
      <AuthNotice>
        <p className="text-body font-semibold text-ink">{t('register.emailSentTitle')}</p>
        <p className="mt-2">{t('register.emailSentBody', { email: state.email ?? '' })}</p>
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
      <AuthField
        id={`${prefix}-password`}
        name="password"
        type="password"
        autoComplete="new-password"
        label={t('shared.passwordLabel')}
        hint={t('shared.passwordHint')}
        error={fe?.password ? t(`errors.${fe.password}`) : undefined}
      />
      <AuthSubmit
        isPending={isPending}
        label={t('register.submit')}
        pendingLabel={t('shared.submitting')}
      />
      <p className="text-small text-text-muted">
        {t('register.haveAccount')}{' '}
        <Link href={ANMELDEN_HREF} className="font-medium text-accent hover:text-accent-hover">
          {t('register.loginLink')}
        </Link>
      </p>
    </form>
  )
}
