/**
 * DIE PARTNER-ATTRIBUTION IM ANWENDUNGSCODE (B16-2, Fahrplan_2026.md B16).
 *
 * Modell A: Ein Fachbetrieb schreibt seine eigenen Bestandskunden an und verweist sie über einen
 * personalisierten Link an COOLiN. COOLiN führt Analyse und Kundenbeziehung, der Partner bekommt
 * das erste Zugriffsrecht auf die Montage.
 *
 * ── ZWEI WEGE, EINE ZUORDNUNG ────────────────────────────────────────────────────────────────────
 *   1. `/partner/<slug>` — die Landingpage. Der Slug steht im PFAD und wird serverseitig gelesen.
 *   2. `/kontakt?partner=<slug>` — der Nachzügler. Wer Tage später direkt über die Startseite kommt,
 *      hat den Pfad verloren; ein Link, der auf die Kontaktseite zeigt, soll trotzdem attributieren.
 *
 * Beide werden gegen die AKTIVEN Fachbetriebe geprüft (`public.get_active_partner`, service_role,
 * s. `lib/leads/store.ts`), bevor irgendetwas geschrieben wird.
 *
 * ── AUSDRÜCKLICH KEIN COOKIE, KEIN localStorage, KEIN sessionStorage ─────────────────────────────
 * Die Attribution läuft ausschliesslich über den URL-Pfad und ein Formularfeld. Eine Speicherung auf
 * dem Endgerät wäre nach §165 TKG einwilligungspflichtig und brächte einen Cookie-Banner für die
 * gesamte Domain mit sich — das beendete die bestehende, cookielose Analytics-Architektur. Aus
 * demselben Grund wird der Slug auch NICHT über alle internen Links weitergereicht.
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Die Route braucht die Prüfung, das
 * Formular die Pfade, `lib/routes.ts` die Vorlage, und die Tests alles drei.
 */

/**
 * Der öffentliche Basispfad — OHNE Locale-Präfix, wie alle Hrefs unter `app/(site)/[locale]`.
 *
 * Steht hier und nicht in `lib/nav.ts`: Die Seite ist bewusst in keinem Menü und in keiner
 * Informationsarchitektur. Sie existiert für den Direktlink aus der Partner-Mail.
 */
export const PARTNER_HREF = '/partner'

/**
 * Die Routen-Vorlage, wie `assertRoutesMatchDisk()` sie erwartet (`lib/routes.ts`).
 *
 * Als Konstante und nicht als getippter String an der Verwendungsstelle, damit ein Umbenennen des
 * Ordners und der Registry-Eintrag nicht auseinanderlaufen können — der Abgleich mit der Platte
 * bricht sonst erst beim Bauen, und zwar mit einer Meldung über eine Route, die es „nicht gibt".
 */
export const PARTNER_ROUTE_TEMPLATE = `${PARTNER_HREF}/[slug]`

/** Der Query-Parameter auf `/kontakt`. Kurz, weil er in gedruckten und getippten Links landet. */
export const PARTNER_QUERY_PARAM = 'partner'

/**
 * Die Herkunft, unter der ein Lead von der Landingpage entsteht (`platform.lead_sources.key`).
 *
 * NICHT dasselbe wie die Zuordnung: die Herkunft sagt „kam über eine Partner-Landingpage", der
 * `partner_slug` sagt, über welchen Fachbetrieb. Beide werden gebraucht — die Herkunft überlebt eine
 * verworfene Zuordnung (unbekannter oder inzwischen stillgelegter Slug), die Zuordnung überlebt die
 * Anonymisierung des Leads (B16-1).
 */
export const LEAD_SOURCE_PARTNER = 'partner-empfehlung'

/**
 * Das Format eines Partner-Slugs — WÖRTLICH der CHECK auf `platform.partners.slug` (B16-1), der
 * seinerseits wörtlich der CHECK auf `platform.lead_sources.key` ist (B1-1).
 *
 * Die Prüfung hier ist keine zweite Wahrheit, sondern die frühe: sie erlaubt der Route, einen
 * formatverletzenden Slug als 404 zu beantworten, ohne die Datenbank zu befragen. Die harte Grenze
 * bleibt der CHECK — ein Slug, der ihm nicht genügt, kann gar nicht gespeichert sein und findet
 * deshalb auch über den Wrapper nichts.
 */
export const PARTNER_SLUG_PATTERN = /^[a-z0-9-]+$/

/**
 * Obergrenze für einen entgegengenommenen Slug. Die Spalte selbst hat keine — `text` ist unbegrenzt,
 * und das ist für einen Primärschlüssel richtig. Was hier begrenzt wird, ist die EINGABE aus einer
 * öffentlichen URL bzw. einem Formular-Rumpf: ohne Obergrenze nähme der Endpunkt eine beliebig lange
 * Zeichenkette entgegen und reichte sie an die Datenbank weiter, nur um dort nichts zu finden.
 */
export const PARTNER_SLUG_MAX_LENGTH = 64

/** Hat der Wert die Form eines Slugs? Kein Nachschlagen — nur die Form. */
export function isPartnerSlugFormat(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PARTNER_SLUG_MAX_LENGTH &&
    PARTNER_SLUG_PATTERN.test(value)
  )
}

/**
 * Prüft eine Eingabe auf die Form eines Slugs — oder gibt `null` zurück, wenn sie keine hat.
 *
 * `null` heisst für die Landingpage `notFound()` und für den `?partner=`-Parameter „stillschweigend
 * verwerfen": ein Link mit Tippfehler darf keinen Lead kosten (dieselbe Abwägung, die B16-1 in
 * `capture_lead` getroffen hat).
 *
 * ── ES WIRD BEWUSST NICHT KLEINGESCHRIEBEN — anders als in der Datenbank ────────────────────────
 * `public.capture_lead` und `public.get_active_partner` schreiben einen übergebenen Slug klein; das
 * ist dort richtig und harmlos (der CHECK garantiert, dass jeder GESPEICHERTE Slug kleingeschrieben
 * ist — das Kleinschreiben kann nur einen Nicht-Treffer in den richtigen Treffer verwandeln, nie in
 * einen falschen).
 *
 * Hier geht es aber um eine ADRESSE, nicht um einen Vergleich. Akzeptierte Schreibvarianten wären
 * mehrere URLs für dieselbe Seite — `/partner/raymann`, `/partner/Raymann`, `/partner/RAYMANN` —,
 * und der Slug ist genau deshalb der Primärschlüssel, weil es von ihm eine einzige Form geben soll.
 * Der Link entsteht ausserdem nicht von Hand: Der Admin-Bereich zeigt ihn fertig zum Kopieren an
 * (B16-2), und von dort ist er immer kleingeschrieben. Eine grosszügige Route löste damit ein
 * Problem, das es nicht gibt, und schüfe dafür ein zweites.
 *
 * Trimmen bleibt: Ein `?partner=` aus einer kopierten Adresse trägt schon einmal ein Leerzeichen,
 * und das ist keine Schreibvariante, sondern Verpackung.
 */
export function normalizePartnerSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim()
  return isPartnerSlugFormat(slug) ? slug : null
}

/** Der öffentliche Pfad eines Partners — ohne Domain, ohne Locale. */
export function partnerHref(slug: string): string {
  return `${PARTNER_HREF}/${slug}`
}

/** Der Anzeigename eines aktiven Fachbetriebs — das EINZIGE, was nach aussen gelangt. */
export type PublicPartner = {
  slug: string
  displayName: string
}
