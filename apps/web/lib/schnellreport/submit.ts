import 'server-only'
import { requireLeadTokenSecret } from '@/lib/env.server'
import { verifyTurnstile } from '@/lib/kontakt/turnstile'
import { CONFIRM_TOKEN_PARAM, EINWILLIGUNG_BESTAETIGEN_HREF } from '@/lib/leads/config'
import { sendConsentConfirmationMail } from '@/lib/leads/mail'
import { getSourceConsentText, recordSchnellreportRequest } from '@/lib/leads/store'
import { createConfirmationToken } from '@/lib/leads/tokens'
import { absoluteUrl } from '@/lib/site'
import { createCallbackTicket } from './callback-ticket'
import {
  DUPLICATE_WINDOW_SECONDS,
  SCHNELLREPORT_SOURCE_KEY,
  runSchnellreportSubmit,
  type SchnellreportResponse,
} from './flow'
import { sendSchnellreportMail, sendSchnellreportTeamNotice } from './mail'
import { renderSchnellreportPdf } from './render'
import type { SchnellreportSubmission } from './request'
import { LOCALE, captureWith, type RequestMeta } from './wiring'

/** Absendung des Schnellreport-Formulars — Verdrahtung für `POST /api/schnellreport`. */
export async function handleSchnellreportSubmit(
  submission: SchnellreportSubmission,
  meta: RequestMeta,
): Promise<SchnellreportResponse> {
  // Bot-Schutz wie im Kontaktformular: Turnstile hier, Honeypot im Ablauf.
  const turnstile = await verifyTurnstile(submission.turnstileToken, meta.sourceIp ?? undefined)
  if (!turnstile.ok) return { ok: false, error: 'turnstile' }

  return runSchnellreportSubmit(submission, {
    captureLead: captureWith(meta),
    recordRequest: (leadId, values) =>
      recordSchnellreportRequest({
        leadId,
        country: values.country,
        branche: values.branche,
        annualKwh: values.kwh,
        peakKw: values.result.kw,
        peakKwEntered: values.result.kwFromInput,
        billEur: values.bill,
        demandPriceEurPerKw: values.result.demandPrice,
        peakCostEur: values.result.peakCostEur,
        tipsRequested: values.tips,
        windowSeconds: DUPLICATE_WINDOW_SECONDS,
      }),
    getConsentText: (purpose) => getSourceConsentText(purpose, SCHNELLREPORT_SOURCE_KEY, LOCALE),
    createToken: () => createConfirmationToken(),
    sendConfirmationMail: ({ to, consentText, token }) =>
      sendConsentConfirmationMail({
        to,
        consentText,
        confirmUrl: absoluteUrl(
          `${EINWILLIGUNG_BESTAETIGEN_HREF}?${CONFIRM_TOKEN_PARAM}=${encodeURIComponent(token)}`,
        ),
        locale: LOCALE,
      }),
    renderPdf: (input) => renderSchnellreportPdf(input),
    sendReportMail: sendSchnellreportMail,
    sendTeamNotice: sendSchnellreportTeamNotice,
    signCallbackTicket: (email) => createCallbackTicket(requireLeadTokenSecret(), email),
    now: () => new Date(),
  })
}
