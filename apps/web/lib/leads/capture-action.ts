'use server'

/**
 * DIE EINE SERVER ACTION ALLER EINSTIEGSPUNKTE (B3-2).
 *
 * Nicht eine je Seite: was ein Einstiegspunkt erhebt und welchen Zweck er trägt, steht in der
 * Registry (`registry.ts`) — nicht in seiner Aktion. Zehn Aktionen wären zehn Gelegenheiten, die
 * Zweckbindung, den Missbrauchsschutz oder die Neutralität der Rückmeldung an einer Stelle anders
 * zu machen als an den anderen.
 *
 * Diese Datei ist bewusst nur VERDRAHTUNG. Die Entscheidungen stehen in `capture-flow.ts` (rein und
 * ohne Datenbank prüfbar); hier werden ihr die echten Effekte hereingereicht.
 *
 * ── WARUM EINE SERVER ACTION UND KEINE ROUTE (anders als beim Kontaktformular) ───────────────────
 * `POST /api/kontakt` existiert, weil dieser Endpunkt unabhängig vom Formular-Rendering nachmessbar
 * sein muss (ein `curl` gegen die Route ist Teil seiner Verifikation) und weil er die
 * Zustellung selbst trägt. Hier ist es umgekehrt: das Formular steht EINGEBETTET auf beliebig
 * vielen Seiten, und eine Action bindet es an die Seite, auf der es steht — ohne einen zweiten
 * öffentlichen Endpunkt, dessen Herkunftsschlüssel ein Fremder frei wählen könnte. Der Schutz
 * dagegen liegt trotzdem nicht in der Action-Form, sondern in der Registry-Bindung des Zwecks.
 */

import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { absoluteUrl } from '@/lib/site'
import { verifyTurnstile } from '@/lib/kontakt/turnstile'
import { CONFIRM_TOKEN_PARAM, EINWILLIGUNG_BESTAETIGEN_HREF } from './config'
import { runLeadCapture, type LeadCaptureResponse } from './capture-flow'
import type { LeadCaptureSubmission } from './capture-request'
import { sendCalculatorResultMail, sendConsentConfirmationMail } from './mail'
import { captureLead, getActiveConsentText } from './store'
import { createConfirmationToken } from './tokens'

export async function submitLeadCaptureAction(
  submission: LeadCaptureSubmission,
): Promise<LeadCaptureResponse> {
  const locale = await getLocale()
  const headerList = await headers()

  /*
   * `x-forwarded-for` kann eine Kette sein („client, proxy1, proxy2"); der erste Eintrag ist der
   * Client. Dieselbe Auswertung wie in `app/api/kontakt/route.ts` — der Wert dient dem
   * Einwilligungsnachweis (B1-1) und als Signal für Cloudflare, nie als Zugangskontrolle.
   */
  const sourceIp = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = headerList.get('user-agent')

  /*
   * MISSBRAUCHSSCHUTZ AUF DEMSELBEN WEG WIE DAS KONTAKTFORMULAR — kein zweiter Mechanismus:
   * Honeypot (immer aktiv, geprüft im Ablauf) plus Turnstile, sobald die Schlüssel gesetzt sind.
   * `verifyTurnstile` ist env-gated in beide Richtungen: ohne Secret wird übersprungen, mit Secret
   * und ohne Token abgelehnt (sonst umginge ein Bot den Schutz durch Weglassen des Feldes).
   */
  const turnstile = await verifyTurnstile(submission.turnstileToken, sourceIp ?? undefined)
  if (!turnstile.ok) return { ok: false, error: 'turnstile' }

  return runLeadCapture(
    submission,
    {
      captureLead: (input) =>
        captureLead({
          email: input.email,
          sourceKey: input.sourceKey,
          purpose: input.purpose,
          tokenHash: input.tokenHash,
          tokenExpiresAt: input.tokenExpiresAt,
          company: input.company,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          industry: input.industry,
          postalCode: input.postalCode,
          annualConsumptionKwh: input.annualConsumptionKwh,
          supplier: input.supplier,
          contractEndDate: input.contractEndDate,
          sourceIp: input.sourceIp,
          userAgent: input.userAgent,
          locale: input.locale,
        }),

      /*
       * DER ANGEZEIGTE WORTLAUT KOMMT SERVERSEITIG AUS DER DATENBANK — dieselbe Auswahlregel
       * („jüngste Fassung je Zweck und Sprache"), die `capture_lead` beim Archivieren anwendet. Die
       * Action verlässt sich NICHT auf vom Client mitgeschickten Text: ein Nachweis, dessen
       * Wortlaut der Absender selbst bestimmt, belegt nichts.
       */
      getConsentText: async (purpose, textLocale) =>
        (await getActiveConsentText(purpose, textLocale))?.body ?? null,

      createToken: () => createConfirmationToken(),

      sendConfirmationMail: ({ to, consentText, token, locale: mailLocale }) =>
        sendConsentConfirmationMail({
          to,
          consentText,
          confirmUrl: absoluteUrl(
            `${EINWILLIGUNG_BESTAETIGEN_HREF}?${CONFIRM_TOKEN_PARAM}=${encodeURIComponent(token)}`,
          ),
          locale: mailLocale,
        }),

      sendResultMail: (input) => sendCalculatorResultMail(input),
    },
    { locale, sourceIp, userAgent },
  )
}
