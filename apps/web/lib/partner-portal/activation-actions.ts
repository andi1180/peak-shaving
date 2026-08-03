'use server'

/**
 * DIE FREISCHALTUNG EINES PARTNERZUGANGS DURCH DEN FACHBETRIEB SELBST (B18-2a).
 *
 * Der letzte Schritt der Kette: Die Bewerbung legt ein UNBESTÄTIGTES Konto an (ohne Mail), die
 * Genehmigung erzeugt einen einmalig einlösbaren Token und verschickt ihn über Resend — und hier
 * wird er eingelöst. Erst danach ist das Konto anmeldefähig.
 *
 * ── ⚠ DER KLICK IST DER GANZE ZWECK, NICHT EINE FORMALITÄT ──────────────────────────────────────
 * Die naheliegende Abkürzung wäre gewesen, das Konto bei der Freischaltung per Admin-API einfach
 * als bestätigt zu markieren und nur einen Portal-Link zu mailen. Sie ist abgelehnt, und zwar aus
 * einem konkreten Grund: Damit liesse sich eine fremde Adresse übernehmen — Bewerbung mit der
 * E-Mail-Adresse eines Dritten, eigenes Passwort gesetzt, Freischaltung, Anmeldung, ohne je Zugriff
 * auf dieses Postfach gehabt zu haben. Der Token liegt ausschliesslich in DIESEM Postfach; sein
 * Einlösen ist der einzige Beweis, dass der Anmeldende es auch lesen kann.
 *
 * ── DAS SELBSTGEWÄHLTE PASSWORT BLEIBT GÜLTIG ───────────────────────────────────────────────────
 * `verifyOtp` mit `type: 'magiclink'` bestätigt die Adresse und legt eine Sitzung an — es fasst das
 * Passwort NICHT an (gemessen, s. Kopf von `lib/auth/admin-api.ts`). Der Bewerber meldet sich
 * danach mit dem an, was er im Bewerbungsformular gesetzt hat; ein neues wird weder verlangt noch
 * gesetzt. Genau deshalb `magiclink` und nicht `recovery`.
 */

import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { PORTAL_HOST_ROOT, isPortalHostRequest } from '@/lib/portal-host'
import { createClient } from '@/lib/supabase/server'
import { ACTIVATION_TOKEN_PARAM, PARTNER_PORTAL_HREF } from './config'

/**
 * Was nach einem FEHLGESCHLAGENEN Versuch angezeigt wird. Der Erfolgsfall hat keinen Zustand — er
 * endet in einer Umleitung ins Portal.
 *
 * Zwei Werte, weil zwei verschiedene Dinge zu tun sind: `invalid` heisst „dieser Link wirkt nicht
 * mehr, bitte einen neuen anfordern", `generic` heisst „gerade ging etwas schief, bitte noch einmal
 * versuchen". Sie zusammenzufassen hiesse, jemanden bei einem vorübergehenden Netzfehler nach einem
 * neuen Link fragen zu lassen, den er gar nicht braucht.
 */
export type PartnerActivationState = { error?: 'invalid' | 'generic' }

export async function activatePartnerAccountAction(
  _prev: PartnerActivationState,
  formData: FormData,
): Promise<PartnerActivationState> {
  const tokenHash = String(formData.get(ACTIVATION_TOKEN_PARAM) ?? '').trim()
  // Ohne Token wird GoTrue gar nicht erst befragt — ein leerer Aufruf brächte dieselbe Antwort wie
  // ein erfundener Token und kostete nur einen Rundlauf.
  if (!tokenHash) return { error: 'invalid' }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })

  if (error) {
    /*
     * GEMESSEN: abgelaufen, bereits verwendet und erfunden antworten ALLE DREI mit HTTP 403
     * `otp_expired` („Email link is invalid or has expired"). Das ist kein Mangel der Meldung,
     * sondern die richtige Eigenschaft — die drei Fälle sind von aussen nicht unterscheidbar, und
     * genau deshalb lässt sich mit dieser Seite auch nicht ausprobieren, welche Tokens es gibt.
     *
     * Die Adresse und der Token stehen bewusst NICHT im Log (B1-2: ein Fehlerlog ist kein
     * zulässiger zweiter Speicherort für Personenbezug, und ein geloggter Token wäre ein
     * einlösbares Geheimnis in einer Datei).
     */
    const expired = error.status === 403 || error.status === 401
    if (!expired) console.error('[partner-portal] Aktivierung fehlgeschlagen:', error.message)
    return { error: expired ? 'invalid' : 'generic' }
  }

  /*
   * Ab hier ist das Konto bestätigt UND die Sitzung gesetzt (der Server-Client schreibt die Cookies
   * in einer Server Action wirklich, s. `lib/supabase/server.ts`).
   *
   * ── DAS ZIEL HÄNGT AM HOST, UND ZWAR AN DEMSELBEN, VON DEM DIE ANFRAGE KAM ─────────────────────
   * Auf `partner.coolin.at` ist `/` das Portal (B18-1a); dort landet der Fachbetrieb direkt und
   * sieht in der Adresszeile kein Pfadsegment, das „Portal" wiederholt. Auf der Hauptdomain gibt es
   * diese Bedeutung nicht — `/` wäre die Marketing-Startseite —, dort führt der Weg auf
   * `/partner-portal`. Beide Adressen rendern denselben Bereich (EINE Fassung, zwei Adressen:
   * `components/partner-portal/partner-portal-route.tsx`).
   *
   * Der Link aus der Mail zeigt in Produktion auf den Portal-Host, der zweite Zweig ist also der
   * Fall „jemand ruft die Seite auf der Hauptdomain auf" (und lokal/in Preview der Normalfall — den
   * Portal-Host gibt es dort nicht). `isPortalHostRequest` prüft BEIDE Host-Kopfzeilen; der Grund
   * dafür ist gemessen und steht in `lib/portal-host.ts`.
   */
  const portalHost = isPortalHostRequest(await headers())
  const locale = await getLocale()
  redirectToLocalized(portalHost ? PORTAL_HOST_ROOT : PARTNER_PORTAL_HREF, locale)
}
