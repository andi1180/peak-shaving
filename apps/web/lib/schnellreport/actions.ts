'use server'

/*
 * Server Actions des Schnellreports (3b-2): Wortlaute laden und Telefonfrage. Die Absendung selbst
 * läuft über `POST /api/schnellreport` (`submit.ts`), weil nur eine eigene Route die PDF-Dateien
 * per `outputFileTracingIncludes` mitnimmt. Entscheidungen stehen in `flow.ts`.
 */
import { headers } from 'next/headers'
import { requireLeadTokenSecret } from '@/lib/env.server'
import { getSourceConsentText } from '@/lib/leads/store'
import { verifyCallbackTicket } from './callback-ticket'
import {
  SCHNELLREPORT_SOURCE_KEY,
  runSchnellreportCallback,
  type CallbackResponse,
  type CallbackSubmission,
} from './flow'
import { sendSchnellreportCallbackNotice } from './mail'
import { LOCALE, captureWith, requestMeta } from './wiring'

export type SchnellreportTexts = {
  delivery: string | null
  tips: string | null
  callback: string | null
}

/** Die Wortlaute, die `capture_lead` für diese Herkunft archiviert — angezeigt wird genau dieser. */
export async function loadSchnellreportTextsAction(): Promise<SchnellreportTexts> {
  try {
    const [delivery, tips, callback] = await Promise.all([
      getSourceConsentText('result_delivery', SCHNELLREPORT_SOURCE_KEY, LOCALE),
      getSourceConsentText('marketing_email', SCHNELLREPORT_SOURCE_KEY, LOCALE),
      getSourceConsentText('offer_contact', SCHNELLREPORT_SOURCE_KEY, LOCALE),
    ])
    return { delivery, tips, callback }
  } catch (cause) {
    console.error('[schnellreport] Wortlaute nicht lesbar:', cause)
    return { delivery: null, tips: null, callback: null }
  }
}

export async function requestSchnellreportCallbackAction(
  submission: CallbackSubmission,
): Promise<CallbackResponse> {
  const meta = requestMeta(await headers())
  return runSchnellreportCallback(submission, {
    verifyTicket: (email, ticket) => verifyCallbackTicket(requireLeadTokenSecret(), email, ticket),
    captureLead: captureWith(meta),
    sendCallbackNotice: sendSchnellreportCallbackNotice,
  })
}
