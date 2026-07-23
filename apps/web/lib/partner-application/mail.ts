/**
 * DIE ZWEI MAILS EINER PARTNER-BEWERBUNG (B16-3) — beide über den bestehenden Resend-Weg
 * (`lib/mail/send.ts`, mit B16-3 aus `lib/leads/mail.ts` herausgezogen).
 *
 *   1. AN COOLIN: die interne Benachrichtigung, an dieselbe Adresse wie das Kontaktformular
 *      (`RESEND_TO`, sonst `COMPANY.email`) und mit Verweis auf die Detailansicht im Admin-Bereich.
 *      Der FREITEXT steht in der Mail — er ist der Grund, warum jemand sie überhaupt öffnet.
 *   2. AN DEN BEWERBER: eine kurze Eingangsbestätigung.
 *
 * ── KEIN DOUBLE-OPT-IN FÜR DIE EINGANGSBESTÄTIGUNG ──────────────────────────────────────────────
 * Die Regel aus B1-1 verlangt eine Bestätigung, sobald die Erfüllung eine KÜNFTIGE E-Mail ist
 * (`platform.purpose_requires_double_opt_in`). Hier ist die Zustellung sofort und die Antwort auf
 * genau die Handlung, die der Mensch gerade vorgenommen hat — transaktional, wie die
 * Zusendung des Rechenergebnisses (`result_delivery`, B3-2). Es entsteht deshalb kein neuer
 * `consent_purpose`, keine Einwilligungszeile und kein Ankreuzfeld; Rechtsgrundlage ist
 * Vertragsanbahnung.
 *
 * ── KEINE ZUSAGE ÜBER DIE BEARBEITUNGSDAUER ─────────────────────────────────────────────────────
 * Weder „innerhalb von X Werktagen" noch „wir melden uns kurzfristig". Eine Frist, die niemand
 * zugesagt hat, wird trotzdem gemessen — und die erste überschrittene kostet mehr, als die Angabe
 * je einbringt. Gilt für beide Mails und für die Seite.
 *
 * ── ⚠ ARBEITSSTAND DER TEXTE ────────────────────────────────────────────────────────────────────
 * Die Formulierungen der Bewerber-Mail stehen unter `PartnerApplicationMail.*` in
 * `messages/de.json` und tragen dort einen Vermerk; die endgültigen kommen von Andreas/Martina.
 * Die INTERNE Mail trägt ihre deutschen Sätze im Code — dasselbe Muster wie
 * `lib/kontakt/deliver.ts`: sie ist eine Benachrichtigung an das eigene Postfach und kein
 * nutzergerichteter Text.
 */
import 'server-only'
import { getTranslations } from 'next-intl/server'
import { serverEnv } from '@/lib/env.server'
import { escapeHtml, mailConfigured, sendMail, warnMailNotConfigured } from '@/lib/mail/send'
import { COMPANY } from '@/lib/nav'
import { absoluteUrl } from '@/lib/site'
import { PARTNER_APPLICATION_DETAIL_HREF } from '@/lib/admin/partner-applications'

/** Wien, nicht UTC: die Mail wird von Menschen in Wien gelesen (wie `lib/kontakt/deliver.ts`). */
const TIMESTAMP = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Europe/Vienna',
})

/**
 * Zustell-Ziel der internen Mail. DIESELBE Auflösung wie das Kontaktformular
 * (`lib/kontakt/deliver.ts`): `RESEND_TO`, sonst die Firmenadresse aus `lib/nav.ts`. Eine zweite
 * getippte Adresse wäre die Stelle, die bei einem Postfachwechsel still ins Leere zeigt — ohne
 * Fehler, die Mails gingen einfach woanders hin.
 */
function internalRecipient(): string {
  return serverEnv.RESEND_TO ?? COMPANY.email
}

const EMPTY = '—'

export type TeamNotification = {
  applicationId: string
  company: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  website: string | null
  message: string
  /** War der Bewerber bereits angemeldet? Steht in der Mail, weil es die Zuordnung erklärt. */
  hasSession: boolean
}

/**
 * Die interne Benachrichtigung.
 *
 * `replyTo` auf die Adresse des Bewerbers — dieselbe Eigenschaft, die das Kontaktformular
 * wertvoll macht: Antworten geht aus dem Postfach heraus, ohne die Adresse aus dem Text zu
 * kopieren. `from` MUSS unsere verifizierte Domain bleiben (SPF/DKIM).
 */
export async function sendPartnerApplicationNotification(
  input: TeamNotification,
): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured(
      'Partner-Bewerbung (interne Benachrichtigung)',
      'Der Antrag ist gespeichert und steht im Admin-Bereich unter „Partner-Anträge".',
    )
    return { ok: false }
  }

  const detailUrl = absoluteUrl(PARTNER_APPLICATION_DETAIL_HREF(input.applicationId))
  const zeitstempel = TIMESTAMP.format(new Date())
  const name = `${input.firstName} ${input.lastName}`.trim()

  /*
   * ZWEI BLÖCKE, WEIL SIE ZWEI VERSCHIEDENE DINGE SIND — dieselbe Trennung wie in
   * `lib/kontakt/deliver.ts`: Was der BEWERBER angegeben hat, steht hervorgehoben; was UNSER SYSTEM
   * dazu vermerkt hat, steht neutral daneben. Wer die Mail liest, entscheidet über eine
   * Geschäftsbeziehung — er muss sehen können, welche Zeile eine fremde Behauptung ist und welche
   * eine eigene Feststellung. Bis hierher trug „Bewerbung erfolgte" und „Eingegangen" dieselbe
   * Auszeichnung wie der Firmenname.
   */
  const fields: Array<[string, string]> = [
    ['Betrieb', input.company],
    ['Ansprechperson', name],
    ['E-Mail', input.email],
    ['Telefon', input.phone ?? EMPTY],
    ['Website', input.website ?? EMPTY],
  ]

  const meta: Array<[string, string]> = [
    // Erklärt, warum die Zuordnung so ist, wie sie ist — die einzige Angabe, die nicht aus dem
    // Formular stammt.
    ['Bewerbung erfolgte', input.hasSession ? 'aus einem angemeldeten Konto' : 'ohne Anmeldung'],
    ['Eingegangen', zeitstempel],
  ]

  const text = [
    'Neue Partner-Bewerbung über coolin.at',
    '',
    ...fields.map(([label, value]) => `${label}: ${value}`),
    ...meta.map(([label, value]) => `${label}: ${value}`),
    '',
    'Was der Betrieb schreibt:',
    input.message,
    '',
    'Im Admin-Bereich ansehen:',
    detailUrl,
    '',
    '—',
    'Direkt antworten geht: Die Adresse des Bewerbers ist als Reply-To gesetzt.',
  ].join('\n')

  /*
   * Inline-Styles statt Design-Tokens und bewusst schlicht — dieselbe Begründung wie in
   * `lib/kontakt/deliver.ts`: E-Mail-Clients kennen kein `var(--color-…)` und strippen
   * `<style>`-Blöcke. Diese Mail ist eine interne Benachrichtigung, kein Marken-Auftritt.
   */
  const rows = fields
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#525252;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;color:#171717"><strong>${escapeHtml(value)}</strong></td>` +
        `</tr>`,
    )
    .join('')

  // Neutral gesetzt, ohne `<strong>` — wie die „Eingegangen"-Zeile im Kontaktformular (s. o.).
  const metaRows = meta
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#525252;white-space:nowrap">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;color:#262626">${escapeHtml(value)}</td>` +
        `</tr>`,
    )
    .join('')

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626">`,
    `<h2 style="margin:0 0 16px;font-size:18px;color:#171717">Neue Partner-Bewerbung über coolin.at</h2>`,
    `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${rows}${metaRows}</table>`,
    `<p style="margin:0 0 6px;color:#525252">Was der Betrieb schreibt:</p>`,
    // `white-space:pre-wrap` erhält die Absätze des Absenders, ohne seinen Text in Markup zu
    // übersetzen — jede Übersetzung wäre eine Interpretation und ein Einfallstor (s. escapeHtml).
    `<div style="white-space:pre-wrap;padding:12px;background:#f5f5f5;border-radius:6px;color:#171717">${escapeHtml(input.message)}</div>`,
    `<p style="margin:16px 0 0"><a href="${escapeHtml(detailUrl)}" style="color:#0f766e;font-weight:600">Im Admin-Bereich ansehen</a></p>`,
    `<p style="margin:16px 0 0;font-size:13px;color:#525252">Direkt antworten geht: Die Adresse des Bewerbers ist als Reply-To gesetzt.</p>`,
    `</div>`,
  ].join('')

  const outcome = await sendMail(
    {
      to: internalRecipient(),
      subject: `Partner-Bewerbung: ${input.company} — ${name}`,
      text,
      html,
      replyTo: input.email,
    },
    'Partner-Bewerbung (interne Benachrichtigung)',
  )
  return { ok: outcome.ok }
}

export type ApplicantAcknowledgement = {
  to: string
  firstName: string
  locale: string
  /**
   * Wurde bei dieser Bewerbung ein NEUES Konto angelegt? Wenn nicht (bestehendes Konto oder bereits
   * angemeldet), sagt die Mail das — sonst wartete jemand auf eine Bestätigungsmail, die nie kommt,
   * und probierte ein Passwort, das nie gesetzt wurde.
   */
  accountCreated: boolean
}

/** Die Eingangsbestätigung an den Bewerber. */
export async function sendPartnerApplicationAcknowledgement(
  input: ApplicantAcknowledgement,
): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured(
      'Partner-Bewerbung (Eingangsbestätigung)',
      'Der Antrag ist gespeichert; die Bestätigung lässt sich nachholen.',
    )
    return { ok: false }
  }

  const t = await getTranslations({
    locale: input.locale,
    namespace: 'PartnerApplicationMail',
  })

  /*
   * DER EINE SATZ, DER VOM ZUSTAND ABHÄNGT. Er verrät nichts nach aussen: Er steht in einer Mail an
   * genau die Adresse, um deren Konto es geht — wer sie liest, weiss ohnehin, ob er ein Konto hat.
   * Ohne ihn wäre der häufigste Störfall unerklärlich („ich habe ein Passwort eingegeben und kann
   * mich nicht anmelden").
   */
  const accountLine = input.accountCreated ? t('accountCreated') : t('accountExisting')

  const text = [
    t('greeting', { name: input.firstName }),
    '',
    t('intro'),
    '',
    accountLine,
    '',
    t('next'),
    '',
    t('fallback', { email: COMPANY.email }),
    '',
    '—',
    COMPANY.name,
    COMPANY.email,
  ].join('\n')

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626">`,
    `<p style="margin:0 0 16px">${escapeHtml(t('greeting', { name: input.firstName }))}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('intro'))}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(accountLine)}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('next'))}</p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#525252">${escapeHtml(t('fallback', { email: COMPANY.email }))}</p>`,
    `<p style="margin:0;font-size:13px;color:#525252">${escapeHtml(COMPANY.name)} · <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#525252">${escapeHtml(COMPANY.email)}</a></p>`,
    `</div>`,
  ].join('')

  const outcome = await sendMail(
    { to: input.to, subject: t('subject'), text, html },
    'Partner-Bewerbung (Eingangsbestätigung)',
  )
  return { ok: outcome.ok }
}
