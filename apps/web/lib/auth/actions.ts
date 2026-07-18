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
import { createClient } from '@/lib/supabase/server'
import { KONTO_HREF, PASSWORT_NEU_HREF } from './config'
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

async function redirectLocalized(href: string): Promise<never> {
  const locale = await getLocale()
  return redirectToLocalized(href, locale)
}

/** Registrierung: E-Mail + Passwort → Bestätigungsmail (enable_confirmations=true, J4). */
export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues) }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: await callbackUrl(KONTO_HREF) },
  })
  if (error) return { formError: mapAuthError(error), email: parsed.data.email }

  // Kein data.user/identities-Branch: bei bereits registrierter Adresse zeigt Supabase (mit
  // enable_confirmations) KEINEN Fehler — der „Bitte bestätige"-Zustand ist in ALLEN Fällen
  // identisch (Enumeration-Schutz).
  return { emailSent: true, email: parsed.data.email }
}

/** Login. Unbestätigtes Konto wird abgewiesen (J4) + Weg „erneut senden" angeboten. */
export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues) }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error) {
    const key = mapAuthError(error)
    return { formError: key, showResend: key === 'emailNotConfirmed', email: parsed.data.email }
  }
  return redirectLocalized(KONTO_HREF)
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
