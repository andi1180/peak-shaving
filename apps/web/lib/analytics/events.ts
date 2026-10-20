/*
 * Funnel-Ereignisse für PostHog (Leadgen 5). Die Instanz bleibt die cookielose aus
 * `components/analytics/posthog.tsx` (Autocapture aus, keine Aufzeichnung); sie meldet sich nach
 * dem Init hier an. Ohne Key meldet sich nie jemand an, und `track` bleibt folgenlos.
 *
 * Keine personenbezogenen Daten: Die Eigenschaften sind ausschliesslich Aufzählungswerte, Wahrheits-
 * werte und Seitennummern — kein Name, keine Adresse, kein exakter Verbrauch (nur `kwh_band`).
 */
import type { Country } from '@/lib/schnellcheck'
import type { LoadProfileAnswer } from '@/lib/profi-report/request'
import { PARTNER_QUERY_PARAM } from '@/lib/leads/partner'

export type KwhBand = '<100k' | '100-250k' | '250-500k' | '500k-1M' | '>1M'

export function kwhBand(kwh: number): KwhBand {
  if (kwh < 100_000) return '<100k'
  if (kwh < 250_000) return '100-250k'
  if (kwh < 500_000) return '250-500k'
  if (kwh <= 1_000_000) return '500k-1M'
  return '>1M'
}

type NoProps = Record<string, never>

export type AnalyticsEvents = {
  cta_ersparnis_click: { position: 'header' | 'hero' | 'bottombar' }
  cta_profi_report_click: {
    position: 'header' | 'bottombar'
    variant: 'profi_report' | 'jetzt_anfragen'
  }
  schnellcheck_started: { country: Country }
  schnellcheck_result_shown: {
    country: Country
    kwh_band: KwhBand
    has_kw: boolean
    has_bill: boolean
  }
  schnellreport_form_opened: NoProps
  schnellreport_submitted: { country: Country; tips_optin: boolean }
  callback_requested: NoProps
  profi_report_beispiel_page: { page: number }
  profi_report_pdf_opened: NoProps
  profi_report_request_submitted: { lastgang: LoadProfileAnswer }
}

export type AnalyticsEventName = keyof AnalyticsEvents

export type CommonProps = { path: string; partner: boolean }

/** `partner`: Partner-Landingpage oder `?partner=` in der Adresse — nur ob, nie welcher. */
export function commonProps(location: { pathname: string; search: string }): CommonProps {
  const onPartnerPage = /^(?:\/[a-z]{2})?\/partner\/[^/]+/.test(location.pathname)
  const viaQuery = new URLSearchParams(location.search).has(PARTNER_QUERY_PARAM)
  return { path: location.pathname, partner: onPartnerPage || viaQuery }
}

export type AnalyticsClient = { capture: (event: string, properties: object) => unknown }

let client: AnalyticsClient | null = null
// Ereignisse vor dem Init (der PostHog-Chunk lädt nach der Hydration) — begrenzt.
const pending: Array<[string, object]> = []
const PENDING_MAX = 20

export function registerAnalyticsClient(next: AnalyticsClient | null): void {
  client = next
  if (!client) return
  for (const [event, properties] of pending.splice(0)) client.capture(event, properties)
}

export function track<N extends AnalyticsEventName>(
  event: N,
  ...props: AnalyticsEvents[N] extends NoProps ? [] : [AnalyticsEvents[N]]
): void {
  if (typeof window === 'undefined') return
  const properties = { ...commonProps(window.location), ...props[0] }
  if (client) client.capture(event, properties)
  else if (pending.length < PENDING_MAX) pending.push([event, properties])
}
