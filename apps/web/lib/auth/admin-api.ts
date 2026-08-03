/**
 * DIE GOTRUE-ADMIN-API — der einzige Ort dieses Systems, der Konten mit erhöhten Rechten anfasst
 * (B18-2a).
 *
 * Zwei Vorgänge der Partner-Aufnahme brauchen sie, und beide nur, weil der reguläre Weg genau das
 * tut, was dieser Bauabschnitt abstellt: `supabase.auth.signUp` schickt SOFORT eine Bestätigungsmail
 * (`enable_confirmations = true`, T4-2/J4). Ein Bewerber müsste sein Konto also bestätigen, bevor er
 * weiss, ob er überhaupt angenommen wird — und bekäme nach der Freischaltung eine zweite Mail.
 *
 *   1. `createAccountWithoutConfirmation` — die Bewerbung legt das Konto UNBESTÄTIGT an, ohne Mail.
 *   2. `createActivationToken`            — die Freischaltung erzeugt den Aktivierungslink, ohne Mail.
 *
 * Versendet wird ausschliesslich über Resend (`lib/mail/send.ts`, Absender `energy@coolin.at`) —
 * damit bleibt es bei EINER Mail je Vorgang, unter unserem Absender, mit unserem Wortlaut.
 *
 * ── DIE PRIVILEGIENGRENZE ───────────────────────────────────────────────────────────────────────
 * Für die Admin-API von GoTrue gibt es KEINEN Weg über den angemeldeten, RLS-gebundenen Client: sie
 * verlangt den `service_role`-Schlüssel. Das ist der Unterschied zu B14-2, das die Erlaubnisliste
 * ausdrücklich NICHT erweitert hat — dort waren die Wrapper `authenticated`-only, hier gibt es
 * schlicht keine zweite Tür. Folgerichtig steht diese EINE Datei in der Allowlist der
 * root-`eslint.config.mjs`, und zwar als Datei und nicht als Verzeichnis: `lib/auth/**` insgesamt
 * freizugeben hiesse, den erhöhten Zugriff für den gesamten öffentlichen Registrierungsweg zu
 * öffnen, der ihn nicht braucht (`lib/auth/sign-up.ts` bleibt beim gewöhnlichen Client).
 *
 * ⚠ DER CLIENT VERLÄSST DIESES MODUL NICHT. Beide Funktionen geben WERTE zurück (ein Ergebnis, ein
 * Token) und niemals den Client selbst. Ein durchgereichter service_role-Client wäre ein
 * RLS-freier Generalschlüssel im Aufrufer — genau das, was die Regel verhindert; die Beschränkung
 * auf eine Datei wäre dann Kosmetik.
 *
 * ── ⚠ GEMESSEN GEGEN DEN LOKALEN STACK, NICHT AUS DER DOKUMENTATION ABGELEITET ──────────────────
 * Muster wie `lib/auth/sign-up.ts`. GoTrue in der Fassung dieses Projekts (PostgreSQL 17,
 * Supabase-CLI-Stack, 03.08.2026):
 *
 *   POST /admin/users  {email, password, email_confirm:false}
 *     – frische Adresse            → HTTP 200, `email_confirmed_at` FEHLT, `confirmation_sent_at`
 *                                    FEHLT, **0 Mails** (Mailpit-Zählung vorher/nachher).
 *     – bereits vergebene Adresse  → HTTP 422 `email_exists`; das Passwort des bestehenden Kontos
 *                                    bleibt UNVERÄNDERT (Anmeldung damit danach weiter HTTP 200).
 *   Anmeldung mit einem so angelegten Konto → HTTP 400 `email_not_confirmed`.
 *
 *   POST /admin/generate_link {type:'magiclink', email}
 *     – bestehendes Konto          → HTTP 200, **0 Mails**, liefert `hashed_token` (56 Hex-Zeichen)
 *                                    und das vollständige Nutzerobjekt.
 *     – ⚠ UNBEKANNTE Adresse       → HTTP 200 und **es entsteht ein Konto** (unbestätigt). S. u.
 *
 *   POST /verify {type:'magiclink', token_hash}
 *     – gültig                     → HTTP 200 MIT Sitzung; `email_confirmed_at` wird gesetzt.
 *     – zweite Verwendung, erfundener oder abgelaufener Token
 *                                  → HTTP 403 `otp_expired` („Email link is invalid or has expired")
 *                                    — alle drei Fälle sind ununterscheidbar, also kein Orakel.
 *
 * ⚠ DER MAGIC LINK FASST DAS PASSWORT NICHT AN. Gemessen: nach dem Einlösen meldet sich das Konto
 * mit dem bei der Bewerbung gesetzten Passwort weiter an (HTTP 200), ein anderes wird mit
 * HTTP 400 `invalid_credentials` abgewiesen. Genau deshalb `magiclink` und nicht:
 *   – `recovery`  — der verlangt ein NEUES Passwort und nähme dem Bewerber das selbstgewählte.
 *   – `invite`    — gedacht für Konten OHNE Passwort; unser Bewerber hat eines.
 *   – `signup`    — verlangt einen `password`-Parameter, den wir gar nicht haben (und nicht
 *                   speichern dürfen). Gemessen bleibt ein mitgegebenes Passwort bei einem
 *                   BESTEHENDEN Konto zwar wirkungslos — auf eine unbekannte Adresse angewandt
 *                   legte derselbe Aufruf aber ein Konto mit genau diesem erfundenen Passwort an.
 */
import 'server-only'
/*
 * Dieser Import ist ÜBERALL SONST ein Lint-Fehler (`no-restricted-imports`, root-`eslint.config.mjs`).
 * Erlaubt ist er hier durch einen Eintrag in der dortigen Allowlist, der GENAU DIESE DATEI nennt —
 * bewusst kein Verzeichnis-Glob wie bei den vier Pfaden davor. Kein `eslint-disable` an dieser
 * Stelle: Eine Ausnahme, die in der Datei selbst steht, wandert beim nächsten Kopieren mit; eine in
 * der Konfiguration muss jemand bewusst erweitern.
 */
import { createServiceRoleClient } from '@/lib/supabase/service-role'

/**
 * Ergebnis der Kontoanlage.
 *
 * Bewusst OHNE den GoTrue-Fehler selbst: Er verrät, ob es die Adresse schon gibt (`email_exists`),
 * und der einzige Aufrufer ist ein ÖFFENTLICHES Formular, dessen Antwort das nicht weitergeben darf
 * (`lib/partner-application/flow.ts`, Regel 3). Was für das Server-Log gebraucht wird — Statuscode
 * und Fehlercode — steht als schlichte Felder daneben.
 */
export type AdminAccountOutcome =
  | { created: true; userId: string }
  | { created: false; status: number | null; code: string | null }

/**
 * Legt ein Konto an, das NOCH NICHT anmeldefähig ist — und löst dabei KEINE Mail aus.
 *
 * `email_confirm: false` ist der ganze Punkt: Das Konto entsteht mit dem selbstgewählten Passwort,
 * bleibt aber unbestätigt und damit gesperrt (gemessen: HTTP 400 `email_not_confirmed`), bis der
 * Bewerber den Aktivierungslink aus der Freischaltungsmail anklickt. Der Klick ist der einzige
 * Beweis, dass er Zugriff auf dieses Postfach hat — ohne ihn liesse sich mit der Adresse eines
 * Dritten ein Konto samt eigenem Passwort erschleichen.
 *
 * WIRFT NICHT: supabase-js gibt Fehler zurück. Ein unerwarteter Wurf (Netz, fehlende Env) wird
 * abgefangen und als `created: false` gemeldet — der Aufrufer wertet ihn ohnehin nicht aus.
 */
export async function createAccountWithoutConfirmation(input: {
  email: string
  password: string
}): Promise<AdminAccountOutcome> {
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: false,
    })
    if (error || !data.user) {
      return { created: false, status: error?.status ?? null, code: error?.code ?? null }
    }
    return { created: true, userId: data.user.id }
  } catch (cause) {
    // Die Adresse steht bewusst NICHT im Log-Text — ein Fehlerlog ist kein zulässiger zweiter
    // Speicherort für Personenbezug (B1-2).
    console.error('[auth/admin-api] Kontoanlage fehlgeschlagen:', cause)
    return { created: false, status: null, code: null }
  }
}

export type ActivationToken = {
  /**
   * Der Wert, der in den Aktivierungslink wandert und den `supabase.auth.verifyOtp` einlöst.
   *
   * Bewusst NICHT `action_link` aus derselben Antwort: Der zeigt auf GoTrues `/verify` und leitet
   * anschliessend mit den Tokens im FRAGMENT weiter — das erreicht den Server nie, und diese App
   * hält ihre Sitzung ausschliesslich serverseitig in Cookies (`lib/supabase/server.ts`, Invariante
   * J1). Mit dem `token_hash` löst die eigene Route ein und setzt die Cookies selbst; das ist
   * derselbe Weg, den der Supabase-Callback seit T4-2 geht.
   */
  tokenHash: string
  /**
   * War das Konto SCHON bestätigt? Dann aktiviert der Link nichts mehr, er meldet nur an.
   *
   * Der Fall ist real und nicht theoretisch: ein von Hand aufgenommener Fachbetrieb, dessen
   * bestehendes Konto nachträglich verknüpft wurde (B16-4a), und ein Bewerber, der sich mit der
   * Adresse eines bereits bestätigten Kontos beworben hat. Die Mail sagt dann etwas anderes — sie
   * darf keine Freischaltung behaupten, die längst geschehen ist.
   *
   * GEMESSEN: `email_confirmed_at` steht im Nutzerobjekt der Antwort, wenn das Konto bestätigt ist,
   * und FEHLT sonst (GoTrue lässt leere Felder weg). Der Zustand kommt damit aus derselben Antwort
   * wie der Token — kein zweiter Rundlauf, der ein anderes Konto meinen könnte.
   */
  alreadyConfirmed: boolean
}

/**
 * Erzeugt einen einmalig einlösbaren Aktivierungstoken — und löst dabei KEINE Mail aus.
 *
 * @param expectedUserId Die Konto-Kennung, die der Aufrufer meint (`platform.partners.user_id`).
 *
 * ⚠ `expectedUserId` IST EINE SICHERUNG, KEIN BEIWERK. Gemessen: `generate_link` auf eine
 * UNBEKANNTE Adresse antwortet mit HTTP 200 und LEGT DABEI EIN KONTO AN. Im Regelfall kann das hier
 * nicht eintreten — die Adresse kommt aus `auth.users` (`admin_list_partners.account_email`), und
 * ohne Konto bricht der Ablauf vorher mit `no_account` ab. Wird das Konto aber zwischen dem Lesen
 * der Partnerliste und diesem Aufruf gelöscht, entstünde ein neues, unbestätigtes und mit nichts
 * verknüpftes Konto, und der Aktivierungslink führte in ein Postfach, das zu keinem Fachbetrieb mehr
 * gehört. Stimmt die Kennung nicht überein, wird deshalb NICHTS zurückgegeben.
 *
 * ⚠ KEIN `redirectTo`. Es wird nicht gebraucht (der Rückweg steht in unserer eigenen URL) und wäre
 * eine Falle: Gemessen ersetzt GoTrue ein nicht in der Allowlist stehendes Ziel STILL durch die
 * Site-URL, ohne Fehler — ein Tippfehler dort fiele niemandem auf.
 *
 * WIRFT NICHT. `null` heisst „kein Token" und führt beim Aufrufer dazu, dass gar keine Mail
 * hinausgeht (`lib/partner-portal/notify.ts`): Eine Freischaltungsmail ohne Aktivierungslink an ein
 * unbestätigtes Konto wäre eine Einladung in einen Zugang, der sich nicht öffnen lässt.
 */
export async function createActivationToken(input: {
  email: string
  expectedUserId: string
}): Promise<ActivationToken | null> {
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email: input.email,
    })
    if (error || !data.properties?.hashed_token || !data.user) {
      console.error('[auth/admin-api] Aktivierungslink nicht erzeugbar:', error?.message ?? 'leer')
      return null
    }
    if (data.user.id !== input.expectedUserId) {
      console.error(
        '[auth/admin-api] Aktivierungslink VERWORFEN: die Adresse gehört zu einem anderen Konto ' +
          'als erwartet. Wahrscheinlichste Ursache ist ein zwischenzeitlich gelöschtes Konto — ' +
          'dabei legt GoTrue ein neues an (gemessen). Der Fachbetrieb wurde NICHT benachrichtigt.',
      )
      return null
    }
    return {
      tokenHash: data.properties.hashed_token,
      alreadyConfirmed: Boolean(data.user.email_confirmed_at),
    }
  } catch (cause) {
    console.error('[auth/admin-api] Aktivierungslink fehlgeschlagen:', cause)
    return null
  }
}
