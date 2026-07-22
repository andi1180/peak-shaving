/**
 * DAS SCHEMA DER PARTNER-BEWERBUNG — EINE Wahrheit für Client UND Server (B16-3).
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Das Formular
 * (`components/partner/partner-application-form.tsx`) prüft damit für die sofortige, feldgenaue
 * Rückmeldung; der Ablauf (`flow.ts`) prüft mit DERSELBEN Regel noch einmal, weil der Client
 * manipulierbar ist. Zwei Schemata wären zwei Auslegungen desselben Formulars.
 *
 * FEHLERTEXTE SIND KEYS, KEINE SÄTZE (§8.7 und dieselbe Konstruktion wie `lib/kontakt/schema.ts`):
 * die Wortwahl steht in `messages/de.json` unter `PartnerBewerbung.errors.*`, und serverseitig gibt
 * es keinen Locale-Kontext für fertige Texte.
 */

import { z } from 'zod'
import {
  PARTNER_APPLICATION_MAX as MAX,
  PARTNER_APPLICATION_MESSAGE_MIN,
  PARTNER_APPLICATION_PASSWORD_MIN,
} from './config'

/** Optionales Textfeld: leerer String ist erlaubt und bedeutet „nicht angegeben". */
function optionalText(max: number, tooLongKey: string) {
  return z.string().trim().max(max, tooLongKey).optional()
}

export const partnerApplicationSchema = z.object({
  company: z.string().trim().min(1, 'companyRequired').max(MAX.company, 'companyTooLong'),

  /*
   * ZWEI NAMENSFELDER STATT EINEM — dieselbe Regel wie Kontaktformular und Registrierung. Die
   * Zerlegung eines zusammengesetzten Freitextnamens ist eine Heuristik und scheitert bei
   * Doppelnamen, Namenszusätzen und Titeln; der Fehler landet dann in der Anrede einer echten Mail.
   * Genau diese Zusammenlegung hat `platform.leads` einen brechenden Spaltenwechsel gekostet.
   *
   * `min(1)`: es gibt einbuchstabige Vornamen, und ein abgelehnter echter Name kostet mehr als ein
   * zu kurz getippter.
   */
  firstName: z.string().trim().min(1, 'firstNameRequired').max(MAX.firstName, 'firstNameTooLong'),
  lastName: z.string().trim().min(1, 'lastNameRequired').max(MAX.lastName, 'lastNameTooLong'),

  email: z
    .string()
    .trim()
    .min(1, 'emailRequired')
    .email('emailInvalid')
    .max(MAX.email, 'emailTooLong'),

  /*
   * Das Passwort ist NUR im anonymen Fall Pflicht. Wer bereits angemeldet ist, bekommt gar kein
   * Feld — es entsteht kein zweites Konto (s. `flow.ts`). Deshalb `optional()` im Basisschema und
   * eine gesonderte Prüfung im Ablauf, statt zwei Schemata für dieselbe Absendung zu führen.
   *
   * Mindestlänge 8 (strenger als `minimum_password_length = 6` in `supabase/config.toml`): alles,
   * was diese Regel passiert, akzeptiert Supabase auch — es gibt keinen Fall, in dem Supabase
   * nachträglich ablehnt, was hier durchging.
   */
  password: z.string().min(PARTNER_APPLICATION_PASSWORD_MIN, 'passwordTooShort').optional(),

  phone: optionalText(MAX.phone, 'phoneTooLong'),

  /*
   * Website OHNE URL-Prüfung, und das ist eine Entscheidung: Ein Betrieb tippt „elektro-muster.at"
   * ohne Schema, und `z.string().url()` lehnte das ab. Das Feld ist optional und wird von einem
   * Menschen gelesen — eine abgelehnte echte Adresse kostet mehr als eine unvollständige.
   *
   * BEACHTE: Das Feld heisst `websiteUrl` und NICHT `website`. `website` ist in diesem System der
   * Name des Honeypots (Kontaktformular, Lead-Erfassung, hier) — die Falle bleibt überall
   * gleich benannt, damit sie überall gleich zuschnappt. Ein echtes Feld unter demselben Namen
   * hätte den Bot-Schutz an genau dieser einen Seite ausgehebelt.
   */
  websiteUrl: optionalText(MAX.website, 'websiteTooLong'),

  /*
   * DER FREITEXT IST PFLICHT — die zentrale fachliche Entscheidung des Formulars. Er ist die
   * Grundlage der Prüfung und die Basis jeder Rückfrage; ein leerer Antrag ist nicht prüfbar und
   * zwänge dazu, den Betrieb erst anzurufen, um zu erfahren, worüber entschieden werden soll.
   */
  message: z
    .string()
    .trim()
    .min(PARTNER_APPLICATION_MESSAGE_MIN, 'messageTooShort')
    .max(MAX.message, 'messageTooLong'),

  /*
   * DSGVO-Pflichtfeld wie im Kontaktformular. `literal(true)`, nicht `boolean()`: „nicht angehakt"
   * ist kein gültiger Wert, sondern eine fehlende Zustimmung — ein `boolean()` mit anschliessendem
   * `if` wäre dieselbe Regel an zwei Orten.
   */
  datenschutz: z.literal(true, { errorMap: () => ({ message: 'datenschutzRequired' }) }),

  /*
   * HONEYPOT. Hier nur deklariert, damit der Wert `z.object()`s Strip überlebt und der Ablauf ihn
   * sehen kann. BEWUSST NICHT hier validiert: „Feld gefüllt" ist kein Eingabefehler des Nutzers (er
   * kann das Feld gar nicht sehen), sondern ein Spam-Verdacht — das gehört in den Ablauf, nicht in
   * die Feldprüfung, sonst müsste die Oberfläche einen Fehler zu einem unsichtbaren Feld anzeigen.
   */
  website: z.string().optional(),

  /** Nur gesetzt, wenn ein Turnstile-Widget lief (env-gated, s. `lib/kontakt/turnstile.ts`). */
  turnstileToken: z.string().optional(),
})

export type PartnerApplicationInput = z.infer<typeof partnerApplicationSchema>

/** Die Felder, die im Formular sichtbar sind und einen Fehler anzeigen können. */
export type PartnerApplicationFieldName =
  | 'company'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'password'
  | 'phone'
  | 'websiteUrl'
  | 'message'
  | 'datenschutz'

export type PartnerApplicationFieldErrors = Partial<Record<PartnerApplicationFieldName, string>>

/**
 * Die Reihenfolge im DOM. Steuert, welches Feld nach einer fehlgeschlagenen Prüfung den Fokus
 * bekommt: das ERSTE fehlerhafte (§9.4) — nicht das zuletzt geprüfte, was den Nutzer im Formular
 * nach unten springen liesse.
 */
export const PARTNER_APPLICATION_FIELD_ORDER: PartnerApplicationFieldName[] = [
  'company',
  'firstName',
  'lastName',
  'email',
  'password',
  'phone',
  'websiteUrl',
  'message',
  'datenschutz',
]

/** zod-Issues → `{ feld: fehlerKey }`. Der ERSTE Fehler je Feld gewinnt. */
export function toFieldErrors(issues: z.ZodIssue[]): PartnerApplicationFieldErrors {
  const errors: PartnerApplicationFieldErrors = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') continue
    const key = field as PartnerApplicationFieldName
    if (errors[key]) continue
    errors[key] = issue.message
  }
  return errors
}
