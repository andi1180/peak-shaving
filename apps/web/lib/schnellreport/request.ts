/*
 * Schnellreport per E-Mail (Leadgen-Umbau Schritt 3b-2) — die Prüfregel für Formular und Server
 * Action. Rein und clientseitig nutzbar: das Formular zeigt dieselben Feldmeldungen sofort, der
 * Server prüft mit derselben Regel nach.
 *
 * Die Rechenwerte kommen NIE vom Client: übernommen werden nur die Eingaben des Schnellchecks, das
 * Ergebnis rechnet `computeSchnellcheck` hier neu.
 */
import {
  KW_SLIDER,
  computeSchnellcheck,
  type Country,
  type SchnellcheckResult,
} from '@/lib/schnellcheck'
import { isBrancheKey, type BrancheKey } from './branchen'

export type SchnellcheckValues = {
  country: string
  kwh: number | null
  kw: number | null
  bill: number | null
  sliderKw: number
}

export type SchnellreportSubmission = {
  firma: string
  branche: string
  vorname: string
  nachname: string
  email: string
  telefon?: string
  /** Optionale Tipp-Mails (marketing_email mit Double-Opt-in). Nie vorausgewählt. */
  tips: boolean
  check: SchnellcheckValues
  /** Honeypot. */
  website?: string
  turnstileToken?: string
  partnerSlug?: string
}

export type SchnellreportField =
  'firma' | 'branche' | 'vorname' | 'nachname' | 'email' | 'telefon' | 'kwh'

export type SchnellreportErrorCode =
  'required' | 'tooLong' | 'emailInvalid' | 'phoneInvalid' | 'brancheRequired' | 'kwhRequired'

export type SchnellreportFieldErrors = Partial<Record<SchnellreportField, SchnellreportErrorCode>>

export type SchnellreportValues = {
  firma: string
  branche: BrancheKey
  firstName: string
  lastName: string
  email: string
  phone: string | null
  tips: boolean
  country: Country
  kwh: number
  kw: number | null
  bill: number | null
  sliderKw: number
  result: SchnellcheckResult
  partnerSlug: string | null
}

export type ParsedSchnellreport =
  { ok: true; values: SchnellreportValues } | { ok: false; fieldErrors: SchnellreportFieldErrors }

const MAX = { firma: 200, name: 100, email: 254, phone: 60 } as const

// Obergrenzen gegen unsinnige Werte; die Spalten sind `integer`.
const MAX_KWH = 1_000_000_000
const MAX_KW = 1_000_000
const MAX_BILL = 1_000_000_000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Telefonnummer: Ziffern, Leerzeichen, + / ( ) -, mindestens sechs Ziffern. `null` = ungültig. */
export function normalizePhone(raw: string): string | null {
  const value = raw.trim()
  if (!/^\+?[\d\s/()-]+$/.test(value)) return null
  if ((value.match(/\d/g) ?? []).length < 6) return null
  return value.length > MAX.phone ? null : value
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function positive(raw: unknown, max: number): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= max ? raw : null
}

function sliderValue(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return KW_SLIDER.initial
  return Math.min(KW_SLIDER.max, Math.max(KW_SLIDER.min, raw))
}

export function parseSchnellreport(submission: SchnellreportSubmission): ParsedSchnellreport {
  const errors: SchnellreportFieldErrors = {}

  const firma = text(submission.firma)
  if (!firma) errors.firma = 'required'
  else if (firma.length > MAX.firma) errors.firma = 'tooLong'

  const branche = submission.branche
  if (!isBrancheKey(branche)) errors.branche = 'brancheRequired'

  const firstName = text(submission.vorname)
  if (!firstName) errors.vorname = 'required'
  else if (firstName.length > MAX.name) errors.vorname = 'tooLong'

  const lastName = text(submission.nachname)
  if (!lastName) errors.nachname = 'required'
  else if (lastName.length > MAX.name) errors.nachname = 'tooLong'

  const email = text(submission.email)
  if (!email) errors.email = 'required'
  else if (email.length > MAX.email) errors.email = 'tooLong'
  else if (!EMAIL_RE.test(email)) errors.email = 'emailInvalid'

  const rawPhone = text(submission.telefon)
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) errors.telefon = 'phoneInvalid'

  const check = submission.check ?? ({} as SchnellcheckValues)
  const country: Country = check.country === 'DE' ? 'DE' : 'AT'
  const kwh = positive(check.kwh, MAX_KWH)
  if (kwh === null) errors.kwh = 'kwhRequired'
  const kw = positive(check.kw, MAX_KW)
  const bill = positive(check.bill, MAX_BILL)
  const sliderKw = sliderValue(check.sliderKw)

  const result = kwh === null ? null : computeSchnellcheck({ country, kwh, kw, bill, sliderKw })

  if (Object.keys(errors).length > 0 || !result || kwh === null || !isBrancheKey(branche)) {
    return { ok: false, fieldErrors: errors }
  }

  const partnerSlug = text(submission.partnerSlug)
  return {
    ok: true,
    values: {
      firma,
      branche,
      firstName,
      lastName,
      email,
      phone,
      tips: submission.tips === true,
      country,
      kwh,
      kw,
      bill,
      sliderKw,
      result,
      partnerSlug: partnerSlug || null,
    },
  }
}
