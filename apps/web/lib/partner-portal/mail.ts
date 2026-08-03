/**
 * DIE GENEHMIGUNGSMAIL AN DEN FACHBETRIEB (B16-4b) — über den bestehenden Resend-Weg
 * (`lib/mail/send.ts`, seit B16-3 aus `lib/leads/mail.ts` herausgezogen).
 *
 * Sie ist die Nachricht, die B16-4a bewusst offengelassen hat: Dort steht nach jeder Genehmigung im
 * Klartext, dass der Betrieb angelegt, aber NICHT benachrichtigt ist. Diese Mail schliesst genau
 * diese Lücke — und sie ist der erste nutzergerichtete Text dieses Systems, der einen ZUGANG
 * ankündigt statt einen Eingang zu bestätigen.
 *
 * ── FÜNF DINGE STEHEN DRIN, UND JEDES AUS EINEM GRUND ───────────────────────────────────────────
 *   1. Die Bestätigung, dass die Aufnahme durch ist. Ohne sie ist der Rest kontextlos.
 *   2. ⚠ DER AKTIVIERUNGSLINK (B18-2a), und zwar ZUERST — er ist die einzige Handlung, ohne die
 *      nichts weitergeht. Erscheint nur, wenn das Konto tatsächlich noch unbestätigt ist.
 *   3. Der persönliche Empfehlungslink, VOLLSTÄNDIG. Er ist der eigentliche Gegenstand der
 *      Partnerschaft; ihn nur im Portal zu zeigen hiesse, den Betrieb für die eine Angabe, die er
 *      sofort braucht, erst durch eine Anmeldung zu schicken.
 *   4. Der Verweis auf das Portal — dort liegen die Vorlagen, und dort steht der Link dauerhaft
 *      (eine Mail wird verlegt).
 *   5. Womit man sich anmeldet. Der Satz hängt vom Zustand ab (s. unten).
 *
 * ── ⚠ B18-2a: SIE IST DIE EINZIGE MAIL NACH DER EINGANGSBESTÄTIGUNG ────────────────────────────
 * Bis dahin bekam ein Bewerber ZWEI Mails, und die erste zum falschen Zeitpunkt: die
 * Bestätigungsmail von Supabase ging bei der BEWERBUNG raus, er musste sein Konto also bestätigen,
 * bevor er wusste, ob er überhaupt angenommen wird. Seit B18-2a entsteht das Konto unbestätigt und
 * ohne jede Mail; der Aktivierungslink steckt hier. Aus zwei Mails wurde eine — nicht drei.
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
import { portalEntryUrl } from '@/lib/portal-host'
import { partnerHref } from '@/lib/leads/partner'

export type PartnerApprovalMail = {
  to: string
  /** `null` = keine Ansprechperson hinterlegt; die Mail benutzt dann eine neutrale Anrede. */
  firstName: string | null
  displayName: string
  slug: string
  /** Steuert GENAU EINEN Satz — den über das Passwort. Begründung in `notify.ts`. */
  fromApplication: boolean
  /**
   * Der Aktivierungslink (B18-2a) — `null`, wenn das Konto BEREITS bestätigt ist.
   *
   * Der Fall ist real und nicht theoretisch: ein von Hand aufgenommener Fachbetrieb, dessen
   * bestehendes Konto nachträglich verknüpft wurde (B16-4a), und ein Bewerber, der sich mit der
   * Adresse eines längst bestätigten Kontos beworben hat. Beiden „schalten Sie Ihren Zugang frei"
   * zu schreiben wäre eine Aufforderung zu einem Schritt, den es für sie nicht gibt — und der
   * naheliegende Anruf käme genau von dem Betrieb, der ohnehin schon hineinkäme.
   *
   * Der Zustand wird NICHT aus `fromApplication` geraten, sondern kommt aus derselben
   * GoTrue-Antwort, die den Token liefert (`email_confirmed_at`, gemessen — s.
   * `lib/auth/admin-api.ts`).
   */
  activationUrl: string | null
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

  /*
   * Der Empfehlungslink zeigt auf die Landingpage `/partner/<slug>` — die liegt auf der
   * HAUPTDOMAIN und wird auf dem Portal-Host per 308 weggeleitet; `absoluteUrl` ist hier also
   * richtig (dieselbe Überlegung wie in `partner-portal-route.tsx`).
   *
   * Die Adresse des PORTALS dagegen ist seit B18-2a die Wurzel des Portal-Hosts
   * (`portalEntryUrl()`, in Produktion `https://partner.coolin.at/`): Die Domain trägt die
   * Bedeutung bereits, ein zusätzliches Pfadsegment wiederholte sie nur (B18-1a). Lokal und in
   * jeder Preview gibt es diesen Host nicht — dort bleibt es beim Pfad auf der ausgelieferten
   * Basis, sonst stünde in der Testmail eine tote Adresse.
   */
  const referralUrl = absoluteUrl(partnerHref(input.slug))
  const portalUrl = portalEntryUrl()

  const greeting = input.firstName ? t('greeting', { name: input.firstName }) : t('greetingNeutral')
  /*
   * Die zustandsabhängigen Sätze. Sie verraten nichts nach aussen — sie stehen in einer Mail an
   * genau die Adresse, um deren Konto es geht.
   */
  const passwordLine = input.fromApplication ? t('passwordFromApplication') : t('passwordExisting')
  const activationUrl = input.activationUrl

  const text = [
    greeting,
    '',
    t('intro', { company: input.displayName }),
    ...(activationUrl ? ['', t('activationLead'), activationUrl, '', t('activationNote')] : []),
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
    /*
     * Der Aktivierungsblock steht VOR dem Empfehlungslink: Er ist die einzige Handlung, ohne die
     * nichts weitergeht. Der Link trägt hier — anders als der Empfehlungslink darunter — eine
     * BESCHRIFTUNG statt seines Volltexts: Er soll angeklickt und nicht kopiert und weitergegeben
     * werden, und ein 200 Zeichen langer Token im Fliesstext lädt zum Zweiten geradezu ein.
     */
    ...(activationUrl
      ? [
          `<p style="margin:0 0 12px">${escapeHtml(t('activationLead'))}</p>`,
          `<p style="margin:0 0 12px"><a href="${escapeHtml(activationUrl)}" style="color:#0f766e;font-weight:600">${escapeHtml(t('activationLinkLabel'))}</a></p>`,
          `<p style="margin:0 0 20px;font-size:13px;color:#525252">${escapeHtml(t('activationNote'))}</p>`,
        ]
      : []),
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
