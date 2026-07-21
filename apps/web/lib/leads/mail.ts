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
import { COMPANY, CTA_HREF } from '@/lib/nav'
import { absoluteUrl } from '@/lib/site'
import {
  QUICK_DECIMAL,
  QUICK_EUR,
  type QuickCalculatorInputs,
  type QuickCalculatorResult,
} from '@/lib/schnellrechner'

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
  if (!serverEnv.RESEND_API_KEY || !serverEnv.RESEND_FROM) {
    warnNotConfigured(
      'Bestätigungsmail',
      'Die Einwilligung bleibt unbestätigt (pending) und damit wirkungslos.',
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

  return deliver({ to: input.to, subject: t('subject'), text, html }, 'Bestätigungsmail')
}

/* ─── Gemeinsamer Versandweg ──────────────────────────────────────────────────────────────────── */

function warnNotConfigured(what: string, consequence: string): void {
  const missing = [
    !serverEnv.RESEND_API_KEY && 'RESEND_API_KEY',
    !serverEnv.RESEND_FROM && 'RESEND_FROM',
  ]
    .filter(Boolean)
    .join(', ')
  console.warn(`[leads] ${what} NICHT versendet — ${missing} fehlt. ${consequence}`)
}

/**
 * Der eine Resend-Aufruf beider Lead-Mails.
 *
 * Wirft NICHT: beide Aufrufer laufen weiter, wenn der Versand scheitert (die Begründungen stehen an
 * ihnen). Die Empfängeradresse steht in keinem Log-Text — ein Fehlerlog ist kein zulässiger zweiter
 * Speicherort für Personenbezug.
 */
async function deliver(
  message: { to: string; subject: string; text: string; html: string },
  label: string,
): Promise<ConsentMailOutcome> {
  const apiKey = serverEnv.RESEND_API_KEY
  const from = serverEnv.RESEND_FROM
  if (!apiKey || !from) return { ok: false, reason: 'not_configured' }

  try {
    // Dynamischer Import wie in `lib/kontakt/deliver.ts`: ohne Key kostet ein Aufruf keinen
    // Modul-Load.
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    const { error } = await resend.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })

    if (error) {
      console.error(`[leads] Resend hat die ${label} abgelehnt:`, error)
      return { ok: false, reason: 'send_failed' }
    }
    return { ok: true }
  } catch (cause) {
    console.error(`[leads] Resend-Aufruf für die ${label} fehlgeschlagen:`, cause)
    return { ok: false, reason: 'send_failed' }
  }
}

/* ─── Zusendung des Rechenergebnisses (B3-2, 'rechnerergebnis') ───────────────────────────────── */

export type CalculatorResultMail = {
  to: string
  locale: string
  /** Die drei Eingaben — so, wie sie im Schnellrechner heissen. */
  inputs: QuickCalculatorInputs
  /** Das SERVERSEITIG nachgerechnete Ergebnis (s. `lib/schnellrechner.ts`). */
  result: QuickCalculatorResult
}

/**
 * Schickt das Ergebnis des Schnellrechners zu.
 *
 * ── WAS DIESE MAIL BEWUSST NICHT IST ─────────────────────────────────────────────────────────────
 * KEIN PDF, KEINE ANLAGE. Das Versprechen am Formular lautet „Ergebnis per E-Mail" — und genau das
 * wird eingelöst: die drei eingegebenen Werte, die daraus gerechnete Zahl und die Formel, die sie
 * ergibt. Ein Dokument wäre mehr Bau (Rendering, Speicher, Zustellbarkeit von Anhängen) für
 * weniger Nutzen; der Empfänger will die Zahl, nicht eine Datei.
 *
 * KEINE WERBUNG. Die Grundlage ist 'result_delivery' — die Zusendung des angeforderten Ergebnisses.
 * Ein Angebot in derselben Mail wäre eine werbliche Aussendung ohne die dafür nötige Einwilligung.
 * Der einzige Link zeigt auf den Kalkulator, also auf die Fortsetzung derselben Rechnung, und er
 * steht als das, was er ist.
 *
 * Zahlen und Formel sind bit-identisch zur Bildschirmanzeige (`QUICK_EUR`/`QUICK_DECIMAL` und
 * dieselben Beschriftungen aus `QuickCalculator.*`) — eine Mail, die andere Beträge zeigt als das
 * Formular, ist schlimmer als gar keine.
 */
export async function sendCalculatorResultMail(
  input: CalculatorResultMail,
): Promise<ConsentMailOutcome> {
  if (!serverEnv.RESEND_API_KEY || !serverEnv.RESEND_FROM) {
    warnNotConfigured(
      'Ergebnis-Mail',
      'Lead und Einwilligung stehen; die Zusendung lässt sich nachholen.',
    )
    return { ok: false, reason: 'not_configured' }
  }

  const t = await getTranslations({ locale: input.locale, namespace: 'LeadMail.result' })
  // Dieselben Feldbeschriftungen wie im Formular — der Empfänger soll seine Eingaben wiedererkennen.
  const tCalc = await getTranslations({ locale: input.locale, namespace: 'QuickCalculator' })

  const rows: Array<[string, string]> = [
    [tCalc('peakLabel'), QUICK_DECIMAL.format(input.inputs.peakKw)],
    [tCalc('reductionLabel'), QUICK_DECIMAL.format(input.inputs.reductionKw)],
    [tCalc('priceLabel'), QUICK_DECIMAL.format(input.inputs.pricePerKwYear)],
  ]

  const formula = tCalc('formula', {
    reduction: QUICK_DECIMAL.format(input.result.effectiveReductionKw),
    price: QUICK_DECIMAL.format(input.inputs.pricePerKwYear),
  })
  const saving = QUICK_EUR.format(input.result.savingEur)
  const calculatorUrl = absoluteUrl(CTA_HREF)

  const text = [
    t('greeting'),
    '',
    t('intro'),
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `${tCalc('resultLabel')}: ${saving}`,
    formula,
    // Wurde die Zielreduktion auf die Spitze geklemmt, MUSS das mit — sonst steht in der Mail eine
    // Zahl, die aus den daneben gezeigten Eingaben nicht folgt.
    ...(input.result.capped
      ? [tCalc('hintCapped', { value: QUICK_DECIMAL.format(input.inputs.peakKw) })]
      : []),
    '',
    tCalc('disclaimer'),
    '',
    t('cta'),
    calculatorUrl,
    '',
    '—',
    COMPANY.name,
    COMPANY.email,
  ].join('\n')

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626">`,
    `<p style="margin:0 0 16px">${escapeHtml(t('greeting'))}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('intro'))}</p>`,
    `<table style="border-collapse:collapse;margin:0 0 20px">`,
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#525252">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;font-variant-numeric:tabular-nums;color:#171717">${escapeHtml(value)}</td></tr>`,
    ),
    `</table>`,
    `<p style="margin:0 0 4px;color:#525252">${escapeHtml(tCalc('resultLabel'))}</p>`,
    `<p style="margin:0 0 4px;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;color:#0f766e">${escapeHtml(saving)}</p>`,
    `<p style="margin:0 0 20px;font-size:13px;color:#525252">${escapeHtml(formula)}</p>`,
    ...(input.result.capped
      ? [
          `<p style="margin:0 0 20px;font-size:13px;color:#525252">${escapeHtml(
            tCalc('hintCapped', { value: QUICK_DECIMAL.format(input.inputs.peakKw) }),
          )}</p>`,
        ]
      : []),
    `<p style="margin:0 0 16px;font-size:13px;color:#525252">${escapeHtml(tCalc('disclaimer'))}</p>`,
    `<p style="margin:0 0 20px"><a href="${escapeHtml(calculatorUrl)}" style="color:#0f766e;font-weight:600">${escapeHtml(t('cta'))}</a></p>`,
    `<p style="margin:0;font-size:13px;color:#525252">${escapeHtml(COMPANY.name)} · <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#525252">${escapeHtml(COMPANY.email)}</a></p>`,
    `</div>`,
  ].join('')

  return deliver({ to: input.to, subject: t('subject'), text, html }, 'Ergebnis-Mail')
}
