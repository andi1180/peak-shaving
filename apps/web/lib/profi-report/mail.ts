/*
 * Die zwei Mails der Profi-Report-Anfrage (Leadgen 4b): Bestätigung an den Kunden und interne
 * Benachrichtigung an energy@coolin.at. Inline-Styles wie `lib/schnellreport/mail.ts`.
 */
import 'server-only'
import { createTranslator } from 'next-intl'
import messages from '@/messages/de.json'
import { COMPANY } from '@/lib/nav'
import { escapeHtml, mailConfigured, sendMail, warnMailNotConfigured } from '@/lib/mail/send'
import { absoluteUrl } from '@/lib/site'
import { LEADS_HREF } from '@/lib/admin/leads'
import { SCHNELLREPORT_SETTINGS, type SchnellreportSettings } from '@/lib/schnellreport/settings'
import type { ConfirmationStatus, ProfiReportNotice } from './flow'
import type { LoadProfileAnswer, ProfiReportValues } from './request'

const t = createTranslator({ locale: 'de', messages, namespace: 'ProfiReportMail' })
const tSignature = createTranslator({ locale: 'de', messages, namespace: 'SchnellreportMail' })

const FONT = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
const MUTED = 'color:#525252'
const DASH = '—'

export type MailParts = { subject: string; text: string; html: string }

/** Bestätigung an den Kunden; Unterschrift aus den Einstellungen (eine Quelle mit Seite und PDF). */
export function buildConfirmationMail(
  values: ProfiReportValues,
  settings: SchnellreportSettings = SCHNELLREPORT_SETTINGS,
): MailParts {
  const greeting = t('greeting', { name: `${values.firstName} ${values.lastName}` })
  const signature = [
    tSignature('closing'),
    settings.contactName,
    settings.contactRole
      ? `${settings.contactRole}, ${tSignature('company')}`
      : tSignature('company'),
    settings.phone && tSignature('signaturePhone', { phone: settings.phone }),
  ].filter(Boolean) as string[]

  const text = [greeting, '', t('body'), '', ...signature].join('\n')
  const html = [
    `<div style="${FONT};font-size:15px;line-height:1.6;color:#262626;max-width:560px">`,
    `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('body'))}</p>`,
    `<p style="margin:0">${signature.map(escapeHtml).join('<br>')}</p>`,
    `</div>`,
  ].join('')
  return { subject: t('subject'), text, html }
}

export async function sendProfiReportConfirmation(
  values: ProfiReportValues,
): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured('Profi-Report-Bestätigung', 'Der Lead steht im Admin-Bereich.')
    return { ok: false }
  }
  const { subject, text, html } = buildConfirmationMail(values)
  const outcome = await sendMail(
    { to: values.email, subject, text, html, replyTo: COMPANY.email },
    'Profi-Report-Bestätigung',
  )
  return { ok: outcome.ok }
}

const LOAD_PROFILE_LABEL: Record<LoadProfileAnswer, string> = {
  ja: 'ja',
  nein: 'nein',
  unsicher: 'weiß nicht',
}

const CONFIRMATION_LABEL: Record<ConfirmationStatus, string> = {
  sent: 'versendet',
  failed: 'FEHLGESCHLAGEN — bitte selbst antworten',
  suppressed: 'nicht versendet (Adresse gesperrt)',
}

export function buildProfiReportNotice(notice: ProfiReportNotice): MailParts {
  const v = notice.values
  const url = absoluteUrl(`${LEADS_HREF}/${notice.leadId}`)
  const rows: Array<[string, string]> = [
    ['Firma', v.firma],
    ['Name', `${v.firstName} ${v.lastName}`],
    ['E-Mail', v.email],
    ['Telefon', v.phone ?? DASH],
    ['Lastgang vorhanden', LOAD_PROFILE_LABEL[v.hasLoadProfile]],
    ['Partner', notice.partner ? `${notice.partner.displayName} (${notice.partner.slug})` : DASH],
    ['Bestätigungsmail', CONFIRMATION_LABEL[notice.confirmation]],
  ]
  const title = 'Neue Anfrage zum Profi-Report über coolin.at'
  const message = v.message ?? DASH

  const text = [
    title,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Nachricht:',
    message,
    '',
    'Im Admin-Bereich:',
    url,
  ].join('\n')
  const html = [
    `<div style="${FONT};font-size:14px;line-height:1.5;color:#262626">`,
    `<p style="margin:0 0 12px;font-weight:600">${escapeHtml(title)}</p>`,
    '<table style="border-collapse:collapse;margin:0 0 16px">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:3px 12px 3px 0;${MUTED};vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>` +
        `<td style="padding:3px 0;color:#171717">${escapeHtml(value)}</td></tr>`,
    ),
    '</table>',
    `<p style="margin:0 0 4px;${MUTED}">Nachricht:</p>`,
    `<p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(message)}</p>`,
    `<p style="margin:0"><a href="${escapeHtml(url)}" style="color:#0f766e;font-weight:600">Lead im Admin-Bereich öffnen</a></p>`,
    `</div>`,
  ].join('')

  return { subject: `Profi-Report angefragt: ${v.firma}`, text, html }
}

export async function sendProfiReportNotice(notice: ProfiReportNotice): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured('Profi-Report-Benachrichtigung', 'Der Lead steht im Admin-Bereich.')
    return { ok: false }
  }
  const { subject, text, html } = buildProfiReportNotice(notice)
  const outcome = await sendMail(
    { to: COMPANY.email, subject, text, html, replyTo: notice.values.email },
    'Profi-Report-Benachrichtigung',
  )
  return { ok: outcome.ok }
}
