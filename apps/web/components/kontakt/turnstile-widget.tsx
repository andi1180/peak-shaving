'use client'

import * as React from 'react'

/**
 * Cloudflare-Turnstile-Widget — rendert NUR, wenn ein Site-Key gesetzt ist.
 *
 * Ohne `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ist diese Komponente inert: kein Script,
 * kein Netzwerk-Request, kein DOM, kein Fehler. Das ist die Bedingung dafür, dass
 * das Formular lokal und in jeder Preview ohne Env funktioniert — der Bot-Schutz
 * ist dann der Honeypot (immer aktiv).
 *
 * KEIN reCAPTCHA (§8.6): Der Bestand lud `data-netlify-recaptcha`. reCAPTCHA
 * würde ein Cookie-Consent-Banner für die ganze Seite erzwingen (§9.3).
 *
 * WARUM DAS SCRIPT VON HAND UND NICHT ÜBER `next/script`: Turnstile muss nach dem
 * Laden explizit auf ein DOM-Element gerendert werden (`turnstile.render`) und
 * beim Unmount wieder abgeräumt werden. Dieser Lebenszyklus gehört an den Effekt,
 * der auch das Element besitzt — `next/script` würde die Ladephase davon trennen
 * und den Aufräumpfad verkomplizieren, ohne etwas zu gewinnen (das Script wird
 * ohnehin nur auf dieser einen Seite gebraucht).
 */

/**
 * Statische Referenz auf `process.env.NEXT_PUBLIC_*` — nur so ersetzt Next den
 * Ausdruck zur Build-Zeit durch den Wert. Eine dynamische Variante
 * (`process.env[name]`) bliebe im Browser `undefined`.
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SCRIPT_ID = 'cf-turnstile-script'

/** Minimal-Typisierung — nur, was hier tatsächlich benutzt wird. */
type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
      language?: string
      theme?: 'light' | 'dark' | 'auto'
    },
  ) => string | undefined
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** Ist der Bot-Schutz überhaupt scharf? Das Formular fragt das, s. `kontakt-form.tsx`. */
export const turnstileEnabled = Boolean(SITE_KEY)

export function TurnstileWidget({
  onToken,
  language,
}: {
  /** `null` = Token ungültig/abgelaufen — das Formular muss es dann verwerfen. */
  onToken: (token: string | null) => void
  language: string
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)

  /*
   * `onToken` über ein Ref, nicht als Dependency: Sonst würde jede neue
   * Callback-Identität (bei jedem Render des Formulars) das Widget abräumen und
   * neu rendern — der Nutzer sähe die Prüfung mitten im Tippen neu starten und
   * verlöre sein Token. Der Effekt darf genau einmal laufen.
   */
  const onTokenRef = React.useRef(onToken)
  React.useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  React.useEffect(() => {
    const siteKey = SITE_KEY
    const element = containerRef.current
    if (!siteKey || !element) return

    let widgetId: string | undefined
    let cancelled = false

    function render() {
      if (cancelled || !window.turnstile || !element) return
      widgetId = window.turnstile.render(element, {
        sitekey: siteKey as string,
        callback: (token) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
        language,
        theme: 'light',
      })
    }

    if (window.turnstile) {
      render()
    } else {
      /*
       * Das Script kann bereits von einem früheren Mount hängen (Client-Nav
       * zurück auf /kontakt). Dann NICHT ein zweites Mal einhängen — Turnstile
       * würde sich doppelt initialisieren.
       */
      const existing = document.getElementById(SCRIPT_ID)
      if (existing) {
        existing.addEventListener('load', render, { once: true })
      } else {
        const script = document.createElement('script')
        script.id = SCRIPT_ID
        script.src = SCRIPT_SRC
        script.async = true
        script.defer = true
        script.addEventListener('load', render, { once: true })
        document.head.appendChild(script)
      }
    }

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [language])

  if (!SITE_KEY) return null

  // Kein Label/keine Überschrift: Das Widget beschriftet sich selbst und ist
  // kein Feld, das der Nutzer ausfüllt.
  return <div ref={containerRef} className="mt-2" />
}
