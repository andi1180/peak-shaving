'use client'

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { TurnstileWidget, turnstileEnabled } from '@/components/kontakt/turnstile-widget'
import { cn } from '@/lib/utils'
import { PARTNER_QUERY_PARAM } from '@/lib/leads/partner'
import { submitProfiReportAction } from '@/lib/profi-report/actions'
import type { ProfiReportResponse } from '@/lib/profi-report/flow'
import {
  LOAD_PROFILE_ANSWERS,
  parseProfiReport,
  type ProfiReportField,
  type ProfiReportFieldErrors,
  type ProfiReportSubmission,
} from '@/lib/profi-report/request'

/*
 * Anfrageformular der Profi-Report-Seite (Leadgen 4b) nach `docs/prototypes/profi-report-prototyp.html`.
 * Abweichung: Vor- und Nachname getrennt statt „Ihr Name" — die Bestätigungsmail grüsst mit Namen,
 * und am Lead stehen beide Felder getrennt (keine nachträgliche Zerlegung eines Freitextnamens).
 * `?partner=` wird wie im Kontaktformular aus der Adresse gelesen, ohne Speicherung im Browser.
 */

const LABEL = 'text-[13.5px] font-semibold text-ink'
const INPUT =
  'w-full rounded-[10px] border border-line-input bg-surface px-3 py-[11px] text-[15px] font-medium text-ink focus:border-transparent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-accent aria-[invalid=true]:border-negative'
const BTN =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-accent px-5 py-[14px] text-[15px] font-semibold leading-none text-accent-foreground hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60'

type FormError = Exclude<ProfiReportResponse, { ok: true }>['error'] | 'network'

const TEXT_FIELDS: {
  key: Exclude<ProfiReportField, 'lastgang' | 'nachricht'>
  type: string
  autoComplete: string
  optional?: boolean
  full?: boolean
}[] = [
  { key: 'firma', type: 'text', autoComplete: 'organization', full: true },
  { key: 'vorname', type: 'text', autoComplete: 'given-name' },
  { key: 'nachname', type: 'text', autoComplete: 'family-name' },
  { key: 'email', type: 'email', autoComplete: 'email' },
  { key: 'telefon', type: 'tel', autoComplete: 'tel', optional: true },
]

const FIELD_ORDER: ProfiReportField[] = [
  'firma',
  'vorname',
  'nachname',
  'email',
  'telefon',
  'lastgang',
  'nachricht',
]

export function ProfiReportForm({ fallbackEmail }: { fallbackEmail: string }) {
  const t = useTranslations('ProfiReport.form')
  const locale = useLocale()
  const uid = React.useId()
  const id = (key: string) => `${uid}-${key}`

  const [values, setValues] = React.useState({
    firma: '',
    vorname: '',
    nachname: '',
    email: '',
    telefon: '',
    lastgang: '',
    nachricht: '',
  })
  const [website, setWebsite] = React.useState('')
  const [partnerSlug, setPartnerSlug] = React.useState<string | undefined>(undefined)
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<ProfiReportFieldErrors>({})
  const [formError, setFormError] = React.useState<FormError | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const doneRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get(PARTNER_QUERY_PARAM)
    if (slug) setPartnerSlug(slug)
  }, [])

  React.useEffect(() => {
    if (done) doneRef.current?.focus()
  }, [done])

  function set(key: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  function focusFirst(errors: ProfiReportFieldErrors) {
    const first = FIELD_ORDER.find((key) => errors[key])
    if (first) document.getElementById(id(first === 'lastgang' ? 'lastgang-ja' : first))?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const submission: ProfiReportSubmission = {
      ...values,
      website,
      turnstileToken: turnstileToken ?? undefined,
      partnerSlug,
    }
    const parsed = parseProfiReport(submission)
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
      const result = await submitProfiReportAction(submission)
      if (result.ok) {
        setDone(true)
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

  const error = (key: ProfiReportField) =>
    fieldErrors[key] ? (
      <span id={id(`${key}-error`)} className="text-[12.5px] font-medium text-negative">
        {t(`errors.${fieldErrors[key]}`)}
      </span>
    ) : null
  const invalid = (key: ProfiReportField) => ({
    'aria-invalid': fieldErrors[key] ? (true as const) : undefined,
    'aria-describedby': fieldErrors[key] ? id(`${key}-error`) : undefined,
  })

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="relative grid gap-4 rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,.04),0_18px_40px_-24px_rgba(15,23,42,.22)] max-[520px]:p-[18px]"
    >
      {done ? (
        <div
          ref={doneRef}
          tabIndex={-1}
          role="status"
          className="grid gap-1.5 rounded-xl border border-accent-border bg-accent-subtle px-4 py-[14px] text-[15px] outline-none"
        >
          <b className="text-accent">{t('doneTitle')}</b>
          <span>{t('doneText')}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-[14px] max-[520px]:grid-cols-1">
            {TEXT_FIELDS.map((field) => (
              <div
                key={field.key}
                className={cn('grid min-w-0 content-start gap-1.5', field.full && 'col-span-full')}
              >
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
                  required={!field.optional}
                  value={values[field.key]}
                  onChange={(e) => set(field.key, e.target.value)}
                  className={INPUT}
                  {...invalid(field.key)}
                />
                {error(field.key)}
              </div>
            ))}

            <fieldset
              className="col-span-full m-0 grid min-w-0 gap-1.5 border-0 p-0"
              aria-describedby={fieldErrors.lastgang ? id('lastgang-error') : undefined}
            >
              <legend className={cn(LABEL, 'mb-1.5 p-0')}>{t('lastgang')}</legend>
              <div className="flex flex-wrap gap-2">
                {LOAD_PROFILE_ANSWERS.map((answer) => (
                  <label
                    key={answer}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-[7px] text-[14px] font-medium"
                  >
                    <input
                      id={id(`lastgang-${answer}`)}
                      type="radio"
                      name="lastgang"
                      value={answer}
                      checked={values.lastgang === answer}
                      onChange={() => set('lastgang', answer)}
                      className="m-0 accent-[var(--color-accent)]"
                    />
                    {t(`lastgangOptions.${answer}`)}
                  </label>
                ))}
              </div>
              {error('lastgang')}
            </fieldset>

            <div className="col-span-full grid min-w-0 gap-1.5">
              <label htmlFor={id('nachricht')} className={LABEL}>
                {t('nachricht')}{' '}
                <span className="font-medium text-text-faint">{t('optional')}</span>
              </label>
              <textarea
                id={id('nachricht')}
                name="nachricht"
                value={values.nachricht}
                onChange={(e) => set('nachricht', e.target.value)}
                className={cn(INPUT, 'min-h-[88px] resize-y')}
                {...invalid('nachricht')}
              />
              {error('nachricht')}
            </div>
          </div>

          <p className="m-0 text-[13px] text-text-faint">
            {t('privacy')}{' '}
            <Link href="/datenschutz" className="text-text-muted underline">
              {t('privacyLink')}
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

          {formError && (
            <div
              role={formError === 'duplicate' ? 'status' : 'alert'}
              className={cn(
                'rounded-[10px] border p-[14px] text-[14px] font-medium',
                formError === 'duplicate'
                  ? 'border-line bg-surface-alt text-text'
                  : 'border-negative bg-negative-subtle text-negative',
              )}
            >
              {t(`formError.${formError}`, { email: fallbackEmail })}
            </div>
          )}

          <div>
            <button type="submit" disabled={submitting} className={cn(BTN, 'max-[520px]:w-full')}>
              {submitting && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {submitting ? t('sending') : t('submit')}
            </button>
          </div>
        </>
      )}
    </form>
  )
}
