/**
 * Das Kontaktformular-Schema — EINE Wahrheit für Client UND Server (§5.5).
 *
 * Rein: kein `server-only`, kein Resend, kein `next/*`. Dadurch kann sowohl das
 * Formular (`components/kontakt/kontakt-form.tsx`) als auch die Route
 * (`app/api/kontakt/route.ts`) exakt dasselbe Schema anwenden. Zwei Schemata
 * wären zwei Auslegungen desselben Formulars — die clientseitige Prüfung würde
 * durchlassen, was der Server ablehnt (oder umgekehrt), und der Nutzer sähe einen
 * Fehler ohne Feld.
 *
 * WARUM CLIENTSEITIG ÜBERHAUPT PRÜFEN, wenn der Server ohnehin prüft: Der Client
 * prüft für die UX (sofortige, feldgenaue Rückmeldung ohne Netzfahrt), der Server
 * prüft für die Wahrheit (der Client ist manipulierbar). Beide sind nötig, aber
 * nur eine Regel darf existieren.
 *
 * FEHLERTEXTE SIND HIER KEYS, KEINE SÄTZE. §8.7 verlangt alle nutzergerichteten
 * Texte in `messages/de.json`; zusätzlich läuft dieses Schema serverseitig ohne
 * Locale-Kontext. Deshalb trägt jede Regel einen stabilen Key (`nameRequired`),
 * den erst die UI zu einem Satz auflöst (`Kontakt.errors.<key>`).
 */

import { z } from 'zod'
import { THEMA_KEYS } from './themen'

/**
 * Max-Längen sind kein Schikane-Limit, sondern die Grenze zwischen „lange
 * Nachricht" und „Payload-Missbrauch": ohne Obergrenze nimmt die Route beliebig
 * große Bodies an und reicht sie an Resend weiter.
 */
const MAX = {
  name: 100,
  email: 254, // RFC 5321: die längste zustellbare Adresse
  unternehmen: 120,
  telefon: 60,
  nachricht: 5000,
} as const

/** Optionales Textfeld: leerer String ist erlaubt und bedeutet „nicht angegeben". */
function optionalText(max: number, tooLongKey: string) {
  return z.string().trim().max(max, tooLongKey).optional()
}

export const kontaktSchema = z.object({
  name: z.string().trim().min(2, 'nameRequired').max(MAX.name, 'nameTooLong'),

  /*
   * `.email()` ist eine Format-, keine Existenzprüfung — sie fängt den Tippfehler,
   * nicht die erfundene Adresse. Das ist der Grund, warum die Antwort-Adresse
   * zusätzlich als `reply-to` in der internen Mail landet (s. `deliver.ts`):
   * ein Rückläufer ist dort sichtbar, hier nicht.
   */
  email: z
    .string()
    .trim()
    .min(1, 'emailRequired')
    .email('emailInvalid')
    .max(MAX.email, 'emailTooLong'),

  unternehmen: optionalText(MAX.unternehmen, 'unternehmenTooLong'),

  /*
   * Bewusst KEINE Formatprüfung der Telefonnummer. Internationale Schreibweisen
   * (+43 1 …, 0043…, Durchwahlen, Klammern) sind mit einer Regex nicht sauber zu
   * fassen; jede Regex hier lehnt irgendwann eine echte Nummer ab. Das Feld ist
   * optional — ein falsch getipptes Optionalfeld kostet nichts, ein abgelehnter
   * Lead alles.
   */
  telefon: optionalText(MAX.telefon, 'telefonTooLong'),

  /* Gegen DIESELBE Liste, die das Dropdown rendert (s. `themen.ts`). */
  thema: z.enum(THEMA_KEYS, { errorMap: () => ({ message: 'themaInvalid' }) }),

  nachricht: z.string().trim().min(10, 'nachrichtTooShort').max(MAX.nachricht, 'nachrichtTooLong'),

  /*
   * `literal(true)`, nicht `boolean()`: „nicht angehakt" ist kein gültiger Wert,
   * sondern eine fehlende Einwilligung (§5.5, DSGVO). Ein `boolean()` mit
   * anschließendem if wäre dieselbe Regel an zwei Orten.
   */
  datenschutz: z.literal(true, { errorMap: () => ({ message: 'datenschutzRequired' }) }),

  /*
   * MARKETING-EINWILLIGUNG (B1-2) — ausdrücklich `boolean().optional()` und NICHT `literal(true)`
   * wie `datenschutz` darüber. Der Unterschied ist der ganze Punkt: die Datenschutz-Zustimmung ist
   * Voraussetzung dafür, die Anfrage überhaupt bearbeiten zu dürfen; diese hier ist eine ZUSÄTZLICHE
   * Einwilligung in künftige Werbung. Sie ist nie vorausgewählt, nie erforderlich, und ihr Fehlen
   * ist kein Eingabefehler — es ist die häufigste und völlig gültige Antwort.
   *
   * Erzeugt sie `true`, entsteht serverseitig eine UNBESTÄTIGTE Einwilligung plus Bestätigungsmail
   * (Double-Opt-in). Erst die Bestätigung berechtigt zum Versand (B1-1:
   * `platform.has_confirmed_consent` ist bei `pending` ausdrücklich false).
   */
  marketing: z.boolean().optional(),

  /*
   * HONEYPOT — siehe `components/kontakt/kontakt-form.tsx`. Hier nur deklariert,
   * damit der Wert `z.object()`s Strip überlebt und die Route ihn sehen kann.
   * BEWUSST NICHT hier validiert: „Feld gefüllt" ist kein Eingabefehler des
   * Nutzers (er kann das Feld gar nicht sehen), sondern ein Spam-Verdacht — das
   * gehört in die Route, nicht in die Feldprüfung, sonst müsste die UI einen
   * Fehler zu einem unsichtbaren Feld anzeigen.
   */
  website: z.string().optional(),

  /* Nur gesetzt, wenn ein Turnstile-Widget lief (env-gated, s. `turnstile.ts`). */
  turnstileToken: z.string().optional(),

  /*
   * Locale des Absenders. Der Server löst damit das Thema-Label für die interne
   * Mail auf — er nimmt NICHT das vom Client geschickte Label entgegen (das wäre
   * eine vom Absender frei wählbare Zeile in unserer eigenen Benachrichtigung).
   * Ungültige Werte fallen in der Route auf die Default-Locale zurück.
   */
  locale: z.string().optional(),
})

export type KontaktInput = z.infer<typeof kontaktSchema>

/**
 * Die Felder, die im Formular sichtbar sind und einen Fehler anzeigen können.
 * Getrennt von `KontaktInput`, weil Honeypot/Token/Locale keine Felder sind, an
 * denen je eine Meldung erscheinen darf.
 */
export type KontaktFieldName =
  'name' | 'email' | 'unternehmen' | 'telefon' | 'thema' | 'nachricht' | 'datenschutz'

/**
 * zod-Issues → `{ feld: fehlerKey }`. Der ERSTE Fehler je Feld gewinnt: ein Feld
 * zeigt eine Meldung, nicht deren drei.
 */
export function toFieldErrors(issues: z.ZodIssue[]): Partial<Record<KontaktFieldName, string>> {
  const errors: Partial<Record<KontaktFieldName, string>> = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') continue
    const key = field as KontaktFieldName
    if (errors[key]) continue
    errors[key] = issue.message
  }
  return errors
}

/**
 * ─── Der Contract zwischen Formular und `POST /api/kontakt` ──────────────────
 *
 * Steht HIER und nicht in `app/api/kontakt/route.ts`, obwohl die Route ihn
 * erfüllt: Das Formular ist eine Client-Komponente. Importierte es den Typ aus
 * der Route, hinge ein Client-Modul an einem Modul, das `deliver.ts` (und damit
 * `server-only` + das Resend-SDK) zieht. Ein `import type` verschwindet zwar beim
 * Kompilieren — aber die Abhängigkeitsrichtung „Client kennt Server-Route" wäre
 * eingerichtet und der nächste Griff daneben (ein Wert statt eines Typs) würde
 * genau das leaken, was `server-only` verhindern soll. Der Contract gehört zur
 * Schema-Wahrheit, nicht zu einer ihrer beiden Seiten.
 */
export type KontaktErrorCode =
  /** Feldprüfung fehlgeschlagen — `fieldErrors` trägt die Details. */
  | 'validation'
  /** Honeypot gefüllt (s. `route.ts`). */
  | 'spam'
  /** Turnstile abgelehnt oder Token fehlt, obwohl geprüft wird. */
  | 'turnstile'
  /** Resend-Env fehlt — unser Setup, nicht die Eingabe des Nutzers. */
  | 'not_configured'
  /** Resend hat abgelehnt / war nicht erreichbar. */
  | 'send_failed'
  /** Body war kein gültiges JSON. */
  | 'bad_request'

export type KontaktResponse =
  | { ok: true }
  | {
      ok: false
      error: KontaktErrorCode
      fieldErrors?: Partial<Record<KontaktFieldName, string>>
    }
