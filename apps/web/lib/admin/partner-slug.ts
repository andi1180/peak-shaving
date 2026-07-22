/**
 * Der Slug-Vorschlag aus dem Firmennamen (B16-4a).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase — die Vorschlagsfunktion läuft im
 * Genehmigungsformular (Client) und ist als reine Funktion prüfbar. Gleiche Aufteilung wie
 * `lib/admin/partners.ts` und `lib/admin/analysis-upload.ts` (B14-2).
 *
 * ── DER VORSCHLAG IST EIN VORSCHLAG, KEINE ABLEITUNG ────────────────────────────────────────────
 * Der Kurz-Key steht in Links, die ein Fachbetrieb an hunderte Bestandskunden verschickt, und ist
 * nach dem Anlegen UNVERÄNDERLICH (Trigger `platform.guard_partner_slug`, B16-1). Er wird deshalb
 * vorgeschlagen und nicht bestimmt: „Elektro Müller GmbH & Co KG" ergibt maschinell keinen
 * Schlüssel, den jemand am Telefon vorlesen möchte. Das Formular belegt das Feld damit vor und
 * lässt es frei überschreiben.
 *
 * ── UMLAUTE WERDEN AUFGELÖST, NICHT ENTFERNT ────────────────────────────────────────────────────
 * „Müller" muss `mueller` ergeben, nicht `mller`. Ein weggeworfener Umlaut macht aus einem Namen
 * eine Buchstabenfolge, die niemand wiedererkennt — und der Slug ist genau das, was ein Kunde im
 * Link sieht und ein Mitarbeiter am Telefon buchstabiert. Die deutschsprachigen Umlaute werden
 * deshalb EXPLIZIT ersetzt (ä→ae, ö→oe, ü→ue, ß→ss); alle übrigen Diakritika (é, å, ç, ł …) fallen
 * anschliessend über die Unicode-Zerlegung weg, weil es für sie keine allgemein richtige
 * Ersetzung gibt und ein `e` für `é` die nächstbeste Lesart ist.
 *
 * WICHTIG ist die REIHENFOLGE: erst die expliziten Ersetzungen, dann die Zerlegung. Andersherum
 * zerlegte NFD das „ü" zuerst in u + Trema, das Trema fiele weg, und aus „Müller" würde `muller` —
 * genau der Fehler, den die explizite Tabelle verhindern soll.
 */

/** Die Form, die `platform.partners.slug` per CHECK erzwingt (B16-1, wörtlich derselbe wie in `lib/admin/schema.ts`). */
export const PARTNER_SLUG_PATTERN = /^[a-z0-9-]+$/

/** Obergrenze wie im zod-Schema (`partnerSlugSchema`) — sie ist eine Bedienbarkeits-, keine DB-Grenze. */
export const PARTNER_SLUG_MAX_LENGTH = 64

/**
 * Rechtsformen, die am ENDE eines Firmennamens stehen und im Link nichts beitragen.
 *
 * Bewusst nur am Ende und bewusst diese kurze Liste: „Elektro Müller GmbH & Co KG" soll
 * `elektro-mueller` ergeben, nicht `elektro-mueller-gmbh-co-kg` — der Link wird vorgelesen und
 * abgetippt. Ein Betrieb, der die Rechtsform IM Namen führen will, überschreibt den Vorschlag; ein
 * Namensteil geht dabei nicht verloren, weil nur nachgestellte Formen entfernt werden.
 */
const LEGAL_FORMS = [
  'gmbh',
  'co',
  'kg',
  'og',
  'ag',
  'ohg',
  'kgaa',
  'gesmbh',
  'ges',
  'eu',
  'ug',
  'se',
  'ev',
  'mbh',
] as const

const UMLAUTS: Array<[RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
]

/**
 * Schlägt aus einem Firmennamen einen gültigen Kurz-Key vor.
 *
 * Liefert `''`, wenn nichts Brauchbares übrig bleibt (ein Name aus reiner Interpunktion, oder ein
 * Ergebnis unter zwei Zeichen). Das ist ausdrücklich KEIN Rückfallwert: ein erfundener Vorschlag
 * wie `partner-1` sähe aus wie eine Empfehlung und würde unwiderruflich übernommen. Ohne Vorschlag
 * bleibt das Feld leer, und die Person tippt selbst.
 */
export function suggestPartnerSlug(company: string): string {
  let value = (company ?? '').toLowerCase()

  for (const [pattern, replacement] of UMLAUTS) value = value.replace(pattern, replacement)

  // Alles Übrige entdiakritisieren: NFD zerlegt „é" in e + Akzent, die Combining Marks fallen weg.
  value = value.normalize('NFD').replace(/[̀-ͯ]/g, '')

  // „&" trägt im Firmennamen eine Bedeutung („Müller & Söhne"), im Link nicht — es wird zum
  // Trennzeichen wie jedes andere Sonderzeichen, damit die beiden Namensteile lesbar bleiben.
  const parts = value
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)

  /*
   * Nachgestellte Rechtsformen entfernen — aber nie den ganzen Namen: bleibt sonst nichts übrig
   * („GmbH" als vollständiger Name), gilt der Name unverändert.
   *
   * Mitentfernt werden nachgestellte EINZELBUCHSTABEN. Sie entstehen aus den Abkürzungspunkten der
   * österreichischen Rechtsformen: „Installateur Huber e.U." zerfällt an den Punkten zu
   * […, 'e', 'u'], und ohne diese Regel hiesse der Link `installateur-huber-e-u`. Ein einzelner
   * Buchstabe am Ende trägt in einem Kurz-Key ohnehin keine Information — und der Vorschlag ist
   * frei überschreibbar, falls doch.
   */
  const isDroppableTail = (part: string) =>
    part.length === 1 || (LEGAL_FORMS as readonly string[]).includes(part)

  while (parts.length > 1 && isDroppableTail(parts[parts.length - 1]!)) {
    parts.pop()
  }

  const slug = parts.join('-').slice(0, PARTNER_SLUG_MAX_LENGTH).replace(/-+$/, '')

  return slug.length >= 2 && PARTNER_SLUG_PATTERN.test(slug) ? slug : ''
}
