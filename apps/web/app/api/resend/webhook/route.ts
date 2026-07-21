/**
 * `POST /api/resend/webhook` — der Zustellrand des Systems (B2-2).
 *
 * Nimmt entgegen, was Resend über bereits versendete Mails zurückmeldet: Zustellungen, Rückläufer,
 * Beschwerden. Er VERSENDET nichts und entscheidet nichts — die gesamte Fachlogik (was eine Sperre
 * auslöst, was einen Widerruf, was nur protokolliert wird) liegt in `public.record_email_event`
 * (Migration 20260723120000). Der Grund ist derselbe wie beim Cron-Endpunkt (B4-1): ein HTTP-Handler
 * ist von aussen erreichbar, eine Datenbankfunktion nicht — läge die Regel hier, entschiede die
 * Nutzlast eines Fremden darüber, welche Adresse dauerhaft gesperrt wird.
 *
 * Aufbau strikt nach dem Vorbild `app/api/stripe/webhook/route.ts` (T4-3).
 *
 * ── ROUTE-LAGE & MIDDLEWARE ─────────────────────────────────────────────────────────────────────
 * Liegt unter `/api`, das der Middleware-Matcher (`middleware.ts`) ausschliesst: kein
 * Locale-Redirect, kein Session-Refresh. Ein 307 auf `/de/…` zerstörte die Signaturprüfung über den
 * rohen Rumpf (in T4-3 verifiziert). Node-Runtime (die Signaturprüfung braucht node:crypto über
 * `standardwebhooks`), `force-dynamic` (nie cachen).
 *
 * ── SIGNATURPRÜFUNG: WARUM `standardwebhooks` UND NICHT `resend.webhooks.verify` ────────────────
 * Beides ist DASSELBE Verfahren — das Resend-SDK ruft intern `new Webhook(secret).verify(...)` aus
 * genau dieser Bibliothek (in `node_modules/resend/dist/index.mjs` nachgesehen, Version 1.0.0 als
 * Abhängigkeit des SDK). Der Umweg über das SDK verlangt aber ein `new Resend(apiKey)`, und dessen
 * Konstruktor WIRFT ohne API-Key (gemessen: „Missing API key"). Die Signaturprüfung hinge damit an
 * `RESEND_API_KEY` — einem Geheimnis, das mit ihr nichts zu tun hat: fehlte nur der API-Key,
 * antwortete dieser Endpunkt 500 statt der glatten 400, die hier vorgesehen ist. Deshalb die
 * Bibliothek direkt, in derselben Version, die das SDK ohnehin zieht.
 *
 * Das Verfahren (Standard Webhooks, ehemals Svix): HMAC-SHA256 über `${id}.${timestamp}.${body}`,
 * base64, Vergleich zeitkonstant; das Geheimnis beginnt mit `whsec_` und wird base64-dekodiert; ein
 * Zeitstempel älter/neuer als 5 Minuten wird abgelehnt (Wiedereinspielschutz). Resend schickt die
 * drei Werte in den Kopfzeilen `svix-id` / `svix-timestamp` / `svix-signature`.
 *
 * ── FAIL-CLOSED, DREIMAL DIESELBE ANTWORT ───────────────────────────────────────────────────────
 * Fehlende Kopfzeile, ungültige Signatur, FEHLENDES `RESEND_WEBHOOK_SECRET`: jedes Mal 400, ohne
 * jeden Datenbankzugriff. Der dritte Fall ist der wichtige — „es ist keins konfiguriert, also nehme
 * ich alles an" machte die dauerhafte Sperre beliebiger Adressen zu einer offenen Schnittstelle, und
 * für diese Wirkung gibt es über die Oberfläche bewusst keinen Rückweg.
 *
 * ── WARUM UNBEKANNTE ARTEN 200 BEKOMMEN UND FEHLER 500 ──────────────────────────────────────────
 * Resend wiederholt jede Nicht-2xx-Antwort. Eine Ereignisart, die wir nicht verarbeiten, ist kein
 * Fehler — sie mit 500 zu quittieren erzeugte einen Wiederholungssturm für etwas, das sich nie
 * ändert. Ein echter Verarbeitungsfehler dagegen SOLL wiederholt werden: ein verlorener Rückläufer
 * hiesse, dass eine tote Adresse im Verteiler bleibt.
 */
import { NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { resendWebhookSecretOrNull } from '@/lib/env.server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Die Ereignisarten, die im Ledger landen. Alles andere → 200/ignoriert.
 *
 * `email.opened` und `email.clicked` stehen hier AUSDRÜCKLICH NICHT — und zwar nicht nur, weil sie
 * nicht abonniert sind: würde die Verfolgung im Resend-Konto versehentlich eingeschaltet und diese
 * Ereignisse damit zugestellt, verwirft dieser Endpunkt sie trotzdem. Ein Zählpixel und
 * umgeschriebene Links sind Verhaltensbeobachtung; Zustellstatus-Ereignisse kommen vom empfangenden
 * Server und sind es nicht (Begründung ausgeschrieben in DEPLOYMENT.md §1h).
 *
 * `email.failed` (Resend konnte gar nicht senden) und `email.suppressed` (Resends eigene Sperrliste
 * hat den Versand verhindert) sind bewusst ausgelassen: beides sind Aussagen über UNSEREN
 * Versandpfad, nicht Rückmeldungen des Empfängers — sie gehören zum Zustellprotokoll je Kampagne
 * (B2-3) und hätten hier keine Wirkung, die sich von „nichts tun" unterscheidet.
 */
const RECORDED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
])

/** Die Form, die dieser Endpunkt aus der Nutzlast liest — nicht mehr. */
type ResendEventPayload = {
  type?: unknown
  created_at?: unknown
  data?: {
    to?: unknown
    bounce?: { type?: unknown; subType?: unknown; message?: unknown }
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Die drei Signatur-Kopfzeilen.
 *
 * Resend schickt sie mit `svix-`-Präfix; das Standard-Webhooks-Verfahren kennt daneben die
 * neutralen `webhook-`-Namen, und Svix-basierte Absender senden beide Formen. Der Rückfall kostet
 * nichts und macht die Prüfung unabhängig davon, welche Benennung der Anbieter künftig führt —
 * verifiziert wird in jedem Fall dieselbe Signatur.
 */
function signatureHeaders(request: Request): Record<string, string> | null {
  const id = request.headers.get('svix-id') ?? request.headers.get('webhook-id')
  const timestamp =
    request.headers.get('svix-timestamp') ?? request.headers.get('webhook-timestamp')
  const signature =
    request.headers.get('svix-signature') ?? request.headers.get('webhook-signature')
  if (!id || !timestamp || !signature) return null
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  }
}

export async function POST(request: Request): Promise<Response> {
  // Der ROHE Rumpf VOR jeder Auswertung — niemals `request.json()` (K4-Befund aus T4-3). Die
  // Signatur gilt über exakt diese Bytes; ein Umweg über JSON.parse/stringify änderte
  // Schlüsselreihenfolge und Leerraum und liesse jede gültige Signatur fehlschlagen.
  const body = await request.text()

  const headers = signatureHeaders(request)
  if (!headers) {
    console.warn('[resend/webhook] Signatur-Kopfzeilen fehlen — abgelehnt.')
    return new NextResponse('Missing signature', { status: 400 })
  }

  const secret = resendWebhookSecretOrNull()
  if (!secret) {
    // 400 und NICHT 200: eine stille Annahme ohne Prüfung wäre genau der offene Schreibzugang, den
    // die Signatur verhindern soll. Resend wiederholt, und der Ausfall bleibt sichtbar, statt
    // Ereignisse ins Leere laufen zu lassen.
    console.error('[resend/webhook] RESEND_WEBHOOK_SECRET ist nicht gesetzt — abgelehnt (400).')
    return new NextResponse('Webhook secret not configured', { status: 400 })
  }

  let event: ResendEventPayload
  try {
    event = new Webhook(secret).verify(body, headers) as ResendEventPayload
  } catch (err) {
    // Ungültige Signatur → 400, KEINE Verarbeitung, KEIN Datenbankzugriff.
    console.error('[resend/webhook] Signaturprüfung fehlgeschlagen:', (err as Error).message)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  const type = str(event.type)
  if (!type || !RECORDED_EVENTS.has(type)) {
    return NextResponse.json({ received: true, ignored: type ?? 'unknown' })
  }

  // Ein Empfänger je Mail ist der gebaute Zustand (B4-2: `to` ist ein String, kein bcc/cc) — das
  // Feld der Nutzlast ist trotzdem ein Array, also wird der erste Eintrag genommen.
  const recipients = Array.isArray(event.data?.to) ? event.data.to : []
  const email = str(recipients[0])
  if (!email) {
    // Ohne Adresse gibt es nichts zu verarbeiten, und eine Wiederholung änderte daran nichts —
    // deshalb 200 statt 500 (ein 500 erzeugte hier eine Endlosschleife). Laut geloggt, weil ein
    // Zustellereignis ohne Empfänger auf eine Formatänderung beim Anbieter hindeutet.
    console.error(`[resend/webhook] ${type} ohne Empfängeradresse — nicht verarbeitbar.`)
    return NextResponse.json({ received: true, ignored: 'no recipient' })
  }

  const bounce = event.data?.bounce

  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.rpc('record_email_event', {
      p_event_id: headers['webhook-id']!,
      p_event_type: type,
      p_email: email,
      // Nullable/optional: `null` → weglassen (SQL-Default NULL), wie im Stripe-Webhook.
      p_occurred_at: str(event.created_at) ?? undefined,
      p_bounce_type: str(bounce?.type) ?? undefined,
      p_bounce_subtype: str(bounce?.subType) ?? undefined,
      p_reason: str(bounce?.message) ?? undefined,
    })
    if (error) throw new Error(`record_email_event fehlgeschlagen: ${error.message}`)

    const result = (data ?? {}) as { outcome?: unknown; effect?: unknown }
    // Duplikat → 200 (die Wiederholung hat ihr Ziel erreicht: nichts ist ein zweites Mal passiert).
    return NextResponse.json({
      received: true,
      outcome: str(result.outcome) ?? 'recorded',
      effect: str(result.effect) ?? 'none',
    })
  } catch (err) {
    // 500 → Resend wiederholt. Ein verlorener Rückläufer hiesse, dass eine tote Adresse im
    // Verteiler bleibt; das wiegt schwerer als ein zusätzlicher Zustellversuch.
    // Die Adresse steht bewusst NICHT im Log — Vercel-Logs sind kein Ort für Empfängeradressen.
    console.error(
      `[resend/webhook] Verarbeitung von ${type} (${headers['webhook-id']}) fehlgeschlagen:`,
      err instanceof Error ? err.message : err,
    )
    return new NextResponse('Webhook handler failed', { status: 500 })
  }
}
