'use client'

import * as React from 'react'
import { publicEnv } from '@/lib/env.public'

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

    void import('posthog-js').then(({ default: posthog }) => {
      // Der Nutzer kann die Seite verlassen haben, während der Chunk lud.
      if (cancelled) return

      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,

        // Der Kern der Entscheidung, s. Dateikopf. Nie Cookies, nie Web-Storage.
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
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Rendert nichts — die Komponente existiert nur für den Effekt.
  return null
}
