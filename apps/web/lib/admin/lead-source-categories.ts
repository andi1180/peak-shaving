/**
 * Die DREI Anzeige-Kategorien der Herkunftsspalte.
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank — die Lead-Liste (Server Component), das
 * Filter-Vokabular (`lib/admin/lead-filters.ts`) und die Tests lesen alle von hier.
 *
 * ── WARUM ES DIESE SCHICHT GIBT ─────────────────────────────────────────────────────────────────
 * `platform.lead_sources` führt derzeit FÜNFZEHN aktive Einstiegspunkte. Fünfzehn Zeilen in einer
 * Ankreuzliste beantworten die Frage nicht, die ein Mensch an der Lead-Liste stellt — die lautet
 * „hat der sich selbst gemeldet, kam der über einen Partner, oder haben wir den aufgenommen?".
 * Genau drei Antworten, und die Einstiegspunkte fallen sauber darauf:
 *
 *   `partner-empfehlung`  → über einen Partner       (die Landingpage eines Fachbetriebs)
 *   `telefonanfrage`      → Manuelle Admin Eingabe   (ein Mensch hat das Telefonat aufgenommen)
 *   ALLE ÜBRIGEN          → Kontaktformular          (Selbstauskunft übers Web)
 *
 * ── DIE DRITTE KATEGORIE IST EINE RESTMENGE, KEINE AUFZÄHLUNG ───────────────────────────────────
 * Das ist die tragende Entscheidung dieses Moduls. „Kontaktformular" ist definiert als „nicht die
 * beiden anderen" — nicht als Liste der dreizehn heute bekannten Schlüssel. Der Unterschied wird
 * beim nächsten Einstiegspunkt sichtbar: Mit einer Aufzählung fiele er aus ALLEN drei Kategorien
 * heraus und wäre über die Herkunftsspalte unauffindbar, ohne dass irgendetwas rot würde. Als
 * Restmenge landet er automatisch dort, wo er hingehört — dieselbe Lesart, die die Aufgabenstellung
 * mit „und was sonst noch in der Liste steht" vorgibt.
 *
 * ── WARUM DIE ZUORDNUNG NICHT IN DER DATENBANK STEHT ────────────────────────────────────────────
 * `lead_sources` ist bewusst eine TABELLE und kein Enum (B1-1/B3): Einstiegspunkte kommen laufend
 * dazu, und der Anwendungscode muss sie nicht kennen. Eine Kategorien-Regel in der Datenbank wäre
 * eine zweite Taxonomie neben dieser hier — und beim nächsten Einstiegspunkt sagten die beiden
 * Verschiedenes, ohne dass es auffiele. Die Datenbank bekommt deshalb eine SCHLÜSSELMENGE
 * (`p_source_keys`), nicht eine Kategorie.
 *
 * ── DAS IST GEFAHRLOS, WEIL DIE SCHLÜSSELLISTE GEPINNT IST ──────────────────────────────────────
 * Aufgelöst wird über `LEAD_SOURCE_KEYS` (`lib/leads/registry.ts`), und das DB-Gate prüft in BEIDE
 * Richtungen, dass diese Liste genau den aktiven `platform.lead_sources` entspricht
 * (`lead-source-registry.test.ts`). Ein neuer Schlüssel ohne Registry-Eintrag macht das Gate rot,
 * bevor er hier ankommen kann — die Restmenge kann also nicht unvollständig werden.
 *
 * Die Auflösung passiert damit VOR dem Datenbankaufruf und braucht die Antwort nicht: Die Liste der
 * Einstiegspunkte fährt zwar in `admin_list_leads` mit, aber sie käme zu spät — die Filterargumente
 * stehen fest, bevor die Abfrage läuft.
 */

import { LEAD_SOURCE_KEYS } from '@/lib/leads/registry'

/**
 * Die Kategorie-Werte, wie sie in der URL stehen. Deutsche Schlüssel wie die Parameternamen
 * ringsum — anders als bei `partner`/`assigned` (B18-5) sind das KEINE Datenbankwerte, sondern eine
 * Erfindung dieser Oberfläche: die Datenbank kennt die Kategorien gar nicht.
 */
export const LEAD_SOURCE_CATEGORIES = ['kontakt', 'partner', 'admin'] as const
export type LeadSourceCategory = (typeof LEAD_SOURCE_CATEGORIES)[number]

/**
 * Die zwei Einstiegspunkte, die eine EIGENE Kategorie bilden. Alles andere ist „Kontaktformular".
 *
 * Sie stehen hier als Literale und nicht als abgeleitete Menge, weil sie eine fachliche Aussage
 * sind und keine technische: `partner-empfehlung` ist die einzige Herkunft, bei der ein
 * Fachbetrieb den Kontakt geschickt hat, `telefonanfrage` die einzige, bei der niemand selbst
 * abgeschickt hat. Beide Schlüssel sind typgeprüft — ein Tippfehler bricht den Build.
 */
const PARTNER_SOURCE_KEY = 'partner-empfehlung' satisfies (typeof LEAD_SOURCE_KEYS)[number]
const ADMIN_SOURCE_KEY = 'telefonanfrage' satisfies (typeof LEAD_SOURCE_KEYS)[number]

export const LEAD_SOURCE_CATEGORY_LABELS: Record<LeadSourceCategory, string> = {
  kontakt: 'Kontaktformular',
  partner: 'über einen Partner',
  admin: 'Manuelle Admin Eingabe',
}

export function isLeadSourceCategory(value: unknown): value is LeadSourceCategory {
  return (
    typeof value === 'string' && (LEAD_SOURCE_CATEGORIES as readonly string[]).includes(value)
  )
}

/** Die Kategorie eines Herkunftsschlüssels — für die ANZEIGE je Zeile. */
export function categoryOfSourceKey(key: string): LeadSourceCategory {
  if (key === PARTNER_SOURCE_KEY) return 'partner'
  if (key === ADMIN_SOURCE_KEY) return 'admin'
  return 'kontakt'
}

/** Die Anzeige-Beschriftung eines Herkunftsschlüssels — eine der genau drei Kategorien. */
export function sourceCategoryLabel(key: string): string {
  return LEAD_SOURCE_CATEGORY_LABELS[categoryOfSourceKey(key)]
}

/**
 * Kategorien → die Schlüsselmenge für `p_source_keys` — für das FILTERN.
 *
 * Leere oder vollständige Auswahl ergibt `undefined`: beides heisst „keine Einschränkung", und ein
 * Filter, der alles durchlässt, gehört nicht in die Adresse (und nicht ins Ausfuhrprotokoll, das
 * ihn sonst als angewandte Auswahl ausweisen würde).
 */
export function sourceKeysForCategories(
  categories: readonly LeadSourceCategory[],
): string[] | undefined {
  if (categories.length === 0 || categories.length === LEAD_SOURCE_CATEGORIES.length) {
    return undefined
  }
  const wanted = new Set(categories)
  return LEAD_SOURCE_KEYS.filter((key) => wanted.has(categoryOfSourceKey(key)))
}
