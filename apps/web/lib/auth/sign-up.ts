/**
 * DIE KONTOANLAGE MIT SOFORTIGER BESTÄTIGUNGSMAIL — seit B18-2a allein der Weg der REGISTRIERUNG
 * (`/registrieren`, `signUpAction`).
 *
 * Herausgezogen aus `signUpAction` (`lib/auth/actions.ts`) mit B16-3, als die Partner-Bewerbung
 * dieselbe Kontoanlage brauchte und `signUpAction` dabei NICHT wiederverwendet werden durfte: Sie
 * schreibt seit B10-5 automatisch einen Lead (`captureRegistrationLead`), und ein Fachbetrieb, der
 * Vertriebspartner werden will, ist kein Peak-Shaving-Interessent — mitgezählt verfälschte er genau
 * die Kennzahl, an der die Marktnachfrage gemessen wird.
 *
 * ── ⚠ DIE PARTNER-BEWERBUNG BENUTZT DIESE FUNKTION SEIT B18-2a NICHT MEHR ───────────────────────
 * Sie legt ihr Konto UNBESTÄTIGT und ohne jede Mail an (`createAccountWithoutConfirmation`,
 * `lib/auth/admin-api.ts`) — ein Bewerber soll sein Konto nicht bestätigen müssen, bevor er weiss,
 * ob er angenommen wird. Der Unterschied ist eine bewusste Abwägung je EINSTIEGSPUNKT, kein
 * Auseinanderlaufen: Wer sich REGISTRIERT, hat genau diese Handlung gerade vorgenommen und wartet
 * auf die Mail; sie ist dort das Ergebnis, nicht eine Vorleistung auf eine fremde Entscheidung.
 * Diese Datei bleibt deshalb, wie sie ist, und hat wieder genau einen Aufrufer.
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
 * Die Partner-Bewerbung hat daraus dieselbe Folgerung gezogen und tut es weiterhin — nur mit dem
 * Admin-Aufruf statt mit dieser Funktion: Der Fehler wird NICHT ausgewertet und nirgends sichtbar
 * (`lib/partner-application/flow.ts`, Regel 3). Der dortige Fehlercode heisst seit B18-2a
 * `email_exists` statt `user_already_exists`; beide sind gemessen, beide verraten dasselbe, und
 * beide werden aus demselben Grund verschluckt.
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
