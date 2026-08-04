/**
 * DIE ZWEI MAILS EINER KALKULATOR-ANFRAGE (B18-4) — beide über den bestehenden Resend-Weg
 * (`lib/mail/send.ts`), beide von `energy@coolin.at` (dort als `MAIL_FROM` begründet).
 *
 *   1. AN COOLIN, bei einer NEUEN Anfrage: die interne Benachrichtigung. An dieselbe Adresse wie
 *      Kontaktformular und Partner-Bewerbung (`RESEND_TO`, sonst `COMPANY.email`) — s. u.
 *   2. AN DEN FACHBETRIEB, bei der FREIGABE: die Nachricht, dass der Zugang steht.
 *
 * ── DIE INTERNE ADRESSE WIRD AUFGELÖST, NICHT GETIPPT ───────────────────────────────────────────
 * `RESEND_TO ?? COMPANY.email` ist die etablierte Auflösung dieses Systems (`lib/kontakt/deliver.ts`
 * seit B1-2, `lib/partner-application/mail.ts` seit B16-3) und ergibt ohne gesetzte Variable genau
 * `energy@coolin.at` — die geforderte Adresse. Eine zweite, hier hart getippte Kopie wäre die
 * Stelle, die bei einem Postfachwechsel still auf das alte Postfach zeigt: kein Fehler, die Mails
 * gingen einfach woanders hin.
 *
 * ── ⚠ KEINE TIEFEN LINKS AUF ROUTEN, DIE ES NOCH NICHT GIBT ────────────────────────────────────
 * B18-4 ist Schema und Schreibweg; die Oberfläche (Portal-Reiter „Peak Shaving", Admin-Eingang für
 * die Anfragen) ist der nächste, eigene Schritt. Beide Mails verweisen deshalb ausschliesslich auf
 * Adressen, die HEUTE antworten — den Admin-Bereich (`/admin`) und die Wurzel des Portal-Hosts —
 * und benennen den Bereich im Text. Ein vorweggenommener Deep-Link wäre bis zum nächsten Schritt
 * ein 404 in einer echten Mail, und er koppelte den Wortlaut an einen Pfad, den es noch nicht gibt.
 * Wer die Oberfläche baut, ersetzt genau diese zwei Ziele.
 *
 * ── KEIN DOUBLE-OPT-IN, KEINE EINWILLIGUNG, KEIN ABMELDELINK ────────────────────────────────────
 * Die Regel aus B1-1 verlangt eine Bestätigung, sobald die Erfüllung eine KÜNFTIGE E-Mail ist
 * (`platform.purpose_requires_double_opt_in`). Hier ist die Zustellung sofort und die Nachricht die
 * Antwort auf einen Vorgang, den der Empfänger selbst angestossen hat — transaktional, wie die
 * Freischaltungsmail (B16-4b) und die Eingangsbestätigung (B16-3). Es entsteht kein neuer
 * `consent_purpose` und keine Einwilligungszeile; Rechtsgrundlage ist die bestehende
 * Vertragsbeziehung zum Fachbetrieb. Folgerichtig auch KEINE `List-Unsubscribe`-Kopfzeilen:
 * abgemeldet werden kann eine Aussendung, nicht die eine Nachricht, die einen Zugang mitteilt.
 *
 * ── ⚠ KEINE ZUSAGE, KEIN VERSPRECHEN ────────────────────────────────────────────────────────────
 * Keine Bearbeitungsdauer für die Prüfung, kein Preis, keine Laufzeit, keine Zusage über den
 * Umfang des Zugangs. Dieselbe Linie wie bei den übrigen Partner-Texten — und hier schärfer, weil
 * der Empfänger ein Betrieb ist, mit dem eine Geschäftsbeziehung besteht: Was hier steht, ist im
 * Zweifel zugesagt.
 *
 * ── ⚠ ARBEITSSTAND DER TEXTE ────────────────────────────────────────────────────────────────────
 * Die Formulierungen der Freischaltungsmail stehen unter `CalculatorRequestMail.*` in
 * `messages/de.json` und tragen dort einen Vermerk; die endgültigen kommen von Andreas/Martina. Die
 * INTERNE Mail trägt ihre deutschen Sätze im Code — dasselbe Muster wie `lib/kontakt/deliver.ts`
 * und `lib/partner-application/mail.ts`: sie ist eine Nachricht ans eigene Postfach, kein
 * nutzergerichteter Text.
 */
import 'server-only'
import { getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { ADMIN_HREF } from '@/lib/admin/config'
import { serverEnv } from '@/lib/env.server'
import { escapeHtml, mailConfigured, sendMail, warnMailNotConfigured } from '@/lib/mail/send'
import { COMPANY } from '@/lib/nav'
import { absoluteUrl } from '@/lib/site'
import { portalEntryUrl } from '@/lib/portal-host'

/** Wien, nicht UTC: die Mail wird von Menschen in Wien gelesen (wie `lib/kontakt/deliver.ts`). */
const TIMESTAMP = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Europe/Vienna',
})

/** s. Kopf: die etablierte Auflösung, keine zweite getippte Adresse. */
function internalRecipient(): string {
  return serverEnv.RESEND_TO ?? COMPANY.email
}

export type CalculatorRequestNotification = {
  requestId: string
  partnerSlug: string
  partnerDisplayName: string
  /**
   * Die Adresse des anfragenden Kontos — sie kommt aus der SITZUNG des Fachbetriebs, nicht aus einem
   * Formularfeld (`readPortal`, B18-3). Sie wird als `replyTo` gesetzt, damit sich aus dem Postfach
   * heraus antworten lässt, ohne sie aus dem Text zu kopieren (dieselbe Eigenschaft, die das
   * Kontaktformular wertvoll macht). `from` MUSS unsere verifizierte Domain bleiben (SPF/DKIM).
   */
  accountEmail: string | null
  message: string
}

/**
 * Die interne Benachrichtigung über eine neue Anfrage. WIRFT NIE.
 *
 * Der Rückgabewert wird vom Aufrufer bewusst NICHT ausgewertet: Die Anfrage steht in der Datenbank,
 * und ein Mailproblem darf dem Fachbetrieb nicht als Fehlschlag seiner Einreichung zurückgemeldet
 * werden — die naheliegende Reaktion (nochmal absenden) liefe in `already_pending`.
 */
export async function sendCalculatorRequestNotification(
  input: CalculatorRequestNotification,
): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured(
      'Kalkulator-Anfrage (interne Benachrichtigung)',
      'Die Anfrage ist gespeichert und steht im Admin-Bereich unter den Kalkulator-Anfragen.',
    )
    return { ok: false }
  }

  const adminUrl = absoluteUrl(ADMIN_HREF)
  const zeitstempel = TIMESTAMP.format(new Date())

  /*
   * ZWEI BLÖCKE, WEIL SIE ZWEI VERSCHIEDENE DINGE SIND — dieselbe Trennung wie in
   * `lib/partner-application/mail.ts`: Was der BETRIEB angegeben hat, steht hervorgehoben; was
   * UNSER SYSTEM dazu vermerkt hat, steht neutral daneben. Wer die Mail liest, entscheidet über
   * einen Produktzugang und muss fremde Behauptung von eigener Feststellung unterscheiden können.
   */
  const fields: Array<[string, string]> = [
    ['Fachbetrieb', input.partnerDisplayName],
    ['Kurz-Key', input.partnerSlug],
    ['Konto', input.accountEmail ?? '—'],
  ]

  const meta: Array<[string, string]> = [['Eingegangen', zeitstempel]]

  const text = [
    'Neue Kalkulator-Anfrage aus dem Partner-Portal',
    '',
    ...fields.map(([label, value]) => `${label}: ${value}`),
    ...meta.map(([label, value]) => `${label}: ${value}`),
    '',
    'Begründung des Betriebs:',
    input.message,
    '',
    'Entscheiden im Admin-Bereich unter „Kalkulator-Anfragen":',
    adminUrl,
    '',
    '—',
    'Direkt antworten geht: Die Adresse des Betriebs ist als Reply-To gesetzt.',
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
    `<h2 style="margin:0 0 16px;font-size:18px;color:#171717">Neue Kalkulator-Anfrage aus dem Partner-Portal</h2>`,
    `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${rows}${metaRows}</table>`,
    `<p style="margin:0 0 6px;color:#525252">Begründung des Betriebs:</p>`,
    // `white-space:pre-wrap` erhält die Absätze des Absenders, ohne seinen Text in Markup zu
    // übersetzen — jede Übersetzung wäre eine Interpretation und ein Einfallstor (s. escapeHtml).
    `<div style="white-space:pre-wrap;padding:12px;background:#f5f5f5;border-radius:6px;color:#171717">${escapeHtml(input.message)}</div>`,
    `<p style="margin:16px 0 0"><a href="${escapeHtml(adminUrl)}" style="color:#0f766e;font-weight:600">Im Admin-Bereich entscheiden</a></p>`,
    `<p style="margin:16px 0 0;font-size:13px;color:#525252">Direkt antworten geht: Die Adresse des Betriebs ist als Reply-To gesetzt.</p>`,
    `</div>`,
  ].join('')

  const outcome = await sendMail(
    {
      to: internalRecipient(),
      subject: `Kalkulator-Anfrage: ${input.partnerDisplayName}`,
      text,
      html,
      ...(input.accountEmail ? { replyTo: input.accountEmail } : {}),
    },
    'Kalkulator-Anfrage (interne Benachrichtigung)',
  )
  return { ok: outcome.ok }
}

export type CalculatorRequestApprovalMail = {
  to: string
  /** `null` = keine Ansprechperson hinterlegt; die Mail benutzt dann eine neutrale Anrede. */
  firstName: string | null
  displayName: string
}

/**
 * Die Freischaltungsmail an den Fachbetrieb. WIRFT NIE.
 *
 * ── KEIN AKTIVIERUNGSLINK, UND DAS IST DER UNTERSCHIED ZU B18-2a ────────────────────────────────
 * Die Freischaltungsmail des PARTNERZUGANGS trägt einen Einmal-Token, weil sie ein Konto bestätigt,
 * das noch niemand benutzt hat — der Klick ist dort der Beweis, dass der Empfänger das Postfach
 * lesen kann. Hier ist der Betrieb bereits angemeldet: Er hat die Anfrage aus seinem Portal heraus
 * gestellt, seine Identität steht fest. Ein Token wäre eine Identitätsprüfung ohne offene Frage —
 * und ein weiterer Weg, auf dem eine Sitzung entstehen kann, wo keiner gebraucht wird.
 *
 * Die Mail ist deshalb rein informativ: Sie sagt, dass der Zugang steht, und wo er liegt.
 *
 * Der Rückgabewert entscheidet, ob `notified_at` gesetzt wird — deshalb ist er die einzige Aussage,
 * die diese Funktion machen darf: `ok: false` heisst „nicht zugestellt", und der Vermerk unterbleibt.
 */
export async function sendCalculatorRequestApprovalMail(
  input: CalculatorRequestApprovalMail,
): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured(
      'Kalkulator-Freigabe (Benachrichtigung an den Fachbetrieb)',
      'Der Zugang IST freigeschaltet, der Betrieb weiss es nur nicht. Der Versand lässt sich ' +
        'nachholen; die Anfrage steht dafür weiterhin ohne Versandvermerk.',
    )
    return { ok: false }
  }

  /*
   * Die Locale ist die Vorgabe-Locale und kein Parameter — dieselbe Begründung wie in
   * `lib/partner-portal/mail.ts`: Diese Mail entsteht aus einer ADMIN-Handlung, nicht aus einem
   * Seitenaufruf des Empfängers; es gibt keinen Request, dessen Sprache man übernehmen könnte, und
   * `platform.partners` führt keine Sprachpräferenz.
   */
  const t = await getTranslations({
    locale: routing.defaultLocale,
    namespace: 'CalculatorRequestMail',
  })

  // s. Kopf: die Wurzel des Portal-Hosts, kein Deep-Link auf den erst kommenden Reiter.
  const portalUrl = portalEntryUrl()
  const greeting = input.firstName ? t('greeting', { name: input.firstName }) : t('greetingNeutral')

  const text = [
    greeting,
    '',
    t('intro', { company: input.displayName }),
    '',
    t('portalLead'),
    portalUrl,
    '',
    t('note'),
    '',
    t('fallback', { email: COMPANY.email }),
    '',
    '—',
    COMPANY.name,
    COMPANY.email,
  ].join('\n')

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626">`,
    `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('intro', { company: input.displayName }))}</p>`,
    `<p style="margin:0 0 12px">${escapeHtml(t('portalLead'))}</p>`,
    `<p style="margin:0 0 20px"><a href="${escapeHtml(portalUrl)}" style="color:#0f766e;font-weight:600">${escapeHtml(portalUrl)}</a></p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('note'))}</p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#525252">${escapeHtml(t('fallback', { email: COMPANY.email }))}</p>`,
    `<p style="margin:0;font-size:13px;color:#525252">${escapeHtml(COMPANY.name)} · <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#525252">${escapeHtml(COMPANY.email)}</a></p>`,
    `</div>`,
  ].join('')

  const outcome = await sendMail(
    { to: input.to, subject: t('subject'), text, html },
    'Kalkulator-Freigabe (Benachrichtigung an den Fachbetrieb)',
  )
  return { ok: outcome.ok }
}
