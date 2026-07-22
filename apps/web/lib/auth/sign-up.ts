/**
 * DIE KONTOANLAGE — der Teil, den Registrierung UND Partner-Bewerbung teilen (B16-3).
 *
 * Herausgezogen aus `signUpAction` (`lib/auth/actions.ts`), weil die Partner-Bewerbung ein Konto
 * anlegen muss und `signUpAction` dabei NICHT wiederverwendet werden darf: Sie schreibt seit B10-5
 * automatisch einen Lead (`captureRegistrationLead`), und ein Fachbetrieb, der Vertriebspartner
 * werden will, ist kein Peak-Shaving-Interessent — mitgezählt verfälschte er genau die Kennzahl, an
 * der die Marktnachfrage gemessen wird. Geteilt wird deshalb nur das, was tatsächlich identisch ist:
 * der Aufruf gegen GoTrue samt Rücksprungziel des Bestätigungslinks.
 *
 * ── DIE E-MAIL-BESTÄTIGUNG WIRD HIER NICHT UMGANGEN ─────────────────────────────────────────────
 * `enable_confirmations = true` gilt plattformweit (`supabase/config.toml`, T4-2/J4). Ein Konto
 * entsteht unbestätigt und ist bis zum Klick in der Mail nicht anmeldefähig — für beide Aufrufer
 * gleich.
 *
 * ── ⚠ GEMESSEN: `signUp` VERRÄT, OB EINE ADRESSE BEREITS EIN KONTO HAT ──────────────────────────
 * Gegen den lokalen Stack gemessen (nicht aus der Doku abgeleitet), GoTrue in der Fassung dieses
 * Projekts:
 *
 *   - FRISCHE Adresse                     → HTTP 200, vollständiges Nutzerobjekt,
 *                                           `confirmation_sent_at` gesetzt, keine Sitzung (~110 ms).
 *   - Adresse mit BESTÄTIGTEM Konto       → HTTP 422, `error_code: user_already_exists`
 *                                           („User already registered"), ~66 ms.
 *   - Adresse mit UNBESTÄTIGTEM Konto,
 *     zweiter Versuch in der Sperrfrist   → HTTP 429, `error_code: over_email_send_rate_limit`.
 *
 * Ebenfalls gemessen: Im 422-Fall entsteht KEINE zweite Zeile in `auth.users`, und das Passwort des
 * bestehenden Kontos bleibt UNVERÄNDERT — die Anmeldung mit dem alten Passwort funktioniert danach
 * weiter, die mit dem neu eingegebenen nicht.
 *
 * Für die Partner-Bewerbung heisst das: Der Fehler wird NICHT ausgewertet und nirgends sichtbar —
 * der Antrag entsteht trotzdem, die Rückmeldung ist dieselbe, und die Eingangsbestätigung weist auf
 * die Anmeldung mit dem bestehenden Passwort hin (`lib/partner-application/flow.ts`).
 *
 * Für die REGISTRIERUNG bleibt das Verhalten unverändert: Dort ist die Rückmeldung an den Nutzer
 * gewollt — wer sich registriert, soll erfahren, dass es sein Konto schon gibt. Die Bewertung, ob
 * das für ein öffentliches Registrierungsformular die richtige Abwägung ist, gehört zu Andreas und
 * ist im Handover festgehalten; dieser Bauabschnitt ändert sie nicht.
 */
import 'server-only'
import type { AuthError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { callbackUrl } from './server-helpers'

export type SignUpOutcome = { created: true } | { created: false; error: AuthError }

/**
 * Legt ein Konto an und stösst die Bestätigungsmail an.
 *
 * @param next Rücksprungziel des Bestätigungslinks — ein seiten-INTERNER Pfad, den der Aufrufer
 *   bereits durch `sanitizeNext` geschickt hat. Er reist durch den Mail-Flow bis hinter die
 *   Bestätigung (B10-5).
 */
export async function createAccountWithConfirmation(input: {
  email: string
  password: string
  next: string
}): Promise<SignUpOutcome> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { emailRedirectTo: await callbackUrl(input.next) },
  })
  return error ? { created: false, error } : { created: true }
}
