/**
 * `GET /api/cron/contract-reminders` — die Vertragsablauf-Erinnerung (B4-2).
 *
 * Täglich 06:40 UTC (`apps/web/vercel.json`). **Dies ist der erste automatisierte E-Mail-Versand
 * des Systems an reale Personen.** B4-1 hatte bewusst eine Aufgabe, die niemanden erreichen konnte;
 * das endet hier.
 *
 * ── WARUM 06:40 UND NICHT 03:15 WIE DER FRISTENLAUF ─────────────────────────────────────────────
 * (Die Begründung steht hier und nicht in `vercel.json` — JSON kennt keine Kommentare.)
 * Eine Erinnerung soll morgens im Postfach liegen, nicht mitten in der Nacht: eine Mail mit
 * Zeitstempel 04:15 wirkt maschinell und wird eher weggeklickt. Der Fristenlauf hat kein
 * Zustellinteresse — er versendet nichts — und bleibt deshalb, wo er ist. Die beiden Läufe stehen
 * ausserdem bewusst nicht auf derselben Minute: sie teilen sich keine Sperren, aber ein
 * gemeinsamer Zeitpunkt macht die Zuordnung im Log unnötig mühsam.
 *
 * ── WARUM DIESER ENDPUNKT MEHR TUT ALS DER FRISTENLAUF ───────────────────────────────────────────
 * `app/api/cron/lead-retention` ist reiner Auslöser: dort steckt der gesamte Vorgang in EINER
 * Datenbankfunktion, weil Auswahl, Wirkung und Protokoll ein einziger SQL-Schritt sind, den eine
 * Transaktion im Fehlerfall vollständig zurücknimmt.
 *
 * Hier ist die Wirkung ein Aufruf an einen FREMDEN Dienst (Resend) und deshalb weder in der
 * Datenbank ausführbar noch zurückrollbar. Der Lauf ist folglich hier orchestriert:
 *
 *   Lauf beginnen (job_runs + Fällige) → ggf. verweigern → je Empfänger: beanspruchen, senden,
 *   Ergebnis festhalten → Lauf abschliessen.
 *
 * Die AUSWAHL liegt trotzdem vollständig in der Datenbank — insbesondere die beiden
 * Versandprüfungen (bestätigte Einwilligung, Sperrliste). Eine Prüfung an dieser Stelle könnte
 * übersprungen werden; eine in der Auswahl nicht: was sie nicht liefert, kann nicht angeschrieben
 * werden. Siehe `platform.leads_due_for_contract_reminder`.
 *
 * ── WARUM DIE MENGENOBERGRENZE AUSNAHMSWEISE HIER STEHT ─────────────────────────────────────────
 * B4-1 begründet ausführlich, warum ein Schwellwert nicht in einen HTTP-Handler gehört (ein
 * Query-Parameter dürfte nicht über die Grösse eines unumkehrbaren Vorgangs entscheiden). Der Grund
 * ist hier gegenstandslos: der wirksame Schritt liegt ohnehin ausserhalb der Datenbank, eine reine
 * DB-Funktion könnte ihn gar nicht bremsen. Die Werte sind deshalb Modulkonstanten und werden
 * NICHT aus der Anfrage gelesen — es gibt keinen Query-Parameter, der sie verstellen könnte.
 *
 * ÜBER DEM SCHWELLWERT WIRD KEINE EINZIGE MAIL VERSENDET, nicht die erste Teilmenge. Ein Fehler in
 * der Datumslogik (eine verrutschte Vorlaufzeit, ein Massenimport mit falschem Vertragsende) machte
 * sonst schlagartig den gesamten Bestand fällig und schriebe ihn in einem Lauf an. Eine versendete
 * Mail ist nicht zurückholbar, und an der Zustellreputation der Absenderdomain hängt die
 * 48-Stunden-Aktivierung im November. Die Abwägung ist asymmetrisch: ein zu später Lauf ist
 * reparabel, ein zu grosser nicht.
 *
 * ── EIN EMPFÄNGER JE AUFRUF ─────────────────────────────────────────────────────────────────────
 * Kein Sammelversand, kein BCC. Jede Mail nennt den Versorger und das Vertragsende GENAU DIESER
 * Person; ein Sammelversand wäre inhaltlich unmöglich — und BCC machte aus einem Zustellfehler
 * einen Fehler für alle.
 *
 * ── EIN FEHLVERSAND BRICHT DEN LAUF NICHT AB ────────────────────────────────────────────────────
 * Er wird an der Zeile festgehalten (`error`, kein `delivered_at`), gezählt und am Ende gemeldet.
 * Der Lauf endet trotzdem mit 'success', wenn er durchgelaufen ist — sonst hielte ein einzelner
 * abgelehnter Empfänger die 47 anderen auf. Solche Zeilen werden NICHT automatisch wiederholt
 * (automatische Wiederholung von E-Mail-Versand erzeugt Schleifen); sie sind ein Admin-Befund und
 * erscheinen auf `/admin/leads`.
 */
import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { cronSecretOrNull } from '@/lib/env.server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { sendContractReminderMail } from '@/lib/leads/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Wie viele Erinnerungen ein Lauf höchstens versendet. Der Rest folgt am nächsten Tag. */
const MAX_BATCH = 200

/** Ab wie vielen Fälligen der Lauf VOLLSTÄNDIG verweigert — s. Kopfkommentar. */
const REFUSE_ABOVE = 500

/**
 * Die Sprache der Erinnerungsmail. `platform.leads` führt keine Locale (die Seite ist einsprachig,
 * `i18n/routing.ts`); ein geratener Wert wäre schlimmer als der Default.
 */
const MAIL_LOCALE = 'de'

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

/* ─── Defensives Lesen der jsonb-Rückgaben ────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

type DueLead = { leadId: string; email: string; supplier: string | null; contractEndDate: string }

/** Ein Eintrag der Fälligenliste — verworfen, wenn ihm eine der drei Pflichtangaben fehlt. */
function readDue(value: unknown): DueLead | null {
  const row = asRecord(value)
  const leadId = stringOrNull(row?.lead_id)
  const email = stringOrNull(row?.email)
  const contractEndDate = stringOrNull(row?.contract_end_date)
  if (!leadId || !email || !contractEndDate) return null
  return { leadId, email, supplier: stringOrNull(row?.supplier), contractEndDate }
}

export async function GET(request: Request): Promise<Response> {
  const secret = cronSecretOrNull()
  const provided = bearerToken(request)

  // Fehlende Kopfzeile, falsches Geheimnis, FEHLENDES CRON_SECRET: jedes Mal 401, kein
  // Datenbankzugriff, kein Laufdatensatz, keine Mail. Besonders der dritte Fall ist Absicht — „es
  // ist keins konfiguriert, also lasse ich jeden durch" wäre hier ein fremdgesteuerter Massenversand.
  if (!secret || !provided || !secretsMatch(secret, provided)) {
    if (!secret) {
      console.error(
        '[cron/contract-reminders] CRON_SECRET fehlt in der Umgebung — Aufruf abgelehnt ' +
          '(fail-closed). Es werden KEINE Erinnerungen versendet; Variable in Vercel setzen und ' +
          'neu deployen.',
      )
    }
    return unauthorized()
  }

  const supabase = createServiceRoleClient()

  // (1) Lauf beginnen. Der Laufdatensatz entsteht VOR jedem Versand — stirbt der Lauf mittendrin,
  // steht er mit `finished_at is null` im Protokoll (sichtbar abgebrochen, nicht spurlos).
  const started = await supabase.rpc('start_contract_reminder_run', { p_max_batch: MAX_BATCH })
  if (started.error) {
    console.error('[cron/contract-reminders] start_contract_reminder_run:', started.error)
    return NextResponse.json(
      { job: 'contract_reminder', outcome: 'error', detail: 'Der Lauf konnte nicht beginnen.' },
      { status: 500 },
    )
  }

  const run = asRecord(started.data)
  const runId = stringOrNull(run?.run_id)
  const considered = numberOrNull(run?.items_considered) ?? 0
  const due = Array.isArray(run?.due) ? run.due.map(readDue).filter((d): d is DueLead => d !== null) : []

  if (!runId) {
    console.error('[cron/contract-reminders] Rückgabe ohne run_id — Lauf abgebrochen.')
    return NextResponse.json(
      { job: 'contract_reminder', outcome: 'error', detail: 'Unerwartete Rückgabe.' },
      { status: 500 },
    )
  }

  const finish = async (
    outcome: 'success' | 'refused' | 'error',
    processed: number,
    detail: string | null,
  ) => {
    const res = await supabase.rpc('finish_contract_reminder_run', {
      p_run_id: runId,
      p_outcome: outcome,
      p_items_processed: processed,
      // `undefined` statt `null`: die generierten RPC-Typen führen defaultende Parameter als
      // optional, und ein ausgelassener Parameter bekommt in der Datenbank denselben Vorgabewert
      // (null). Dieselbe Übersetzung wie in `lib/leads/store.ts` (B1-2).
      p_detail: detail ?? undefined,
    })
    // Ein misslungener Abschluss darf die Antwort nicht kippen: die Mails sind dann bereits raus,
    // und der Laufdatensatz bleibt als offener (finished_at is null) sichtbar — genau der Zustand,
    // für den das Protokoll gebaut ist.
    if (res.error) console.error('[cron/contract-reminders] finish_contract_reminder_run:', res.error)
  }

  // (2) Mengenobergrenze. Oberhalb wird NICHTS versendet — nicht die erste Teilmenge.
  if (considered > REFUSE_ABOVE) {
    const detail =
      `Fällig: ${considered} Erinnerungen — das übersteigt die Obergrenze von ${REFUSE_ABOVE}. ` +
      'Es wurde KEINE einzige Mail versendet. Eine versendete Mail ist nicht zurückholbar; zuerst ' +
      'die Datumslogik und den Bestand prüfen (Vertragsenden, Vorlaufzeit), dann die Grenze bewusst ' +
      'anheben.'
    console.warn('[cron/contract-reminders] Lauf verweigert:', detail)
    await finish('refused', 0, detail)
    // 200 mit Kennzeichnung, nicht 4xx/5xx: die Verweigerung ist das VORGESEHENE Verhalten und darf
    // keinen Wiederholungsversuch auslösen, der genauso ausginge (B4-1).
    return NextResponse.json(
      {
        job: 'contract_reminder',
        outcome: 'refused',
        refused: true,
        itemsConsidered: considered,
        itemsProcessed: 0,
        detail,
        runId,
      },
      { status: 200 },
    )
  }

  // (3) Je Empfänger EINZELN: beanspruchen → senden → Ergebnis festhalten. Die Reihenfolge ist die
  // Doppelversand-Sperre (Begründung an `public.claim_contract_reminder`).
  let sent = 0
  let failed = 0
  let skipped = 0

  try {
    for (const lead of due) {
      const claim = await supabase.rpc('claim_contract_reminder', {
        p_lead_id: lead.leadId,
        p_contract_end_date: lead.contractEndDate,
      })

      if (claim.error) {
        console.error('[cron/contract-reminders] claim_contract_reminder:', claim.error)
        failed += 1
        continue
      }

      const claimed = asRecord(claim.data)
      if (stringOrNull(claimed?.outcome) !== 'claimed') {
        // 'already_claimed' (ein zeitgleicher Lauf war schneller) oder 'not_eligible' (Widerruf
        // oder Sperre zwischen Auswahl und Beanspruchung). Beides ist richtig so und kein Fehler.
        skipped += 1
        continue
      }

      const mail = await sendContractReminderMail({
        to: lead.email,
        locale: MAIL_LOCALE,
        leadId: lead.leadId,
        supplier: lead.supplier,
        contractEndDate: lead.contractEndDate,
      })

      const result = await supabase.rpc('record_contract_reminder_result', {
        p_lead_id: lead.leadId,
        p_contract_end_date: lead.contractEndDate,
        // Der Grund steht im Klartext an der Zeile, aber OHNE Empfängeradresse — ein Fehlertext ist
        // kein zulässiger zweiter Speicherort für Personenbezug (B1-2).
        p_error: mail.ok
          ? undefined
          : mail.reason === 'not_configured'
            ? 'Versand nicht konfiguriert (RESEND_API_KEY/RESEND_FROM fehlt).'
            : 'Der Mailversand wurde abgelehnt oder war nicht erreichbar.',
      })
      if (result.error) {
        console.error('[cron/contract-reminders] record_contract_reminder_result:', result.error)
      }

      if (mail.ok) sent += 1
      else failed += 1
    }
  } catch (cause) {
    // Unerwarteter Abbruch mitten im Lauf: die bereits versendeten Mails sind raus und an ihren
    // Zeilen protokolliert — deshalb wird `sent` MITGEZÄHLT und nicht auf 0 gesetzt (anders als bei
    // B4-1, wo der Sicherungspunkt die Wirkung wirklich zurücknimmt; hier gibt es keinen Rückweg).
    console.error('[cron/contract-reminders] Lauf abgebrochen:', cause)
    const detail =
      `Der Lauf ist abgebrochen. Bereits versendet: ${sent}, fehlgeschlagen: ${failed}. ` +
      'Versendete Mails sind nicht zurücknehmbar; beanspruchte Zeilen ohne Zustellung bleiben als ' +
      'Befund stehen und werden NICHT automatisch wiederholt.'
    await finish('error', sent, detail)
    return NextResponse.json(
      {
        job: 'contract_reminder',
        outcome: 'error',
        refused: false,
        itemsConsidered: considered,
        itemsProcessed: sent,
        failed,
        detail,
        runId,
      },
      { status: 500 },
    )
  }

  // (4) Abschluss. Fehlschläge und Übersprungene stehen im Klartext — „48 versendet" liest sich
  // sonst wie „fertig", auch wenn 12 davon abgelehnt wurden.
  const notes: string[] = []
  if (failed > 0) {
    notes.push(
      `${failed} Erinnerung(en) konnten nicht zugestellt werden. Sie stehen mit Grund im ` +
        'Versandprotokoll und werden NICHT automatisch wiederholt.',
    )
  }
  if (skipped > 0) {
    notes.push(
      `${skipped} Fall/Fälle wurden zwischen Auswahl und Versand hinfällig (bereits beansprucht, ` +
        'widerrufen oder gesperrt).',
    )
  }
  if (sent + failed + skipped < considered) {
    notes.push(
      `Stapelgrenze erreicht: ${due.length} von ${considered} fälligen Erinnerungen bearbeitet, ` +
        'der Rest folgt in den nächsten Läufen.',
    )
  }
  const detail = notes.length > 0 ? notes.join(' ') : null

  await finish('success', sent, detail)

  return NextResponse.json(
    {
      job: 'contract_reminder',
      outcome: 'success',
      refused: false,
      itemsConsidered: considered,
      itemsProcessed: sent,
      failed,
      skipped,
      detail,
      runId,
    },
    { status: 200 },
  )
}
