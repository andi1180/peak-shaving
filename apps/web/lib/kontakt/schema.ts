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
  vorname: 100,
  nachname: 100,
  email: 254, // RFC 5321: die längste zustellbare Adresse
  unternehmen: 120,
  telefon: 60,
  nachricht: 5000,
  /** „Empfohlen durch" (B16-2) — Freitext, keine Kennung. `platform.leads.referred_by_text`. */
  empfehlung: 200,
} as const

/** Optionales Textfeld: leerer String ist erlaubt und bedeutet „nicht angegeben". */
function optionalText(max: number, tooLongKey: string) {
  return z.string().trim().max(max, tooLongKey).optional()
}

export const kontaktSchema = z.object({
  /*
   * ZWEI FELDER STATT EINEM, und BEIDE Pflicht — anders als die meisten übrigen Lead-Felder im
   * System (dort ist ein Name optional). Das Kontaktformular ist der Kanal mit dem höchsten
   * Anspruch an persönliche Ansprache: auf eine Kontaktanfrage folgt eine Antwort per E-Mail, und
   * die beginnt mit einer Anrede.
   *
   * Getrennt erhoben und NICHT nachträglich zerlegt: jede Zerlegung eines Freitextnamens ist eine
   * Heuristik und scheitert bei Doppelnamen, Namenszusätzen und Titeln — der Fehler landet dann in
   * der Anrede einer echten Mail. Ausführlich begründet in der Migration, die `contact_name`
   * ablöst.
   *
   * `min(1)` statt `min(2)` wie beim früheren gemeinsamen Namensfeld: es gibt einbuchstabige
   * Vornamen („E"), und ein abgelehnter echter Name kostet mehr als ein zu kurz getippter.
   */
  vorname: z.string().trim().min(1, 'vornameRequired').max(MAX.vorname, 'vornameTooLong'),

  nachname: z.string().trim().min(1, 'nachnameRequired').max(MAX.nachname, 'nachnameTooLong'),

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
   * „EMPFOHLEN DURCH" (B16-2) — Freitext, AUSDRÜCKLICH OPTIONAL.
   *
   * Zweck: Der Kunde kommt Tage nach der Partner-Mail direkt über die Startseite; der Pfad
   * `/partner/<slug>` ist dann verloren, die Zuordnung soll trotzdem möglich bleiben. Was hier
   * ankommt, ist eine BEOBACHTUNG („Fa. Raymann Elektro", „mein Elektriker aus Wiener Neustadt") und
   * landet in `platform.leads.referred_by_text` — NICHT in `partner_slug`. Die beiden Spalten sind
   * seit B16-1 getrennt, weil an der Zuordnung später hängt, wer ein Montageprojekt bekommt: In
   * einem Feld vermischt liesse sich nicht mehr feststellen, ob „raymann" dort steht, weil der Kunde
   * es geschrieben hat oder weil jemand es zugeordnet hat.
   *
   * KEIN Pflichtfeld und keine Auswahlliste aller Partner: Wer von niemandem empfohlen wurde, darf
   * nicht zum Leerklicken gezwungen werden — und eine Auswahlliste wäre ein öffentliches Verzeichnis
   * aller Fachbetriebe, mit denen wir zusammenarbeiten.
   */
  empfehlung: optionalText(MAX.empfehlung, 'empfehlungTooLong'),

  /*
   * DER PARTNER-SLUG AUS `?partner=` (B16-2) — und die Erklärung, warum er hier so lax steht.
   *
   * Er ist KEINE Nutzereingabe, sondern ein Query-Parameter, den das Formular nach der Hydration aus
   * der Adresszeile liest (`components/kontakt/kontakt-form.tsx`, dieselbe Mechanik wie `?thema=`).
   * Geprüft wird er SERVERSEITIG gegen die aktiven Fachbetriebe; ein unbekannter, stillgelegter oder
   * formatverletzender Wert wird STILLSCHWEIGEND VERWORFEN und der Lead entsteht trotzdem.
   *
   * Deshalb steht hier bewusst keine Formatregel: Sie würde die GESAMTE Absendung mit einer
   * Feldmeldung abweisen — zu einem Feld, das der Absender nie gesehen hat, wegen eines Tippfehlers
   * in einem Link, den er nicht geschrieben hat. Ein Link mit Tippfehler darf keinen Lead kosten
   * (dieselbe Abwägung, die B16-1 in `public.capture_lead` getroffen hat). Die Längengrenze bleibt,
   * damit der Endpunkt keine beliebig lange Zeichenkette entgegennimmt; sie ist grosszügiger als die
   * echte Slug-Grenze (64), damit sie nie der Grund einer Ablehnung ist.
   *
   * Auf der Landingpage `/partner/<slug>` wird dieses Feld ausdrücklich IGNORIERT — dort gilt der
   * Pfad (s. `lib/kontakt/submit.ts`).
   */
  partner: z.string().trim().max(200).optional(),

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
  | 'vorname'
  | 'nachname'
  | 'email'
  | 'unternehmen'
  | 'telefon'
  | 'thema'
  | 'nachricht'
  /** B16-2 — nur auf `/kontakt` sichtbar, auf der Partner-Landingpage bewusst nicht. */
  | 'empfehlung'
  | 'datenschutz'

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
