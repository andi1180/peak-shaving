'use server'

/*
 * Server Action der Profi-Report-Anfrage (Leadgen 4b) — nur Verdrahtung; die Entscheidungen trifft
 * `flow.ts`. Partnerzuordnung über dieselbe Auflösung wie Kontaktformular und Schnellreport.
 */
import { headers } from 'next/headers'
import { verifyTurnstile } from '@/lib/kontakt/turnstile'
import { resolvePartnerAttribution } from '@/lib/leads/capture'
import { captureLead, recordLeadAttribution, recordProfiReportRequest } from '@/lib/leads/store'
import { requestMeta } from '@/lib/schnellreport/wiring'
import {
  DUPLICATE_WINDOW_SECONDS,
  PROFI_REPORT_SOURCE_KEY,
  runProfiReportRequest,
  type ProfiReportResponse,
} from './flow'
import { sendProfiReportConfirmation, sendProfiReportNotice } from './mail'
import type { ProfiReportSubmission } from './request'

export async function submitProfiReportAction(
  submission: ProfiReportSubmission,
): Promise<ProfiReportResponse> {
  const meta = requestMeta(await headers())
  const turnstile = await verifyTurnstile(submission.turnstileToken, meta.sourceIp ?? undefined)
  if (!turnstile.ok) return { ok: false, error: 'turnstile' }

  return runProfiReportRequest(submission, {
    resolvePartner: async (slug) => {
      const attribution = await resolvePartnerAttribution({ querySlug: slug })
      return attribution.partnerSlug && attribution.partnerDisplayName
        ? { slug: attribution.partnerSlug, displayName: attribution.partnerDisplayName }
        : null
    },
    captureLead: (call) =>
      captureLead({
        ...call,
        sourceKey: PROFI_REPORT_SOURCE_KEY,
        sourceIp: meta.sourceIp,
        userAgent: meta.userAgent,
        locale: 'de',
      }),
    recordRequest: (leadId, hasLoadProfile) =>
      recordProfiReportRequest({ leadId, hasLoadProfile, windowSeconds: DUPLICATE_WINDOW_SECONDS }),
    sendConfirmation: sendProfiReportConfirmation,
    sendTeamNotice: sendProfiReportNotice,
    recordAttribution: (leadId, attribution) =>
      recordLeadAttribution(leadId, 'profi_report', attribution),
  })
}
