/**
 * POST /api/kontakt — die serverseitige Wahrheit des Kontaktformulars (§5.5/§8.6).
 *
 * Ersetzt Netlify Forms, das auf Vercel/Next nicht existiert (§8.6). Der Bestand
 * (`reference/coolin-legacy.html`) postete an `/danke.html` mit
 * `data-netlify="true"` — auf Vercel wäre das ein 404 und ein still verlorener
 * Lead.
 *
 * WARUM EINE ROUTE UND KEINE SERVER ACTION: Der Endpunkt ist Trage der Secrets
 * (Resend, Turnstile) und muss unabhängig vom Formular-Rendering prüfbar sein —
 * ein `curl` gegen diese Route ist Teil der Verifikation. Server Actions sind an
 * ihren Client gebunden und lassen sich nicht so gerade heraus nachmessen.
 *
 * Die Route liegt AUSSERHALB der `(site)/[locale]`-Struktur: Die
 * next-intl-Middleware schließt `/api` explizit aus (`middleware.ts`), es gibt
 * also kein Locale-Präfix und keinen Rewrite. Die Locale kommt deshalb aus dem
 * Body (und wird geprüft, s. u.), nicht aus der URL.
 */

import { NextResponse } from 'next/server'
import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { deliverKontakt } from '@/lib/kontakt/deliver'
import { captureKontaktLead } from '@/lib/leads/capture'
import {
  kontaktSchema,
  toFieldErrors,
  type KontaktErrorCode,
  type KontaktResponse,
} from '@/lib/kontakt/schema'
import { findThema } from '@/lib/kontakt/themen'
import { verifyTurnstile } from '@/lib/kontakt/turnstile'

/*
 * Der Contract (`KontaktResponse`) steht in `lib/kontakt/schema.ts`, nicht hier —
 * die Begründung dort. Kurz: Das Formular ist eine Client-Komponente und darf
 * keine Abhängigkeit auf dieses Modul aufbauen. Fehler sind CODES, keine Sätze:
 * Die Wortwahl gehört nach `messages/de.json` (§8.7).
 */
function fail(error: KontaktErrorCode, status: number, extra = {}) {
  return NextResponse.json<KontaktResponse>({ ok: false, error, ...extra }, { status })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('bad_request', 400)
  }

  const parsed = kontaktSchema.safeParse(body)
  if (!parsed.success) {
    /*
     * Feldgenau zurückmelden. Das ist kein Informationsleck: Es sind die Regeln
     * des eigenen Formulars, die der Client ohnehin kennt (dasselbe Schema).
     * Ohne diese Rückmeldung sähe ein Nutzer, dessen Browser-JS versagt hat,
     * einen Fehler ohne Feld.
     */
    return fail('validation', 400, { fieldErrors: toFieldErrors(parsed.error.issues) })
  }

  const data = parsed.data

  /*
   * HONEYPOT — die einzige Bot-Bremse, die IMMER läuft (Turnstile ist env-gated).
   *
   * ABGELEHNT statt still verschluckt, und das ist eine bewusste Abweichung von
   * der Lehrbuch-Empfehlung („nie verraten, dass die Falle zuschnappte"):
   * Ein stiller 200 zeigt dem Absender „Danke, wir melden uns" — und niemand
   * meldet sich je. Träfe die Falle einen echten Menschen (z. B. per Autofill),
   * wäre der Lead unwiederbringlich weg, ohne dass eine Seite davon weiß. Genau
   * dieser Fall — falscher Erfolg = verlorener Lead — ist das, was dieses
   * Formular nicht tun darf. Mit einer Fehlermeldung sieht der Mensch die
   * Fallback-Adresse; ein Bot sieht 400 und lernt daraus wenig.
   */
  if (data.website !== undefined && data.website.trim() !== '') {
    console.warn('[kontakt] Honeypot gefüllt — Anfrage als Spam abgelehnt.')
    return fail('spam', 400)
  }

  /*
   * `x-forwarded-for` kann eine Kette sein („client, proxy1, proxy2"); der erste
   * Eintrag ist der Client. Nur ein Signal für Cloudflare, keine Zugangskontrolle
   * — deshalb ist die Manipulierbarkeit des Headers hier unkritisch.
   */
  const remoteIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const turnstile = await verifyTurnstile(data.turnstileToken, remoteIp)
  if (!turnstile.ok) return fail('turnstile', 400)

  /*
   * Thema-Label SERVERSEITIG auflösen. Der Client schickt nur den Key — sonst
   * könnte ein Absender die Betreffzeile unserer eigenen internen Mail frei
   * beschriften („Thema: Rechnung beglichen").
   */
  const locale = hasLocale(routing.locales, data.locale) ? data.locale : routing.defaultLocale
  const thema = findThema(data.thema)
  const t = await getTranslations({ locale, namespace: thema.labelNamespace })
  const themaLabel = t(thema.labelKey)

  const outcome = await deliverKontakt(data, themaLabel)
  if (!outcome.ok) {
    /*
     * KEIN falscher Erfolg. `not_configured` (unser Setup fehlt) und
     * `send_failed` (Resend/Netz) bleiben getrennt bis in die UI — der Nutzer
     * bekommt in beiden Fällen die Fallback-Adresse, aber die Ursache ist im
     * Log und im Statuscode unterscheidbar.
     *
     * 503 vs. 502: „nicht konfiguriert" ist unsere Seite, die (noch) nicht
     * bereit ist; „send failed" ist ein Fehler des nachgelagerten Dienstes.
     */
    return fail(outcome.reason, outcome.reason === 'not_configured' ? 503 : 502)
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * LEAD-ERFASSUNG (B1-2) — NACH erfolgreicher Zustellung, NIE davor.
   *
   * Reihenfolge und Nicht-Blockieren sind die eigentliche Regel: Die Anfrage IST
   * beim Menschen angekommen; ein Datenbankfehler danach darf daraus keinen
   * Fehlerzustand machen, sonst schickt der Absender dieselbe Anfrage ein zweites
   * Mal. `captureKontaktLead` wirft deshalb NIE — Fehler landen laut im
   * Server-Log, der Nutzer sieht Erfolg.
   *
   * `await` (kein „fire and forget"): auf Vercel endet die Function mit der
   * Antwort, ein nicht abgewarteter Promise würde mitten im Insert abgeschnitten.
   *
   * DIE RÜCKMELDUNG IST IN ALLEN FÄLLEN IDENTISCH — auch bei gesperrter oder
   * bereits bekannter Adresse. Sie darf nie verraten, ob eine Adresse im Bestand
   * steht; sonst wäre das Formular ein Auskunftsdienst über fremde Kontakte.
   * ─────────────────────────────────────────────────────────────────────────
   */
  await captureKontaktLead({
    email: data.email,
    contactName: data.name,
    company: data.unternehmen,
    phone: data.telefon,
    // Nur wenn ausdrücklich angekreuzt — der Default ist `undefined`, nicht `true`.
    wantsMarketingEmail: data.marketing === true,
    // Nachweisfelder der Einwilligung (B1-1: ausschliesslich Nachweis, keine Profilbildung).
    // Dieselbe `x-forwarded-for`-Kette wie oben für Turnstile; der erste Eintrag ist der Client.
    sourceIp: remoteIp ?? null,
    userAgent: request.headers.get('user-agent'),
  })

  return NextResponse.json<KontaktResponse>({ ok: true })
}
