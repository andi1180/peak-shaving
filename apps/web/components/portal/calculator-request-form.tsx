'use client'

/**
 * DAS ANFRAGEFORMULAR DES REITERS „KALKULATOR" (B18-4, Portal-Oberfläche).
 *
 * Der einzige Client-Anteil dieses Reiters. Er existiert allein wegen `useActionState`: Ein blankes
 * `<form action={serverAction}>` kann keinen Rückgabewert anzeigen — und genau der trägt hier die
 * Auskunft, die zählt (`already_pending` ist KEIN Fehler, s. u.).
 *
 * ── ⚠ `already_pending` ERSCHEINT HIER GAR NICHT — GEMESSEN, NICHT ANGENOMMEN ───────────────────
 * Er entsteht real ohne jedes Fehlverhalten: zwei offene Tabs, ein Doppelklick, oder die Seite lag
 * schon offen, als aus einem anderen Tab abgesendet wurde. Der erste Entwurf zeigte dafür einen
 * neutralen Satz IM Formular (kein `role="alert"`, keine Fehlerfarbe). Im Browserlauf gemessen:
 * Der Satz ist unerreichbar. Die Action ruft `revalidatePath`, die Seite rendert in den
 * WARTEZUSTAND — und dieses Formular samt seinem `useActionState` verschwindet dabei.
 *
 * Das Ergebnis ist besser als der Satz: Der zweite Tab zeigt danach „Ihre Anfrage liegt bei uns"
 * mit Zeitpunkt und der eigenen Begründung — vollständiger als ein Hinweis, dass etwas bereits
 * vorliegt. Der Satz wurde deshalb ERSATZLOS entfernt statt stehengelassen: ein Zweig, der nie
 * rendert, behauptet ein Verhalten, das es nicht gibt. Was bleibt und was zählt: `already_pending`
 * wird NIE als Fehler behandelt (die Action gibt keinen `formError` zurück).
 *
 * ── PROGRESSIVE ENHANCEMENT BLEIBT GEWAHRT ──────────────────────────────────────────────────────
 * Es ist ein echtes `<form>`, das auch ohne JavaScript absendet; `useActionState` ergänzt nur
 * Ladezustand und Rückmeldung ohne Neuladen.
 *
 * ── DER GETIPPTE TEXT GEHT NIE VERLOREN ─────────────────────────────────────────────────────────
 * Jeder Fehlerzustand der Action trägt ihn zurück (`defaultValue`). Ein Betrieb, der drei Absätze
 * geschrieben hat und sie wegen eines Netzfehlers neu tippen soll, schreibt beim zweiten Mal
 * weniger — und die Begründung ist die Grundlage der Entscheidung.
 */
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { FieldHint, Label, Textarea } from '@/components/ui/input'
import { submitCalculatorRequestAction } from '@/lib/partner-portal/calculator-request-actions'
import { CALCULATOR_REQUEST_INITIAL_STATE } from '@/lib/partner-portal/calculator-request-form-state'

export function CalculatorRequestForm() {
  const t = useTranslations('PartnerPortal.calculator')
  const [state, formAction, isPending] = useActionState(
    submitCalculatorRequestAction,
    CALCULATOR_REQUEST_INITIAL_STATE,
  )

  const fieldError =
    state.status === 'missing_fields'
      ? t('formRequired')
      : state.status === 'message_too_long'
        ? t('formTooLong', { max: state.maxLength })
        : null

  const formError =
    state.status === 'error'
      ? t('formError')
      : state.status === 'none'
        ? t('formNone')
        : null

  // Nur die Fehlerzustände tragen den Text zurück; nach einem Erfolg ist das Feld leer (und die
  // Seite zeigt beim nächsten Rendern ohnehin den Wartezustand statt dieses Formulars).
  const defaultValue =
    state.status === 'missing_fields' ||
    state.status === 'message_too_long' ||
    state.status === 'error'
      ? state.message
      : ''

  return (
    <form action={formAction} noValidate className="mt-6 flex flex-col gap-4">
      {formError && (
        <p
          role="alert"
          className="rounded-lg border border-negative bg-negative-subtle p-4 text-body text-negative"
        >
          {formError}
        </p>
      )}

      <div>
        <Label htmlFor="kalkulator-begruendung">{t('formLabel')}</Label>
        <div className="mt-1.5">
          <Textarea
            id="kalkulator-begruendung"
            name="begruendung"
            rows={5}
            required
            defaultValue={defaultValue}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={
              fieldError ? 'kalkulator-begruendung-error' : 'kalkulator-begruendung-hint'
            }
          />
        </div>
        {fieldError ? (
          <p id="kalkulator-begruendung-error" role="alert" className="mt-1.5 text-small text-negative">
            {fieldError}
          </p>
        ) : (
          <FieldHint id="kalkulator-begruendung-hint">{t('formHint')}</FieldHint>
        )}
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? t('formSubmitting') : t('formSubmit')}
        </Button>
      </div>
    </form>
  )
}
