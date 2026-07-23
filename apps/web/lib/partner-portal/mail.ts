/**
 * DIE GENEHMIGUNGSMAIL AN DEN FACHBETRIEB (B16-4b) — über den bestehenden Resend-Weg
 * (`lib/mail/send.ts`, seit B16-3 aus `lib/leads/mail.ts` herausgezogen).
 *
 * Sie ist die Nachricht, die B16-4a bewusst offengelassen hat: Dort steht nach jeder Genehmigung im
 * Klartext, dass der Betrieb angelegt, aber NICHT benachrichtigt ist. Diese Mail schliesst genau
 * diese Lücke — und sie ist der erste nutzergerichtete Text dieses Systems, der einen ZUGANG
 * ankündigt statt einen Eingang zu bestätigen.
 *
 * ── VIER DINGE STEHEN DRIN, UND JEDES AUS EINEM GRUND ───────────────────────────────────────────
 *   1. Die Bestätigung, dass die Aufnahme durch ist. Ohne sie ist der Rest kontextlos.
 *   2. Der persönliche Empfehlungslink, VOLLSTÄNDIG. Er ist der eigentliche Gegenstand der
 *      Partnerschaft; ihn nur im Portal zu zeigen hiesse, den Betrieb für die eine Angabe, die er
 *      sofort braucht, erst durch eine Anmeldung zu schicken.
 *   3. Der Verweis auf das Portal — dort liegen die Vorlagen, und dort steht der Link dauerhaft
 *      (eine Mail wird verlegt).
 *   4. Womit man sich anmeldet. Der Satz ist der einzige, der vom Zustand abhängt (s. unten).
 *
 * ── KEIN DOUBLE-OPT-IN, KEINE EINWILLIGUNG, KEIN ABMELDELINK ────────────────────────────────────
 * Die Regel aus B1-1 verlangt eine Bestätigung, sobald die Erfüllung eine KÜNFTIGE E-Mail ist
 * (`platform.purpose_requires_double_opt_in`). Hier ist die Zustellung sofort und die Nachricht die
 * Antwort auf einen Vorgang, den der Empfänger selbst angestossen hat (seine Bewerbung) bzw. auf
 * eine Vereinbarung, die besteht — transaktional, wie die Eingangsbestätigung (B16-3) und die
 * Zusendung des Rechenergebnisses (`result_delivery`, B3-2). Es entsteht kein neuer
 * `consent_purpose` und keine Einwilligungszeile; Rechtsgrundlage ist die Vertragsbeziehung.
 * Folgerichtig auch KEINE `List-Unsubscribe`-Kopfzeilen (`unsubscribeHeaders`, B1-2): abgemeldet
 * werden kann eine Aussendung, nicht die eine Nachricht, die einen Zugang mitteilt.
 *
 * ── ⚠ KEINE ZUSAGE, KEIN VERSPRECHEN ────────────────────────────────────────────────────────────
 * Keine Provision, kein Umsatz, keine Ersparnis, keine Bearbeitungsdauer für Anfragen, die über den
 * Link kommen. Dieselbe Linie wie auf der Bewerbungsseite und der Landingpage (B16-2/B16-3) — und
 * hier schärfer, weil diese Mail an einen Betrieb geht, mit dem ab jetzt eine Geschäftsbeziehung
 * besteht: Was hier steht, ist im Zweifel zugesagt.
 *
 * ── ⚠ ARBEITSSTAND DER TEXTE ────────────────────────────────────────────────────────────────────
 * Die Formulierungen stehen unter `PartnerApprovalMail.*` in `messages/de.json` und tragen dort
 * einen Vermerk; die endgültigen kommen von Andreas/Martina. Sie stehen NICHT im Code (anders als
 * die interne Benachrichtigung in `lib/partner-application/mail.ts`), weil sie nutzergerichtet sind
 * — dieselbe Aufteilung wie bei der Eingangsbestätigung.
 */
import 'server-only'
import { getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { escapeHtml, mailConfigured, sendMail, warnMailNotConfigured } from '@/lib/mail/send'
import { COMPANY } from '@/lib/nav'
import { absoluteUrl } from '@/lib/site'
import { partnerHref } from '@/lib/leads/partner'
import { PARTNER_PORTAL_HREF } from './config'

export type PartnerApprovalMail = {
  to: string
  /** `null` = keine Ansprechperson hinterlegt; die Mail benutzt dann eine neutrale Anrede. */
  firstName: string | null
  displayName: string
  slug: string
  /** Steuert GENAU EINEN Satz — den über das Passwort. Begründung in `notify.ts`. */
  fromApplication: boolean
}

/**
 * Versendet die Benachrichtigung über den Portalzugang. WIRFT NIE.
 *
 * Der Rückgabewert entscheidet, ob `notified_at` gesetzt wird — deshalb ist er die einzige Aussage,
 * die diese Funktion machen darf: `ok: false` heisst „nicht zugestellt", und der Vermerk unterbleibt.
 */
export async function sendPartnerApprovalMail(input: PartnerApprovalMail): Promise<{ ok: boolean }> {
  if (!mailConfigured()) {
    warnMailNotConfigured(
      'Partner-Freischaltung (Benachrichtigung an den Fachbetrieb)',
      'Der Fachbetrieb ist angelegt und freigeschaltet, weiss es aber nicht. Der Versand lässt sich ' +
        'im Admin-Bereich unter „Partner" nachholen.',
    )
    return { ok: false }
  }

  /*
   * Die Locale ist die Vorgabe-Locale und kein Parameter: Diese Mail entsteht aus einer
   * ADMIN-Handlung, nicht aus einem Seitenaufruf des Empfängers — es gibt keinen Request, dessen
   * Sprache man übernehmen könnte, und `platform.partners` führt keine Sprachpräferenz. Phase 1 ist
   * ohnehin nur Deutsch (`i18n/routing.ts`); eine zweite Sprache braucht dann eine echte
   * Sprachangabe am Betrieb, nicht ein geratenes Argument hier.
   */
  const t = await getTranslations({
    locale: routing.defaultLocale,
    namespace: 'PartnerApprovalMail',
  })

  const referralUrl = absoluteUrl(partnerHref(input.slug))
  const portalUrl = absoluteUrl(PARTNER_PORTAL_HREF)

  const greeting = input.firstName ? t('greeting', { name: input.firstName }) : t('greetingNeutral')
  /*
   * Der eine zustandsabhängige Satz. Er verrät nichts nach aussen — er steht in einer Mail an genau
   * die Adresse, um deren Konto es geht.
   */
  const passwordLine = input.fromApplication ? t('passwordFromApplication') : t('passwordExisting')

  const text = [
    greeting,
    '',
    t('intro', { company: input.displayName }),
    '',
    t('linkLead'),
    referralUrl,
    '',
    t('portalLead'),
    portalUrl,
    '',
    passwordLine,
    '',
    t('passwordForgotten'),
    '',
    t('fallback', { email: COMPANY.email }),
    '',
    '—',
    COMPANY.name,
    COMPANY.email,
  ].join('\n')

  /*
   * Inline-Styles statt Design-Tokens und bewusst schlicht — dieselbe Begründung wie in
   * `lib/partner-application/mail.ts` und `lib/kontakt/deliver.ts`: E-Mail-Clients kennen kein
   * `var(--color-…)` und strippen `<style>`-Blöcke.
   *
   * Der Empfehlungslink steht zusätzlich als KOPIERBARER TEXT und nicht nur als Verweis: Der Betrieb
   * soll ihn in seine eigene Aussendung übernehmen, nicht anklicken — ein reines `<a>` mit
   * Beschriftung liesse ihn genau das nicht tun. Das ist die EINZIGE bewusste Abweichung vom
   * Bestandsmuster (dort trägt der Link eine Beschriftung, `lib/leads/mail.ts`); der Abstands-
   * rhythmus „Satz (12px) + Link (20px)" ist derselbe wie dort.
   */
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626">`,
    `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(t('intro', { company: input.displayName }))}</p>`,
    `<p style="margin:0 0 12px">${escapeHtml(t('linkLead'))}</p>`,
    `<p style="margin:0 0 20px;padding:12px;background:#f5f5f5;border-radius:6px;word-break:break-all">`,
    `<a href="${escapeHtml(referralUrl)}" style="color:#0f766e;font-weight:600">${escapeHtml(referralUrl)}</a>`,
    `</p>`,
    `<p style="margin:0 0 12px">${escapeHtml(t('portalLead'))}</p>`,
    `<p style="margin:0 0 20px"><a href="${escapeHtml(portalUrl)}" style="color:#0f766e;font-weight:600">${escapeHtml(portalUrl)}</a></p>`,
    `<p style="margin:0 0 16px">${escapeHtml(passwordLine)}</p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#525252">${escapeHtml(t('passwordForgotten'))}</p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#525252">${escapeHtml(t('fallback', { email: COMPANY.email }))}</p>`,
    `<p style="margin:0;font-size:13px;color:#525252">${escapeHtml(COMPANY.name)} · <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#525252">${escapeHtml(COMPANY.email)}</a></p>`,
    `</div>`,
  ].join('')

  const outcome = await sendMail(
    { to: input.to, subject: t('subject'), text, html },
    'Partner-Freischaltung (Benachrichtigung an den Fachbetrieb)',
  )
  return { ok: outcome.ok }
}
