/*
 * Herkunft einer Absendung (Leadgen 5): UTM-Parameter, Einstiegspfad und Referrer-Host. Rein und
 * isomorph — der Browser liest die Werte aus der aktuellen Adresse (`readAttributionFromLocation`),
 * der Server prüft und kürzt sie (`parseAttribution`). Nichts davon wird im Browser gespeichert:
 * wechselt der Besucher vor dem Absenden die Seite, ist die UTM verloren (bekannte Grenze).
 */

export const ATTRIBUTION_CHANNELS = ['schnellreport', 'profi_report', 'kontakt'] as const
export type AttributionChannel = (typeof ATTRIBUTION_CHANNELS)[number]

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const
type UtmKey = (typeof UTM_KEYS)[number]

/** Rohform, wie der Browser sie mitschickt — Schlüssel wie in der Adresse. */
export type RawAttribution = Partial<Record<UtmKey | 'landing_path' | 'referrer_host', string>>

export type Attribution = {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  landingPath: string | null
  referrerHost: string | null
}

/** Dieselben Grenzen wie die CHECKs in `platform.lead_attributions`. */
export const ATTRIBUTION_LIMITS = { utm: 100, path: 200, host: 253 } as const

export const EMPTY_ATTRIBUTION: Attribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  landingPath: null,
  referrerHost: null,
}

/**
 * Im Browser beim Absenden: UTM aus der Adresse, aktueller Pfad, Referrer NUR als Host — und nur,
 * wenn er von einer fremden Seite kommt (ein interner Verweis sagt nichts über die Herkunft).
 */
export function readAttributionFromLocation(
  location: { pathname: string; search: string; hostname: string },
  referrer: string,
): RawAttribution {
  const raw: RawAttribution = { landing_path: location.pathname }
  const params = new URLSearchParams(location.search)
  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) raw[key] = value
  }
  if (referrer) {
    try {
      const host = new URL(referrer).hostname
      if (host && host !== location.hostname) raw.referrer_host = host
    } catch {
      // Unlesbarer Referrer → keine Angabe.
    }
  }
  return raw
}

/** Für die Formulare: die Herkunft der laufenden Seite, im Augenblick des Absendens gelesen. */
export function currentAttribution(): RawAttribution | undefined {
  if (typeof window === 'undefined') return undefined
  return readAttributionFromLocation(window.location, document.referrer)
}

// Steuerzeichen machen einen Wert unbrauchbar; er wird verworfen statt bereinigt.
const CONTROL = /\p{Cc}/u
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

function cut(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join('') : value
}

function utmValue(raw: unknown): string | null {
  if (typeof raw !== 'string' || CONTROL.test(raw)) return null
  const value = raw.trim()
  return value ? cut(value, ATTRIBUTION_LIMITS.utm) : null
}

function pathValue(raw: unknown): string | null {
  if (typeof raw !== 'string' || CONTROL.test(raw)) return null
  const path = raw.trim().split(/[?#]/)[0]!
  if (!path.startsWith('/') || path.startsWith('//') || /\s/.test(path)) return null
  return cut(path, ATTRIBUTION_LIMITS.path)
}

function hostValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const host = raw.trim().toLowerCase()
  // Ein gekürzter Host wäre ein falscher — verworfen statt gekürzt.
  return HOSTNAME.test(host) ? host : null
}

/** Serverseitig: alles Unbrauchbare wird verworfen, Überlanges gekürzt. Wirft nie. */
export function parseAttribution(raw: unknown): Attribution {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_ATTRIBUTION
  const r = raw as Record<string, unknown>
  return {
    utmSource: utmValue(r.utm_source),
    utmMedium: utmValue(r.utm_medium),
    utmCampaign: utmValue(r.utm_campaign),
    utmContent: utmValue(r.utm_content),
    utmTerm: utmValue(r.utm_term),
    landingPath: pathValue(r.landing_path),
    referrerHost: hostValue(r.referrer_host),
  }
}

/** Wert der Zeile „Herkunft" in den Benachrichtigungen an energy@coolin.at. */
export function formatAttributionLine(a: Attribution): string {
  const origin = a.utmSource
    ? [a.utmSource, a.utmMedium ?? '–', a.utmCampaign ?? '–'].join('/')
    : a.referrerHost
      ? `Verweis ${a.referrerHost}`
      : 'direkt'
  return a.landingPath ? `${origin}, Einstieg ${a.landingPath}` : origin
}
