/**
 * Formular-Schema des Gratis-Checks (Stufe 1, §5.1) — EINE Wahrheit für
 * Zahlen-Parsing + Pflichtfeld-Prüfung. Rein clientseitig (§10, dataless):
 * anders als `lib/kontakt/schema.ts` gibt es hier keine Server-Route, die
 * dasselbe Schema noch einmal anwendet — der Gratis-Check verlässt den
 * Browser nie.
 *
 * FEHLERTEXTE SIND KEYS, KEINE SÄTZE (Muster wie `lib/kontakt/schema.ts`) —
 * die Wortwahl steht in `messages/de.json` unter `Monitor.GratisCheck.errors`.
 */
import { z } from 'zod'
import type { UserTariffInput } from 'tariff-monitor'

export type BaseFeeUnit = 'monthly' | 'annual'

/** Die vier Rohfelder des Formulars, noch als Text (kontrollierter Eingabe-Zustand). */
export type GratisCheckRawValues = {
  annualConsumptionKwh: string
  energyPriceCtPerKwh: string
  baseFeeAmount: string
  baseFeeUnit: BaseFeeUnit
  postalCode: string
}

export const EMPTY_GRATIS_CHECK_VALUES: GratisCheckRawValues = {
  annualConsumptionKwh: '',
  energyPriceCtPerKwh: '',
  baseFeeAmount: '',
  baseFeeUnit: 'monthly',
  postalCode: '',
}

/**
 * de-AT-Zahlen-Eingabe: Komma = Dezimaltrenner (Muster wie
 * `components/quick-calculator.tsx:parseField` — dieselbe Ambiguitäts-Regel:
 * ohne Komma gilt ein einzelner Punkt als Dezimaltrenner, „1.500" wird also
 * als 1,5 gelesen). Leere/kaputte Eingabe → `NaN`, damit `z.number()` sie
 * einheitlich über `invalid_type_error` ablehnt statt über einen eigenen
 * „leer"-Sonderfall.
 */
export function parseDecimalInput(raw: string): number {
  const trimmed = raw.trim()
  if (trimmed === '') return NaN
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed
  return Number(normalized)
}

/** Positive Pflichtzahl, EIN Fehler-Key für „fehlt" UND „ungültig" (kein toter Zweig). */
function positiveNumber(messageKey: string) {
  return z
    .number({ required_error: messageKey, invalid_type_error: messageKey })
    .positive({ message: messageKey })
}

export const gratisCheckSchema = z.object({
  annualConsumptionKwh: positiveNumber('verbrauchInvalid'),
  energyPriceCtPerKwh: positiveNumber('energiepreisInvalid'),
  baseFeeAmount: positiveNumber('grundgebuehrInvalid'),
  baseFeeUnit: z.enum(['monthly', 'annual']),
  // AT-PLZ-Grundform: genau 4 Ziffern. `min(1)` zuerst, damit ein leeres Feld
  // als „fehlt" statt als „falsches Format" gemeldet wird.
  postalCode: z.string().trim().min(1, 'plzRequired').regex(/^\d{4}$/, 'plzInvalid'),
})

export type GratisCheckValues = z.infer<typeof gratisCheckSchema>
export type GratisCheckFieldName = keyof GratisCheckRawValues

/** Rohe Text-Werte → geprüfter Zahlen-/Enum-Kandidat für `gratisCheckSchema`. */
export function parseGratisCheckValues(raw: GratisCheckRawValues) {
  return gratisCheckSchema.safeParse({
    annualConsumptionKwh: parseDecimalInput(raw.annualConsumptionKwh),
    energyPriceCtPerKwh: parseDecimalInput(raw.energyPriceCtPerKwh),
    baseFeeAmount: parseDecimalInput(raw.baseFeeAmount),
    baseFeeUnit: raw.baseFeeUnit,
    postalCode: raw.postalCode,
  })
}

/**
 * zod-Issues → `{ feld: fehlerKey }`. Der ERSTE Fehler je Feld gewinnt (Muster
 * wie `lib/kontakt/schema.ts:toFieldErrors`): ein Feld zeigt eine Meldung.
 */
export function toFieldErrors(issues: z.ZodIssue[]): Partial<Record<GratisCheckFieldName, string>> {
  const errors: Partial<Record<GratisCheckFieldName, string>> = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') continue
    const key = field as GratisCheckFieldName
    if (errors[key]) continue
    errors[key] = issue.message
  }
  return errors
}

/**
 * Grundgebühr intern IMMER auf €/Jahr normalisiert (Aufgabe 1) — die Engine
 * (`UserTariffInput.baseFeeEurPerYear`, §5.1) kennt keine Monatsangabe.
 */
export function toUserTariffInput(values: GratisCheckValues): UserTariffInput {
  return {
    annualConsumptionKwh: values.annualConsumptionKwh,
    energyPriceCtPerKwh: values.energyPriceCtPerKwh,
    baseFeeEurPerYear:
      values.baseFeeUnit === 'monthly' ? values.baseFeeAmount * 12 : values.baseFeeAmount,
    postalCode: values.postalCode,
  }
}
