/**
 * DER EINE RESEND-AUFRUF ALLER SYSTEMMAILS.
 *
 * Herausgezogen mit B16-3 aus `lib/leads/mail.ts`, wo dieser Ablauf seit B1-2 stand. Der Grund ist
 * nicht Zeilenersparnis: Die Partner-Bewerbung verschickt zwei Mails, die keine LEAD-Mails sind (ein
 * Fachbetrieb, der Vertriebspartner werden will, ist kein Peak-Shaving-Interessent — genau deshalb
 * gibt es für ihn eine eigene Tabelle). Eine zweite Fassung dieses Ablaufs wäre eine zweite
 * Fehlerpolitik, ein zweites Logverhalten und eine zweite Stelle, an der die Adresse versehentlich
 * ins Log geriete; sie liefe beim ersten Fix auseinander.
 *
 * `lib/kontakt/deliver.ts` bleibt bewusst UNANGETASTET: dort steckt der Aufruf in einem Modul, das
 * zusätzlich die interne Benachrichtigung baut und `replyTo` setzt. Es hierher zu ziehen wäre ein
 * Umbau ohne Anlass — B16-3 braucht `replyTo` allerdings ebenfalls, und der Parameter steht deshalb
 * hier von Anfang an zur Verfügung.
 *
 * ── FEHLVERSAND BRICHT NICHTS AB ────────────────────────────────────────────────────────────────
 * Rückgabe statt Wurf. Ob ein Fehlschlag den auslösenden Vorgang umwirft, entscheidet der AUFRUFER;
 * in diesem System tut es keiner. Die Empfängeradresse steht in KEINEM Log-Text — ein Fehlerlog ist
 * kein zulässiger zweiter Speicherort für Personenbezug.
 */
import 'server-only'
import { serverEnv } from '@/lib/env.server'

export type MailOutcome = { ok: true } | { ok: false; reason: 'not_configured' | 'send_failed' }

/**
 * Nutzereingabe → HTML. PFLICHT, nicht Kosmetik: Ohne Escaping trägt jede Absendung beliebiges
 * Markup in ein Postfach (`<img src=x onerror=…>`, gefälschte Links). Gilt auch für Texte aus der
 * eigenen Datenbank — sie werden von Menschen gepflegt.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Ist der Versandweg überhaupt konfiguriert? Aufrufer prüfen das VOR dem Aufbau der Mail. */
export function mailConfigured(): boolean {
  return Boolean(serverEnv.RESEND_API_KEY && serverEnv.RESEND_FROM)
}

/** Was fehlt — für das Server-Log, nicht für den Nutzer. */
export function warnMailNotConfigured(what: string, consequence: string): void {
  const missing = [
    !serverEnv.RESEND_API_KEY && 'RESEND_API_KEY',
    !serverEnv.RESEND_FROM && 'RESEND_FROM',
  ]
    .filter(Boolean)
    .join(', ')
  console.warn(`[mail] ${what} NICHT versendet — ${missing} fehlt. ${consequence}`)
}

export type OutgoingMail = {
  to: string
  subject: string
  text: string
  html: string
  /**
   * RFC-8058-Kopfzeilen (`List-Unsubscribe`). BEWUSST optional und nicht der Normalfall: eine
   * Bestätigungsmail darf sie nicht bekommen — abgemeldet werden kann nur, was besteht.
   */
  headers?: Record<string, string>
  /**
   * Antwortadresse. `from` MUSS unsere verifizierte Domain bleiben (SPF/DKIM) — eine fremde Adresse
   * gehört hierher, nicht dorthin.
   */
  replyTo?: string
}

export async function sendMail(message: OutgoingMail, label: string): Promise<MailOutcome> {
  const apiKey = serverEnv.RESEND_API_KEY
  const from = serverEnv.RESEND_FROM
  if (!apiKey || !from) return { ok: false, reason: 'not_configured' }

  try {
    // Dynamischer Import wie in `lib/kontakt/deliver.ts`: ohne Key kostet ein Aufruf keinen
    // Modul-Load, und der Client-Bundler bekommt das SDK nie zu Gesicht.
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    const { error } = await resend.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    })

    if (error) {
      console.error(`[mail] Resend hat die ${label} abgelehnt:`, error)
      return { ok: false, reason: 'send_failed' }
    }
    return { ok: true }
  } catch (cause) {
    console.error(`[mail] Resend-Aufruf für die ${label} fehlgeschlagen:`, cause)
    return { ok: false, reason: 'send_failed' }
  }
}
