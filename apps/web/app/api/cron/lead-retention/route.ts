/**
 * `GET /api/cron/lead-retention` — der erste zeitgesteuerte Job im System (B4-1).
 *
 * Täglich 03:15 UTC (`apps/web/vercel.json`). Er setzt die Löschfristen des Lead-Bestands durch,
 * indem er fällige Leads anonymisiert — und versendet dabei KEINE einzige E-Mail. Die
 * Vertragsablauf-Erinnerung samt Versand ist B4-2.
 *
 * ── DER ENDPUNKT IST AUSLÖSER, NICHT VERANTWORTLICHER ────────────────────────────────────────────
 * Hier steht KEINE Entscheidungslogik: kein Schwellwert, keine Auswahl, keine Zählung. Er prüft das
 * Geheimnis und ruft genau einen Wrapper. Alles Fachliche — welche Leads fällig sind, ab welcher
 * Menge der Lauf verweigert, was protokolliert wird — liegt in `platform.run_lead_retention`
 * (Migration 20260722120000). Der Grund ist nicht Geschmack, sondern Reichweite: ein HTTP-Handler
 * ist von aussen erreichbar, eine Datenbankfunktion nicht. Läge die Mengenbegrenzung hier, entschiede
 * ein Query-Parameter über die Grösse eines unumkehrbaren Vorgangs.
 *
 * ── WARUM DIE ROUTE UNTER `/api` LIEGT ───────────────────────────────────────────────────────────
 * Der Middleware-Matcher (`middleware.ts`) schliesst `/api` aus — kein Locale-Routing, kein
 * Session-Refresh. Ein 307 auf `/de/…` machte aus dem Cron-Aufruf ein stilles Nichts (Vercel folgt
 * Redirects beim Cron nicht). Dieselbe Lage wie beim Stripe-Webhook (in T4-3 verifiziert) und beim
 * One-Click-Abmeldeendpunkt (B1-2).
 *
 * ── FAIL-CLOSED, DREIMAL DASSELBE ERGEBNIS ───────────────────────────────────────────────────────
 * Fehlende Kopfzeile, falsches Geheimnis, FEHLENDES `CRON_SECRET` in der Umgebung: jedes Mal 401,
 * kein Datenbankzugriff, kein Laufdatensatz. Besonders der dritte Fall ist Absicht — „es ist keins
 * konfiguriert, also lasse ich jeden durch" wäre ein offener Auslöser für einen unumkehrbaren
 * Massenvorgang, und eine vergessene Umgebungsvariable ist ein durchaus plausibler Zustand.
 *
 * ── WARUM EINE VERWEIGERUNG 200 IST UND KEIN FEHLER ──────────────────────────────────────────────
 * Übersteigt die Zahl der fälligen Leads die Obergrenze, anonymisiert der Lauf NICHTS und meldet
 * `outcome: 'refused'`. Das ist das VORGESEHENE Verhalten, kein Fehler — und es darf keinen
 * Wiederholungsversuch auslösen, der beim nächsten Mal genauso ausginge. Die Kennzeichnung steht
 * dafür im Rumpf (`refused: true`) und laut im Log; sichtbar wird sie ohnehin im Admin-Bereich, der
 * die Begründung im Klartext anzeigt.
 * Ein echter Abbruch (`outcome: 'error'`, der Lauf wurde vollständig zurückgenommen) antwortet
 * dagegen 500 — damit er in der Vercel-Übersicht als fehlgeschlagener Lauf erscheint und nicht als
 * einer von vielen grünen.
 */
import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { cronSecretOrNull } from '@/lib/env.server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Vergleicht zwei Geheimnisse zeitkonstant.
 *
 * ANDERS ALS `verifyUnsubscribe` (lib/leads/token-crypto.ts) wird hier NICHT vorab die Länge
 * verglichen: dort ist die erwartete Länge eine öffentlich bekannte Eigenschaft des Verfahrens
 * (HMAC-SHA256, base64url — immer gleich lang), hier ist sie eine Eigenschaft des Geheimnisses
 * selbst. Beide Werte werden deshalb erst gehasht: die Digests sind immer 32 Byte, `timingSafeEqual`
 * kann nicht mehr wegen ungleicher Pufferlänge werfen, und die Antwortzeit verrät weder Länge noch
 * Inhalt.
 */
function secretsMatch(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected, 'utf8').digest()
  const b = createHash('sha256').update(provided, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** `Authorization: Bearer <secret>` — das Format, in dem Vercel das Cron-Geheimnis mitschickt. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1]! : null
}

/** Immer derselbe knappe Rumpf — der Aufrufer soll aus der Ablehnung nichts weiter erfahren. */
function unauthorized(): Response {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

type RetentionRun = {
  outcome?: unknown
  items_considered?: unknown
  items_processed?: unknown
  detail?: unknown
  run_id?: unknown
  started_at?: unknown
  finished_at?: unknown
}

function asRun(value: unknown): RetentionRun | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as RetentionRun
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export async function GET(request: Request): Promise<Response> {
  const secret = cronSecretOrNull()
  const provided = bearerToken(request)

  // Reihenfolge ist bedeutungslos für das Ergebnis (beides → 401), aber nicht für die Wirkung:
  // vor dieser Zeile passiert nichts, was die Datenbank berührt.
  if (!secret || !provided || !secretsMatch(secret, provided)) {
    if (!secret) {
      console.error(
        '[cron/lead-retention] CRON_SECRET fehlt in der Umgebung — Aufruf abgelehnt (fail-closed). ' +
          'Der Fristenlauf findet damit NICHT statt; Variable in Vercel setzen und neu deployen.',
      )
    }
    return unauthorized()
  }

  const supabase = createServiceRoleClient()
  // Ohne Argumente: die Vorgabewerte (500 / 1000) stehen in der Datenbank, nicht hier. Ein
  // Query-Parameter dürfte sie ohnehin nicht setzen — s. Kopfkommentar.
  const { data, error } = await supabase.rpc('run_lead_retention_job')

  if (error) {
    console.error('[cron/lead-retention] run_lead_retention_job:', error)
    return NextResponse.json(
      { job: 'lead_retention', outcome: 'error', detail: 'Der Aufruf ist fehlgeschlagen.' },
      { status: 500 },
    )
  }

  const run = asRun(data)
  const outcome = stringOrNull(run?.outcome)
  const body = {
    job: 'lead_retention',
    outcome,
    refused: outcome === 'refused',
    itemsConsidered: numberOrNull(run?.items_considered),
    itemsProcessed: numberOrNull(run?.items_processed),
    detail: stringOrNull(run?.detail),
    runId: stringOrNull(run?.run_id),
    startedAt: stringOrNull(run?.started_at),
    finishedAt: stringOrNull(run?.finished_at),
  }

  if (outcome === 'refused') {
    // Laut ins Log, obwohl die Antwort 200 ist: die Verweigerung ist der Zustand, der einen Menschen
    // erreichen muss, bevor er sich täglich wiederholt.
    console.warn('[cron/lead-retention] Lauf verweigert:', body.detail)
  }
  if (outcome === 'error') {
    console.error('[cron/lead-retention] Lauf abgebrochen:', body.detail)
    return NextResponse.json(body, { status: 500 })
  }

  return NextResponse.json(body, { status: 200 })
}
