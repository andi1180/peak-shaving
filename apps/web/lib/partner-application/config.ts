/**
 * KONSTANTEN DER PARTNER-BEWERBUNG (B16-3, Fahrplan_2026.md B16).
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Die Route braucht den Pfad, das
 * Client-Formular die Grenzen, `lib/routes.ts` den Eintrag für sitemap und Abgleich, und die Tests
 * alles drei.
 *
 * ── DER PFAD LIEGT AUSDRÜCKLICH NICHT UNTER `/partner/` ─────────────────────────────────────────
 * Dort sitzt seit B16-2 das dynamische Segment `[slug]` (die Landingpage eines Fachbetriebs). Ein
 * statisches Kindsegment `/partner/werden` machte den Slug „werden" für immer unerreichbar — und
 * zwar still: Ein Fachbetrieb mit diesem Kurz-Key bekäme einen Link, der auf eine ganz andere Seite
 * führt, und der Fehler fiele erst auf, wenn die Serienmail bereits draussen ist. `/partner-werden`
 * ist ein eigenes Geschwistersegment und kollidiert mit keinem denkbaren Slug.
 */

/** Die öffentliche Bewerbungsseite — OHNE Locale-Präfix, wie alle Hrefs unter `app/(site)/[locale]`. */
export const PARTNER_BEWERBUNG_HREF = '/partner-werden'

/**
 * Obergrenzen der Eingabefelder.
 *
 * Sie stehen HIER und nicht in der Datenbank: keine andere Textspalte in `platform` trägt eine
 * Längenbeschränkung, und ein Verstoss käme dort als SQLSTATE 23514 zurück statt als Meldung am
 * Feld. Der Wrapper `public.submit_partner_application` ist service_role-only — es gibt keinen
 * Aufrufer an diesem Schema vorbei.
 *
 * `message` ist grosszügig bemessen (5000), weil der Freitext die Grundlage der Prüfung ist: eine
 * knappe Grenze zwänge einen Betrieb, seine Begründung zu kürzen, und genau die wollen wir lesen.
 */
export const PARTNER_APPLICATION_MAX = {
  company: 200,
  firstName: 100,
  lastName: 100,
  /** RFC 5321: die längste zustellbare Adresse. */
  email: 254,
  phone: 60,
  website: 300,
  message: 5000,
} as const

/** Mindestlänge des Passworts — dieselbe Regel wie die Registrierung (`lib/auth/schema.ts`). */
export const PARTNER_APPLICATION_PASSWORD_MIN = 8

/** Mindestlänge des Freitexts. Zwei Wörter sind keine Begründung, aber eine Zeile schon. */
export const PARTNER_APPLICATION_MESSAGE_MIN = 20
