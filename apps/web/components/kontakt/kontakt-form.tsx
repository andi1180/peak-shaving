'use client'

import * as React from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from '@/components/ui/input'
import { TurnstileWidget, turnstileEnabled } from '@/components/kontakt/turnstile-widget'
import { COMPANY } from '@/lib/nav'
import {
  kontaktSchema,
  toFieldErrors,
  type KontaktErrorCode,
  type KontaktFieldName,
  type KontaktResponse,
} from '@/lib/kontakt/schema'
import { THEMA_PARAM, THEMEN, isThemaKey, type Thema } from '@/lib/kontakt/themen'

/**
 * Das Kontaktformular (Pflichtenheft §5.5).
 *
 * WIEDERVERWENDBAR: Die Komponente bringt kein Layout mit (kein `Section`, kein
 * `Container`) — nur die Karte. `/kontakt` ist heute der einzige Ort; sollte das
 * Formular je zusätzlich in einem Dialog stehen, ist das ein Prop, kein Umbau.
 *
 * PRÜFUNG LÄUFT ZWEIMAL, MIT EINER REGEL: `kontaktSchema` (aus
 * `lib/kontakt/schema.ts`) hier für die sofortige Rückmeldung, dieselbe Datei in
 * `app/api/kontakt/route.ts` für die Wahrheit. Der Client ist manipulierbar; der
 * Server prüft deshalb nach, aber beide lesen dieselbe Regel.
 *
 * `noValidate` am <form> ist Absicht, kein Weglassen: Die `required`-Attribute
 * bleiben (Screenreader kündigen „erforderlich" an, §9.4) — aber die native
 * Browser-Blase würde in der Browser-Sprache melden, nicht in der Sprache dieser
 * Seite, und sie zeigt immer nur EINEN Fehler. Die Prüfung übernimmt deshalb zod,
 * die Semantik bleibt am HTML.
 */

type Status = 'idle' | 'submitting' | 'success' | 'error'

/** `network` gibt es nur hier: Der Server kann nicht melden, dass er unerreichbar war. */
type FormErrorCode = KontaktErrorCode | 'network'

type Values = {
  name: string
  email: string
  unternehmen: string
  telefon: string
  thema: string
  nachricht: string
  datenschutz: boolean
  /** Zusätzliche Marketing-Einwilligung (B1-2) — optional, NIE vorausgewählt. */
  marketing: boolean
  /** Honeypot — s. u. Gehört in den State, damit React das Feld kontrolliert. */
  website: string
}

const EMPTY_VALUES: Values = {
  name: '',
  email: '',
  unternehmen: '',
  telefon: '',
  thema: '',
  nachricht: '',
  datenschutz: false,
  /*
   * `false`, und es gibt keinen Pfad, der das vorbelegt — dieselbe harte Regel wie bei
   * `datenschutz`: eine vorangehakte Einwilligung ist nach DSGVO keine Einwilligung. Anders als dort
   * ist das Feld hier aber freiwillig; ein leer gelassenes Kästchen ist die erwartete Normalantwort
   * und darf den Versand nicht behindern.
   */
  marketing: false,
  website: '',
}

/**
 * Reihenfolge im DOM. Steuert, welches Feld nach einer fehlgeschlagenen Prüfung
 * den Fokus bekommt: das ERSTE fehlerhafte (§9.4 Fokusführung) — nicht das
 * zuletzt geprüfte, was den Nutzer im Formular nach unten springen ließe.
 */
const FIELD_ORDER: KontaktFieldName[] = [
  'name',
  'email',
  'unternehmen',
  'telefon',
  'thema',
  'nachricht',
  'datenschutz',
]

/**
 * @param marketingConsentText Der WORTLAUT der Marketing-Einwilligung, serverseitig aus
 *   `platform.consent_texts` gelesen (B1-2, s. `app/(site)/[locale]/kontakt/page.tsx`). Er steht
 *   bewusst NICHT in `messages/de.json`: angezeigter und archivierter Wortlaut müssen dieselbe
 *   Quelle haben, sonst behauptet der Nachweis später einen Satz, den die Person nie gesehen hat
 *   (B1-1, append-only `consent_texts`).
 *
 *   Fehlt er (`null`), wird die Ankreuzmöglichkeit NICHT gerendert. Ohne Wortlaut darf keine
 *   Einwilligung eingesammelt werden — und der Rest des Formulars funktioniert unverändert weiter.
 */
export function KontaktForm({
  marketingConsentText = null,
}: {
  marketingConsentText?: string | null
}) {
  const t = useTranslations('Kontakt')
  const tNav = useTranslations('Nav')
  const locale = useLocale()

  const [values, setValues] = React.useState<Values>(EMPTY_VALUES)
  const [status, setStatus] = React.useState<Status>('idle')
  const [errorCode, setErrorCode] = React.useState<FormErrorCode | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<KontaktFieldName, string>>>(
    {},
  )
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null)

  /* Eindeutige IDs — `useId`, damit ein zweites Formular auf derselben Seite die
     label/aria-Verknüpfungen des ersten nicht kapert. */
  const uid = React.useId()
  const fieldId = (name: string) => `${uid}-${name}`
  const errorId = (name: string) => `${uid}-${name}-error`

  const alertRef = React.useRef<HTMLDivElement>(null)
  const successRef = React.useRef<HTMLDivElement>(null)

  /*
   * DEEP-LINK `?thema=<key>` (z. B. von einer Leistungsseite, s.
   * `lib/kontakt/themen.ts` → `kontaktHrefFor`).
   *
   * BEWUSST `window.location.search` und NICHT `useSearchParams()`: Der Hook
   * zwingt Next, die Seite entweder dynamisch zu rendern oder den Baum bis zur
   * nächsten <Suspense>-Grenze clientseitig nachzuladen. Beides kostet genau das,
   * was hier zählt — das vollständige Formular stünde dann nicht mehr im
   * vorgerenderten HTML (ohne JS unsichtbar, für Crawler unsichtbar). Die
   * Vorauswahl ist eine Bequemlichkeit, kein Inhalt; sie darf nach der Hydration
   * passieren, der Rest nicht.
   */
  React.useEffect(() => {
    const param = new URLSearchParams(window.location.search).get(THEMA_PARAM)
    if (isThemaKey(param)) setValues((prev) => ({ ...prev, thema: param as string }))
  }, [])

  React.useEffect(() => {
    if (status === 'success') successRef.current?.focus()
  }, [status])

  React.useEffect(() => {
    // Bei Feldfehlern führt der Fokus ins FELD (s. `handleSubmit`), nicht in die
    // Meldung — sonst müsste der Nutzer erst zurücknavigieren, um es zu beheben.
    if (status === 'error' && errorCode && errorCode !== 'validation') alertRef.current?.focus()
  }, [status, errorCode])

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
    // Die Meldung verschwindet beim Tippen, nicht erst beim nächsten Absenden:
    // Ein Fehler, der nach der Korrektur stehen bleibt, liest sich wie ein Bug.
    setFieldErrors((prev) => (prev[key as KontaktFieldName] ? { ...prev, [key]: undefined } : prev))
  }

  function themaLabel(thema: Thema): string {
    return thema.labelNamespace === 'Nav' ? tNav(thema.labelKey) : t(thema.labelKey)
  }

  function focusFirstInvalid(errors: Partial<Record<KontaktFieldName, string>>) {
    const first = FIELD_ORDER.find((name) => errors[name])
    if (first) document.getElementById(fieldId(first))?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'submitting') return

    const payload = { ...values, turnstileToken: turnstileToken ?? undefined, locale }
    const parsed = kontaktSchema.safeParse(payload)

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
      const response = await fetch('/api/kontakt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = (await response.json().catch(() => null)) as KontaktResponse | null

      if (response.ok && body?.ok) {
        setStatus('success')
        return
      }

      /*
       * Kein `body` (HTML-Fehlerseite, Proxy, Timeout) → `send_failed`. Bewusst
       * NICHT als Erfolg werten: „Die Antwort war unlesbar" heißt nicht „die Mail
       * ist raus".
       */
      const code: FormErrorCode = body && !body.ok ? body.error : 'send_failed'
      if (body && !body.ok && body.fieldErrors) {
        setFieldErrors(body.fieldErrors)
        focusFirstInvalid(body.fieldErrors)
      }
      setErrorCode(code)
      setStatus('error')
    } catch {
      // Offline, abgebrochen, DNS — der Request hat den Server nie erreicht.
      setErrorCode('network')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 sm:p-8">
        {/*
          `role="status"` (höflich) statt `alert` (assertiv): Der Erfolg unterbricht
          nichts. `tabIndex={-1}` + Fokus (s. Effekt oben) ist trotzdem nötig — das
          Formular ist gerade verschwunden, der Fokus läge sonst im Nirgendwo.
        */}
        <div ref={successRef} role="status" tabIndex={-1} className="outline-none">
          <CheckCircle2 className="h-6 w-6 text-positive" strokeWidth={1.75} aria-hidden="true" />
          <h2 className="mt-4 text-h3 text-ink">{t('success.title')}</h2>
          <p className="mt-3 max-w-prose text-body text-text-muted">{t('success.text')}</p>
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
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="name"
            label={t('fields.name')}
            error={fieldErrors.name}
            fieldId={fieldId}
            errorId={errorId}
            t={t}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="name"
                required
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>

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
                required
                value={values.email}
                onChange={(e) => set('email', e.target.value)}
              />
            )}
          </Field>

          <Field
            name="unternehmen"
            label={t('fields.unternehmen')}
            optionalLabel={t('optional')}
            error={fieldErrors.unternehmen}
            fieldId={fieldId}
            errorId={errorId}
            t={t}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="organization"
                value={values.unternehmen}
                onChange={(e) => set('unternehmen', e.target.value)}
              />
            )}
          </Field>

          <Field
            name="telefon"
            label={t('fields.telefon')}
            optionalLabel={t('optional')}
            error={fieldErrors.telefon}
            fieldId={fieldId}
            errorId={errorId}
            t={t}
          >
            {(props) => (
              <Input
                {...props}
                type="tel"
                autoComplete="tel"
                value={values.telefon}
                onChange={(e) => set('telefon', e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          name="thema"
          label={t('fields.thema')}
          error={fieldErrors.thema}
          fieldId={fieldId}
          errorId={errorId}
          t={t}
        >
          {(props) => (
            <Select
              {...props}
              required
              value={values.thema}
              onChange={(e) => set('thema', e.target.value)}
            >
              {/* `disabled` + leerer Wert: Der Platzhalter ist keine gültige Wahl,
                  bleibt aber sichtbar, solange nichts gewählt ist. */}
              <option value="" disabled>
                {t('fields.themaPlaceholder')}
              </option>
              {THEMEN.map((thema) => (
                <option key={thema.key} value={thema.key}>
                  {themaLabel(thema)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          name="nachricht"
          label={t('fields.nachricht')}
          error={fieldErrors.nachricht}
          fieldId={fieldId}
          errorId={errorId}
          t={t}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={6}
              required
              value={values.nachricht}
              onChange={(e) => set('nachricht', e.target.value)}
            />
          )}
        </Field>

        {/* DSGVO-Pflichtfeld (§5.5): NICHT vorausgewählt — `EMPTY_VALUES.datenschutz`
            ist `false`, und es gibt keinen Pfad, der das vorbelegt. Eine
            vorangehakte Einwilligung ist nach DSGVO keine Einwilligung. */}
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
                Der Link steht INNERHALB des Labels. Das ist erlaubt und korrekt:
                Die HTML-Spec schließt „interactive content descendants" von der
                Label-Aktivierung aus — ein Klick auf den Link navigiert, ohne die
                Checkbox umzuschalten. Der Alternativ-Aufbau (Link neben dem Label)
                würde den Satz zerreißen und die Einwilligung schlechter lesbar
                machen als die Sache verlangt.
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
          MARKETING-EINWILLIGUNG (B1-2) — freiwillig, nicht vorausgewählt, kein Pflichtfeld und
          deshalb ohne `required` und ohne Fehlerpfad. Sie steht bewusst UNTER der
          Datenschutz-Zustimmung und optisch abgesetzt: die eine ist Voraussetzung der Bearbeitung,
          die andere eine zusätzliche Erlaubnis für später. Sie zu vermischen (etwa als eine
          gemeinsame Checkbox) wäre eine Kopplung, die die Einwilligung unwirksam machte.

          Der Text ist der Wortlaut aus `platform.consent_texts` — nicht aus `messages/de.json`
          (s. Prop-Kommentar oben). Ohne Wortlaut kein Kästchen.
        */}
        {marketingConsentText && (
          <div className="rounded-md border border-line bg-surface-alt p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id={fieldId('marketing')}
                name="marketing"
                checked={values.marketing}
                onChange={(e) => set('marketing', e.target.checked)}
              />
              <Label htmlFor={fieldId('marketing')} className="font-normal text-text">
                {marketingConsentText}
              </Label>
            </div>
            {/* Was nach dem Ankreuzen passiert, gehört an die Stelle des Ankreuzens — sonst ist die
                Bestätigungsmail für den Absender eine Überraschung. */}
            <p className="mt-2 pl-7 text-caption text-text-muted">{t('marketing.hint')}</p>
          </div>
        )}

        {/*
          HONEYPOT — immer aktiv, unabhängig von Turnstile (§ Bot-Schutz).
          Vom Menschen nicht erreichbar: außerhalb des Sichtfelds, `tabIndex={-1}`
          (nicht per Tastatur erreichbar) und `aria-hidden` (nicht vorgelesen).
          `aria-hidden` auf einem Feld wäre ein a11y-Fehler, WENN es fokussierbar
          bliebe — `tabIndex={-1}` schließt genau das aus.

          Ausgeblendet per Position, NICHT per `display:none`/`hidden`: Ein Feld,
          das der Browser gar nicht layoutet, überspringen auch schlichte Bots.
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
            // `role="alert"` = assertive: Der Fehler unterbricht, weil der Nutzer
            // gerade eine Aktion abgeschlossen glaubt, die nicht durchging.
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-negative bg-negative-subtle p-4 outline-none"
          >
            <p className="text-small font-semibold text-negative">{t(`formError.${errorCode}`)}</p>
            {/*
              FALLBACK-ADRESSE bei jedem Fehler, der nicht am Nutzer liegt: Der
              Lead darf nicht an unserem Kanal scheitern. Bei reinen Feldfehlern
              wäre die Adresse dagegen ein Ausweichangebot für ein Problem, das der
              Nutzer in fünf Sekunden selbst löst — deshalb nicht.
            */}
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
              // Die globale `prefers-reduced-motion`-Regel (globals.css) friert
              // die Rotation ein — der Ladezustand bleibt über `aria-busy` und
              // den Text trotzdem erkennbar.
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
 * Als Render-Prop statt als „Input mit 12 Props": Die vier Feldtypen (Input,
 * Textarea, Select, tel/email) unterscheiden sich in ihren Attributen, aber NICHT
 * in der Verdrahtung von Label, `aria-invalid`, `aria-describedby` und Meldung.
 * Genau diese Verdrahtung ist der Teil, der leise kaputtgeht (§9.4) — deshalb
 * steht sie einmal hier und nicht siebenmal oben.
 */
function Field({
  name,
  label,
  optionalLabel,
  error,
  fieldId,
  errorId,
  t,
  children,
}: {
  name: KontaktFieldName
  label: string
  optionalLabel?: string
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
  const describedBy = error ? errorId(name) : undefined

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
      {error && (
        <FieldHint id={errorId(name)} tone="error">
          <span className="mt-1.5 block">{t(`errors.${error}`)}</span>
        </FieldHint>
      )}
    </div>
  )
}
