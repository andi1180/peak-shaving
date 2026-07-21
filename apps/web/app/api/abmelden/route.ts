/**
 * `POST /api/abmelden` — One-Click-Unsubscribe nach RFC 8058 (B1-2).
 *
 * ── WOZU DAS ÜBERHAUPT DA IST ────────────────────────────────────────────────────────────────────
 * Gmail und Yahoo verlangen von Massenversendern eine funktionierende Ein-Klick-Abmeldung. Der
 * Mail-Client zeigt sie als eigene Schaltfläche neben dem Absender und schickt einen POST an die
 * URL aus `List-Unsubscribe` — OHNE Browser, ohne Cookies, ohne dass ein Mensch eine Seite sieht.
 * Wer stattdessen eine Bestätigungsseite verlangt, gilt als nicht konform, und die Alternative des
 * Empfängers ist die „Spam"-Schaltfläche daneben: eine Beschwerde statt einer Abmeldung, mit
 * dauerhaftem Schaden an der Zustellbarkeit für ALLE Empfänger.
 *
 * Der Endpunkt meldet deshalb ohne Rückfrage vom übergebenen Zweck ab. Die weitergehende Sperrung
 * der ganzen Adresse gehört NICHT hierher: sie ist die eingreifendere Entscheidung und braucht die
 * Menschenseite (`/abmelden`), auf die ein GET hier weiterleitet.
 *
 * ── WARUM DIE ROUTE UNTER `/api` LIEGT ───────────────────────────────────────────────────────────
 * Der Middleware-Matcher (`middleware.ts`) schliesst `/api` aus — kein Locale-Routing, kein
 * Session-Refresh. Ein Locale-Redirect würde den POST zerstören: Mail-Clients folgen ihm nicht
 * zwingend, und ein 307 auf `/de/abmelden` machte aus der Abmeldung ein stilles Nichts. Dieselbe
 * Lage wie beim Stripe-Webhook (T4-3, dort verifiziert).
 *
 * ── ANTWORTVERHALTEN: IMMER 200, AUCH BEI UNGÜLTIGER SIGNATUR ────────────────────────────────────
 * Der Aufrufer ist eine Maschine. Ein 4xx würde von Mail-Clients teils als „Abmeldung kaputt"
 * angezeigt und teils wiederholt; wichtiger noch: unterschiedliche Statuscodes machten den Endpunkt
 * zum Orakel, mit dem sich gültige Lead-IDs abklopfen liessen. Die Wirkung tritt nur bei gültiger
 * Signatur ein, die ANTWORT ist in jedem Fall dieselbe.
 */
import { NextResponse } from 'next/server'
import { getPathname } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { ABMELDEN_HREF, UNSUBSCRIBE_PARAM, isConsentPurpose } from '@/lib/leads/config'
import { withdrawConsent } from '@/lib/leads/store'
import { verifyUnsubscribeToken } from '@/lib/leads/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Die signierte Nutzlast. Sie steht in der QUERY, nicht im Body: RFC 8058 schreibt dem Client vor,
 * `List-Unsubscribe=One-Click` als Body zu senden — die Adressierung muss deshalb vollständig in der
 * URL stehen. (Ein Body-Feld würde von konformen Clients gar nicht mitgeschickt.)
 */
function readInput(request: Request) {
  const url = new URL(request.url)
  const leadId = url.searchParams.get(UNSUBSCRIBE_PARAM.lead)?.trim() ?? ''
  const purpose = url.searchParams.get(UNSUBSCRIBE_PARAM.purpose)?.trim() ?? ''
  const signature = url.searchParams.get(UNSUBSCRIBE_PARAM.signature)?.trim() ?? ''
  return { url, leadId, purpose, signature }
}

export async function POST(request: Request): Promise<Response> {
  const { leadId, purpose, signature } = readInput(request)

  if (leadId && isConsentPurpose(purpose)) {
    try {
      if (verifyUnsubscribeToken(leadId, purpose, signature)) {
        await withdrawConsent(leadId, purpose)
      }
    } catch (cause) {
      // Fehlendes Geheimnis, DB nicht erreichbar: laut ins Log, aber dieselbe Antwort nach aussen.
      console.error('[leads] One-Click-Abmeldung fehlgeschlagen:', cause)
    }
  }

  // `new Response(null, {status: 200})` statt JSON: der Aufrufer ist ein Mail-Client und liest den
  // Rumpf nicht. Ein leerer 200 ist die knappste konforme Antwort.
  return new Response(null, { status: 200 })
}

/**
 * Ein GET landet hier nur, wenn ein Mensch die One-Click-URL im Browser öffnet (manche Clients
 * zeigen sie als normalen Link). Weiterleitung auf die Menschenseite — mit denselben Parametern,
 * damit dort beide Möglichkeiten zur Wahl stehen, statt einer stillen Wirkung ohne Nachfrage.
 */
export async function GET(request: Request): Promise<Response> {
  const { url, leadId, purpose, signature } = readInput(request)

  const path = getPathname({ href: ABMELDEN_HREF, locale: routing.defaultLocale })
  const target = new URL(path, url.origin)
  target.searchParams.set(UNSUBSCRIBE_PARAM.lead, leadId)
  target.searchParams.set(UNSUBSCRIBE_PARAM.purpose, purpose)
  target.searchParams.set(UNSUBSCRIBE_PARAM.signature, signature)

  // 303: der Browser soll die Zielseite per GET holen — unabhängig davon, wie er hierher kam.
  return NextResponse.redirect(target, 303)
}
