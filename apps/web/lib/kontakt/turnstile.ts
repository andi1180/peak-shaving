/**
 * Cloudflare Turnstile — serverseitige Prüfung (Pflichtenheft §8.6).
 *
 * Turnstile statt reCAPTCHA ist eine DATENSCHUTZ-Entscheidung, keine
 * Geschmacksfrage: Turnstile setzt keine Cookies zur Nutzerverfolgung, und genau
 * darauf beruht §9.3 („kein Cookie-Consent-Banner nötig"). Wer hier reCAPTCHA
 * einsetzt, macht das Banner für die ganze Seite erforderlich.
 *
 * ENV-GATED, in beide Richtungen:
 * - Kein `TURNSTILE_SECRET_KEY` → diese Prüfung wird ÜBERSPRUNGEN, nicht
 *   verweigert. Ohne Secret gäbe es nichts zu prüfen; ein harter Fehler würde
 *   das Formular lokal und in jeder Preview ohne Env unbenutzbar machen. Der
 *   Bot-Schutz ist dann der Honeypot (immer aktiv, s. `kontakt-form.tsx`).
 * - Secret gesetzt, aber kein Token → ABLEHNEN. Wenn geprüft werden soll, dann
 *   richtig: Ein „kein Token, also durchwinken" wäre ein Bot-Schutz, den ein Bot
 *   durch Weglassen des Feldes umgeht.
 *
 * ─── AKTIVIERUNG ─────────────────────────────────────────────────────────────
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY   Widget-Key (im Browser sichtbar — das ist
 *                                    Absicht und bei Turnstile unkritisch).
 *   TURNSTILE_SECRET_KEY             Secret. NUR serverseitig, nie NEXT_PUBLIC_.
 * Beide aus dash.cloudflare.com → Turnstile → Site hinzufügen. Erst wenn BEIDE
 * gesetzt sind, ist der Schutz vollständig; einzeln gesetzt ist jeweils harmlos
 * (Widget ohne Prüfung bzw. Prüfung ohne Widget → Letzteres lehnt ab).
 */

import 'server-only'
import { serverEnv } from '@/lib/env.server'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileOutcome =
  /** `skipped` unterscheidet „bestanden" von „gar nicht geprüft" — fürs Log. */
  { ok: true; skipped: boolean } | { ok: false }

type SiteVerifyResponse = {
  success?: boolean
  'error-codes'?: string[]
}

/**
 * @param token    Das `cf-turnstile-response`-Token des Widgets.
 * @param remoteIp Optional; Cloudflare nutzt sie als zusätzliches Signal.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string,
): Promise<TurnstileOutcome> {
  const secret = serverEnv.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: true, skipped: true }

  if (!token) {
    console.warn('[kontakt] Turnstile: Secret gesetzt, aber kein Token im Request — abgelehnt.')
    return { ok: false }
  }

  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteIp) body.set('remoteip', remoteIp)

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      // Cloudflares Antwort ist per Definition request-spezifisch.
      cache: 'no-store',
    })

    if (!response.ok) {
      console.error(`[kontakt] Turnstile: siteverify antwortete HTTP ${response.status}`)
      return { ok: false }
    }

    const result = (await response.json()) as SiteVerifyResponse
    if (!result.success) {
      console.warn('[kontakt] Turnstile abgelehnt:', result['error-codes'] ?? 'unbekannt')
      return { ok: false }
    }

    return { ok: true, skipped: false }
  } catch (cause) {
    /*
     * Netzfehler gegen Cloudflare → ABLEHNEN, nicht durchwinken. Ein Bot-Schutz,
     * der bei Nichterreichbarkeit öffnet, ist genau dann wirkungslos, wenn ein
     * Angreifer ihn unter Last setzt. Der Nutzer sieht einen Fehlerzustand samt
     * Fallback-Adresse — der Lead ist damit nicht verloren.
     */
    console.error('[kontakt] Turnstile: siteverify nicht erreichbar:', cause)
    return { ok: false }
  }
}
