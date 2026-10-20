/*
 * Anfrage zum Profi-Report (Leadgen 4b) — der Ablauf. Rein: Datenbank und Mail kommen als Effekte
 * herein (Muster `lib/schnellreport/flow.ts`).
 *
 * Eine Anfrage ist eine erbetene Kontaktaufnahme: Lead auf Grundlage Vertragsanbahnung wie beim
 * Kontaktformular, ohne Einwilligungszeile und ohne Werbe-Einwilligung.
 */
import { parseAttribution, type Attribution } from '@/lib/attribution/attribution'
import type { CaptureResult } from '@/lib/leads/config'
import {
  parseProfiReport,
  type LoadProfileAnswer,
  type ProfiReportFieldErrors,
  type ProfiReportSubmission,
  type ProfiReportValues,
} from './request'

export const PROFI_REPORT_SOURCE_KEY = 'profi-report-anfrage'

/** Thema am Lead — derselbe Schlüssel wie im Kontaktformular (`lib/kontakt/themen.ts`). */
export const PROFI_REPORT_THEMA = 'profiReport'

/** Eine zweite Anfrage desselben Leads in diesem Fenster gilt als Doppelabsendung. */
export const DUPLICATE_WINDOW_SECONDS = 15 * 60

export type ProfiReportResponse =
  | { ok: true }
  | { ok: false; error: 'validation'; fieldErrors: ProfiReportFieldErrors }
  | { ok: false; error: 'duplicate' | 'spam' | 'turnstile' | 'unavailable' }

export type ProfiReportCaptureCall = {
  email: string
  company: string
  firstName: string
  lastName: string
  phone: string | null
  partnerSlug: string | null
  thema: string
}

export type ResolvedPartner = { slug: string; displayName: string }

export type ConfirmationStatus = 'sent' | 'failed' | 'suppressed'

export type ProfiReportNotice = {
  leadId: string
  values: ProfiReportValues
  partner: ResolvedPartner | null
  confirmation: ConfirmationStatus
  attribution: Attribution
}

export type ProfiReportEffects = {
  resolvePartner: (slug: string) => Promise<ResolvedPartner | null>
  captureLead: (call: ProfiReportCaptureCall) => Promise<CaptureResult>
  recordRequest: (
    leadId: string,
    hasLoadProfile: LoadProfileAnswer,
  ) => Promise<{ status: 'created' | 'duplicate' }>
  sendConfirmation: (values: ProfiReportValues) => Promise<{ ok: boolean }>
  sendTeamNotice: (notice: ProfiReportNotice) => Promise<unknown>
  recordAttribution: (leadId: string, attribution: Attribution) => Promise<unknown>
}

export async function runProfiReportRequest(
  submission: ProfiReportSubmission,
  effects: ProfiReportEffects,
): Promise<ProfiReportResponse> {
  if (typeof submission.website === 'string' && submission.website.trim() !== '') {
    console.warn('[profi-report] Honeypot gefüllt — abgelehnt.')
    return { ok: false, error: 'spam' }
  }

  const parsed = parseProfiReport(submission)
  if (!parsed.ok) return { ok: false, error: 'validation', fieldErrors: parsed.fieldErrors }
  const values = parsed.values
  const attribution = parseAttribution(submission.herkunft)

  let partner: ResolvedPartner | null = null
  if (values.partnerSlug) {
    try {
      partner = await effects.resolvePartner(values.partnerSlug)
    } catch (cause) {
      // Ein unauflösbarer Partner kostet keine Anfrage — sie entsteht dann ohne Zuordnung.
      console.error('[profi-report] Partner nicht auflösbar:', cause)
    }
  }

  let captured: CaptureResult
  try {
    captured = await effects.captureLead({
      email: values.email,
      company: values.firma,
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      partnerSlug: partner?.slug ?? null,
      thema: PROFI_REPORT_THEMA,
    })
    const recorded = await effects.recordRequest(captured.leadId, values.hasLoadProfile)
    if (recorded.status === 'duplicate') {
      console.info(`[profi-report] Doppelte Absendung (Lead ${captured.leadId}).`)
      return { ok: false, error: 'duplicate' }
    }
  } catch (cause) {
    console.error('[profi-report] Erfassung fehlgeschlagen:', cause)
    return { ok: false, error: 'unavailable' }
  }
  const leadId = captured.leadId

  // Eine gesperrte Adresse bekommt keine Mail, auch keine Bestätigung; die Anfrage zählt trotzdem.
  let confirmation: ConfirmationStatus = 'suppressed'
  if (captured.outcome !== 'suppressed') {
    try {
      confirmation = (await effects.sendConfirmation(values)).ok ? 'sent' : 'failed'
    } catch (cause) {
      confirmation = 'failed'
      console.error(`[profi-report] Bestätigungsmail fehlgeschlagen (Lead ${leadId}):`, cause)
    }
  }

  try {
    await effects.recordAttribution(leadId, attribution)
  } catch (cause) {
    console.error(`[profi-report] Herkunft nicht gespeichert (Lead ${leadId}):`, cause)
  }

  try {
    await effects.sendTeamNotice({ leadId, values, partner, confirmation, attribution })
  } catch (cause) {
    console.error(`[profi-report] Benachrichtigung fehlgeschlagen (Lead ${leadId}):`, cause)
  }

  return { ok: true }
}
