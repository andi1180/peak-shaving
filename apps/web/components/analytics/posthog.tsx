'use client'

import * as React from 'react'
import { publicEnv } from '@/lib/env.public'
import { registerAnalyticsClient } from '@/lib/analytics/events'
import { startPostHog } from '@/lib/analytics/posthog-start'

/**
 * PostHog Product Analytics — COOKIELOS, deshalb OHNE Cookie-Banner (§9.3).
 *
 * DIE ARCHITEKTURENTSCHEIDUNG, an der alles hängt: `cookieless_mode: 'always'`.
 * PostHog legt dann NIE ein Cookie und NIE einen localStorage-/sessionStorage-Eintrag
 * an; die Zahl der Besucher entsteht aus einem serverseitig berechneten, rotierenden
 * Hash. Ohne Speicherzugriff auf dem Endgerät greift die Einwilligungspflicht des
 * §165 TKG / Art. 5(3) ePrivacy nicht — genau deshalb braucht diese Seite kein
 * Consent-Management. Das ist KEINE Vorstufe zu einem späteren Banner-Setup:
 * `identify()` ist in diesem Modus gesperrt (eine distinct ID wäre nach DSGVO ein
 * personenbezogenes Datum) und wird hier bewusst NIRGENDS aufgerufen.
 *
 * ES GIBT EINE DASHBOARD-VORAUSSETZUNG: In PostHog muss unter
 * Project Settings -> Web analytics die Option „Cookieless server hash mode"
 * aktiviert sein. Ohne sie verwirft PostHog die cookielos gesendeten Events
 * serverseitig — der Code hier ist dann korrekt, aber es kommt nichts an.
 * Fundort dieser Anforderung: DEPLOYMENT.md §1e.
 *
 * WARUM `posthog-js` UND NICHT DER SCRIPT-SNIPPET: Der Snippet ist ein minifizierter
 * Blob, der im Review nicht lesbar ist und seine Version aus der CDN zieht — beides
 * passt nicht zu einer Codebasis, die ihre Env zentral validiert und ihre Abhängigkeiten
 * versioniert. Der Grund, aus dem `turnstile-widget.tsx` sein Script von Hand einhängt
 * (ein DOM-Element, dessen Lebenszyklus an den Effekt gehört), gilt hier gerade NICHT:
 * PostHog besitzt kein Element und rendert nichts.
 *
 * WARUM DER IMPORT DYNAMISCH IST: `posthog-js` ist ~60 KB. Ein statischer Import
 * landete im geteilten Client-Bundle JEDER Seite — auch dann, wenn gar kein Key
 * gesetzt ist. Mit dem dynamischen Import in einem key-gegateten Effekt wird der
 * Chunk ohne Key NIE angefordert: kein Script, kein Netzwerk-Request, kein Fehler
 * (dieselbe Eigenschaft, die `turnstile-widget.tsx` ohne Site-Key hat). Mit Key lädt
 * er nach der Hydration und blockiert das erste Rendern nicht (§7.4 Core Web Vitals).
 *
 * Init-Optionen und die Ausnahme für interne Geräte: `lib/analytics/posthog-start.ts`.
 */

const POSTHOG_KEY = publicEnv.NEXT_PUBLIC_POSTHOG_KEY

/**
 * EU-Cloud (Frankfurt) als DEFAULT IM CODE — das ist eine Datenschutz-Zusicherung,
 * keine Bequemlichkeit. `posthog-js` fällt von sich aus auf `https://us.i.posthog.com`
 * zurück. Wäre der Host nur eine Env-Variable, würde ein Deploy, bei dem jemand den
 * Key setzt und den Host vergisst, die Besucherdaten STILL in die USA senden — ein
 * Drittlandtransfer, den niemand bemerkt, weil Analytics ja „funktioniert". Deshalb
 * steht der EU-Host hier und nicht nur in `.env.example`.
 */
const POSTHOG_HOST = publicEnv.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

/** Läuft Analytics überhaupt? Ohne Key ist diese Komponente vollständig inert. */
export const analyticsEnabled = Boolean(POSTHOG_KEY)

export function PostHogAnalytics() {
  React.useEffect(() => {
    if (!POSTHOG_KEY) return

    let cancelled = false

    void startPostHog({
      key: POSTHOG_KEY,
      apiHost: POSTHOG_HOST,
      pathname: window.location.pathname,
      load: () => import('posthog-js').then(({ default: posthog }) => posthog),
      isCancelled: () => cancelled,
      // Funnel-Ereignisse (Leadgen 5) laufen über diese eine, so konfigurierte Instanz.
      onReady: registerAnalyticsClient,
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Rendert nichts — die Komponente existiert nur für den Effekt.
  return null
}
