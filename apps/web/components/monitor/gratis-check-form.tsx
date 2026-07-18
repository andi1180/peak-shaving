'use client'

/**
 * Das Gratis-Check-Formular (T3-Teil 2, Pflichtenheft_Monitor_MVP.md §5.1/§5.3).
 *
 * Die vier Stufe-1-Pflichtfelder — Jahresverbrauch, Energiepreis, Grundgebühr
 * (mit Einheiten-Umschalter €/Monat ↔ €/Jahr), PLZ. Reine Formular-Komponente:
 * `values`/`onChange` sind von außen kontrolliert (der Elternknoten
 * `GratisCheckClient` hält den Zustand, u. a. für die localStorage-Vorbelegung,
 * §6). Validierung, Fehlertexte und Fokusführung nach einem fehlgeschlagenen
 * Absenden bleiben dagegen HIER gekapselt — das ist reines Formularverhalten
 * und braucht den Elternknoten nicht.
 *
 * `noValidate` + `type="text"`/`inputMode` statt `type="number"`: dieselbe,
 * bereits an anderer Stelle in `apps/web` getroffene und begründete
 * Entscheidung wie in `components/quick-calculator.tsx` — `type="number"`
 * liefert bei Komma-Eingabe („27,9") je nach Browser einen leeren Wert.
 */
import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { FieldHint, Input, Label, Select } from '@/components/ui/input'
import {
  parseGratisCheckValues,
  toFieldErrors,
  type BaseFeeUnit,
  type GratisCheckFieldName,
  type GratisCheckRawValues,
  type GratisCheckValues,
} from '@/lib/monitor/schema'

const FIELD_ORDER: GratisCheckFieldName[] = [
  'annualConsumptionKwh',
  'energyPriceCtPerKwh',
  'baseFeeAmount',
  'postalCode',
]

export type GratisCheckFormProps = {
  values: GratisCheckRawValues
  onChange: <K extends keyof GratisCheckRawValues>(field: K, value: GratisCheckRawValues[K]) => void
  onValidSubmit: (values: GratisCheckValues) => void
}

/** Eine Zeile: Label + Feld + EIN Hinweis-Slot (Fehler ersetzt den Hilfetext, Muster wie `quick-calculator.tsx`). */
function FieldRow({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint: React.ReactNode
  children: (describedBy: string) => React.ReactNode
}) {
  const hintId = `${id}-hint`
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">{children(hintId)}</div>
      <FieldHint id={hintId} tone={error ? 'error' : 'muted'}>
        {error ?? hint}
      </FieldHint>
    </div>
  )
}

export function GratisCheckForm({ values, onChange, onValidSubmit }: GratisCheckFormProps) {
  const t = useTranslations('Monitor.GratisCheck')

  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<GratisCheckFieldName, string>>>(
    {},
  )

  const uid = React.useId()
  const fieldId = (name: string) => `${uid}-${name}`

  function set<K extends keyof GratisCheckRawValues>(field: K, value: GratisCheckRawValues[K]) {
    onChange(field, value)
    // Die Meldung verschwindet beim Tippen, nicht erst beim nächsten Absenden
    // (Muster wie `components/kontakt/kontakt-form.tsx`).
    setFieldErrors((prev) => (prev[field as GratisCheckFieldName] ? { ...prev, [field]: undefined } : prev))
  }

  function focusFirstInvalid(errors: Partial<Record<GratisCheckFieldName, string>>) {
    const first = FIELD_ORDER.find((name) => errors[name])
    if (first) document.getElementById(fieldId(first))?.focus()
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseGratisCheckValues(values)

    if (!parsed.success) {
      const errors = toFieldErrors(parsed.error.issues)
      setFieldErrors(errors)
      focusFirstInvalid(errors)
      return
    }

    setFieldErrors({})
    onValidSubmit(parsed.data)
  }

  const errorText = (key: GratisCheckFieldName) => {
    const errorKey = fieldErrors[key]
    return errorKey ? t(`errors.${errorKey}`) : undefined
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="rounded-lg border border-line bg-surface p-6 sm:p-8"
    >
      <div className="space-y-5">
        <FieldRow
          id={fieldId('annualConsumptionKwh')}
          label={t('fields.consumptionLabel')}
          error={errorText('annualConsumptionKwh')}
          hint={t('fields.consumptionHint')}
        >
          {(describedBy) => (
            <Input
              id={fieldId('annualConsumptionKwh')}
              name="annualConsumptionKwh"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              maxLength={12}
              className="tabular-nums"
              value={values.annualConsumptionKwh}
              onChange={(e) => set('annualConsumptionKwh', e.target.value)}
              aria-invalid={fieldErrors.annualConsumptionKwh ? true : undefined}
              aria-describedby={describedBy}
            />
          )}
        </FieldRow>

        {/*
          KRITISCH (§1.4/§5.3): der Hilfetext steht IMMER da, nicht erst nach
          einem Fehler — er soll den häufigsten Fehler VORHER verhindern.
          Prominenz kommt über Textgewicht (`<strong>`), nicht über Warnfarbe:
          DESIGN.md reserviert Bernstein für echte Warnungen, nicht für Dekor.
        */}
        <FieldRow
          id={fieldId('energyPriceCtPerKwh')}
          label={t('fields.priceLabel')}
          error={errorText('energyPriceCtPerKwh')}
          hint={t.rich('fields.priceHint', {
            strong: (chunks) => <strong className="font-semibold text-text">{chunks}</strong>,
          })}
        >
          {(describedBy) => (
            <Input
              id={fieldId('energyPriceCtPerKwh')}
              name="energyPriceCtPerKwh"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              maxLength={12}
              className="tabular-nums"
              value={values.energyPriceCtPerKwh}
              onChange={(e) => set('energyPriceCtPerKwh', e.target.value)}
              aria-invalid={fieldErrors.energyPriceCtPerKwh ? true : undefined}
              aria-describedby={describedBy}
            />
          )}
        </FieldRow>

        <FieldRow
          id={fieldId('baseFeeAmount')}
          label={t('fields.baseFeeLabel')}
          error={errorText('baseFeeAmount')}
          hint={t('fields.baseFeeHint')}
        >
          {(describedBy) => (
            <div className="flex gap-2">
              <Input
                id={fieldId('baseFeeAmount')}
                name="baseFeeAmount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                maxLength={12}
                className="tabular-nums"
                value={values.baseFeeAmount}
                onChange={(e) => set('baseFeeAmount', e.target.value)}
                aria-invalid={fieldErrors.baseFeeAmount ? true : undefined}
                aria-describedby={describedBy}
              />
              <Select
                aria-label={t('fields.baseFeeUnitLabel')}
                className="w-36 shrink-0"
                value={values.baseFeeUnit}
                onChange={(e) => set('baseFeeUnit', e.target.value as BaseFeeUnit)}
              >
                <option value="monthly">{t('fields.baseFeeUnitMonthly')}</option>
                <option value="annual">{t('fields.baseFeeUnitAnnual')}</option>
              </Select>
            </div>
          )}
        </FieldRow>

        <FieldRow
          id={fieldId('postalCode')}
          label={t('fields.postalCodeLabel')}
          error={errorText('postalCode')}
          hint={t('fields.postalCodeHint')}
        >
          {(describedBy) => (
            <Input
              id={fieldId('postalCode')}
              name="postalCode"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={4}
              className="max-w-[8rem] tabular-nums"
              value={values.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
              aria-invalid={fieldErrors.postalCode ? true : undefined}
              aria-describedby={describedBy}
            />
          )}
        </FieldRow>

        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
          <Button type="submit" variant="primary" size="lg">
            {t('submit')}
          </Button>
          <p className="text-caption text-text-muted">{t('requiredHint')}</p>
        </div>
      </div>
    </form>
  )
}
