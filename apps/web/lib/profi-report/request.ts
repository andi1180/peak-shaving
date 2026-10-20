/*
 * Anfrage zum Profi-Report (Leadgen 4b) — Eingaben und Prüfung. Rein; läuft im Formular UND in der
 * Server Action, damit beide dieselben Fehler melden.
 */
import { normalizePhone } from '@/lib/schnellreport/request'

export const LOAD_PROFILE_ANSWERS = ['ja', 'nein', 'unsicher'] as const
export type LoadProfileAnswer = (typeof LOAD_PROFILE_ANSWERS)[number]

export type ProfiReportSubmission = {
  firma: string
  vorname: string
  nachname: string
  email: string
  telefon?: string
  lastgang?: string
  nachricht?: string
  website?: string
  turnstileToken?: string
  partnerSlug?: string
}

export type ProfiReportField =
  'firma' | 'vorname' | 'nachname' | 'email' | 'telefon' | 'lastgang' | 'nachricht'

export type ProfiReportErrorCode =
  'required' | 'tooLong' | 'emailInvalid' | 'phoneInvalid' | 'lastgangRequired'

export type ProfiReportFieldErrors = Partial<Record<ProfiReportField, ProfiReportErrorCode>>

export type ProfiReportValues = {
  firma: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  hasLoadProfile: LoadProfileAnswer
  message: string | null
  partnerSlug: string | null
}

export type ParsedProfiReport =
  { ok: true; values: ProfiReportValues } | { ok: false; fieldErrors: ProfiReportFieldErrors }

const MAX = { firma: 200, name: 100, email: 254, message: 4000 } as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG_RE = /^[a-z0-9-]+$/

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function isLoadProfileAnswer(value: unknown): value is LoadProfileAnswer {
  return (LOAD_PROFILE_ANSWERS as readonly unknown[]).includes(value)
}

export function parseProfiReport(submission: ProfiReportSubmission): ParsedProfiReport {
  const errors: ProfiReportFieldErrors = {}

  const firma = text(submission.firma)
  if (!firma) errors.firma = 'required'
  else if (firma.length > MAX.firma) errors.firma = 'tooLong'

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
  if (rawPhone && phone === null) errors.telefon = 'phoneInvalid'

  const lastgang = submission.lastgang
  if (!isLoadProfileAnswer(lastgang)) errors.lastgang = 'lastgangRequired'

  const message = text(submission.nachricht)
  if (message.length > MAX.message) errors.nachricht = 'tooLong'

  if (Object.keys(errors).length > 0 || !isLoadProfileAnswer(lastgang)) {
    return { ok: false, fieldErrors: errors }
  }

  // Ein formatverletzender Slug wird verworfen, nicht abgewiesen — die Anfrage zählt mehr.
  const slug = text(submission.partnerSlug).toLowerCase()

  return {
    ok: true,
    values: {
      firma,
      firstName,
      lastName,
      email,
      phone,
      hasLoadProfile: lastgang,
      message: message || null,
      partnerSlug: slug && SLUG_RE.test(slug) ? slug : null,
    },
  }
}
