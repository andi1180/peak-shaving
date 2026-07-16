/**
 * Der Wissen-Bereich als DATENQUELLE (Pflichtenheft §6.1/§6.5, §10.1).
 *
 * Anders als `lib/leistungen.ts` und `lib/branchen.ts` steht die Liste hier NICHT
 * im Code: Wissen ist eine COLLECTION, die wächst. Ein neuer Artikel ist genau
 * eine neue Datei unter `content/wissen/` — kein Eintrag in einer Tabelle, kein
 * Code-Umbau, kein Message-Block. Diese Datei liest das Verzeichnis und macht aus
 * dem Frontmatter getypte Metadaten.
 *
 * WARUM MDX IM REPO (§10.1): Phase 1 shippt den 2027-Artikel als MDX. Das
 * Autoren-UI (Keystatic, Phase 2) legt sich später OHNE Umbau darüber — es
 * schreibt genau diese Dateien. Ein Editor, der in eine DB schreibt, wäre der
 * Umbau, den §10.1 ausdrücklich vermeidet.
 *
 * WARUM FRONTMATTER STATT `messages/de.json` (§8.7-Ausnahme, bewusst): Die
 * UI-Chrome des Bereichs (Überschriften der Übersicht, Labels, FAQ-Titel) steht
 * weiterhin in den Messages — dort gehört sie hin. Der ARTIKEL-FLIESSTEXT aber
 * nicht: Ein 9-Minuten-Fachtext mit Zwischenüberschriften, Callouts und Charts
 * ist in einer flachen JSON-Datei weder les- noch redigierbar, und Martin soll
 * ihn später in einem Editor bearbeiten, nicht in einem String-Katalog.
 *
 * I18N TROTZDEM GEWAHRT (Prinzip 5): Die Locale steht IM DATEINAMEN
 * (`<slug>.<locale>.mdx`). Ein englisches Pendant ist damit eine Geschwisterdatei
 * (`leistungstarif-2027.en.mdx`) — kein Rearchitecting, kein zweiter Mechanismus.
 * `articlesFor(locale)` filtert; fehlt eine Übersetzung, erscheint der Artikel in
 * dieser Sprache schlicht nicht (besser als ein halb übersetzter Artikel).
 *
 * JSON-LD-READY, ABER KEIN JSON-LD (§6.4): Das Frontmatter trägt bereits alles,
 * was ein späterer `Article`-/`FAQPage`-Block braucht (Datum, Autor, FAQ als
 * `{q,a}`). Das SEO-Fundament ist ein eigener Prompt — hier wird es nur nicht
 * verbaut.
 */

import fs from 'node:fs'
import path from 'node:path'
import { VFile } from 'vfile'
import { matter } from 'vfile-matter'

/** Verzeichnis der Artikel. Liegt bewusst außerhalb von `app/` — Inhalt ist keine Route. */
const CONTENT_DIR = path.join(process.cwd(), 'content', 'wissen')

/**
 * Eine FAQ-Frage. GENAU die Struktur der Branchenseiten (`{ q, a }`) — nicht
 * zufällig, sondern damit ein späterer `FAQPage`-JSON-LD BEIDE Quellen mit
 * derselben Funktion lesen kann. Gerendert wird sie auch von derselben
 * Komponente (`components/faq-section.tsx`).
 */
export type FaqItem = { q: string; a: string }

/**
 * Eine Quellenangabe. §9.5 verlangt Quellen statt Behauptungen — bei einem
 * Artikel über einen laufenden Verordnungsprozess ist das keine Kür: Der Leser
 * muss den Stand selbst nachprüfen können, weil er sich ändern wird.
 */
export type ArticleSource = { label: string; url: string }

/** Das Frontmatter eines Artikels, nach der Validierung. */
export type ArticleMeta = {
  slug: string
  locale: string
  /** H1 der Seite UND `<title>` (mit Marken-Suffix, s. `articleMetadata`). */
  title: string
  /** Meta-Description (§6.3, ~150–160 Zeichen). */
  description: string
  /** Kurz-Kategorie für Index-Karte und Startseiten-Teaser (z. B. „Netzentgelte"). */
  tag: string
  /** Anreißer für Index-Karte und Startseiten-Teaser — NICHT die Description. */
  teaser: string
  /** ISO-Datum (YYYY-MM-DD). Sortierschlüssel + späteres `datePublished`. */
  date: string
  /** ISO-Datum der letzten inhaltlichen Überarbeitung. Späteres `dateModified`. */
  updated?: string
  author: string
  /** Geschätzte Lesezeit in Minuten — reine Leserführung, keine Kennzahl. */
  readingMinutes: number
  /**
   * Der EINE Flaggschiff-Artikel (§6.1), den die Startseite hervorhebt.
   * Mehrere `featured: true` sind ein Fehler und werfen — „hervorgehoben" ist
   * eine Aussage über Rang, und Rang gibt es nur einmal.
   */
  featured?: boolean
  faq: FaqItem[]
  sources: ArticleSource[]
}

/** Frontmatter + der rohe MDX-Körper (ohne Frontmatter-Block). */
export type Article = ArticleMeta & { body: string }

/** `<slug>.<locale>.mdx` — die Locale ist Teil des Dateinamens, s. Kopf. */
const FILE_PATTERN = /^(?<slug>[a-z0-9-]+)\.(?<locale>[a-z]{2})\.mdx$/

function fail(file: string, message: string): never {
  throw new Error(`Wissen-Artikel "${file}": ${message}`)
}

/**
 * YAML liefert `date: 2026-07-16` als `Date`, `date: '2026-07-16'` als String.
 * Beides wird auf „YYYY-MM-DD" normalisiert, statt sich auf die Schreibweise im
 * Frontmatter zu verlassen — ein Autor soll nicht wissen müssen, dass
 * Anführungszeichen den Typ ändern.
 *
 * `toISOString()` auf einem YAML-Datum ist sicher: js-yaml legt reine Datumswerte
 * auf UTC-Mitternacht, der Tag kann also nicht kippen.
 */
function toIsoDate(value: unknown, file: string, field: string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return fail(
    file,
    `Feld "${field}" muss ein Datum im Format YYYY-MM-DD sein (ist: ${String(value)})`,
  )
}

function requireString(data: Record<string, unknown>, key: string, file: string): string {
  const value = data[key]
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(file, `Pflichtfeld "${key}" fehlt oder ist leer`)
  }
  return value
}

function parseFaq(value: unknown, file: string): FaqItem[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return fail(file, '"faq" muss eine Liste sein')
  return value.map((item, i) => {
    const entry = item as Record<string, unknown>
    if (typeof entry?.q !== 'string' || typeof entry?.a !== 'string') {
      return fail(file, `faq[${i}] braucht die Felder "q" und "a" (Struktur der Branchen-FAQ)`)
    }
    return { q: entry.q, a: entry.a }
  })
}

function parseSources(value: unknown, file: string): ArticleSource[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return fail(file, '"sources" muss eine Liste sein')
  return value.map((item, i) => {
    const entry = item as Record<string, unknown>
    if (typeof entry?.label !== 'string' || typeof entry?.url !== 'string') {
      return fail(file, `sources[${i}] braucht die Felder "label" und "url"`)
    }
    return { label: entry.label, url: entry.url }
  })
}

/**
 * Liest eine Datei und validiert ihr Frontmatter. Wirft LAUT statt einen halb
 * befüllten Artikel auszuliefern: Ein Artikel ohne `description` wäre eine Seite
 * ohne Meta-Description — für den stärksten SEO-Hebel des Projekts (§6.1) genau
 * der Fehler, der niemandem auffällt, bis das Ranking fehlt. Der Build bricht,
 * das ist die Absicht.
 *
 * `vfile-matter` und nicht ein zweiter YAML-Parser: `next-mdx-remote` benutzt
 * intern exakt dieses Paket (`parseFrontmatter`). Eine zweite YAML-Engine wäre
 * eine zweite Auslegung derselben Datei — und damit die Möglichkeit, dass
 * Übersicht und Artikelseite unterschiedliche Titel zeigen.
 */
function readArticle(fileName: string): Article {
  const match = FILE_PATTERN.exec(fileName)
  if (!match?.groups) {
    return fail(
      fileName,
      'Dateiname muss "<slug>.<locale>.mdx" sein (z. B. leistungstarif-2027.de.mdx)',
    )
  }
  const { slug, locale } = match.groups as { slug: string; locale: string }

  const raw = fs.readFileSync(path.join(CONTENT_DIR, fileName), 'utf8')
  const file = new VFile(raw)
  matter(file, { strip: true })
  const data = (file.data.matter ?? {}) as Record<string, unknown>

  // Der Slug steht im Dateinamen UND im Frontmatter. Redundant — mit Absicht:
  // Das Frontmatter ist das, was ein Autoren-UI (§10.1) bearbeitet, der
  // Dateiname das, was die URL bestimmt. Driften sie auseinander, zeigt die
  // Seite unter einer anderen Adresse als der Artikel behauptet. Also: prüfen.
  const declaredSlug = requireString(data, 'slug', fileName)
  if (declaredSlug !== slug) {
    fail(fileName, `Frontmatter-slug "${declaredSlug}" weicht vom Dateinamen ("${slug}") ab`)
  }

  const readingMinutes = data.readingMinutes
  if (typeof readingMinutes !== 'number' || !Number.isFinite(readingMinutes)) {
    fail(fileName, 'Pflichtfeld "readingMinutes" fehlt oder ist keine Zahl')
  }

  return {
    slug,
    locale,
    title: requireString(data, 'title', fileName),
    description: requireString(data, 'description', fileName),
    tag: requireString(data, 'tag', fileName),
    teaser: requireString(data, 'teaser', fileName),
    date: toIsoDate(data.date, fileName, 'date'),
    updated: data.updated === undefined ? undefined : toIsoDate(data.updated, fileName, 'updated'),
    author: requireString(data, 'author', fileName),
    readingMinutes,
    featured: data.featured === true,
    faq: parseFaq(data.faq, fileName),
    sources: parseSources(data.sources, fileName),
    body: String(file),
  }
}

/**
 * Alle Artikel, neueste zuerst. Einmal pro Prozess gelesen (Modul-Konstante) —
 * das Verzeichnis ändert sich zur Laufzeit nicht, die Seiten sind statisch
 * vorgerendert.
 */
const ALL_ARTICLES: Article[] = (fs.existsSync(CONTENT_DIR) ? fs.readdirSync(CONTENT_DIR) : [])
  .filter((name) => name.endsWith('.mdx'))
  .map(readArticle)
  // Absteigend nach Datum; bei gleichem Datum alphabetisch, damit die
  // Reihenfolge nicht von der Dateisystem-Sortierung abhängt (die je nach
  // Plattform abweicht — sonst sähe die Übersicht lokal anders aus als auf Vercel).
  .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))

/** Die Artikel einer Locale, neueste zuerst. */
export function articlesFor(locale: string): Article[] {
  return ALL_ARTICLES.filter((article) => article.locale === locale)
}

/**
 * Der hervorgehobene Artikel einer Locale (§6.1) — die Startseite und die
 * Übersicht lesen beide von hier, statt den Slug zu tippen. Ein hartkodiertes
 * „leistungstarif-2027" im Teaser wäre ein toter Link, sobald die Datei
 * umbenannt wird; hier fällt es beim Bauen auf.
 */
export function featuredArticle(locale: string): Article | undefined {
  const featured = articlesFor(locale).filter((article) => article.featured)
  if (featured.length > 1) {
    throw new Error(
      `Mehrere Artikel mit "featured: true" für Locale "${locale}": ${featured
        .map((a) => a.slug)
        .join(', ')} — hervorgehoben ist genau einer.`,
    )
  }
  return featured[0]
}

export function findArticle(locale: string, slug: string): Article | undefined {
  return articlesFor(locale).find((article) => article.slug === slug)
}

/** URL eines Artikels. Der Pfad steht an EINER Stelle (wie `lib/nav.ts` für die IA). */
export function articleHref(slug: string): string {
  return `${WISSEN_HREF}/${slug}`
}

/** Die Bereichs-Übersicht. Deckt sich mit dem Nav-Eintrag „Wissen" in `lib/nav.ts`. */
export const WISSEN_HREF = '/wissen'
