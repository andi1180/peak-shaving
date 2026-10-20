/*
 * Die drei Mails des Schnellreports (3b-2): Report an den Kunden (PDF im Anhang), interne
 * Benachrichtigung und „Rückruf gewünscht". Kundentexte wörtlich aus dem Prototyp
 * (`docs/prototypes/schnellreport-prototyp.html`, Abschnitt „3 · Die E-Mail") in
 * `messages/de.json` → `SchnellreportMail`. Inline-Styles wie in `lib/leads/mail.ts`.
 */
import 'server-only'
import { createTranslator } from 'next-intl'
import messages from '@/messages/de.json'
import { COMPANY } from '@/lib/nav'
import { escapeHtml, mailConfigured, sendMail, warnMailNotConfigured } from '@/lib/mail/send'
import { absoluteUrl } from '@/lib/site'
import { LEADS_HREF } from '@/lib/admin/leads'
import { kontaktHrefFor } from '@/lib/kontakt/themen'
import { formatGrouped } from '@/lib/schnellcheck'
import type { ReportMailStatus, TeamNotice } from './flow'
import type { SchnellreportValues } from './request'
import { SCHNELLREPORT_SETTINGS, type SchnellreportSettings } from './settings'

const t = createTranslator({ locale: 'de', messages, namespace: 'SchnellreportMail' })
const tCheck = createTranslator({ locale: 'de', messages, namespace: 'Schnellcheck' })
const tReport = createTranslator({ locale: 'de', messages, namespace: 'Schnellreport' })

const FONT = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
const P = 'margin:0 0 16px'
const MUTED = 'color:#525252'

/** `Schnellreport_<Firma>.pdf` — ohne Zeichen, die Dateisysteme nicht erlauben. */
export function reportFilename(firma: string): string {
  const printable = Array.from(firma, (ch) => (ch < ' ' ? ' ' : ch)).join('')
  const safe = printable
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `Schnellreport_${safe || tReport('firmaFallback')}.pdf`
}

function profiReportUrl(values: SchnellreportValues): string {
  const country = values.country === 'AT' ? tCheck('countryAT') : tCheck('countryDE')
  const message = [
    tCheck('prefillIntro'),
    tCheck('prefillCountry', { country }),
    tCheck('prefillKwh', { kwh: formatGrouped(values.kwh) }),
    values.kw !== null && tCheck('prefillKw', { kw: formatGrouped(values.kw) }),
    values.bill !== null && tCheck('prefillBill', { bill: formatGrouped(values.bill) }),
  ]
    .filter(Boolean)
    .join('\n')
  return absoluteUrl(kontaktHrefFor('profiReport', message))
}

export type ReportMailParts = { subject: string; text: string; html: string }

/** Inhalt der Kundenmail — getrennt vom Versand, damit er ohne Resend prüfbar ist. */
export function buildReportMail(
  values: SchnellreportValues,
  settings: SchnellreportSettings = SCHNELLREPORT_SETTINGS,
): ReportMailParts {
  const greeting = t('greeting', { name: `${values.firstName} ${values.lastName}` })
  const amount = tReport('aroundEur', { amount: formatGrouped(values.result.peakCostEur) })
  const profi = settings.price ? t('profiPrice', { price: settings.price }) : t('profi')
  const followUp = settings.phone
    ? `${t('followUp')} ${t('followUpPhone', { phone: settings.phone })}`
    : t('followUp')
  const signature = [
    t('closing'),
    settings.contactName,
    settings.contactRole ? `${settings.contactRole}, ${t('company')}` : t('company'),
    settings.phone && t('signaturePhone', { phone: settings.phone }),
  ].filter(Boolean) as string[]
  const url = profiReportUrl(values)

  const text = [
    greeting,
    '',
    t('intro'),
    amount,
    t('outro'),
    '',
    profi,
    `${t('button')}: ${url}`,
    '',
    followUp,
    '',
    ...signature,
  ].join('\n')

  const html = [
    `<div style="${FONT};font-size:15px;line-height:1.6;color:#262626;max-width:560px">`,
    `<p style="${P}">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 6px">${escapeHtml(t('intro'))}</p>`,
    `<p style="margin:0 0 6px;font-size:28px;font-weight:700;color:#b91c1c;font-variant-numeric:tabular-nums">${escapeHtml(amount)}</p>`,
    `<p style="${P}">${escapeHtml(t('outro'))}</p>`,
    `<p style="${P}">${escapeHtml(profi)}</p>`,
    `<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0f766e;color:#ffffff;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:8px">${escapeHtml(t('button'))}</a></p>`,
    `<p style="${P};font-size:14px;${MUTED}">${escapeHtml(followUp)}</p>`,
    `<p style="margin:0">${signature.map(escapeHtml).join('<br>')}</p>`,
    `</div>`,
  ].join('')

  return { subject: t('subject'), text, html }
}

export async function sendSchnellreportMail(input: {
  to: string
  values: SchnellreportValues
  pdf: Buffer
}): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured('Schnellreport-Mail', 'Lead und Einwilligung stehen.')
    return { ok: false }
  }
  const { subject, text, html } = buildReportMail(input.values)
  return sendMail(
    {
      to: input.to,
      subject,
      text,
      html,
      replyTo: COMPANY.email,
      attachments: [{ filename: reportFilename(input.values.firma), content: input.pdf }],
    },
    'Schnellreport-Mail',
  )
}

/* ─── Intern ───────────────────────────────────────────────────────────────────────────────────── */

const DASH = '—'

function leadUrl(leadId: string): string {
  return absoluteUrl(`${LEADS_HREF}/${leadId}`)
}

function table(rows: Array<[string, string]>): string {
  return [
    '<table style="border-collapse:collapse;margin:0 0 16px">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:3px 12px 3px 0;${MUTED};vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>` +
        `<td style="padding:3px 0;color:#171717">${escapeHtml(value)}</td></tr>`,
    ),
    '</table>',
  ].join('')
}

function internalMail(title: string, rows: Array<[string, string]>, url: string) {
  const text = [
    title,
    '',
    ...rows.map(([l, v]) => `${l}: ${v}`),
    '',
    'Im Admin-Bereich:',
    url,
  ].join('\n')
  const html = [
    `<div style="${FONT};font-size:14px;line-height:1.5;color:#262626">`,
    `<p style="margin:0 0 12px;font-weight:600">${escapeHtml(title)}</p>`,
    table(rows),
    `<p style="margin:0"><a href="${escapeHtml(url)}" style="color:#0f766e;font-weight:600">Lead im Admin-Bereich öffnen</a></p>`,
    `</div>`,
  ].join('')
  return { text, html }
}

const REPORT_MAIL_LABEL: Record<ReportMailStatus, string> = {
  sent: 'versendet',
  failed: 'FEHLGESCHLAGEN — bitte nachsenden',
  suppressed: 'nicht versendet (Adresse gesperrt)',
}

export function buildTeamNotice(notice: TeamNotice) {
  const v = notice.values
  const eur = (n: number) => tReport('eur', { amount: formatGrouped(n) })
  const rows: Array<[string, string]> = [
    ['Firma', v.firma],
    ['Name', `${v.firstName} ${v.lastName}`],
    ['E-Mail', v.email],
    ['Telefon', v.phone ?? DASH],
    ['Branche', tReport(`branchen.${v.branche}.label`)],
    ['Land', v.country === 'AT' ? 'Österreich' : 'Deutschland'],
    ['Jahresverbrauch', `${formatGrouped(v.kwh)} kWh`],
    [
      'Höchste Leistung',
      v.kw !== null
        ? `${formatGrouped(v.kw)} kW (eingegeben)`
        : `${formatGrouped(v.sliderKw)} kW (Reglerwert, Beispiel)`,
    ],
    ['Stromrechnung', v.bill !== null ? `${eur(v.bill)} pro Jahr` : DASH],
    ['Leistungspreis', `${formatGrouped(v.result.demandPrice)} €/kW·a`],
    ['Ergebnis', `${eur(v.result.peakCostEur)} Spitzenkosten pro Jahr`],
    ['Tipp-Mails', v.tips ? 'ja (Bestätigung angefordert)' : 'nein'],
    ['Report-Mail', REPORT_MAIL_LABEL[notice.reportMail]],
  ]
  return {
    subject: `Schnellreport angefordert: ${v.firma}`,
    ...internalMail('Neuer Schnellreport über coolin.at', rows, leadUrl(notice.leadId)),
  }
}

export async function sendSchnellreportTeamNotice(notice: TeamNotice): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured('Schnellreport-Benachrichtigung', 'Der Lead steht im Admin-Bereich.')
    return { ok: false }
  }
  const { subject, text, html } = buildTeamNotice(notice)
  return sendMail(
    { to: COMPANY.email, subject, text, html, replyTo: notice.values.email },
    'Schnellreport-Benachrichtigung',
  )
}

export async function sendSchnellreportCallbackNotice(notice: {
  leadId: string
  email: string
  phone: string
}): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured('Rückruf-Benachrichtigung', 'Der Lead steht im Admin-Bereich.')
    return { ok: false }
  }
  const rows: Array<[string, string]> = [
    ['Telefon', notice.phone],
    ['E-Mail', notice.email],
    ['Zusage', 'innerhalb eines Werktags'],
  ]
  const { text, html } = internalMail(
    'Rückruf gewünscht (Schnellreport)',
    rows,
    leadUrl(notice.leadId),
  )
  return sendMail(
    {
      to: COMPANY.email,
      subject: 'Rückruf gewünscht (Schnellreport)',
      text,
      html,
      replyTo: notice.email,
    },
    'Rückruf-Benachrichtigung',
  )
}
