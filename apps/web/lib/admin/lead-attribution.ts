/*
 * Herkunft und Profi-Report-Anfragen eines Leads für die Admin-Detailseite (Leadgen 5). Rein: liest
 * die Rückgaben von `public.admin_get_lead_attribution` und `admin_list_profi_report_requests`.
 */
import {
  ATTRIBUTION_CHANNELS,
  type Attribution,
  type AttributionChannel,
} from '@/lib/attribution/attribution'
import { LOAD_PROFILE_ANSWERS, type LoadProfileAnswer } from '@/lib/profi-report/request'

export type AttributionTouch = Attribution & { createdAt: string }
export type AttributionRequest = AttributionTouch & { id: string; channel: AttributionChannel }
export type LeadAttribution = { firstTouch: AttributionTouch | null; touches: AttributionRequest[] }
export type ProfiReportRequestRow = {
  id: string
  createdAt: string
  hasLoadProfile: LoadProfileAnswer
}

const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

function readTouch(raw: unknown): AttributionTouch | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.created_at !== 'string') return null
  return {
    createdAt: r.created_at,
    utmSource: str(r.utm_source),
    utmMedium: str(r.utm_medium),
    utmCampaign: str(r.utm_campaign),
    utmContent: str(r.utm_content),
    utmTerm: str(r.utm_term),
    landingPath: str(r.landing_path),
    referrerHost: str(r.referrer_host),
  }
}

export function readLeadAttribution(data: unknown): LeadAttribution {
  if (data === null || typeof data !== 'object') return { firstTouch: null, touches: [] }
  const obj = data as Record<string, unknown>
  const touches: AttributionRequest[] = []
  for (const raw of Array.isArray(obj.touches) ? obj.touches : []) {
    const touch = readTouch(raw)
    const r = raw as Record<string, unknown>
    const channel = ATTRIBUTION_CHANNELS.find((c) => c === r.channel)
    if (touch && channel && typeof r.id === 'string') touches.push({ ...touch, id: r.id, channel })
  }
  return { firstTouch: readTouch(obj.first_touch), touches }
}

export function readProfiReportRequests(data: unknown): ProfiReportRequestRow[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const answer = LOAD_PROFILE_ANSWERS.find((a) => a === r.has_load_profile)
    return typeof r.id === 'string' && typeof r.created_at === 'string' && answer
      ? [{ id: r.id, createdAt: r.created_at, hasLoadProfile: answer }]
      : []
  })
}
