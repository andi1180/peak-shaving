'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { setNewPasswordAction } from '@/lib/auth/actions'
import { AUTH_INITIAL_STATE } from '@/lib/auth/schema'
import { AuthField, AuthFormError, AuthSubmit, useFocusFirstError } from './form-parts'

const FIELD_ORDER = ['password', 'confirm'] as const

export function NewPasswordForm() {
  const t = useTranslations('Konto')
  const [state, formAction, isPending] = useActionState(setNewPasswordAction, AUTH_INITIAL_STATE)
  const prefix = `newpw-${React.useId()}`
  useFocusFirstError(state.fieldErrors, FIELD_ORDER, prefix)

  const fe = state.fieldErrors
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AuthFormError>{t(`errors.${state.formError}`)}</AuthFormError>}
      <AuthField
        id={`${prefix}-password`}
        name="password"
        type="password"
        autoComplete="new-password"
        label={t('newPassword.passwordLabel')}
        hint={t('shared.passwordHint')}
        error={fe?.password ? t(`errors.${fe.password}`) : undefined}
        autoFocus
      />
      <AuthField
        id={`${prefix}-confirm`}
        name="confirm"
        type="password"
        autoComplete="new-password"
        label={t('newPassword.confirmLabel')}
        error={fe?.confirm ? t(`errors.${fe.confirm}`) : undefined}
      />
      <AuthSubmit
        isPending={isPending}
        label={t('newPassword.submit')}
        pendingLabel={t('shared.submitting')}
      />
    </form>
  )
}
