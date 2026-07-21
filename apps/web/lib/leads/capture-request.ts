/**
 * Die PRÜFUNG einer Erfassungs-Absendung (B3-2) — abgeleitet aus der Registry, nicht je Seite von
 * Hand geschrieben.
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Dadurch prüft das Formular im Browser
 * mit exakt derselben Regel, mit der die Server Action nachprüft (Muster wie
 * `lib/kontakt/schema.ts`): der Client prüft für die Rückmeldung, der Server für die Wahrheit — aber
 * es gibt nur eine Regel.
 *
 * FEHLERTEXTE SIND KEYS, KEINE SÄTZE (§8.7, wie im Kontaktformular): `emailInvalid`,
 * `fieldRequired`, … Die UI löst sie über `LeadCapture.errors.<key>` auf; serverseitig gibt es
 * ohnehin keinen Locale-Kontext an dieser Stelle.
 */

import { z } from 'zod'
import {
  LEAD_FIELDS,
  LEAD_INDUSTRY_VALUES,
  findLeadCaptureEntry,
  type LeadCaptureEntry,
  type LeadFieldKey,
} from './registry'

/* ─── Werte einer Absendung ───────────────────────────────────────────────────────────────────── */

export type LeadCaptureValues = Partial<Record<LeadFieldKey, string>>

/** Die drei Rohwerte des Schnellrechners. Der Server rechnet daraus selbst nach. */
export const calculatorInputSchema = z.object({
  peakKw: z.number().finite().min(0),
  reductionKw: z.number().finite().min(0),
  pricePerKwYear: z.number().finite().min(0),
})

export type CalculatorInput = z.infer<typeof calculatorInputSchema>

/**
 * Der Contract zwischen Formular und Server Action.
 *
 * ES GIBT KEIN `purpose`-FELD. Das ist die zentrale Eigenschaft dieses Typs, nicht ein Versehen:
 * der Zweck kommt ausschliesslich aus der Registry (s. `capture-flow.ts`).
 */
export type LeadCaptureSubmission = {
  sourceKey: string
  values: LeadCaptureValues
  /** Zusätzliche Marketing-Einwilligung — nur wirksam, wo der Eintrag sie überhaupt anbietet. */
  marketing?: boolean
  /** Honeypot (s. `components/leads/lead-capture-form.tsx`). */
  website?: string
  turnstileToken?: string
  calculator?: CalculatorInput
}

/* ─── Feldregeln ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Die Prüfregel je Eingabeart. Sie spiegelt bewusst die CHECKs der Datenbank (B3-1): PLZ genau vier
 * Ziffern, Jahresverbrauch > 0. Eine laxere Regel hier hiesse, dass der Nutzer statt einer
 * Feldmeldung einen abgebrochenen Vorgang bekäme — die Datenbank lehnt ab, und zwar hart.
 */
function ruleFor(key: LeadFieldKey): z.ZodType<string> {
  const descriptor = LEAD_FIELDS[key]
  const max = descriptor.maxLength ?? 200

  switch (descriptor.kind) {
    case 'email':
      return z.string().trim().email('emailInvalid').max(max, 'tooLong')
    case 'postalCode':
      // Vier Ziffern — exakt der DB-CHECK. „1100 Wien", „A-1100" und „110" werden abgelehnt.
      return z.string().trim().regex(/^\d{4}$/, 'postalCodeInvalid')
    case 'kwh':
      // Ganzzahl > 0 (die Spalte ist `integer` mit CHECK > 0). Punkte/Leerzeichen als
      // Tausendertrenner werden vorher entfernt (s. `normalizeValue`).
      return z.string().trim().regex(/^[1-9]\d*$/, 'consumptionInvalid')
    case 'date':
      // ISO-Datum aus `<input type="date">`. Kein Bereichs-Check: ein Vertragsende in der
      // Vergangenheit ist eine Angabe, kein Eingabefehler — es zu verwerfen hiesse, jemanden mit
      // gerade ausgelaufenem Vertrag abzuweisen.
      return z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateInvalid')
    case 'industry':
      return z.enum(LEAD_INDUSTRY_VALUES, { errorMap: () => ({ message: 'industryInvalid' }) })
    default:
      return z.string().trim().min(1, 'fieldRequired').max(max, 'tooLong')
  }
}

/**
 * Tausendertrenner fallen weg, bevor geprüft wird — Punkt und jede Art Leerzeichen.
 *
 * `\s` deckt auch das GESCHÜTZTE Leerzeichen (U+00A0) und das schmale (U+202F) ab, und genau die
 * kommen hier vor: `Intl` gruppiert blanke Zahlen im deutschen Format damit, und wer eine Zahl aus
 * einer Rechnung kopiert, bringt sie mit. Ohne diese Zeile wäre eine so gruppierte Zahl eine
 * ungültige Eingabe — für den Absender unerklärlich, weil er nur Ziffern sieht.
 */
function normalizeValue(key: LeadFieldKey, raw: string): string {
  if (LEAD_FIELDS[key].kind === 'kwh') return raw.replace(/[.\s]/g, '')
  return raw.trim()
}

/**
 * Das zod-Schema EINES Eintrags — vollständig aus seinen `fields` abgeleitet.
 *
 * Optionale Felder sind `''`-tolerant: ein leer gelassenes Feld ist „nicht angegeben" und kein
 * Fehler. Es wird als `undefined` weitergereicht, damit `capture_lead` seine
 * COALESCE-Zusammenführung anwenden kann (B3-1: null lässt Bestehendes unberührt) — ein
 * durchgereichter Leerstring täte das nicht.
 */
export function schemaForEntry(entry: LeadCaptureEntry) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of entry.fields) {
    const rule = ruleFor(field.key)
    shape[field.key] = field.required
      ? z.string().trim().min(1, 'fieldRequired').pipe(rule)
      : z.union([z.literal(''), rule]).optional()
  }
  return z.object(shape)
}

export type LeadFieldErrors = Partial<Record<LeadFieldKey, string>>

export type ParsedLeadCapture =
  | { ok: true; entry: LeadCaptureEntry; values: LeadCaptureValues; marketing: boolean }
  | { ok: false; reason: 'unknown_source' }
  | { ok: false; reason: 'validation'; entry: LeadCaptureEntry; fieldErrors: LeadFieldErrors }

/**
 * Prüft eine Absendung gegen den Eintrag ihres Einstiegspunkts.
 *
 * Ein unbekannter Einstiegspunkt endet hier — ohne Ersatzwert und ohne Feldprüfung: es gibt keinen
 * Eintrag, gegen den geprüft werden könnte, und ein „nimm halt den Standard" schriebe den Lead unter
 * einer falschen Herkunft in den Bestand.
 */
export function parseLeadCapture(submission: LeadCaptureSubmission): ParsedLeadCapture {
  const entry = findLeadCaptureEntry(submission.sourceKey)
  if (!entry) return { ok: false, reason: 'unknown_source' }

  const raw: Record<string, string> = {}
  for (const field of entry.fields) {
    const value = submission.values?.[field.key]
    raw[field.key] = normalizeValue(field.key, typeof value === 'string' ? value : '')
  }

  const parsed = schemaForEntry(entry).safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: LeadFieldErrors = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key !== 'string') continue
      const fieldKey = key as LeadFieldKey
      // Der ERSTE Fehler je Feld gewinnt — ein Feld zeigt eine Meldung, nicht deren drei.
      if (fieldErrors[fieldKey]) continue
      fieldErrors[fieldKey] = issue.message
    }
    return { ok: false, reason: 'validation', entry, fieldErrors }
  }

  const values: LeadCaptureValues = {}
  for (const field of entry.fields) {
    const value = (parsed.data as Record<string, string | undefined>)[field.key]
    if (typeof value === 'string' && value !== '') values[field.key] = value
  }

  return {
    ok: true,
    entry,
    values,
    /*
     * Die Ankreuzmöglichkeit wirkt NUR, wo der Eintrag sie anbietet. Ein `marketing: true` an einem
     * Einstiegspunkt, der den Marketing-Wortlaut nie angezeigt hat, wäre ein Nachweis über einen
     * Text, den niemand gesehen hat — also wertlos. Deshalb wird der Wert hier verworfen und nicht
     * etwa als Fehler gemeldet: ein manipulierter Aufruf soll nichts bewirken, nicht auffallen.
     */
    marketing: entry.offersMarketingConsent && submission.marketing === true,
  }
}
