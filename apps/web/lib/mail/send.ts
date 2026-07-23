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
import { COMPANY } from '@/lib/nav'

/**
 * DER ABSENDER ALLER ÜBER RESEND VERSENDETEN MAILS — eine Definition, nicht ein Fundort je Mail.
 *
 * ── WARUM `energy@coolin.at` UND AUSDRÜCKLICH KEIN `noreply@` ───────────────────────────────────
 * Die Adresse ist in Resend verifiziert (SPF/DKIM auf coolin.at) und liefert nachweislich zu — sie
 * ist damit die einzige, für die das belegt ist. Und sie ist ein echtes Postfach: `noreply@`-
 * Adressen werden von Filtern tendenziell schlechter bewertet, und bei einer Mail, die jemand
 * unerwartet bekommt (eine Bestätigung, eine Erinnerung, eine Freischaltung), muss eine Rückfrage
 * möglich sein. Eine Antwort, die ins Leere läuft, ist im besten Fall eine verlorene Rückfrage und
 * im schlechtesten eine Beschwerde.
 *
 * ── WARUM IM CODE UND NICHT IN DER UMGEBUNG ────────────────────────────────────────────────────
 * Bis hierher kam der Wert aus `RESEND_FROM` und wurde an ZWEI Stellen gelesen (hier und in
 * `lib/kontakt/deliver.ts`). Das hat zwei Nachteile, die beide real geworden sind: Resend verlangt
 * strikt `email@domain` oder `Name <email@domain>`, und eine falsch formatierte Variable hat den
 * Versand schon einmal mit 422 abgelehnt (Handover `apps/web/CLAUDE.md`, Domain-Umzug) — ein
 * Fehler, den kein Build und kein Test fängt, weil er in der Umgebung steht. Ausserdem konnte der
 * Absender je Deployment ein anderer sein, ohne dass es irgendwo auffiele. Als Konstante ist er
 * versioniert, prüfbar und für alle sieben Mails derselbe; ein Wechsel der Absenderdomain ist ein
 * PR mit einer Zeile — dieselbe Abwägung, mit der B11 die Tarifsätze in den Code gelegt hat.
 *
 * Die ADRESSE selbst steht weiterhin nur an einer Stelle (`COMPANY`, `lib/nav.ts`): sie ist die
 * Firmenadresse, die auch der Footer und das JSON-LD zeigen. Eine zweite getippte Kopie wäre die
 * Stelle, die bei einem Postfachwechsel still auf das alte Postfach zeigt.
 */
export const MAIL_FROM = `${COMPANY.name} <${COMPANY.email}>`

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

/**
 * Ist der Versandweg überhaupt konfiguriert? Aufrufer prüfen das VOR dem Aufbau der Mail.
 *
 * Seit der Absender im Code steht (s. `MAIL_FROM`), fehlt dafür genau EIN Wert: der API-Schlüssel.
 * Der Absender kann nicht mehr fehlen und nicht mehr formal falsch sein.
 */
export function mailConfigured(): boolean {
  return Boolean(serverEnv.RESEND_API_KEY)
}

/** Was fehlt — für das Server-Log, nicht für den Nutzer. */
export function warnMailNotConfigured(what: string, consequence: string): void {
  console.warn(`[mail] ${what} NICHT versendet — RESEND_API_KEY fehlt. ${consequence}`)
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
   * Antwortadresse. `from` ist immer `MAIL_FROM` und MUSS unsere verifizierte Domain bleiben
   * (SPF/DKIM) — eine fremde Adresse gehört hierher, nicht dorthin.
   */
  replyTo?: string
}

export async function sendMail(message: OutgoingMail, label: string): Promise<MailOutcome> {
  const apiKey = serverEnv.RESEND_API_KEY
  if (!apiKey) return { ok: false, reason: 'not_configured' }

  try {
    // Dynamischer Import wie in `lib/kontakt/deliver.ts`: ohne Key kostet ein Aufruf keinen
    // Modul-Load, und der Client-Bundler bekommt das SDK nie zu Gesicht.
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    const { error } = await resend.emails.send({
      from: MAIL_FROM,
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
