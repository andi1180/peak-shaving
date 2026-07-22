/**
 * Die ausgehenden Lead-Mails — alle über denselben Resend-Pfad wie `lib/kontakt/deliver.ts`.
 *
 * Bestätigungsmail des Double-Opt-in (B1-2) · Zusendung des Rechenergebnisses (B3-2) ·
 * Vertragsablauf-Erinnerung (B4-2, die erste automatisch ausgelöste Mail des Systems).
 *
 * ── WAS DIE BESTÄTIGUNGSMAIL IST UND WAS SIE NICHT IST ───────────────────────────────────────────
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
import { COMPANY, CTA_HREF } from '@/lib/nav'
import {
  escapeHtml,
  mailConfigured,
  sendMail,
  warnMailNotConfigured,
  type MailOutcome,
} from '@/lib/mail/send'
import { absoluteUrl } from '@/lib/site'
import {
  QUICK_DECIMAL,
  QUICK_EUR,
  type QuickCalculatorInputs,
  type QuickCalculatorResult,
} from '@/lib/schnellrechner'
import { unsubscribeHeaders, unsubscribeUrls } from './tokens'

/**
 * Der kostenlose, unabhängige Tarifvergleich der E-Control (B4-2).
 *
 * Steht als Konstante hier und NICHT im Nachrichtenkatalog: eine URL ist keine Übersetzung. Und sie
 * gehört in die Erinnerungsmail und nicht auf eine eigene Vergleichsseite — Fahrplan_2026.md hat den
 * Eigenbau eines Tarifvergleichs am 20.07.2026 ausdrücklich eingestellt, weil E-Control dieselbe
 * Funktion kostenlos und mit gesetzlich erzwungener Vollständigkeit betreibt.
 */
const ECONTROL_TARIFKALKULATOR_URL = 'https://www.e-control.at/tarifkalkulator'

/**
 * Der Versandweg selbst steht seit B16-3 in `lib/mail/send.ts` — dieselbe Funktion, nur nicht mehr
 * privat in dieser Datei, weil die Partner-Bewerbung sie ebenfalls braucht und keine Lead-Mail ist.
 * Verhaltensgleich; der Typ bleibt unter seinem bisherigen Namen erhalten, damit kein Aufrufer
 * angefasst werden muss.
 */
export type ConsentMailOutcome = MailOutcome

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
  if (!mailConfigured()) {
    warnMailNotConfigured(
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

  return sendMail({ to: input.to, subject: t('subject'), text, html }, 'Bestätigungsmail')
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
  if (!mailConfigured()) {
    warnMailNotConfigured(
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

  return sendMail({ to: input.to, subject: t('subject'), text, html }, 'Ergebnis-Mail')
}

/* ─── Vertragsablauf-Erinnerung (B4-2, 'contract_expiry_reminder') ────────────────────────────── */

export type ContractReminderMail = {
  to: string
  locale: string
  /** Für den Abmeldelink und die List-Unsubscribe-Kopfzeilen. */
  leadId: string
  /** Der von der Person genannte Versorger — `null`, wenn er nicht erhoben wurde. */
  supplier: string | null
  /** Reines Datum („YYYY-MM-DD"), wie es in `platform.leads.contract_end_date` steht. */
  contractEndDate: string
}

/** Vertragsende als deutsches Datum. Fällt auf den Rohwert zurück, statt „Invalid Date" zu senden. */
const CONTRACT_DATE = new Intl.DateTimeFormat('de-AT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatContractEnd(isoDate: string): string {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isNaN(parsed) ? isoDate : CONTRACT_DATE.format(new Date(parsed))
}

/**
 * Die Vertragsablauf-Erinnerung — die ERSTE automatisch ausgelöste Mail dieses Systems.
 *
 * ── DIESE MAIL ENTHÄLT KEIN ANGEBOT UND KEINE BEWERBUNG EIGENER LEISTUNGEN ──────────────────────
 * Auch dann nicht, wenn derselbe Lead zusätzlich eine bestätigte Marketing-Einwilligung besitzt.
 * Drei Gründe, und der dritte ist der wichtigste:
 *
 *  1. Die Einwilligung, auf der diese Mail beruht, lautet auf eine ERINNERUNG, nicht auf Werbung.
 *     Genau dafür sind die Zwecke in B1-1 getrennt — `contract_expiry_reminder` ist ausdrücklich
 *     NICHT `marketing_email`.
 *  2. Hinge der INHALT vom Vorliegen einer zweiten Einwilligung ab, hinge der rechtliche Charakter
 *     der Mail an einem Zustand, der sich später ändert. Im Nachhinein wäre nicht mehr prüfbar, was
 *     im Moment des Versands drinstand — der Nachweis führte sich selbst vor.
 *  3. Die Zurückhaltung IST hier das Vertrauensargument, nicht der Verzicht darauf. Wer eine
 *     Erinnerung bestellt und eine Erinnerung bekommt — und sonst nichts —, wird beim nächsten Mal
 *     wieder etwas von uns annehmen. Ein untergeschobenes Angebot verkauft eine Mail und verliert
 *     einen Kontakt.
 *
 * Der einzige Link im Rumpf zeigt deshalb auf den KOSTENLOSEN Tarifkalkulator der E-Control — den
 * unabhängigen, gesetzlich zur Vollständigkeit verpflichteten Vergleichsweg (Fahrplan_2026.md:
 * „kostenlos ist alles, was reine Rechenlogik oder Weiterleitung ist"). Kein Link auf eigene
 * Leistungsseiten, kein CTA, kein Preis.
 *
 * ── ABMELDUNG ───────────────────────────────────────────────────────────────────────────────────
 * Abmeldelink im Fuss UND die beiden RFC-8058-Kopfzeilen über `unsubscribeHeaders` (B1-2). Dieser
 * Helfer wurde damals gebaut und bis heute nicht verbraucht — dies ist sein erster Konsument.
 */
export async function sendContractReminderMail(
  input: ContractReminderMail,
): Promise<ConsentMailOutcome> {
  if (!mailConfigured()) {
    warnMailNotConfigured(
      'Vertragsablauf-Erinnerung',
      'Der Versand wird als Fehlschlag protokolliert und NICHT automatisch wiederholt.',
    )
    return { ok: false, reason: 'not_configured' }
  }

  const t = await getTranslations({ locale: input.locale, namespace: 'LeadMail.contractReminder' })
  const endDate = formatContractEnd(input.contractEndDate)

  const { page: unsubscribeUrl } = unsubscribeUrls(input.leadId, 'contract_expiry_reminder')
  const headers = unsubscribeHeaders(input.leadId, 'contract_expiry_reminder', COMPANY.email)

  const facts: Array<[string, string]> = [
    // Der Versorger fährt nur mit, wenn er erhoben wurde — eine leere Zeile „Ihr Versorger: —"
    // sähe aus, als hätten wir etwas verloren.
    ...(input.supplier ? ([[t('supplierLabel'), input.supplier]] as Array<[string, string]>) : []),
    [t('endLabel'), endDate],
  ]

  const text = [
    t('greeting'),
    '',
    t('intro'),
    '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    '',
    t('compareIntro'),
    ECONTROL_TARIFKALKULATOR_URL,
    '',
    t('note'),
    '',
    `${t('unsubscribe')}: ${unsubscribeUrl}`,
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
    ...facts.map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#525252">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;font-variant-numeric:tabular-nums;color:#171717">${escapeHtml(value)}</td></tr>`,
    ),
    `</table>`,
    `<p style="margin:0 0 12px">${escapeHtml(t('compareIntro'))}</p>`,
    `<p style="margin:0 0 20px"><a href="${ECONTROL_TARIFKALKULATOR_URL}" style="color:#0f766e;font-weight:600">${escapeHtml(t('compareCta'))}</a></p>`,
    `<p style="margin:0 0 20px;font-size:13px;color:#525252">${escapeHtml(t('note'))}</p>`,
    `<p style="margin:0 0 8px;font-size:13px;color:#525252"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#525252">${escapeHtml(t('unsubscribe'))}</a></p>`,
    `<p style="margin:0;font-size:13px;color:#525252">${escapeHtml(COMPANY.name)} · <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#525252">${escapeHtml(COMPANY.email)}</a></p>`,
    `</div>`,
  ].join('')

  return sendMail(
    { to: input.to, subject: t('subject', { date: endDate }), text, html, headers },
    'Vertragsablauf-Erinnerung',
  )
}
