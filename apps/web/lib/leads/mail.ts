/**
 * Die Bestätigungsmail des Double-Opt-in (B1-2) — über denselben Resend-Pfad wie
 * `lib/kontakt/deliver.ts`.
 *
 * ── WAS DIESE MAIL IST UND WAS SIE NICHT IST ─────────────────────────────────────────────────────
 * Sie BESTÄTIGT eine Einwilligung, sie NUTZT sie nicht bereits aus: kein Angebot, kein Produkt, kein
 * Link auf Leistungsseiten. Der Empfänger hat der Zusendung von Werbung noch gar nicht zugestimmt —
 * eine werbliche Bestätigungsmail wäre genau die unerlaubte Aussendung, deren Erlaubnis sie
 * einholen soll. Aus demselben Grund tragen ausgerechnet DIESE Mails KEINE
 * `List-Unsubscribe`-Kopfzeilen (`lib/leads/tokens.ts`): abgemeldet werden kann nur, was besteht.
 *
 * ── FEHLVERSAND BRICHT NICHTS AB ─────────────────────────────────────────────────────────────────
 * Rückgabe statt Wurf. Die aufrufende Erfassung (`capture.ts`) läuft in jedem Fall weiter: die
 * Einwilligung steht als `pending` in der Datenbank, unbestätigt und damit rechtlich wirkungslos —
 * der ehrliche Zustand nach einem gescheiterten Versand. Was NICHT passieren darf, ist dass eine
 * fehlgeschlagene Bestätigungsmail eine Kundenanfrage umwirft.
 */
import 'server-only'
import { getTranslations } from 'next-intl/server'
import { serverEnv } from '@/lib/env.server'
import { COMPANY } from '@/lib/nav'

export type ConsentMailOutcome =
  { ok: true } | { ok: false; reason: 'not_configured' | 'send_failed' }

/**
 * Nutzereingabe → HTML. Dieselbe Pflicht wie in `deliver.ts`, hier zusätzlich für den
 * Einwilligungs-WORTLAUT: der kommt zwar aus der eigenen Datenbank, aber er wird von Menschen
 * gepflegt und darf trotzdem kein Markup in eine Mail tragen.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type ConsentConfirmationMail = {
  to: string
  /** Der Wortlaut, dem zugestimmt wurde — aus `platform.consent_texts`, nicht aus einer Kopie. */
  consentText: string
  /** Absolute URL der Bestätigungsseite inkl. Klartext-Token. */
  confirmUrl: string
  locale: string
}

/**
 * Verschickt die Bestätigungsmail. Texte kommen aus `messages/de.json` (§8.7 — alle
 * nutzergerichteten Texte dort), nicht als deutsche Literale aus dem Code.
 */
export async function sendConsentConfirmationMail(
  input: ConsentConfirmationMail,
): Promise<ConsentMailOutcome> {
  const apiKey = serverEnv.RESEND_API_KEY
  const from = serverEnv.RESEND_FROM

  if (!apiKey || !from) {
    const missing = [!apiKey && 'RESEND_API_KEY', !from && 'RESEND_FROM'].filter(Boolean).join(', ')
    console.warn(
      `[leads] Bestätigungsmail NICHT versendet — ${missing} fehlt. Die Einwilligung bleibt ` +
        `unbestätigt (pending) und damit wirkungslos.`,
    )
    return { ok: false, reason: 'not_configured' }
  }

  const t = await getTranslations({ locale: input.locale, namespace: 'LeadMail.confirm' })

  const text = [
    t('greeting'),
    '',
    t('intro'),
    '',
    `„${input.consentText}"`,
    '',
    t('cta'),
    input.confirmUrl,
    '',
    t('noAction'),
    '',
    '—',
    COMPANY.name,
    COMPANY.email,
  ].join('\n')

  /*
   * Inline-Styles und bewusst NICHT die Design-Tokens dieser App — dieselbe Begründung wie in
   * `deliver.ts`: E-Mail-Clients kennen kein `var(--color-…)` und strippen `<style>`-Blöcke. Die
   * Mail muss in Outlook, Gmail und einem Terminal-Client lesbar sein.
   */
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626">`,
    `<p style="margin:0 0 16px">${escapeHtml(t('greeting'))}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('intro'))}</p>`,
    `<blockquote style="margin:0 0 20px;padding:12px 16px;background:#f5f5f5;border-left:3px solid #d4d4d4;color:#171717">${escapeHtml(input.consentText)}</blockquote>`,
    `<p style="margin:0 0 12px">${escapeHtml(t('cta'))}</p>`,
    `<p style="margin:0 0 20px"><a href="${escapeHtml(input.confirmUrl)}" style="color:#0f766e;font-weight:600">${escapeHtml(t('button'))}</a></p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#525252">${escapeHtml(t('noAction'))}</p>`,
    `<p style="margin:0;font-size:13px;color:#525252">${escapeHtml(COMPANY.name)} · <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#525252">${escapeHtml(COMPANY.email)}</a></p>`,
    `</div>`,
  ].join('')

  try {
    // Dynamischer Import wie in `deliver.ts`: ohne Key kostet ein Aufruf keinen Modul-Load.
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: t('subject'),
      text,
      html,
    })

    if (error) {
      console.error('[leads] Resend hat die Bestätigungsmail abgelehnt:', error)
      return { ok: false, reason: 'send_failed' }
    }
    return { ok: true }
  } catch (cause) {
    console.error('[leads] Resend-Aufruf für die Bestätigungsmail fehlgeschlagen:', cause)
    return { ok: false, reason: 'send_failed' }
  }
}
