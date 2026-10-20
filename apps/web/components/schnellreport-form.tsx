'use client'

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { TurnstileWidget, turnstileEnabled } from '@/components/kontakt/turnstile-widget'
import { cn } from '@/lib/utils'
import { track } from '@/lib/analytics/events'
import { currentAttribution } from '@/lib/attribution/attribution'
import {
  loadSchnellreportTextsAction,
  requestSchnellreportCallbackAction,
  type SchnellreportTexts,
} from '@/lib/schnellreport/actions'
import { BRANCHE_KEYS } from '@/lib/schnellreport/branchen'
import type { SchnellreportResponse } from '@/lib/schnellreport/flow'
import {
  parseSchnellreport,
  type SchnellcheckValues,
  type SchnellreportField,
  type SchnellreportFieldErrors,
  type SchnellreportSubmission,
} from '@/lib/schnellreport/request'

/*
 * Schnellreport-Formular (Leadgen-Umbau Schritt 3b-2) nach `docs/prototypes/schnellreport-prototyp.html`,
 * Abschnitt „1 · Formular". Öffnet direkt unter dem Report-Block des Schnellchecks; dessen Werte
 * reisen als Eingaben mit, gerechnet wird auf dem Server neu.
 *
 * Die Einwilligungswortlaute (Zusendung, Tipp-Mails, Telefonfrage) kommen aus der Datenbank — derselbe
 * Text wird angezeigt und archiviert. Kein Häkchen ist vorausgewählt; es gibt keine Kontakt-Checkbox.
 */

const LABEL = 'text-[13.5px] font-semibold text-ink'
const INPUT =
  'w-full rounded-[10px] border border-line-input bg-surface px-[14px] py-[12px] text-[16px] leading-tight text-ink focus:border-transparent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-accent aria-[invalid=true]:border-negative'
const BTN =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-[9px] px-5 py-[13px] text-[15px] font-semibold leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60'

type FormError = Exclude<SchnellreportResponse, { ok: true }>['error'] | 'network'

type TextField = Exclude<SchnellreportField, 'branche' | 'kwh'>

const TEXT_FIELDS: { key: TextField; type: string; autoComplete: string; optional?: boolean }[] = [
  { key: 'vorname', type: 'text', autoComplete: 'given-name' },
  { key: 'nachname', type: 'text', autoComplete: 'family-name' },
  { key: 'email', type: 'email', autoComplete: 'email' },
  { key: 'telefon', type: 'tel', autoComplete: 'tel', optional: true },
]

export function SchnellreportForm({
  check,
  partnerSlug,
}: {
  check: SchnellcheckValues
  partnerSlug?: string
}) {
  const t = useTranslations('SchnellreportForm')
  const tReport = useTranslations('Schnellreport')
  const locale = useLocale()
  const uid = React.useId()
  const id = (key: string) => `${uid}-${key}`

  const [texts, setTexts] = React.useState<SchnellreportTexts | null>(null)
  const [values, setValues] = React.useState({
    firma: '',
    branche: '',
    vorname: '',
    nachname: '',
    email: '',
    telefon: '',
  })
  const [tips, setTips] = React.useState(false)
  const [website, setWebsite] = React.useState('')
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<SchnellreportFieldErrors>({})
  const [formError, setFormError] = React.useState<FormError | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState<{
    email: string
    ticket: string
    phoneKnown: boolean
  } | null>(null)

  React.useEffect(() => {
    let active = true
    loadSchnellreportTextsAction()
      .then((loaded) => active && setTexts(loaded))
      .catch(() => active && setTexts({ delivery: null, tips: null, callback: null }))
    return () => {
      active = false
    }
  }, [])

  // Ohne archivierbaren Zusendungs-Wortlaut keine Absendung (fail-closed).
  const unavailable = texts !== null && !texts.delivery

  function set(key: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) =>
      prev[key as SchnellreportField] ? { ...prev, [key]: undefined } : prev,
    )
  }

  function focusFirst(errors: SchnellreportFieldErrors) {
    const order: SchnellreportField[] = [
      'firma',
      'branche',
      'vorname',
      'nachname',
      'email',
      'telefon',
    ]
    const first = order.find((key) => errors[key])
    if (first) document.getElementById(id(first))?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !texts?.delivery) return

    const submission: SchnellreportSubmission = {
      ...values,
      tips,
      check,
      website,
      turnstileToken: turnstileToken ?? undefined,
      partnerSlug,
      herkunft: currentAttribution(),
    }
    const parsed = parseSchnellreport(submission)
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors)
      setFormError('validation')
      focusFirst(parsed.fieldErrors)
      return
    }

    setFieldErrors({})
    setFormError(null)
    setSubmitting(true)
    try {
      const response = await fetch('/api/schnellreport', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submission),
      })
      const result = (await response.json()) as SchnellreportResponse
      if (result.ok) {
        track('schnellreport_submitted', {
          country: check.country === 'DE' ? 'DE' : 'AT',
          tips_optin: tips,
        })
        setDone({
          email: result.email,
          ticket: result.callbackTicket,
          phoneKnown: result.phoneKnown,
        })
        return
      }
      if (result.error === 'validation') {
        setFieldErrors(result.fieldErrors)
        focusFirst(result.fieldErrors)
      }
      setFormError(result.error)
    } catch {
      setFormError('network')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <SchnellreportDone
        email={done.email}
        ticket={done.ticket}
        phone={values.telefon.trim() && done.phoneKnown ? values.telefon.trim() : null}
        question={texts?.callback ?? null}
      />
    )
  }

  const error = (key: SchnellreportField) =>
    fieldErrors[key] ? (
      <span id={id(`${key}-error`)} className="text-[12.5px] font-medium text-negative">
        {t(`errors.${fieldErrors[key]}`)}
      </span>
    ) : null
  const invalid = (key: SchnellreportField) => ({
    'aria-invalid': fieldErrors[key] ? (true as const) : undefined,
    'aria-describedby': fieldErrors[key] ? id(`${key}-error`) : undefined,
  })

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="relative grid gap-[18px] rounded-[14px] border border-line bg-surface p-[22px] max-[480px]:p-4"
    >
      <div>
        <h3 className="m-0 text-[18px] font-semibold tracking-[-0.01em] text-navy">{t('title')}</h3>
        <p className="m-0 mt-1 text-[14.5px] text-text-muted">{t('sub')}</p>
      </div>

      <div className="grid grid-cols-1 gap-[14px] min-[621px]:grid-cols-2">
        <div className="grid content-start gap-[6px]">
          <label htmlFor={id('firma')} className={LABEL}>
            {t('firma')}
          </label>
          <input
            id={id('firma')}
            name="firma"
            autoComplete="organization"
            value={values.firma}
            onChange={(e) => set('firma', e.target.value)}
            className={INPUT}
            {...invalid('firma')}
          />
          {error('firma')}
        </div>
        <div className="grid content-start gap-[6px]">
          <label htmlFor={id('branche')} className={LABEL}>
            {t('branche')}
          </label>
          <select
            id={id('branche')}
            name="branche"
            value={values.branche}
            onChange={(e) => set('branche', e.target.value)}
            className={INPUT}
            {...invalid('branche')}
          >
            <option value="">{t('branchePlaceholder')}</option>
            {BRANCHE_KEYS.map((key) => (
              <option key={key} value={key}>
                {tReport(`branchen.${key}.label`)}
              </option>
            ))}
          </select>
          {error('branche')}
        </div>
        {TEXT_FIELDS.map((field) => (
          <div key={field.key} className="grid content-start gap-[6px]">
            <label htmlFor={id(field.key)} className={LABEL}>
              {t(field.key)}{' '}
              {field.optional && (
                <span className="font-medium text-text-faint">{t('optional')}</span>
              )}
            </label>
            <input
              id={id(field.key)}
              name={field.key}
              type={field.type}
              autoComplete={field.autoComplete}
              value={values[field.key]}
              onChange={(e) => set(field.key, e.target.value)}
              className={INPUT}
              {...invalid(field.key)}
            />
            {error(field.key)}
          </div>
        ))}
      </div>

      {fieldErrors.kwh && (
        <p role="alert" className="m-0 text-[13.5px] font-medium text-negative">
          {t('errors.kwhRequired')}
        </p>
      )}

      {texts?.tips && (
        <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line bg-surface-alt p-[14px] text-[14px] leading-[1.5] text-text">
          <input
            type="checkbox"
            name="tips"
            checked={tips}
            onChange={(e) => setTips(e.target.checked)}
            className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            {texts.tips} <span className="text-text-faint">{t('optional')}</span>
          </span>
        </label>
      )}

      <p className="m-0 text-[12.5px] leading-[1.5] text-text-faint">
        {texts?.delivery ? `${texts.delivery} ` : ''}
        {t('noCall')}{' '}
        <Link href="/datenschutz" className="text-navy underline">
          {t('privacy')}
        </Link>
      </p>

      {/* Honeypot wie im Kontaktformular: per Position versteckt, nicht per display:none. */}
      <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor={id('website')}>{t('honeypot')}</label>
        <input
          id={id('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {turnstileEnabled && <TurnstileWidget onToken={setTurnstileToken} language={locale} />}

      {(formError && formError !== 'validation') || unavailable ? (
        <div
          role={formError === 'duplicate' ? 'status' : 'alert'}
          className={cn(
            'rounded-[10px] border p-[14px] text-[14px] font-medium',
            formError === 'duplicate'
              ? 'border-line bg-surface-alt text-text'
              : 'border-negative bg-negative-subtle text-negative',
          )}
        >
          {t(`formError.${formError && formError !== 'validation' ? formError : 'unavailable'}`)}
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={submitting || !texts?.delivery}
          className={cn(
            BTN,
            'bg-accent text-accent-foreground hover:bg-accent-hover max-[480px]:w-full',
          )}
        >
          {submitting && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {submitting ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  )
}

/** Bestätigung und Telefonfrage („Ja, gerne anrufen" / „Nein, danke"). */
function SchnellreportDone({
  email,
  ticket,
  phone,
  question,
}: {
  email: string
  ticket: string
  phone: string | null
  question: string | null
}) {
  const t = useTranslations('SchnellreportForm')
  const uid = React.useId()
  const statusRef = React.useRef<HTMLDivElement>(null)
  const [state, setState] = React.useState<'ask' | 'phone' | 'sending' | 'thanks' | 'declined'>(
    'ask',
  )
  const [phoneInput, setPhoneInput] = React.useState('')
  const [error, setError] = React.useState<'phoneInvalid' | 'unavailable' | null>(null)

  React.useEffect(() => {
    statusRef.current?.focus()
  }, [])

  async function sendCallback(number: string) {
    setState('sending')
    setError(null)
    try {
      const result = await requestSchnellreportCallbackAction({ email, ticket, phone: number })
      if (result.ok) {
        track('callback_requested')
        setState('thanks')
        return
      }
      setError(result.error)
    } catch {
      setError('unavailable')
    }
    setState('phone')
  }

  function yes() {
    if (state === 'ask' && phone) return sendCallback(phone)
    if (state === 'ask') return setState('phone')
    return sendCallback(phoneInput)
  }

  return (
    <div
      ref={statusRef}
      role="status"
      tabIndex={-1}
      className="grid gap-3 rounded-[14px] border border-line bg-surface p-[22px] outline-none max-[480px]:p-4"
    >
      <b className="text-[16px] text-navy">{t('doneTitle')}</b>
      <span className="text-[14.5px] text-text">{t('doneText', { email })}</span>

      {question && state !== 'thanks' && state !== 'declined' && (
        <div className="grid gap-3 rounded-[10px] border border-line bg-surface-alt p-[14px]">
          <span className="text-[14.5px] font-semibold text-ink">{question}</span>
          {(state === 'phone' || (state === 'sending' && !phone)) && (
            <div className="grid gap-[6px]">
              <label htmlFor={`${uid}-tel`} className={LABEL}>
                {t('askPhone')}
              </label>
              <input
                id={`${uid}-tel`}
                type="tel"
                autoComplete="tel"
                autoFocus
                placeholder={t('askPhonePlaceholder')}
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                aria-invalid={error === 'phoneInvalid' || undefined}
                className={INPUT}
              />
            </div>
          )}
          {error && (
            <span role="alert" className="text-[13px] font-medium text-negative">
              {error === 'phoneInvalid' ? t('errors.phoneInvalid') : t('formError.unavailable')}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={yes}
              disabled={state === 'sending'}
              className={cn(BTN, 'bg-navy px-4 py-[11px] text-[14px] text-navy-foreground')}
            >
              {t('askYes')}
            </button>
            <button
              type="button"
              onClick={() => setState('declined')}
              disabled={state === 'sending'}
              className={cn(
                BTN,
                'border border-line bg-surface px-4 py-[11px] text-[14px] text-navy',
              )}
            >
              {t('askNo')}
            </button>
          </div>
        </div>
      )}

      {state === 'thanks' && <span className="text-[14.5px] text-text">{t('askThanks')}</span>}
    </div>
  )
}
