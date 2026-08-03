'use server'

/**
 * DIE SERVER ACTION DER PARTNER-BEWERBUNG (B16-3).
 *
 * Bewusst nur VERDRAHTUNG. Die Entscheidungen stehen in `flow.ts` (rein und ohne Datenbank prüfbar);
 * hier werden ihr die echten Effekte hereingereicht.
 *
 * ── WARUM EINE SERVER ACTION UND KEINE ROUTE ────────────────────────────────────────────────────
 * Dasselbe Argument wie bei der Lead-Erfassung (B3-2): Die Kontaktroute `/api/kontakt` existiert,
 * weil sie unabhängig vom Rendering nachmessbar sein muss und weil die Partner-Landingpage einen
 * zweiten Endpunkt mit eigenem Pfad-Slug braucht. Hier gibt es nur EINEN Einstiegspunkt, und die
 * Action bindet ihn an die Seite, auf der er steht — ohne einen zusätzlichen öffentlichen Endpunkt.
 * Sie braucht ausserdem die SITZUNG (Cookies), um zu erkennen, ob bereits jemand angemeldet ist.
 *
 * ── DER LEAD-SCHREIBWEG WIRD HIER NICHT AUFGERUFEN ──────────────────────────────────────────────
 * Nicht vergessen, sondern ausgeschlossen: `signUpAction` schreibt seit B10-5 automatisch einen Lead;
 * diese Action benutzt sie deshalb NICHT. `PartnerApplicationEffects` hat gar kein Feld für eine
 * Lead-Erfassung — die Regel steht damit im Typ und nicht in der Disziplin dieser Datei.
 *
 * ── ⚠ SEIT B18-2a GEHT BEI DER BEWERBUNG KEINE SUPABASE-MAIL MEHR RAUS ──────────────────────────
 * Bis hierher lief die Kontoanlage über den mit B16-3 geteilten `createAccountWithConfirmation`
 * (`lib/auth/sign-up.ts`) und stiess damit SOFORT die Bestätigungsmail von Supabase an. Das war der
 * Fehler, den ein echter Wochenendtest gezeigt hat: Der Bewerber musste sein Konto bestätigen,
 * BEVOR er wusste, ob er überhaupt angenommen wird — und bekam nach der Freischaltung eine zweite
 * Mail. Zwei Mails, die erste zum falschen Zeitpunkt.
 *
 * Jetzt entsteht das Konto UNBESTÄTIGT und ohne jede Mail (`createAccountWithoutConfirmation`,
 * `lib/auth/admin-api.ts`); der Bewerber bekommt allein die Eingangsbestätigung über Resend. Der
 * Aktivierungslink kommt erst mit der Freischaltung (B16-4b-Mail, um genau diesen Link erweitert) —
 * es bleibt bei EINER Mail je Vorgang.
 *
 * `lib/auth/sign-up.ts` bleibt unverändert und gehört ab jetzt allein der Registrierung
 * (`/registrieren`): dort ist die sofortige Bestätigungsmail richtig, weil sie das Ergebnis der
 * Handlung ist, die die Person gerade vorgenommen hat.
 */

import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { createAccountWithoutConfirmation } from '@/lib/auth/admin-api'
import { verifyTurnstile } from '@/lib/kontakt/turnstile'
import { createClient } from '@/lib/supabase/server'
import {
  runPartnerApplication,
  type PartnerApplicationResponse,
  type PartnerApplicationSubmission,
} from './flow'
import { sendPartnerApplicationAcknowledgement, sendPartnerApplicationNotification } from './mail'
import { submitPartnerApplication } from './store'

export async function submitPartnerApplicationAction(
  submission: PartnerApplicationSubmission,
): Promise<PartnerApplicationResponse> {
  const locale = await getLocale()
  const headerList = await headers()

  /*
   * `x-forwarded-for` kann eine Kette sein („client, proxy1, proxy2"); der erste Eintrag ist der
   * Client. Nur ein Signal für Cloudflare, keine Zugangskontrolle — die Manipulierbarkeit des
   * Headers ist hier unkritisch. Dieselbe Auswertung wie in `lib/kontakt/submit.ts`.
   */
  const remoteIp = headerList.get('x-forwarded-for')?.split(',')[0]?.trim()

  /*
   * MISSBRAUCHSSCHUTZ AUF DEMSELBEN WEG WIE DAS KONTAKTFORMULAR — kein zweiter Mechanismus:
   * Honeypot (immer aktiv, geprüft im Ablauf) plus Turnstile, sobald die Schlüssel gesetzt sind.
   * `verifyTurnstile` ist env-gated in beide Richtungen: ohne Secret wird übersprungen, mit Secret
   * und ohne Token abgelehnt (sonst umginge ein Bot den Schutz durch Weglassen des Feldes).
   */
  const turnstile = await verifyTurnstile(submission.turnstileToken, remoteIp)
  if (!turnstile.ok) return { ok: false, error: 'turnstile' }

  /*
   * Läuft eine Sitzung? Dann entsteht KEIN zweites Konto und die Bewerbung wird mit dem
   * angemeldeten verknüpft. Ein Lesefehler gilt als „nicht angemeldet" — das ist der sichere Fall:
   * es entstünde dann höchstens eine überflüssige Kontoanlage, während die Gegenrichtung eine
   * Bewerbung an ein Konto hängte, von dem wir nicht wissen, ob es das des Absenders ist.
   */
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const session = user?.email ? { userId: user.id, email: user.email } : null

  return runPartnerApplication(
    submission,
    {
      /*
       * ES GIBT KEIN RÜCKSPRUNGZIEL MEHR, WEIL ES KEINEN BESTÄTIGUNGSLINK MEHR GIBT (B18-2a). Das
       * Konto entsteht unbestätigt und ohne Mail; anmeldefähig wird es erst durch den Klick auf den
       * Aktivierungslink der Freischaltungsmail, und dessen Ziel ist das Partner-Portal — nicht
       * `/konto`. Wohin der Bewerber am Ende kommt, entscheidet also die Freischaltung
       * (`lib/partner-portal/**`) und nicht mehr dieser Aufruf.
       *
       * Ein Fehler wird NICHT ausgewertet, sondern nur als „kein Konto entstanden" gemeldet — die
       * Antwort von GoTrue verrät, ob die Adresse bereits ein Konto hat (gemessen: HTTP 422
       * `email_exists`, s. Kopf von `lib/auth/admin-api.ts`), und genau das darf diese Seite nicht
       * weitergeben. Ob die Bewerbung daraufhin entstehen darf, entscheidet die DATENBANK daran, ob
       * am Ende ein Konto DA ist (`no_account`, s. Regel 3 in `flow.ts`) — nicht dieser
       * Rückgabewert. Das Passwort eines BESTEHENDEN Kontos bleibt dabei unangetastet (ebenfalls
       * gemessen), der Fall läuft also unverändert durch.
       */
      createAccount: async ({ email, password }) => {
        const outcome = await createAccountWithoutConfirmation({ email, password })
        if (!outcome.created) {
          console.warn(
            '[partner-application] Kontoanlage nicht erfolgt — der Antrag entsteht trotzdem ' +
              `(code=${outcome.code ?? 'unbekannt'}, status=${outcome.status ?? '—'}).`,
          )
        }
        return outcome.created
      },

      storeApplication: (input) => submitPartnerApplication(input),

      notifyTeam: (input) => sendPartnerApplicationNotification(input),

      acknowledgeApplicant: ({ to, firstName, accountCreated }) =>
        sendPartnerApplicationAcknowledgement({ to, firstName, accountCreated, locale }),
    },
    session,
  )
}
