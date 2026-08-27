/**
 * `GET /api/cron/spot-price-sync` — der tägliche Abruf der aWATTar-Marktpreise (B21-2a).
 *
 * Täglich 13:20 UTC (`apps/web/vercel.json`). Der DRITTE zeitgesteuerte Job des Systems, nach dem
 * Fristenlauf (B4-1, 03:15 UTC) und der Vertragsablauf-Erinnerung (B4-2, 06:40 UTC).
 *
 * Er versendet — wie der Fristenlauf und anders als die Erinnerung — KEINE E-Mail und erreicht
 * niemanden. Er holt öffentliche Börsenpreise und legt sie ab.
 *
 * ── WARUM 13:20 UTC, UND WARUM NICHT ZWEI EINTRÄGE ──────────────────────────────────────────────
 * (Die Begründung steht hier und nicht in `vercel.json` — JSON kennt keine Kommentare.)
 * Die Preise des Folgetags stehen nach der Day-Ahead-Auktion ab ungefähr 14 Uhr ORTSZEIT fest. Diese
 * Ortszeit-Marke wandert über das Jahr:
 *
 *   Winter (CET,  UTC+1): 14:00 Ortszeit = 13:00 UTC
 *   Sommer (CEST, UTC+2): 14:00 Ortszeit = 12:00 UTC
 *
 * Ein Vercel-Cron läuft in UTC und kennt keine Sommerzeit. 13:20 UTC liegt in BEIDEN Fällen sicher
 * nach der Marke — 20 Minuten nach der späteren, winterlichen. Damit genügt EIN Eintrag; zwei
 * DST-abhängige Einträge wären zweimal dieselbe Aufgabe mit der Frage, welcher gerade gilt.
 * Dieselbe Fixed-UTC-Konvention wie B4-1/B4-2, nur mit dem für die Schwankung nötigen Abstand.
 *
 * Ein zu früher Lauf wäre ohnehin kein Schaden, sondern nur ein leerer: die Quelle liefert dann
 * weniger Einträge, das Upsert schreibt weniger Zeilen, und der Lauf des Folgetags holt es nach.
 *
 * ── DAS ABGEFRAGTE FENSTER IST BEWUSST GRÖSSER ALS NÖTIG ────────────────────────────────────────
 * Abgefragt wird [heute 00:00 UTC, +3 Tage), nicht nur der Folgetag. Der Mehraufwand ist eine
 * Anfrage; der Gewinn ist, dass ein einzelner ausgefallener Lauf (Deployment, Ausfall der Quelle,
 * verworfener Aufruf) sich am nächsten Tag von selbst repariert, statt eine Lücke zu hinterlassen,
 * die niemand bemerkt. Möglich ist das nur, weil `unique (provider, ts_start)` aus B21-1 das
 * wiederholte Schreiben desselben Zeitraums gefahrlos macht: das Upsert überschreibt, es verdoppelt
 * nicht.
 *
 * ── WARUM DIE ROUTE UNTER `/api` LIEGT ───────────────────────────────────────────────────────────
 * Der Middleware-Matcher (`middleware.ts`) schliesst `/api` aus — kein Locale-Routing, kein
 * Session-Refresh. Ein 307 auf `/de/…` machte aus dem Cron-Aufruf ein stilles Nichts (Vercel folgt
 * Redirects beim Cron nicht). Dieselbe Lage wie bei den beiden bestehenden Cron-Endpunkten.
 *
 * ── FAIL-CLOSED, DREIMAL DASSELBE ERGEBNIS ───────────────────────────────────────────────────────
 * Fehlende Kopfzeile, falsches Geheimnis, FEHLENDES `CRON_SECRET` in der Umgebung: jedes Mal 401,
 * kein Netzabruf, kein Datenbankzugriff. Die Prüfung ist wortgleich zu `app/api/cron/lead-retention`
 * und `app/api/cron/contract-reminders` — EIN Geheimnis, EINE Prüfvariante für alle drei Jobs.
 *
 * ── KEIN LAUFPROTOKOLL IN `platform.job_runs` ───────────────────────────────────────────────────
 * Die beiden bestehenden Jobs schreiben ihre Läufe nach `platform.job_runs`, weil ihre Wirkung
 * unumkehrbar ist (eine Anonymisierung, eine versendete Mail) und ein Mensch nachvollziehen können
 * muss, was mit wessen Daten geschah. Hier ist die Wirkung ein Upsert öffentlicher Börsenpreise:
 * wiederholbar, ohne Personenbezug, und der Zustand ist der Tabelleninhalt selbst — die jüngste
 * `ts_start` sagt unmittelbar, bis wann der Sync gekommen ist. Ein Protokoll daneben führte einen
 * zweiten Wahrheitsort ein, der mit dem ersten auseinanderlaufen kann.
 */
import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { cronSecretOrNull } from '@/lib/env.server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { SPOT_PRICES_ON_CONFLICT, syncSpotPrices, type SpotPriceRow } from '@/lib/spot-prices/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Wie viele Tage ab heute 00:00 UTC abgefragt werden — s. Kopfkommentar. */
const WINDOW_DAYS = 3

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Vergleicht zwei Geheimnisse zeitkonstant — wortgleich zu `app/api/cron/lead-retention`
 * (dieselbe Aussenkante, dasselbe Verfahren; die Begründung für das Vorab-Hashen steht dort).
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

export async function GET(request: Request): Promise<Response> {
  const secret = cronSecretOrNull()
  const provided = bearerToken(request)

  // Vor dieser Zeile passiert nichts, was die Quelle oder die Datenbank berührt.
  if (!secret || !provided || !secretsMatch(secret, provided)) {
    if (!secret) {
      console.error(
        '[cron/spot-price-sync] CRON_SECRET fehlt in der Umgebung — Aufruf abgelehnt (fail-closed). ' +
          'Die Spotpreise werden damit NICHT aktualisiert; Variable in Vercel setzen und neu deployen.',
      )
    }
    return unauthorized()
  }

  // Ab Mitternacht UTC des heutigen Tages, damit das Fenster nicht mit der Uhrzeit des Laufs wandert.
  const startMs = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY
  const endMs = startMs + WINDOW_DAYS * MS_PER_DAY

  const supabase = createServiceRoleClient()

  try {
    const result = await syncSpotPrices({
      startMs,
      endMs,
      write: (rows: SpotPriceRow[]) =>
        supabase.from('spot_prices').upsert(rows, { onConflict: SPOT_PRICES_ON_CONFLICT }),
    })

    return NextResponse.json(
      {
        job: 'spot_price_sync',
        outcome: 'success',
        windowStart: new Date(startMs).toISOString(),
        windowEnd: new Date(endMs).toISOString(),
        ...result,
      },
      { status: 200 },
    )
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'Unbekannter Fehler.'
    console.error('[cron/spot-price-sync] Lauf abgebrochen:', cause)
    // 500, damit der Lauf in der Vercel-Übersicht als fehlgeschlagen erscheint und nicht als einer
    // von vielen grünen — anders als eine Verweigerung bei B4-1/B4-2 ist das hier immer ein Fehler.
    return NextResponse.json(
      { job: 'spot_price_sync', outcome: 'error', detail },
      { status: 500 },
    )
  }
}
