'use server'

/**
 * Auth-Server-Actions (T4-2, Invariante J1: KEIN Supabase im Client-Bundle — jeder Auth-Vorgang
 * läuft hier serverseitig). Aufgerufen aus den Client-Formularen via `useActionState`.
 *
 * Kein try/catch nötig: supabase-js gibt Fehler als `{ error }` ZURÜCK (wirft nicht). Der einzige
 * „Wurf" ist `redirect()` (NEXT_REDIRECT) — der MUSS außerhalb eines try/catch stehen und steht
 * hier bewusst als letzte Anweisung.
 */
import { getLocale } from 'next-intl/server'
import { captureRegistrationLead } from '@/lib/leads/capture-registration'
import { createClient } from '@/lib/supabase/server'
import { KONTO_HREF, NEXT_PARAM, PASSWORT_NEU_HREF, sanitizeNext } from './config'
import { mapAuthError } from './errors'
import {
  forgotSchema,
  loginSchema,
  newPasswordSchema,
  registerSchema,
  toFieldErrors,
  type AuthState,
} from './schema'
import { callbackUrl, redirectToLocalized } from './server-helpers'
import { createAccountWithConfirmation } from './sign-up'

async function redirectLocalized(href: string): Promise<never> {
  const locale = await getLocale()
  return redirectToLocalized(href, locale)
}

/** Registrierung: E-Mail + Passwort + Betrieb/Ansprechperson → Bestätigungsmail (J4). */
export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    company: formData.get('company'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
  })
  if (!parsed.success) {
    /*
     * Die drei Pflichtangaben zurückgeben, damit ein Tippfehler in der Adresse nicht das ganze
     * Formular leert. Das Passwort bleibt bewusst draussen (s. `AuthState`).
     */
    return {
      fieldErrors: toFieldErrors(parsed.error.issues),
      email: formData.get('email')?.toString(),
      company: formData.get('company')?.toString(),
      firstName: formData.get('firstName')?.toString(),
      lastName: formData.get('lastName')?.toString(),
    }
  }

  /*
   * Rücksprungziel (B10-5). Dieselbe Prüfung wie beim Login und bei der Gutscheineinlösung
   * (`sanitizeNext`) — der Wert kommt aus einem versteckten Formularfeld und ist im Browser frei
   * änderbar. LEERER Rückfallwert statt `/konto`: „kein oder kein zulässiges Ziel" heisst hier
   * ausdrücklich „kein Ziel" und nicht „ersatzweise irgendwohin". Daran hängen zwei Dinge — wohin
   * der Bestätigungslink führt UND unter welcher Herkunft der Lead entsteht; ein Ersatzwert
   * verfälschte die zweite Aussage, ohne die erste zu verbessern.
   */
  const rawNext = formData.get(NEXT_PARAM)?.toString()
  const next = rawNext ? sanitizeNext(rawNext, '') : ''

  /*
   * Die Kontoanlage selbst steht seit B16-3 in `lib/auth/sign-up.ts` — geteilt mit der
   * Partner-Bewerbung, die ein Konto braucht, aber ausdrücklich KEINEN Lead schreiben darf (s. u.).
   * Verhaltensgleich; das Ziel reist unverändert durch den Mail-Flow mit: der Bestätigungslink
   * landet im Callback, der die Sitzung setzt und anschliessend GENAU DORTHIN weiterleitet, wohin
   * die Person ursprünglich wollte (B10-5). Ohne Ziel bleibt es bei `/konto`.
   */
  const signUp = await createAccountWithConfirmation({
    email: parsed.data.email,
    password: parsed.data.password,
    next: next || KONTO_HREF,
  })
  if (!signUp.created) {
    return {
      formError: mapAuthError(signUp.error),
      email: parsed.data.email,
      company: parsed.data.company,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
    }
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────────────────────────
   * LEAD-ERFASSUNG (B10-5) — NACH erfolgreichem `signUp` und VOR der Mail-Bestätigung.
   *
   * Die Reihenfolge IST die Aufgabe: Wer sich registriert und die Bestätigungsmail nie öffnet,
   * hinterliess bisher nichts als eine Adresse. Genau dieser Abbrecher soll erfasst sein.
   *
   * `captureRegistrationLead` wirft NIE — ein Datenbankfehler darf aus einer angelegten
   * Registrierung keinen Fehlerzustand machen, sonst versuchte die Person es ein zweites Mal und
   * bekäme „Adresse bereits vergeben". `await` (kein „fire and forget"): auf Vercel endet die
   * Function mit der Antwort, ein nicht abgewarteter Promise würde mitten im Insert abgeschnitten.
   *
   * Die Rückmeldung ist in ALLEN Fällen identisch — auch bei bereits bekannter Adresse. Sie darf
   * nie verraten, ob eine Adresse im Bestand steht (derselbe Enumeration-Schutz wie unten).
   * ─────────────────────────────────────────────────────────────────────────────────────────────
   */
  await captureRegistrationLead({
    email: parsed.data.email,
    company: parsed.data.company,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    next,
  })

  /*
   * ⚠ KORRIGIERT MIT B16-3 — hier stand bis dahin, bei bereits registrierter Adresse zeige Supabase
   * (mit `enable_confirmations`) KEINEN Fehler, der „Bitte bestätige"-Zustand sei in allen Fällen
   * identisch und die Registrierung damit enumerationssicher.
   *
   * DAS IST IN DER GOTRUE-FASSUNG DIESES PROJEKTS FALSCH, gemessen gegen den lokalen Stack: ein
   * `signUp` auf eine Adresse mit BESTÄTIGTEM Konto antwortet mit HTTP 422 `user_already_exists`,
   * und `mapAuthError` macht daraus den Sammel-Text `generic` — der Zustand oben (`formError`)
   * unterscheidet sich also sichtbar vom Erfolgszustand. Belege und Messwerte stehen im Kopf von
   * `lib/auth/sign-up.ts`.
   *
   * VERHALTEN UNVERÄNDERT GELASSEN, und zwar bewusst: Auf einem Registrierungsformular ist die
   * Rückmeldung „dieses Konto gibt es schon" die für den Nutzer richtige — sie erspart ihm das
   * Warten auf eine Mail, die nie kommt. Ob dieser Nutzen den Enumerationspreis wert ist, ist eine
   * Produktentscheidung und gehört zu Andreas; sie steht im B16-3-Handover. Die PARTNER-BEWERBUNG
   * trifft sie ausdrücklich anders (`lib/partner-application/flow.ts`): dort wird derselbe Fehler
   * verschluckt, weil die Seite sonst zum Auskunftsdienst über fremde Konten würde.
   */
  return { emailSent: true, email: parsed.data.email }
}

/** Login. Unbestätigtes Konto wird abgewiesen (J4) + Weg „erneut senden" angeboten. */
export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues) }

  /*
   * Rücksprungziel (B10-2). Der Wert kommt als verstecktes Formularfeld aus der Anmeldeseite,
   * stammt also aus der URL und ist damit vom Absender frei wählbar — er läuft deshalb durch
   * `sanitizeNext`, das nur seiten-INTERNE Pfade durchlässt. Ohne diese Prüfung wäre der Login
   * ein Open Redirect: ein Angreifer verschickte `/anmelden?next=https://…`, der Nutzer meldete
   * sich bei UNS an und landete auf einer fremden Seite, die er für unsere hält.
   *
   * Gelesen wird VOR dem Anmeldeversuch: `redirectLocalized` wirft (NEXT_REDIRECT) und muss die
   * letzte Anweisung bleiben.
   */
  const next = sanitizeNext(formData.get(NEXT_PARAM)?.toString(), KONTO_HREF)

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error) {
    const key = mapAuthError(error)
    return { formError: key, showResend: key === 'emailNotConfirmed', email: parsed.data.email }
  }
  return redirectLocalized(next)
}

/** Bestätigungsmail erneut senden (aus dem Login-Fehlerzustand). */
export async function resendConfirmationAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { formError: 'generic' }

  const supabase = await createClient()
  await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: await callbackUrl(KONTO_HREF) },
  })
  // Enumeration-Schutz: unabhängig vom Ergebnis dieselbe Bestätigung.
  return { resent: true, showResend: true, email }
}

/** Passwort vergessen: Reset-Mail anstoßen (J5, self-service ohne Team-Eingriff). */
export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = forgotSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues) }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: await callbackUrl(PASSWORT_NEU_HREF),
  })
  // J5 + Sicherheit: die Antwort verrät NICHT, ob die Adresse registriert ist — in beiden Fällen
  // dieselbe „Falls ein Konto existiert…"-Meldung. Nur ein Rate-Limit (kein Existenz-Signal) wird
  // als solches gemeldet.
  if (error && error.status === 429) return { formError: 'rateLimited', email: parsed.data.email }
  return { emailSent: true, email: parsed.data.email }
}

/** Neues Passwort setzen (nach Reset-Link — die Recovery-Session hat der Callback gesetzt). */
export async function setNewPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues) }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { formError: mapAuthError(error) }
  return redirectLocalized(KONTO_HREF)
}

/** Logout. Aus einem <form action={signOutAction}> auf der Kontoseite. */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  await redirectLocalized('/')
}
