'use client'

import * as React from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox, FieldHint, Input, Label, PasswordInput, Textarea } from '@/components/ui/input'
import { TurnstileWidget, turnstileEnabled } from '@/components/kontakt/turnstile-widget'
import { COMPANY } from '@/lib/nav'
import { submitPartnerApplicationAction } from '@/lib/partner-application/actions'
import { PARTNER_APPLICATION_MAX } from '@/lib/partner-application/config'
import type { PartnerApplicationResponse } from '@/lib/partner-application/flow'
import {
  PARTNER_APPLICATION_FIELD_ORDER,
  partnerApplicationSchema,
  toFieldErrors,
  type PartnerApplicationFieldErrors,
  type PartnerApplicationFieldName,
} from '@/lib/partner-application/schema'

/**
 * DAS BEWERBUNGSFORMULAR EINES FACHBETRIEBS (B16-3).
 *
 * Muster, Anrede und Fehlerdarstellung wie das Kontaktformular
 * (`components/kontakt/kontakt-form.tsx`): `noValidate` bei erhaltenen `required`-Attributen (die
 * native Browser-Blase spräche in Browser-Sprache und zeigte nur EINEN Fehler), Fokus ins erste
 * fehlerhafte Feld, `role="alert"` für Fehler und `role="status"` für den Erfolg, Honeypot per
 * Position ausgeblendet statt per `display:none`.
 *
 * ── DER HONEYPOT HEISST WEITERHIN `website` — UND DAS ECHTE FELD DESHALB `websiteUrl` ────────────
 * In diesem System ist `website` an drei Stellen der Name der Falle (Kontaktformular,
 * Lead-Erfassung, hier). Diese Seite hat als einzige ein ECHTES Website-Feld; sie bekommt deshalb
 * einen anderen Namen. Andersherum — die Falle umzubenennen — hätte den Bot-Schutz an genau dieser
 * einen Seite von dem der übrigen abgekoppelt.
 *
 * ── ZWEI GESTALTEN, EIN FORMULAR ────────────────────────────────────────────────────────────────
 * Angemeldet fehlen E-Mail- und Passwortfeld: Es entsteht kein zweites Konto, und die Bewerbung
 * wird mit dem laufenden verknüpft. Die Adresse wird nicht erneut erfragt, sondern GENANNT — sonst
 * müsste jemand raten, an welches seiner Konten der Antrag geht.
 *
 * ── KEINE ZUSAGE ÜBER DIE BEARBEITUNGSDAUER ─────────────────────────────────────────────────────
 * Weder im Formular noch in der Erfolgsmeldung. Eine Frist, die niemand zugesagt hat, wird trotzdem
 * gemessen.
 */

type Status = 'idle' | 'submitting' | 'success' | 'error'

/** `network` gibt es nur hier: Der Server kann nicht melden, dass er unerreichbar war. */
type FormErrorCode = 'validation' | 'turnstile' | 'unavailable' | 'network'

type Values = {
  company: string
  firstName: string
  lastName: string
  email: string
  password: string
  phone: string
  websiteUrl: string
  message: string
  datenschutz: boolean
  /** Honeypot — s. Kopf. Gehört in den State, damit React das Feld kontrolliert. */
  website: string
}

const EMPTY_VALUES: Values = {
  company: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  phone: '',
  websiteUrl: '',
  message: '',
  /* NICHT vorausgewählt, und es gibt keinen Pfad, der das vorbelegt (DSGVO). */
  datenschutz: false,
  website: '',
}

export function PartnerApplicationForm({
  /**
   * Die Adresse der laufenden Sitzung — `null`, wenn niemand angemeldet ist. Serverseitig ermittelt
   * und hereingereicht; die Action liest die Sitzung NOCH EINMAL selbst. Dieser Wert ist eine
   * Anzeige, keine Zusicherung: Was der Browser schickt, entscheidet nichts.
   */
  sessionEmail = null,
}: {
  sessionEmail?: string | null
}) {
  const t = useTranslations('PartnerBewerbung')
  const tKonto = useTranslations('Konto')
  const locale = useLocale()

  const [values, setValues] = React.useState<Values>(EMPTY_VALUES)
  const [status, setStatus] = React.useState<Status>('idle')
  const [errorCode, setErrorCode] = React.useState<FormErrorCode | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<PartnerApplicationFieldErrors>({})
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null)

  /* `useId`, damit ein zweites Formular auf derselben Seite die aria-Verknüpfungen nicht kapert. */
  const uid = React.useId()
  const fieldId = (name: string) => `${uid}-${name}`
  const errorId = (name: string) => `${uid}-${name}-error`

  const alertRef = React.useRef<HTMLDivElement>(null)
  const successRef = React.useRef<HTMLDivElement>(null)

  const angemeldet = Boolean(sessionEmail)

  React.useEffect(() => {
    if (status === 'success') successRef.current?.focus()
  }, [status])

  React.useEffect(() => {
    // Bei Feldfehlern führt der Fokus ins FELD (s. `handleSubmit`), nicht in die Meldung.
    if (status === 'error' && errorCode && errorCode !== 'validation') alertRef.current?.focus()
  }, [status, errorCode])

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
    // Die Meldung verschwindet beim Tippen, nicht erst beim nächsten Absenden.
    setFieldErrors((prev) =>
      prev[key as PartnerApplicationFieldName] ? { ...prev, [key]: undefined } : prev,
    )
  }

  function focusFirstInvalid(errors: PartnerApplicationFieldErrors) {
    const first = PARTNER_APPLICATION_FIELD_ORDER.find((name) => errors[name])
    if (first) document.getElementById(fieldId(first))?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'submitting') return

    const submission = {
      company: values.company,
      firstName: values.firstName,
      lastName: values.lastName,
      /*
       * Angemeldet: Adresse und Passwort fahren gar nicht erst mit. Der Server setzt die Adresse
       * aus der Sitzung ein — was der Browser schickt, ist dort ohne Belang.
       */
      email: angemeldet ? undefined : values.email,
      password: angemeldet ? undefined : values.password,
      phone: values.phone,
      websiteUrl: values.websiteUrl,
      message: values.message,
      datenschutz: values.datenschutz,
      website: values.website,
      turnstileToken: turnstileToken ?? undefined,
    }

    /*
     * Clientseitige Vorprüfung mit DERSELBEN Regel wie der Server (`partnerApplicationSchema`) — für
     * die sofortige, feldgenaue Rückmeldung ohne Netzfahrt. Im angemeldeten Fall wird die Adresse
     * dafür eingesetzt, damit die Prüfung nicht ein Feld anmahnt, das gar nicht existiert.
     */
    const parsed = partnerApplicationSchema.safeParse(
      angemeldet ? { ...submission, email: sessionEmail ?? '', password: undefined } : submission,
    )
    if (!parsed.success) {
      const errors = toFieldErrors(parsed.error.issues)
      setFieldErrors(errors)
      setErrorCode('validation')
      setStatus('error')
      focusFirstInvalid(errors)
      return
    }

    setFieldErrors({})
    setErrorCode(null)
    setStatus('submitting')

    try {
      const response: PartnerApplicationResponse = await submitPartnerApplicationAction(submission)
      if (response.ok) {
        setStatus('success')
        return
      }
      if (response.error === 'validation') {
        setFieldErrors(response.fieldErrors)
        focusFirstInvalid(response.fieldErrors)
      }
      setErrorCode(response.error)
      setStatus('error')
    } catch {
      // Offline, abgebrochen, Deploy während der Absendung — die Action wurde nie ausgeführt.
      setErrorCode('network')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 sm:p-8">
        {/*
          `role="status"` (höflich) statt `alert`: Der Erfolg unterbricht nichts. `tabIndex={-1}`
          + Fokus ist trotzdem nötig — das Formular ist gerade verschwunden.
        */}
        <div ref={successRef} role="status" tabIndex={-1} className="outline-none">
          <CheckCircle2 className="h-6 w-6 text-positive" strokeWidth={1.75} aria-hidden="true" />
          <h2 className="mt-4 text-h3 text-ink">{t('success.title')}</h2>
          <p className="mt-3 max-w-prose text-body text-text-muted">{t('success.body')}</p>
          {/*
            DIE KONTAKTADRESSE STEHT IM ERFOLGSZUSTAND, und das ist kein Beiwerk: Diese Seite
            antwortet in JEDEM Fall gleich — auch dann, wenn der Honeypot zugeschnappt ist und gar
            nichts entstanden ist (s. `lib/partner-application/flow.ts`). Das ausbleibende Echo ist
            die einzige Rückmeldung, die ein fälschlich Gefangener bekommt; er braucht dafür einen
            Weg zurück.
          */}
          <p className="mt-3 max-w-prose text-small text-text-muted">
            {t.rich('success.fallback', {
              mail: () => (
                <a
                  href={`mailto:${COMPANY.email}`}
                  className="font-medium text-accent underline decoration-accent-border underline-offset-4 hover:decoration-accent"
                >
                  {COMPANY.email}
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    )
  }

  const submitting = status === 'submitting'
  const showError = status === 'error' && errorCode !== null

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      // `relative`: Anker für das absolut positionierte Honeypot-Feld unten.
      className="relative rounded-lg border border-line bg-surface p-6 sm:p-8"
    >
      <div className="space-y-5">
        <Field
          name="company"
          label={t('fields.company')}
          error={fieldErrors.company}
          fieldId={fieldId}
          errorId={errorId}
          t={t}
        >
          {(props) => (
            <Input
              {...props}
              autoComplete="organization"
              maxLength={PARTNER_APPLICATION_MAX.company}
              required
              value={values.company}
              onChange={(e) => set('company', e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          {/*
            ZWEI NAMENSFELDER, BEIDE PFLICHT. `given-name`/`family-name` statt eines gemeinsamen
            `name`: der Browser füllt zwei Felder nur dann richtig vor, wenn er weiss, welcher Teil
            wohin gehört. Begründung für die Auftrennung: `lib/partner-application/schema.ts`.
          */}
          <Field
            name="firstName"
            label={t('fields.firstName')}
            error={fieldErrors.firstName}
            fieldId={fieldId}
            errorId={errorId}
            t={t}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="given-name"
                maxLength={PARTNER_APPLICATION_MAX.firstName}
                required
                value={values.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
            )}
          </Field>

          <Field
            name="lastName"
            label={t('fields.lastName')}
            error={fieldErrors.lastName}
            fieldId={fieldId}
            errorId={errorId}
            t={t}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="family-name"
                maxLength={PARTNER_APPLICATION_MAX.lastName}
                required
                value={values.lastName}
                onChange={(e) => set('lastName', e.target.value)}
              />
            )}
          </Field>
        </div>

        {angemeldet ? (
          /*
            ANGEMELDET: kein Adress- und kein Passwortfeld. Die Adresse wird GENANNT statt erneut
            erfragt — wer zwei Konten hat, muss sehen, an welches die Bewerbung geht.
          */
          <div className="rounded-md border border-line bg-surface-alt p-4">
            <p className="text-small text-text">
              {t.rich('signedIn', {
                email: () => <strong className="font-semibold text-ink">{sessionEmail}</strong>,
              })}
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              name="email"
              label={t('fields.email')}
              error={fieldErrors.email}
              fieldId={fieldId}
              errorId={errorId}
              t={t}
            >
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  autoComplete="email"
                  maxLength={PARTNER_APPLICATION_MAX.email}
                  required
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              )}
            </Field>

            <Field
              name="password"
              label={t('fields.password')}
              hint={t('fields.passwordHint')}
              error={fieldErrors.password}
              fieldId={fieldId}
              errorId={errorId}
              t={t}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="new-password"
                  /*
                    Die Beschriftungen des Sichtbar-Schalters kommen aus dem Konto-Namensraum —
                    dieselben Wörter wie in Registrierung und Anmeldung (`Konto.shared.*`). Ein
                    zweiter Satz Übersetzungen für denselben Knopf wäre eine zweite Wortwahl für
                    dasselbe Bedienelement.
                  */
                  showLabel={tKonto('shared.showPassword')}
                  hideLabel={tKonto('shared.hidePassword')}
                  required
                  value={values.password}
                  onChange={(e) => set('password', e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="phone"
            label={t('fields.phone')}
            optionalLabel={t('optional')}
            error={fieldErrors.phone}
            fieldId={fieldId}
            errorId={errorId}
            t={t}
          >
            {(props) => (
              <Input
                {...props}
                type="tel"
                autoComplete="tel"
                maxLength={PARTNER_APPLICATION_MAX.phone}
                value={values.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            )}
          </Field>

          <Field
            name="websiteUrl"
            label={t('fields.website')}
            optionalLabel={t('optional')}
            error={fieldErrors.websiteUrl}
            fieldId={fieldId}
            errorId={errorId}
            t={t}
          >
            {(props) => (
              <Input
                {...props}
                /*
                  `type="text"` und nicht `type="url"`: Ein Betrieb tippt „elektro-muster.at" ohne
                  Schema, und `type="url"` liesse den Browser das als ungültig melden — in seiner
                  eigenen Sprache und ausserhalb unserer Fehlerdarstellung. Das Feld ist optional
                  und wird von einem Menschen gelesen (s. `schema.ts`).
                */
                autoComplete="url"
                inputMode="url"
                maxLength={PARTNER_APPLICATION_MAX.website}
                placeholder={t('fields.websitePlaceholder')}
                value={values.websiteUrl}
                onChange={(e) => set('websiteUrl', e.target.value)}
              />
            )}
          </Field>
        </div>

        {/*
          DER FREITEXT — Pflichtfeld und der eigentliche Inhalt der Bewerbung. Er steht bewusst weit
          unten und mit sechs Zeilen: Er ist die Grundlage der Prüfung, und die Feldhöhe ist die
          Ansage, wie viel Text erwartet wird.
        */}
        <Field
          name="message"
          label={t('fields.message')}
          hint={t('fields.messageHint')}
          error={fieldErrors.message}
          fieldId={fieldId}
          errorId={errorId}
          t={t}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={6}
              maxLength={PARTNER_APPLICATION_MAX.message}
              required
              value={values.message}
              onChange={(e) => set('message', e.target.value)}
            />
          )}
        </Field>

        {/* DSGVO-Pflichtfeld — NICHT vorausgewählt (s. `EMPTY_VALUES`). */}
        <div>
          <div className="flex items-start gap-3">
            <Checkbox
              id={fieldId('datenschutz')}
              name="datenschutz"
              required
              checked={values.datenschutz}
              onChange={(e) => set('datenschutz', e.target.checked)}
              aria-invalid={fieldErrors.datenschutz ? true : undefined}
              aria-describedby={fieldErrors.datenschutz ? errorId('datenschutz') : undefined}
            />
            <Label htmlFor={fieldId('datenschutz')} className="font-normal text-text">
              {/*
                Der Link steht INNERHALB des Labels: Die HTML-Spec schliesst interaktive Nachfahren
                von der Label-Aktivierung aus — ein Klick auf den Link navigiert, ohne die Checkbox
                umzuschalten (dieselbe Konstruktion wie im Kontaktformular).
              */}
              {t.rich('fields.datenschutz', {
                link: (chunks) => (
                  <Link
                    href="/datenschutz"
                    className="text-accent underline decoration-accent-border underline-offset-4 hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </Label>
          </div>
          {fieldErrors.datenschutz && (
            <FieldHint id={errorId('datenschutz')} tone="error">
              <span className="mt-2 block pl-7">{t(`errors.${fieldErrors.datenschutz}`)}</span>
            </FieldHint>
          )}
        </div>

        {/*
          HONEYPOT — immer aktiv, unabhängig von Turnstile; derselbe Mechanismus und derselbe
          Feldname wie im Kontaktformular und in der Lead-Erfassung, kein zweiter. Vom Menschen nicht
          erreichbar: ausserhalb des Sichtfelds, `tabIndex={-1}` und `aria-hidden`. Ausgeblendet per
          Position, NICHT per `display:none` — ein Feld, das der Browser gar nicht layoutet,
          überspringen auch schlichte Bots.
        */}
        <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
          <label htmlFor={fieldId('website')}>{t('honeypot')}</label>
          <input
            id={fieldId('website')}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
          />
        </div>

        {turnstileEnabled && <TurnstileWidget onToken={setTurnstileToken} language={locale} />}

        {showError && (
          <div
            ref={alertRef}
            // `role="alert"` = assertive: Der Nutzer glaubt gerade, eine Aktion abgeschlossen zu haben.
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-negative bg-negative-subtle p-4 outline-none"
          >
            <p className="text-small font-semibold text-negative">{t(`formError.${errorCode}`)}</p>
            {errorCode !== 'validation' && (
              <p className="mt-2 text-small text-text">
                {t.rich('formError.fallback', {
                  mail: () => (
                    <a
                      href={`mailto:${COMPANY.email}`}
                      className="font-medium text-accent underline decoration-accent-border underline-offset-4 hover:decoration-accent"
                    >
                      {COMPANY.email}
                    </a>
                  ),
                })}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" size="lg" disabled={submitting}>
            {submitting && (
              // Die globale `prefers-reduced-motion`-Regel (globals.css) friert die Rotation ein.
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            {submitting ? t('submitting') : status === 'error' ? t('retry') : t('submit')}
          </Button>
          {/* Ladezustand für Screenreader — `aria-busy` allein wird nicht angesagt. */}
          <span role="status" aria-live="polite" className="sr-only">
            {submitting ? t('submitting') : ''}
          </span>
          <p className="text-caption text-text-muted">{t('requiredHint')}</p>
        </div>
      </div>
    </form>
  )
}

/**
 * Ein beschriftetes Feld samt Fehlerverknüpfung.
 *
 * Als Render-Prop statt als „Input mit 12 Props" — dieselbe Konstruktion und dieselbe Begründung
 * wie im Kontaktformular: Die Feldtypen unterscheiden sich in ihren Attributen, aber NICHT in der
 * Verdrahtung von Label, `aria-invalid`, `aria-describedby` und Meldung. Genau diese Verdrahtung ist
 * der Teil, der leise kaputtgeht (§9.4).
 */
function Field({
  name,
  label,
  optionalLabel,
  hint,
  error,
  fieldId,
  errorId,
  t,
  children,
}: {
  name: PartnerApplicationFieldName
  label: string
  optionalLabel?: string
  hint?: string
  error?: string
  fieldId: (name: string) => string
  errorId: (name: string) => string
  t: (key: string) => string
  children: (props: {
    id: string
    name: string
    'aria-invalid'?: true
    'aria-describedby'?: string
  }) => React.ReactNode
}) {
  const id = fieldId(name)
  const hintId = hint ? `${id}-hint` : undefined
  const describedBy = error ? errorId(name) : hintId

  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {optionalLabel && <span className="ml-1 font-normal text-text-muted">{optionalLabel}</span>}
      </Label>
      <div className="mt-1.5">
        {children({
          id,
          name,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
        })}
      </div>
      {hint && !error && (
        <FieldHint id={hintId}>
          <span className="mt-1.5 block">{hint}</span>
        </FieldHint>
      )}
      {error && (
        <FieldHint id={errorId(name)} tone="error">
          <span className="mt-1.5 block">{t(`errors.${error}`)}</span>
        </FieldHint>
      )}
    </div>
  )
}
