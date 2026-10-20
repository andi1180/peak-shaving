/*
 * Schnellreport per E-Mail (Leadgen-Umbau Schritt 3b-2) — der Ablauf. Rein: Datenbank, Mail und
 * PDF kommen als Effekte herein (Muster `lib/leads/capture-flow.ts`), damit er ohne Stack prüfbar
 * ist. Die Server Action (`actions.ts`) ist nur Verdrahtung.
 *
 * Reihenfolge der Absendung:
 *   1. Lead + `result_delivery` (Herkunft 'schnellreport', Wortlaut herkunftsgebunden).
 *   2. Schnellcheck-Werte ablegen; gab es für den Lead im Fenster schon einen Report → Abbruch
 *      ohne zweiten Report.
 *   3. PDF rendern, Report-Mail senden (nur bei bestätigter Einwilligung, nie bei Sperre).
 *   4. Tipp-Mails angehakt → `marketing_email` mit Double-Opt-in. Der Report hängt NICHT daran.
 *   5. Herkunft dieser Absendung ablegen (Leadgen 5; Fehler kosten nichts) und interne
 *      Benachrichtigung.
 * Logs tragen nur die Lead-ID, nie Name oder Adresse.
 */
import { parseAttribution, type Attribution } from '@/lib/attribution/attribution'
import type { CaptureResult, ConsentPurpose } from '@/lib/leads/config'
import type { LeadIndustry } from '@/lib/leads/registry'
import type { BrancheKey } from './branchen'
import type { SchnellreportInput } from './content'
import {
  normalizePhone,
  parseSchnellreport,
  type SchnellreportFieldErrors,
  type SchnellreportSubmission,
  type SchnellreportValues,
} from './request'

export const SCHNELLREPORT_SOURCE_KEY = 'schnellreport'

/** Innerhalb dieses Fensters geht an dieselbe Adresse kein zweiter Report. */
export const DUPLICATE_WINDOW_SECONDS = 15 * 60

/*
 * Nur eindeutige Zuordnungen zum Branchen-Enum der Leads; die übrigen Report-Branchen umfassen
 * mehrere Enum-Werte und blieben sonst geraten. Die genaue Report-Branche steht in
 * `platform.schnellreport_requests`.
 */
export const LEAD_INDUSTRY_FOR_BRANCHE: Readonly<Record<BrancheKey, LeadIndustry | null>> = {
  produktion: null,
  lebensmittel: null,
  gastro: null,
  logistik: null,
  handel: 'handel',
  sonstige: 'sonstige',
}

export type SchnellreportResponse =
  | { ok: true; email: string; callbackTicket: string; phoneKnown: boolean }
  | { ok: false; error: 'validation'; fieldErrors: SchnellreportFieldErrors }
  | { ok: false; error: 'duplicate' | 'spam' | 'turnstile' | 'unavailable' }

export type SchnellreportCaptureCall = {
  email: string
  purpose: ConsentPurpose
  tokenHash?: string | null
  tokenExpiresAt?: Date | null
  company?: string
  firstName?: string
  lastName?: string
  phone?: string | null
  industry?: LeadIndustry | null
  annualConsumptionKwh?: number
  partnerSlug?: string | null
}

export type ReportMailStatus = 'sent' | 'failed' | 'suppressed'

export type ResolvedPartner = { slug: string; displayName: string }

export type TeamNotice = {
  leadId: string
  values: SchnellreportValues
  reportMail: ReportMailStatus
  /** Der bestätigte Fachbetrieb, falls die Absendung einen aktiven Partner-Slug trug. */
  partner: ResolvedPartner | null
  attribution: Attribution
}

export type SchnellreportEffects = {
  /** Unbekannter/inaktiver Slug oder Lesefehler → `null`; der Lead entsteht trotzdem. */
  resolvePartner: (slug: string) => Promise<ResolvedPartner | null>
  captureLead: (call: SchnellreportCaptureCall) => Promise<CaptureResult>
  recordRequest: (
    leadId: string,
    values: SchnellreportValues,
  ) => Promise<{ status: 'created' | 'duplicate' }>
  getConsentText: (purpose: ConsentPurpose) => Promise<string | null>
  createToken: () => { token: string; tokenHash: string; expiresAt: Date }
  sendConfirmationMail: (input: {
    to: string
    consentText: string
    token: string
  }) => Promise<unknown>
  renderPdf: (input: SchnellreportInput) => Promise<Buffer>
  sendReportMail: (input: {
    to: string
    values: SchnellreportValues
    pdf: Buffer
  }) => Promise<{ ok: boolean }>
  sendTeamNotice: (notice: TeamNotice) => Promise<unknown>
  recordAttribution: (leadId: string, attribution: Attribution) => Promise<unknown>
  signCallbackTicket: (email: string) => string
  now: () => Date
}

export async function runSchnellreportSubmit(
  submission: SchnellreportSubmission,
  effects: SchnellreportEffects,
): Promise<SchnellreportResponse> {
  if (typeof submission.website === 'string' && submission.website.trim() !== '') {
    console.warn('[schnellreport] Honeypot gefüllt — abgelehnt.')
    return { ok: false, error: 'spam' }
  }

  const parsed = parseSchnellreport(submission)
  if (!parsed.ok) return { ok: false, error: 'validation', fieldErrors: parsed.fieldErrors }
  const values = parsed.values
  const attribution = parseAttribution(submission.herkunft)
  const partner = values.partnerSlug ? await effects.resolvePartner(values.partnerSlug) : null

  let delivery: CaptureResult
  try {
    delivery = await effects.captureLead({
      email: values.email,
      purpose: 'result_delivery',
      company: values.firma,
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      industry: LEAD_INDUSTRY_FOR_BRANCHE[values.branche],
      annualConsumptionKwh: Math.round(values.kwh),
      partnerSlug: partner?.slug ?? null,
    })
    const recorded = await effects.recordRequest(delivery.leadId, values)
    if (recorded.status === 'duplicate') {
      console.info(
        `[schnellreport] Doppelte Absendung, kein zweiter Report (Lead ${delivery.leadId}).`,
      )
      return { ok: false, error: 'duplicate' }
    }
  } catch (cause) {
    console.error('[schnellreport] Erfassung fehlgeschlagen:', cause)
    return { ok: false, error: 'unavailable' }
  }

  const leadId = delivery.leadId
  let reportMail: ReportMailStatus = 'suppressed'
  if (delivery.outcome === 'consent_confirmed') {
    try {
      const pdf = await effects.renderPdf({
        country: values.country,
        kwh: values.kwh,
        kw: values.kw,
        sliderKw: values.sliderKw,
        bill: values.bill,
        firma: values.firma,
        branche: values.branche,
        createdAt: effects.now(),
      })
      const sent = await effects.sendReportMail({ to: values.email, values, pdf })
      reportMail = sent.ok ? 'sent' : 'failed'
    } catch (cause) {
      reportMail = 'failed'
      console.error(`[schnellreport] Report-Mail fehlgeschlagen (Lead ${leadId}):`, cause)
    }
  }

  if (values.tips) await requestTips(values.email, leadId, effects)

  try {
    await effects.recordAttribution(leadId, attribution)
  } catch (cause) {
    console.error(`[schnellreport] Herkunft nicht gespeichert (Lead ${leadId}):`, cause)
  }

  try {
    await effects.sendTeamNotice({ leadId, values, reportMail, partner, attribution })
  } catch (cause) {
    console.error(`[schnellreport] Benachrichtigung fehlgeschlagen (Lead ${leadId}):`, cause)
  }

  return {
    ok: true,
    email: values.email,
    callbackTicket: effects.signCallbackTicket(values.email),
    phoneKnown: values.phone !== null,
  }
}

async function requestTips(email: string, leadId: string, effects: SchnellreportEffects) {
  try {
    const confirmation = effects.createToken()
    const captured = await effects.captureLead({
      email,
      purpose: 'marketing_email',
      tokenHash: confirmation.tokenHash,
      tokenExpiresAt: confirmation.expiresAt,
    })
    // Nur eine neu angelegte, offene Einwilligung bekommt eine Bestätigungsmail.
    if (captured.outcome !== 'consent_created') return
    const consentText = await effects.getConsentText('marketing_email')
    if (!consentText) {
      console.error(`[schnellreport] Kein Wortlaut für die Bestätigungsmail (Lead ${leadId}).`)
      return
    }
    await effects.sendConfirmationMail({ to: email, consentText, token: confirmation.token })
  } catch (cause) {
    console.error(`[schnellreport] Tipp-Mail-Einwilligung fehlgeschlagen (Lead ${leadId}):`, cause)
  }
}

/* ─── Telefonfrage ─────────────────────────────────────────────────────────────────────────────── */

export type CallbackSubmission = { email: string; ticket: string; phone: string }

export type CallbackResponse = { ok: true } | { ok: false; error: 'phoneInvalid' | 'unavailable' }

export type CallbackEffects = {
  verifyTicket: (email: string, ticket: string) => boolean
  captureLead: (call: SchnellreportCaptureCall) => Promise<CaptureResult>
  sendCallbackNotice: (notice: { leadId: string; email: string; phone: string }) => Promise<unknown>
}

/** „Ja, gerne anrufen": Telefonnummer am Lead, `offer_contact`, Benachrichtigung „Rückruf gewünscht". */
export async function runSchnellreportCallback(
  submission: CallbackSubmission,
  effects: CallbackEffects,
): Promise<CallbackResponse> {
  const email = typeof submission.email === 'string' ? submission.email.trim() : ''
  if (!email || !effects.verifyTicket(email, submission.ticket)) {
    console.warn('[schnellreport] Rückruf ohne gültiges Ticket abgelehnt.')
    return { ok: false, error: 'unavailable' }
  }

  const phone = typeof submission.phone === 'string' ? normalizePhone(submission.phone) : null
  if (!phone) return { ok: false, error: 'phoneInvalid' }

  let leadId: string
  try {
    const captured = await effects.captureLead({ email, purpose: 'offer_contact', phone })
    leadId = captured.leadId
  } catch (cause) {
    console.error('[schnellreport] Rückruf-Einwilligung fehlgeschlagen:', cause)
    return { ok: false, error: 'unavailable' }
  }

  try {
    await effects.sendCallbackNotice({ leadId, email, phone })
  } catch (cause) {
    console.error(
      `[schnellreport] Rückruf-Benachrichtigung fehlgeschlagen (Lead ${leadId}):`,
      cause,
    )
  }
  return { ok: true }
}
