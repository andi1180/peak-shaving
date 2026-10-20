import 'server-only'
import { captureLead } from '@/lib/leads/store'
import { SCHNELLREPORT_SOURCE_KEY, type SchnellreportCaptureCall } from './flow'

export const LOCALE = 'de'

export type RequestMeta = { sourceIp: string | null; userAgent: string | null }

/** Nachweisfelder der Einwilligung; erster Eintrag von `x-forwarded-for` wie im Kontaktformular. */
export function requestMeta(headers: Headers): RequestMeta {
  return {
    sourceIp: headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headers.get('user-agent'),
  }
}

/** `capture_lead` mit fester Herkunft 'schnellreport'. */
export function captureWith(meta: RequestMeta) {
  return (call: SchnellreportCaptureCall) =>
    captureLead({
      ...call,
      sourceKey: SCHNELLREPORT_SOURCE_KEY,
      sourceIp: meta.sourceIp,
      userAgent: meta.userAgent,
      locale: LOCALE,
    })
}
