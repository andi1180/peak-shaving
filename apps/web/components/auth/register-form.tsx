'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { signUpAction } from '@/lib/auth/actions'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { AUTH_INITIAL_STATE } from '@/lib/auth/schema'
import {
  AuthField,
  AuthFormError,
  AuthNotice,
  AuthSubmit,
  PartnerHint,
  useFocusFirstError,
} from './form-parts'

/*
 * Die Reihenfolge, in der nach einem Fehlversuch fokussiert wird — und zugleich die Reihenfolge im
 * Formular: erst wer (Betrieb, Ansprechperson), dann womit man sich anmeldet.
 */
const FIELD_ORDER = ['company', 'firstName', 'lastName', 'email', 'password'] as const

export function RegisterForm({ next }: { next?: string }) {
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
      {/*
       * Rücksprungziel (B10-5), unverändertes Muster aus dem Anmeldeformular: als verstecktes Feld
       * statt über die URL, weil die Server Action per POST läuft und den Query-String der Seite
       * nicht sieht. Die Seite hat den Wert bereits durch `sanitizeNext` geschickt; die Action
       * prüft ihn NOCH EINMAL — dieses Feld ist im Browser frei änderbar.
       */}
      {next && <input type="hidden" name={NEXT_PARAM} value={next} />}
      {state.formError && <AuthFormError>{t(`errors.${state.formError}`)}</AuthFormError>}
      {/*
       * Betrieb und Ansprechperson stehen VOR den Zugangsdaten: Sie sind die Angaben, die den
       * Kontext dieses Kontos ausmachen, und sie sind für beide Produkte gleichermassen Pflicht.
       * `organization`/`given-name`/`family-name` als `autocomplete` — der Browser füllt zwei
       * Namensfelder nur dann richtig vor, wenn er weiss, welcher Teil wohin gehört.
       */}
      <AuthField
        id={`${prefix}-company`}
        name="company"
        autoComplete="organization"
        label={t('shared.companyLabel')}
        defaultValue={state.company}
        error={fe?.company ? t(`errors.${fe.company}`) : undefined}
        autoFocus
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <AuthField
          id={`${prefix}-firstName`}
          name="firstName"
          autoComplete="given-name"
          label={t('shared.firstNameLabel')}
          defaultValue={state.firstName}
          error={fe?.firstName ? t(`errors.${fe.firstName}`) : undefined}
        />
        <AuthField
          id={`${prefix}-lastName`}
          name="lastName"
          autoComplete="family-name"
          label={t('shared.lastNameLabel')}
          defaultValue={state.lastName}
          error={fe?.lastName ? t(`errors.${fe.lastName}`) : undefined}
        />
      </div>
      <AuthField
        id={`${prefix}-email`}
        name="email"
        type="email"
        autoComplete="email"
        label={t('shared.emailLabel')}
        defaultValue={state.email}
        error={fe?.email ? t(`errors.${fe.email}`) : undefined}
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
        {/*
         * Das Ziel reist auch auf dem Rückweg mit: Wer für den Kalkulator hierhergeleitet wurde
         * und dann merkt, dass er längst ein Konto hat, soll nach dem Anmelden dort landen und
         * nicht auf `/konto`. Ohne den Parameter wäre der Umweg über diese Seite ein Sackgassen-
         * schritt — genau die Lücke, die dieser Bauabschnitt in der Gegenrichtung schliesst.
         */}
        <Link
          href={next ? { pathname: ANMELDEN_HREF, query: { [NEXT_PARAM]: next } } : ANMELDEN_HREF}
          className="font-medium text-accent hover:text-accent-hover"
        >
          {t('register.loginLink')}
        </Link>
      </p>

      <PartnerHint />
    </form>
  )
}
