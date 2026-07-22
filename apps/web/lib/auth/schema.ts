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

/*
 * Firma und Name der Ansprechperson (B10-5) — PFLICHT, und zwar plattformweit gleich streng: es
 * gibt genau EIN Registrierungsformular, und eine bedingte Validierung („nur wenn aus dem
 * Kalkulator-Trichter") ergäbe denselben Screen mit zwei Strengegraden. Die Zielgruppe ist in
 * beiden Produkten der Betrieb, nicht die Privatperson.
 *
 * ZWEI NAMENSFELDER STATT EINEM, Muster exakt wie das Kontaktformular (`lib/kontakt/schema.ts`):
 * eine korrekte Anrede braucht den Nachnamen als eigenen Wert, und die nachträgliche Zerlegung
 * eines Freitextnamens scheitert bei Doppelnamen, Namenszusätzen und Titeln — der Fehler landete
 * dann in der Anrede einer echten E-Mail.
 *
 * `min(1)` statt `min(2)`: es gibt einbuchstabige Vornamen, und ein abgelehnter echter Name kostet
 * mehr als ein zu kurz getippter. Die Obergrenzen entsprechen den Spaltenlängen von
 * `platform.leads` (`LEAD_FIELDS`, B3-2) — ein hier durchgelassener längerer Wert liefe erst an der
 * Datenbank auf, also nach der bereits angelegten Registrierung.
 */
const companyField = z.string().trim().min(1, 'companyRequired').max(120, 'companyTooLong')
const firstNameField = z.string().trim().min(1, 'firstNameRequired').max(100, 'firstNameTooLong')
const lastNameField = z.string().trim().min(1, 'lastNameRequired').max(100, 'lastNameTooLong')

export const registerSchema = z.object({
  email: emailField,
  password: newPasswordField,
  company: companyField,
  firstName: firstNameField,
  lastName: lastNameField,
})
export const loginSchema = z.object({
  email: emailField,
  // Beim Login KEINE Längenpolitik durchsickern lassen — nur „ausgefüllt".
  password: z.string().min(1, 'passwordRequired'),
})
export const forgotSchema = z.object({ email: emailField })
export const newPasswordSchema = z
  .object({ password: newPasswordField, confirm: z.string().min(1, 'passwordRequired') })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'passwordsDontMatch' })

export type AuthFieldName = 'email' | 'password' | 'confirm' | 'company' | 'firstName' | 'lastName'

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
  /*
   * Die drei Pflichtangaben der Registrierung, für die Wiederanzeige nach einem Fehler (B10-5).
   * Ohne sie räumte eine abgelehnte Eingabe drei ausgefüllte Felder ab — das Passwort wird bewusst
   * NICHT mitgeführt (es gehört nicht in einen Server-Zustand, der zurück an den Client geht).
   */
  company?: string
  firstName?: string
  lastName?: string
}

export const AUTH_INITIAL_STATE: AuthState = {}
