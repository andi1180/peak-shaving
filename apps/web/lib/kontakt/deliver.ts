/**
 * ZUSTELLUNG einer Kontaktanfrage — der einzige Ort, der weiß, WOHIN eine
 * Anfrage geht (Pflichtenheft §8.6).
 *
 * `import 'server-only'` ist kein Kommentar, sondern eine Zusage mit Zähnen: Wer
 * dieses Modul (oder etwas, das es importiert) je aus einer Client-Komponente
 * zieht, bekommt einen BUILD-Fehler statt eines API-Keys im Browser-Bundle. Die
 * Route ist ohnehin serverseitig — aber „ohnehin" ist keine Garantie, die man in
 * einem Refactoring behält.
 *
 * ISOLIERT, weil der Kanal sich ändern wird: Heute Resend, in Phase 2 zusätzlich
 * ein Supabase-`contacts`-Insert (s. Einhängestelle unten). Die Route soll davon
 * nichts wissen müssen — sie kennt nur „zugestellt" / „nicht zugestellt".
 *
 * ─── AKTIVIERUNG (Vercel → Settings → Environment Variables) ──────────────────
 *
 *   RESEND_API_KEY   Pflicht. Aus resend.com → API Keys. Beginnt mit „re_".
 *                    Fehlt er, sendet dieses Modul NICHT und meldet
 *                    `not_configured` — es crasht nicht (lokal/Preview normal).
 *
 *   RESEND_FROM      Pflicht. MUSS auf einer in Resend VERIFIZIERTEN Domain
 *                    liegen, sonst lehnt Resend die Sendung ab (403).
 *                    Beispiel:  COOLiN ENERGY <noreply@coolin.at>
 *                    NICHT die Adresse des Absenders eintragen — dessen Adresse
 *                    steht als `reply-to` (s. u.), nicht als `from`. Ein „from"
 *                    mit fremder Domain scheitert an SPF/DKIM.
 *
 *   RESEND_TO        Optional. Default: COMPANY.email (energy@coolin.at).
 *                    Nur setzen, wenn intern anders zugestellt werden soll.
 *
 * Danach: Domain in Resend verifizieren (DNS: SPF + DKIM), einmal echt testen.
 * Der Sendetest gehört zu Andreas mit gesetztem Key — nicht zu Claude Code.
 * Die Namen stehen zusätzlich in `apps/web/.env.example`.
 */

import 'server-only'
import { COMPANY } from '@/lib/nav'
import { serverEnv } from '@/lib/env.server'
import type { KontaktInput } from './schema'

/**
 * Das Ergebnis einer Zustellung. Bewusst KEIN `boolean`: Der Unterschied
 * zwischen „nicht konfiguriert" (unser Setup fehlt — Andreas muss handeln) und
 * „Senden fehlgeschlagen" (Resend/Netz — evtl. transient) ist der Unterschied
 * zwischen zwei verschiedenen Meldungen an den Nutzer und zwei verschiedenen
 * Reaktionen im Betrieb. Ein `false` würde beides zu „irgendwas ging schief".
 */
export type DeliveryOutcome =
  { ok: true; id: string | null } | { ok: false; reason: 'not_configured' | 'send_failed' }

/**
 * Zustell-Ziel. `COMPANY.email` statt eines getippten Strings: Die Firmenadresse
 * hat in dieser App genau einen Fundort (`lib/nav.ts`, verbatim aus dem
 * Bestand). Eine zweite Kopie hier wäre die Stelle, die bei einem Adresswechsel
 * still auf das alte Postfach zeigt — und niemand merkt es, weil kein Fehler
 * entsteht: die Mails gehen einfach woanders hin.
 */
const DEFAULT_TO = COMPANY.email

/** Wien, nicht UTC: Die Mail wird von Menschen in Wien gelesen. */
const TIMESTAMP = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Europe/Vienna',
})

/**
 * Nutzereingabe → HTML. PFLICHT, nicht Kosmetik: Ohne Escaping trägt jede
 * Kontaktanfrage beliebiges Markup in unser eigenes Postfach (`<img src=x
 * onerror=…>`, gefälschte Links). Der Absender ist per Definition unbekannt.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Nicht ausgefüllte Optionalfelder als solche zeigen, nicht als leere Zeile. */
const EMPTY = '—'

function orEmpty(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : EMPTY
}

type MailFields = { label: string; value: string }[]

function buildFields(input: KontaktInput, themaLabel: string): MailFields {
  return [
    { label: 'Name', value: input.name },
    { label: 'E-Mail', value: input.email },
    { label: 'Unternehmen', value: orEmpty(input.unternehmen) },
    { label: 'Telefon', value: orEmpty(input.telefon) },
    { label: 'Thema', value: themaLabel },
  ]
}

function buildText(fields: MailFields, nachricht: string, zeitstempel: string): string {
  const head = fields.map((f) => `${f.label}: ${f.value}`).join('\n')
  return [
    'Neue Kontaktanfrage über coolin.at',
    '',
    head,
    `Eingegangen: ${zeitstempel}`,
    '',
    'Nachricht:',
    nachricht,
    '',
    '—',
    'Direkt antworten geht: Die Absender-Adresse ist als Reply-To gesetzt.',
  ].join('\n')
}

/*
 * Inline-Styles statt Klassen und bewusst NICHT die Design-Tokens dieser App:
 * E-Mail-Clients kennen kein `var(--color-…)` und strippen `<style>`-Blöcke.
 * Diese Mail ist eine INTERNE Benachrichtigung, kein Marken-Auftritt — sie muss
 * in Outlook, Gmail und einem Terminal-Client lesbar sein, nicht schön.
 */
function buildHtml(fields: MailFields, nachricht: string, zeitstempel: string): string {
  const rows = fields
    .map(
      (f) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#525252;vertical-align:top;white-space:nowrap">${escapeHtml(f.label)}</td>` +
        `<td style="padding:4px 0;color:#171717"><strong>${escapeHtml(f.value)}</strong></td>` +
        `</tr>`,
    )
    .join('')

  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626">`,
    `<h2 style="margin:0 0 16px;font-size:18px;color:#171717">Neue Kontaktanfrage über coolin.at</h2>`,
    `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${rows}`,
    `<tr><td style="padding:4px 12px 4px 0;color:#525252;white-space:nowrap">Eingegangen</td>`,
    `<td style="padding:4px 0;color:#262626">${escapeHtml(zeitstempel)}</td></tr>`,
    `</table>`,
    `<p style="margin:0 0 6px;color:#525252">Nachricht:</p>`,
    // `white-space:pre-wrap` erhält die Absätze des Absenders, ohne dass wir
    // seinen Text in Markup übersetzen müssen (jede Übersetzung wäre eine
    // Interpretation — und ein Einfallstor, s. escapeHtml).
    `<div style="white-space:pre-wrap;padding:12px;background:#f5f5f5;border-radius:6px;color:#171717">${escapeHtml(nachricht)}</div>`,
    `<p style="margin:16px 0 0;font-size:13px;color:#525252">Direkt antworten geht: Die Absender-Adresse ist als Reply-To gesetzt.</p>`,
    `</div>`,
  ].join('')
}

/**
 * Stellt eine geprüfte Anfrage zu. `input` MUSS bereits durch `kontaktSchema`
 * gelaufen sein — dieses Modul validiert nicht nach (eine zweite Prüfung wäre
 * eine zweite Regel).
 *
 * @param themaLabel Serverseitig aufgelöstes Label (s. `route.ts`) — nicht der
 *                   Key, weil die Mail von Menschen gelesen wird, und nicht vom
 *                   Client geliefert, weil der Client alles behaupten kann.
 */
export async function deliverKontakt(
  input: KontaktInput,
  themaLabel: string,
): Promise<DeliveryOutcome> {
  const apiKey = serverEnv.RESEND_API_KEY
  const from = serverEnv.RESEND_FROM
  const to = serverEnv.RESEND_TO ?? DEFAULT_TO

  /*
   * Ohne Key ODER ohne Absender ist eine Sendung physisch unmöglich (Resend
   * verlangt beides). Deshalb hier EIN Zustand, nicht zwei: Für den Nutzer ist
   * die Folge identisch. Die Server-Warnung nennt trotzdem, was genau fehlt —
   * sie ist für Andreas, nicht für den Absender.
   */
  if (!apiKey || !from) {
    const missing = [!apiKey && 'RESEND_API_KEY', !from && 'RESEND_FROM'].filter(Boolean).join(', ')
    console.warn(
      `[kontakt] Resend nicht konfiguriert — ${missing} fehlt. Die Anfrage wurde NICHT zugestellt. ` +
        `Env in Vercel setzen (Details: lib/kontakt/deliver.ts, apps/web/.env.example).`,
    )
    return { ok: false, reason: 'not_configured' }
  }

  const zeitstempel = TIMESTAMP.format(new Date())
  const fields = buildFields(input, themaLabel)

  try {
    /*
     * DYNAMISCHER Import, nicht `import { Resend } from 'resend'` oben:
     * zusammen mit dem `not_configured`-Guard darüber wird das SDK nur geladen,
     * wenn wirklich gesendet wird — ohne Key kostet eine Anfrage keinen Modul-
     * Load. Zusammen mit `server-only` (oben) ist damit doppelt ausgeschlossen,
     * dass der Client-Bundler das SDK je zu Gesicht bekommt.
     */
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    const { data, error } = await resend.emails.send({
      from,
      to,
      /*
       * DER PUNKT DER GANZEN MAIL: Antworten geht aus dem Postfach heraus, ohne
       * die Adresse aus dem Text zu kopieren. `from` MUSS unsere verifizierte
       * Domain bleiben (SPF/DKIM) — deshalb die fremde Adresse hier und nicht dort.
       */
      replyTo: input.email,
      subject: `Kontaktanfrage: ${themaLabel} — ${input.name}`,
      text: buildText(fields, input.nachricht, zeitstempel),
      html: buildHtml(fields, input.nachricht, zeitstempel),
    })

    if (error) {
      // Serverseitig laut, clientseitig als Fehlerzustand sichtbar: Ein Lead, der
      // im Log verschwindet, ist verloren — genau der Fall, den ein „success"
      // hier verstecken würde.
      console.error('[kontakt] Resend hat die Sendung abgelehnt:', error)
      return { ok: false, reason: 'send_failed' }
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * EINHÄNGESTELLE PHASE 2 — Supabase `contacts` (Pflichtenheft §5.5/§8.6).
     *
     * Hier (NACH erfolgreichem Mailversand, VOR dem return) kommt der Insert in
     * die `contacts`-Tabelle dazu:
     *
     *     await insertContact({ ...input, themaLabel, emailId: data?.id })
     *
     * BEWUSST JETZT NICHT GEBAUT: kein Supabase-Client, keine Dependency, kein
     * Env, keine Tabelle. Die Mail ist der echte Kanal — die DB ist Auswertung
     * und Verlaufs-Historie, und beides braucht erst eine Entscheidung über
     * Aufbewahrungsfrist und Löschkonzept (DSGVO, §9.1), die es noch nicht gibt.
     *
     * WENN es kommt, gilt: Der Insert darf die Zustellung NICHT umwerfen. Ein
     * DB-Fehler nach erfolgreichem Mailversand ist KEIN `send_failed` — die
     * Anfrage IST beim Menschen angekommen; dem Nutzer eine Fehlermeldung zu
     * zeigen würde ihn zu einer zweiten, identischen Anfrage bewegen. Also:
     * try/catch um den Insert, Fehler loggen, `ok: true` behalten.
     * ─────────────────────────────────────────────────────────────────────────
     */

    return { ok: true, id: data?.id ?? null }
  } catch (cause) {
    // Netzfehler, DNS, Timeout, kaputter Key — alles, was `send` werfen kann.
    console.error('[kontakt] Resend-Aufruf fehlgeschlagen:', cause)
    return { ok: false, reason: 'send_failed' }
  }
}
