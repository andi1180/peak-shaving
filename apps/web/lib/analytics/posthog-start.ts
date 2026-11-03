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
  isCancelled: () => boolean
  onReady: (client: PostHogLike) => void
}): Promise<boolean> {
  if (!analyticsAllowed(options.pathname, options.store)) return false
  const posthog = await options.load()
  // Der Nutzer kann die Seite verlassen haben, während der Chunk lud.
  if (options.isCancelled()) return false
  posthog.init(options.key, posthogInitOptions(options.apiHost))
  options.onReady(posthog)
  return true
}
