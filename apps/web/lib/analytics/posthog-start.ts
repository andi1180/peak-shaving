import type { AnalyticsClient } from './events'
import { INTERN_HREF, isInternalDevice, type DeviceStorage } from './internal-device'

/**
 * Init-Optionen und Startentscheidung der PostHog-Instanz — aus `components/analytics/posthog.tsx`
 * herausgezogen, damit beides ohne Renderer testbar ist. Begründung der Architektur (cookielos,
 * EU-Host, dynamischer Import): Dateikopf dort.
 */
export function posthogInitOptions(apiHost: string) {
  return {
    api_host: apiHost,

    // Der Kern der Entscheidung, s. Dateikopf in posthog.tsx. Nie Cookies, nie Web-Storage.
    cookieless_mode: 'always',

    /*
     * SPA-SEITENWECHSEL ZÄHLEN — ohne diesen Wert wäre die Statistik falsch.
     * Der App Router wechselt die Seite client-seitig über `history.pushState`;
     * ein `load`-Event gibt es dabei nicht. Der Default `true` zählt nur echte
     * Dokument-Ladevorgänge und würde jede Folgeseite einer Sitzung verschlucken.
     * `'history_change'` hängt sich an die History-API und erfasst genau diese
     * Wechsel — nachgemessen, nicht angenommen (s. Bericht).
     */
    capture_pageview: 'history_change',

    /*
     * Ausdrücklich statt des Defaults `'if_capture_pageview'`: der hinge sonst still an
     * `capture_pageview` und fiele mit einem `false` dort weg. PostHog sendet `$pageleave` beim
     * Verlassen des Dokuments (`pagehide`); die Verweildauer eines SPA-Wechsels steht als
     * `$prev_pageview_duration` am nächsten `$pageview`.
     */
    capture_pageleave: true,

    /*
     * NUR PAGEVIEWS. Autocapture würde jeden Klick und jede Formular-Interaktion
     * mitschneiden — auf einer Seite mit Kontakt-, Login- und Registrierungs-
     * formularen deutlich mehr, als für Reichweitenmessung nötig ist. Event-
     * Instrumentierung ist ein eigener, bewusster Schritt.
     */
    autocapture: false,

    /*
     * Session Replay AUS — und zwar HIER, nicht nur im Dashboard. Replay lässt
     * sich in PostHog serverseitig per Projekt-Einstellung einschalten; stünde
     * die Entscheidung nur dort, könnte ein Klick im Dashboard die Bildschirm-
     * aufzeichnung aller Besucher aktivieren, ohne dass ein Deploy stattfindet.
     * Dieser Schalter im Code gewinnt und macht die Entscheidung überprüfbar.
     */
    disable_session_recording: true,
  } as const
}

export type PostHogLike = AnalyticsClient & {
  init: (key: string, options: ReturnType<typeof posthogInitOptions>) => unknown
  register: (properties: Record<string, string>) => unknown
}

/** Zwei Grossbuchstaben (ISO 3166-1 alpha-2), sonst `null`. */
export function parseLand(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : null
}

export const LAND_TIMEOUT_MS = 1500

/**
 * Fragt `/api/land` je Seitenladung neu ab — bewusst ohne Ablage im Browser (cookielos). Jeder
 * Fehler und der Timeout ergeben `null`; die Messung startet dann ohne Land.
 */
export async function fetchLand(): Promise<string | null> {
  try {
    const response = await fetch('/api/land', {
      cache: 'no-store',
      signal: AbortSignal.timeout(LAND_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    return parseLand((body as { land?: unknown } | null)?.land)
  } catch {
    return null
  }
}

/**
 * Interne Geräte und `/intern` werden gar nicht erst initialisiert — `opt_out_capturing()` ist bei
 * `cookieless_mode: 'always'` in posthog-js wirkungslos (die Methode steht hinter dieser Bedingung).
 */
export function analyticsAllowed(pathname: string, store?: DeviceStorage | null): boolean {
  return pathname !== INTERN_HREF && !isInternalDevice(store)
}

/** `true`, wenn initialisiert wurde. Der Chunk wird bei einem internen Gerät nicht einmal geladen. */
export async function startPostHog(options: {
  key: string
  apiHost: string
  pathname: string
  store?: DeviceStorage | null
  load: () => Promise<PostHogLike>
  /** Vorgabe `fetchLand`; im Test ersetzt. */
  getLand?: () => Promise<string | null>
  isCancelled: () => boolean
  onReady: (client: PostHogLike) => void
}): Promise<boolean> {
  if (!analyticsAllowed(options.pathname, options.store)) return false
  // Chunk und Land parallel; `getLand` fängt jeden Fehler selbst ab.
  const [posthog, land] = await Promise.all([options.load(), (options.getLand ?? fetchLand)()])
  // Der Nutzer kann die Seite verlassen haben, während der Chunk lud.
  if (options.isCancelled()) return false
  posthog.init(options.key, posthogInitOptions(options.apiHost))
  // Vor dem ersten `$pageview`: den schickt posthog-js erst per setTimeout nach `init`.
  if (land) posthog.register({ land })
  options.onReady(posthog)
  return true
}
