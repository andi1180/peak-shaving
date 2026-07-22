'use client'

import * as React from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox, FieldHint, Input, Label, Select } from '@/components/ui/input'
import { TurnstileWidget, turnstileEnabled } from '@/components/kontakt/turnstile-widget'
import { submitLeadCaptureAction } from '@/lib/leads/capture-action'
import { parseLeadCapture, type LeadFieldErrors } from '@/lib/leads/capture-request'
import type { LeadCaptureResponse } from '@/lib/leads/capture-flow'
import type { LeadCaptureConsentTexts } from '@/lib/leads/capture-texts'
import {
  LEAD_FIELDS,
  LEAD_INDUSTRY_VALUES,
  LEAD_CAPTURE_REGISTRY,
  type LeadCaptureField,
  type LeadFieldKey,
  type LeadCaptureFormKey,
} from '@/lib/leads/registry'
import type { QuickCalculatorInputs } from '@/lib/schnellrechner'

/**
 * DIE EINBETTBARE ERFASSUNGSKOMPONENTE (B3-2, Fahrplan_2026.md B3).
 *
 * Sie bezieht ihren gesamten Inhalt aus dem Registry-Eintrag ihres `sourceKey`: welche Felder
 * angezeigt werden, welche davon Pflicht sind, ob eine Marketing-Einwilligung angeboten wird — und
 * über den Schlüssel auch ihre vier Texte (`LeadCapture.entries.<key>.*`). Es gibt bewusst KEINE je
 * Einsatzort kopierte Formularvariante: „EIN Backend, VIELE kontextspezifische Einstiegspunkte;
 * kein überall gleiches Formular" heisst genau das — ein Formular, das je Kontext anders SPRICHT
 * und anders FRAGT, nicht zehn Formulare.
 *
 * MUSTER, ANREDE UND FEHLERDARSTELLUNG WIE DAS KONTAKTFORMULAR
 * (`components/kontakt/kontakt-form.tsx`): `noValidate` bei erhaltenen `required`-Attributen (die
 * native Browser-Blase spräche in Browser-Sprache und zeigte nur EINEN Fehler), Fokus ins erste
 * fehlerhafte Feld, `role="alert"` für Fehler und `role="status"` für den Erfolg, Honeypot per
 * Position ausgeblendet statt per `display:none`. Die Anrede ist durchgehend „Sie".
 *
 * KEIN LAYOUT: die Komponente bringt keine `Section`, keinen `Container` und keinen Seitenabstand
 * mit — nur die Karte. Wo sie steht, entscheidet der Einsatzort.
 *
 * FAIL-CLOSED: hat der Eintrag einen Zweck, dessen Wortlaut nicht geladen werden konnte, rendert
 * die Komponente NICHTS. Ohne den Text, dem zugestimmt wird, darf keine Einwilligung eingesammelt
 * werden (B1-2, gleiche Regel wie die Ankreuzmöglichkeit auf `/kontakt`).
 */

type Status = 'idle' | 'submitting' | 'success' | 'error'

/** `network` gibt es nur hier: Der Server kann nicht melden, dass er unerreichbar war. */
type FormErrorCode = 'validation' | 'unavailable' | 'spam' | 'turnstile' | 'network'

export type LeadCaptureFormProps = {
  sourceKey: LeadCaptureFormKey
  /** Serverseitig geladen (`lib/leads/capture-texts.ts`) — nie im Client zusammengesetzt. */
  consentTexts: LeadCaptureConsentTexts
  /**
   * Die aktuellen Eingaben des Schnellrechners. Nur für Einträge mit `carriesCalculatorResult`;
   * der Server rechnet daraus selbst nach und übernimmt keine fertige Zahl vom Client.
   */
  calculator?: QuickCalculatorInputs | null
  className?: string
}

export function LeadCaptureForm({
  sourceKey,
  consentTexts,
  calculator = null,
  className,
}: LeadCaptureFormProps) {
  const entry = LEAD_CAPTURE_REGISTRY[sourceKey]
  const t = useTranslations('LeadCapture')
  const locale = useLocale()

  const [values, setValues] = React.useState<Record<string, string>>({})
  const [marketing, setMarketing] = React.useState(false)
  const [website, setWebsite] = React.useState('')
  const [status, setStatus] = React.useState<Status>('idle')
  const [errorCode, setErrorCode] = React.useState<FormErrorCode | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<LeadFieldErrors>({})
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null)

  /* `useId`, damit mehrere Formulare auf einer Seite sich nicht die label/aria-Verknüpfungen kapern. */
  const uid = React.useId()
  const fieldId = (name: string) => `${uid}-${name}`
  const errorId = (name: string) => `${uid}-${name}-error`

  const alertRef = React.useRef<HTMLDivElement>(null)
  const successRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (status === 'success') successRef.current?.focus()
  }, [status])

  React.useEffect(() => {
    // Bei Feldfehlern führt der Fokus ins FELD (s. `handleSubmit`), nicht in die Meldung.
    if (status === 'error' && errorCode && errorCode !== 'validation') alertRef.current?.focus()
  }, [status, errorCode])

  function set(key: LeadFieldKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    // Die Meldung verschwindet beim Tippen, nicht erst beim nächsten Absenden.
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  function focusFirstInvalid(errors: LeadFieldErrors) {
    const first = entry.fields.find((field) => errors[field.key])
    if (first) document.getElementById(fieldId(first.key))?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'submitting') return

    const submission = {
      sourceKey,
      values,
      marketing,
      website,
      turnstileToken: turnstileToken ?? undefined,
      calculator: entry.carriesCalculatorResult && calculator ? calculator : undefined,
    }

    /*
     * Clientseitige Vorprüfung mit DERSELBEN Regel wie der Server (`parseLeadCapture`) — für die
     * sofortige, feldgenaue Rückmeldung ohne Netzfahrt. Der Client ist manipulierbar; der Server
     * prüft deshalb nach, aber es gibt nur eine Regel.
     */
    const parsed = parseLeadCapture(submission)
    if (!parsed.ok && parsed.reason === 'validation') {
      setFieldErrors(parsed.fieldErrors)
      setErrorCode('validation')
      setStatus('error')
      focusFirstInvalid(parsed.fieldErrors)
      return
    }

    setFieldErrors({})
    setErrorCode(null)
    setStatus('submitting')

    try {
      const response: LeadCaptureResponse = await submitLeadCaptureAction(submission)
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

  /*
   * FAIL-CLOSED (s. Kopf). Der Hinweis geht ins Server-/Browser-Log, nicht an den Besucher: für ihn
   * ist die Abwesenheit des Formulars kein Fehlerzustand, den er beheben könnte.
   */
  if (entry.purpose && !consentTexts.primary) return null

  if (status === 'success') {
    return (
      <div className={cardClass(className)}>
        {/* `role="status"` (höflich) statt `alert`: Der Erfolg unterbricht nichts. `tabIndex={-1}`
            + Fokus ist trotzdem nötig — das Formular ist gerade verschwunden. */}
        <div ref={successRef} role="status" tabIndex={-1} className="outline-none">
          <CheckCircle2 className="h-6 w-6 text-positive" strokeWidth={1.75} aria-hidden="true" />
          <p className="mt-3 text-body text-text">{t(`entries.${sourceKey}.success`)}</p>
        </div>
      </div>
    )
  }

  const submitting = status === 'submitting'
  const showError = status === 'error' && errorCode !== null && errorCode !== 'validation'

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      /* `relative`: Anker für das absolut positionierte Honeypot-Feld unten. */
      className={`relative ${cardClass(className)}`}
    >
      <h2 className="text-h4 text-ink">{t(`entries.${sourceKey}.heading`)}</h2>
      <p className="mt-2 max-w-prose text-small text-text-muted">
        {t(`entries.${sourceKey}.body`)}
      </p>

      <div className="mt-5 space-y-4">
        {entry.fields.map((field) => (
          <FormField
            key={field.key}
            field={field}
            value={values[field.key] ?? ''}
            error={fieldErrors[field.key]}
            id={fieldId(field.key)}
            errorId={errorId(field.key)}
            onChange={(next) => set(field.key, next)}
            t={t}
          />
        ))}
      </div>

      {/*
        DER EINWILLIGUNGSWORTLAUT DES ZWECKS — sichtbar VOR der Schaltfläche und nicht im
        Kleingedruckten. Er steht als Satz und nicht als Kästchen: das Absenden IST hier die
        Einwilligungshandlung (der Eintrag hat genau diesen einen Zweck, und die Beschriftung der
        Schaltfläche benennt ihn). Ein zusätzliches Pflicht-Kästchen daneben wäre eine zweite,
        gleichbedeutende Zustimmung zum selben Vorgang.
      */}
      {consentTexts.primary && (
        <p className="mt-5 max-w-prose text-caption text-text-muted">{consentTexts.primary}</p>
      )}

      {/*
        DIE ZUSÄTZLICHE MARKETING-EINWILLIGUNG — NIE vorausgewählt (`useState(false)`, und es gibt
        keinen Pfad, der das vorbelegt: eine vorangehakte Einwilligung ist nach DSGVO keine
        Einwilligung). Sie trägt den Wortlaut aus `platform.consent_texts`, nicht aus
        `messages/de.json`. Optisch abgesetzt vom eigentlichen Zweck: die eine ist der Grund des
        Formulars, die andere eine zusätzliche Erlaubnis für später.
      */}
      {entry.offersMarketingConsent && consentTexts.marketing && (
        <div className="mt-4 rounded-md border border-line bg-surface-alt p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id={fieldId('marketing')}
              name="marketing"
              checked={marketing}
              onChange={(event) => setMarketing(event.target.checked)}
            />
            <Label htmlFor={fieldId('marketing')} className="font-normal text-text">
              {consentTexts.marketing}
            </Label>
          </div>
          <p className="mt-2 pl-7 text-caption text-text-muted">{t('marketingHint')}</p>
        </div>
      )}

      {/*
        HONEYPOT — immer aktiv, unabhängig von Turnstile; derselbe Mechanismus wie im
        Kontaktformular, kein zweiter. Vom Menschen nicht erreichbar: ausserhalb des Sichtfelds,
        `tabIndex={-1}` und `aria-hidden`. Ausgeblendet per Position, NICHT per `display:none` —
        ein Feld, das der Browser gar nicht layoutet, überspringen auch schlichte Bots.
      */}
      <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor={fieldId('website')}>{t('honeypot')}</label>
        <input
          id={fieldId('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {turnstileEnabled && <TurnstileWidget onToken={setTurnstileToken} language={locale} />}

      {showError && (
        <div
          ref={alertRef}
          /* `role="alert"` = assertive: der Nutzer glaubt gerade, eine Aktion abgeschlossen zu haben. */
          role="alert"
          tabIndex={-1}
          className="mt-4 rounded-md border border-negative bg-negative-subtle p-4 outline-none"
        >
          <p className="text-small font-semibold text-negative">{t(`formError.${errorCode}`)}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {submitting && (
            // Die globale `prefers-reduced-motion`-Regel (globals.css) friert die Rotation ein —
            // der Ladezustand bleibt über `aria-busy` und den Text erkennbar.
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {submitting ? t('submitting') : t(`entries.${sourceKey}.submit`)}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {submitting ? t('submitting') : ''}
        </span>
      </div>
    </form>
  )
}

function cardClass(className?: string): string {
  return `rounded-lg border border-line bg-surface p-6 ${className ?? ''}`.trim()
}

/**
 * Ein Feld samt Beschriftung, Fehlerverknüpfung und passender Eingabeart.
 *
 * Die Eingabeart kommt aus `LEAD_FIELDS` (Registry) — nicht aus einer Fallunterscheidung je
 * Einsatzort. Genau die Verdrahtung von Label, `aria-invalid`, `aria-describedby` und Meldung ist
 * der Teil, der leise kaputtgeht (§9.4); deshalb steht sie einmal hier.
 */
function FormField({
  field,
  value,
  error,
  id,
  errorId,
  onChange,
  t,
}: {
  field: LeadCaptureField
  value: string
  error?: string
  id: string
  errorId: string
  onChange: (next: string) => void
  t: (key: string, values?: Record<string, string>) => string
}) {
  const descriptor = LEAD_FIELDS[field.key]
  const describedBy = error ? errorId : undefined
  const shared = {
    id,
    name: field.key,
    required: field.required || undefined,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy,
    autoComplete: descriptor.autoComplete,
    maxLength: descriptor.maxLength,
    value,
  }

  return (
    <div>
      <Label htmlFor={id}>
        {t(`fields.${field.key}`)}
        {!field.required && (
          <span className="ml-1 font-normal text-text-muted">{t('optional')}</span>
        )}
      </Label>
      <div className="mt-1.5">
        {descriptor.kind === 'industry' ? (
          <Select {...shared} onChange={(event) => onChange(event.target.value)}>
            {/* `disabled` + leerer Wert: der Platzhalter ist keine gültige Wahl, bleibt aber
                sichtbar, solange nichts gewählt ist. */}
            <option value="" disabled>
              {t('industryPlaceholder')}
            </option>
            {LEAD_INDUSTRY_VALUES.map((industry) => (
              <option key={industry} value={industry}>
                {t(`industries.${industry}`)}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            {...shared}
            type={inputType(descriptor.kind)}
            inputMode={inputMode(descriptor.kind)}
            /* Lastwerte und Postleitzahlen mit tabellarischen Ziffern (DESIGN.md). */
            className={NUMERIC_KINDS.has(descriptor.kind) ? 'tabular-nums' : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </div>
      {error && (
        <FieldHint id={errorId} tone="error">
          <span className="mt-1.5 block">{t(`errors.${error}`)}</span>
        </FieldHint>
      )}
    </div>
  )
}

const NUMERIC_KINDS = new Set(['postalCode', 'kwh'])

function inputType(kind: string): string {
  if (kind === 'email') return 'email'
  if (kind === 'tel') return 'tel'
  if (kind === 'date') return 'date'
  return 'text'
}

/*
 * `type="text"` + `inputMode` statt `type="number"` — dieselbe Entscheidung wie im Schnellrechner:
 * `type="number"` liefert je nach Browser bei ungewöhnlicher Eingabe einen LEEREN Wert zurück und
 * verstellt sich am Scrollrad. `inputMode` bringt trotzdem die numerische Tastatur.
 */
function inputMode(kind: string): 'numeric' | undefined {
  return NUMERIC_KINDS.has(kind) ? 'numeric' : undefined
}
