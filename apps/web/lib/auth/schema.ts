/**
 * Validierungs-Schemata + Formular-Zustandsvertrag des Auth-Bereichs (T4-2).
 *
 * REIN (kein `server-only`, kein `next/*`): die Server Actions validieren damit serverseitig
 * (Autorität), die Client-Formulare rendern die zurückgegebenen Fehler. Fehlermeldungen sind
 * KEYS (`emailInvalid` …), keine Sätze — die Wortwahl steht in messages/de.json (§8.7-Analog),
 * und serverseitig gibt es keinen Locale-Kontext für fertige Texte.
 */
import { z } from 'zod'

// Mindestlänge 8 (bewusst strenger als config.toml minimum_password_length=6): alles, was diese
// zod-Regel passiert, akzeptiert Supabase auch — kein Fall, in dem Supabase nachträglich ablehnt,
// was hier durchging.
const PASSWORT_MIN = 8

const emailField = z.string().trim().min(1, 'emailRequired').email('emailInvalid')
const newPasswordField = z.string().min(PASSWORT_MIN, 'passwordTooShort')

export const registerSchema = z.object({ email: emailField, password: newPasswordField })
export const loginSchema = z.object({
  email: emailField,
  // Beim Login KEINE Längenpolitik durchsickern lassen — nur „ausgefüllt".
  password: z.string().min(1, 'passwordRequired'),
})
export const forgotSchema = z.object({ email: emailField })
export const newPasswordSchema = z
  .object({ password: newPasswordField, confirm: z.string().min(1, 'passwordRequired') })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'passwordsDontMatch' })

export type AuthFieldName = 'email' | 'password' | 'confirm'

/** Erste Meldung je Feld, als KEY. Reihenfolge egal — die Formulare fokussieren nach FIELD_ORDER. */
export function toFieldErrors(issues: z.ZodIssue[]): Partial<Record<AuthFieldName, string>> {
  const out: Partial<Record<AuthFieldName, string>> = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && !(field in out)) {
      out[field as AuthFieldName] = issue.message
    }
  }
  return out
}

/**
 * Rückgabe der Auth-Server-Actions (via useActionState). Bei Erfolg, der weiterleitet, kehrt die
 * Action nicht zurück (redirect wirft); die hier beschriebenen Zustände sind die RENDERbaren.
 */
export type AuthState = {
  /** Formular-weiter Fehler-KEY (Konto.errors.*). */
  formError?: string
  /** Feld-Fehler-KEYS (Konto.errors.*). */
  fieldErrors?: Partial<Record<AuthFieldName, string>>
  /** „Bitte bestätige deine E-Mail" (Registrierung) bzw. „Mail unterwegs" (Passwort-Reset). */
  emailSent?: boolean
  /** Login: Konto unbestätigt → Weg „Bestätigungsmail erneut senden" anbieten. */
  showResend?: boolean
  /** Bestätigungsmail wurde erneut gesendet. */
  resent?: boolean
  /** Für die Wiederanzeige / das erneute Senden mitgeführte Adresse. */
  email?: string
}

export const AUTH_INITIAL_STATE: AuthState = {}
