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
 * diese Action benutzt sie deshalb NICHT, sondern den mit B16-3 herausgezogenen gemeinsamen Teil
 * (`lib/auth/sign-up.ts`). `PartnerApplicationEffects` hat gar kein Feld für eine Lead-Erfassung —
 * die Regel steht damit im Typ und nicht in der Disziplin dieser Datei.
 */

import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { KONTO_HREF } from '@/lib/auth/config'
import { createAccountWithConfirmation } from '@/lib/auth/sign-up'
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
       * Das Rücksprungziel des Bestätigungslinks ist `/konto` und NICHT die Bewerbungsseite: Wer
       * bestätigt hat, soll sein Konto sehen — die Bewerbungsseite zeigte ihm ein zweites Mal das
       * Formular, das er gerade abgeschickt hat. Einen Partnerbereich gibt es noch nicht (B16-4+).
       *
       * Ein Fehler wird NICHT ausgewertet, sondern nur als „kein Konto entstanden" gemeldet — die
       * Antwort von GoTrue verrät, ob die Adresse bereits ein Konto hat (gemessen, s. Kopf von
       * `lib/auth/sign-up.ts`), und genau das darf diese Seite nicht weitergeben.
       */
      createAccount: async ({ email, password }) => {
        const outcome = await createAccountWithConfirmation({ email, password, next: KONTO_HREF })
        if (!outcome.created) {
          console.warn(
            '[partner-application] Kontoanlage nicht erfolgt — der Antrag entsteht trotzdem ' +
              `(code=${outcome.error.code ?? 'unbekannt'}, status=${outcome.error.status ?? '—'}).`,
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
