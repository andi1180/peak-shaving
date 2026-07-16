/**
 * Strukturierte Daten (JSON-LD) — die maschinenlesbare Schicht (Pflichtenheft §6.4).
 *
 * HIER STEHEN DIE BAUSTEINE, NICHT DIE AUSGABE: Gerendert wird über
 * `components/json-ld.tsx` (`<JsonLd schema={…} />`). Diese Datei kennt nur die
 * Formen — sie ist rein, hat keine JSX-Abhängigkeit und ist damit dieselbe Sorte
 * Modul wie `lib/seo.ts`: eine Funktion pro Aussage, die Seiten rufen sie auf.
 *
 * JEDE URL IST ABSOLUT UND KOMMT AUS `absoluteUrl` (`lib/site.ts`). JSON-LD hat
 * keinen Dokumentkontext, gegen den ein Crawler einen relativen Pfad auflösen
 * müsste — eine relative URL ist hier schlicht kaputt, und zwar still.
 *
 * KEINE ZWEITE WAHRHEIT (der eigentliche Punkt): Jeder Baustein liest DIE
 * QUELLE, aus der auch das sichtbare HTML entsteht — die FAQ aus derselben
 * `items`-Liste wie `FaqSection`, der Artikel aus seinem Frontmatter, die
 * Firmendaten aus `COMPANY` (`lib/nav.ts`). Nichts wird für das Markup neu
 * getippt. Für die FAQ ist das keine Stilfrage: Ein `FAQPage`, dessen Antworten
 * nicht wörtlich auf der Seite stehen, ist ein Verstoß gegen Googles Richtlinien
 * und kann eine manuelle Maßnahme auslösen.
 */

import type { FaqItem } from '@/components/faq-section'
import { COMPANY } from './nav'
import { absoluteUrl } from './site'
import type { Article } from './wissen'

/**
 * Ein JSON-LD-Knoten. Bewusst nur so streng wie nötig: `unknown` als Wert würde
 * jeden Aufrufer zum Casten zwingen, ein präzises Schema.org-Typmodell wäre ein
 * eigenes Projekt. Was hier zählt, ist die Zusicherung „serialisierbares Objekt".
 */
export type JsonLdNode = Record<string, unknown>

/**
 * Die IDENTITÄT der Firma im Graph.
 *
 * Ein `@id` ist die Adresse eines DINGES, nicht einer Seite — deshalb der
 * Fragment-Anker: `https://…/#organization` ist nicht die Startseite, sondern
 * „die Firma, von der die Startseite handelt". Jede Seite, die die Firma
 * erwähnt, verweist auf genau diese ID, statt sie neu zu beschreiben (s.
 * `organizationRef`). Ohne das entstünden aus einem Artikel-`publisher`, einem
 * `provider` des Kalkulators und dem globalen Block DREI Firmen, die zufällig
 * gleich heißen — und Google müsste raten, welche gemeint ist.
 */
export const ORGANIZATION_ID = absoluteUrl('/#organization')

/**
 * Ein VERWEIS auf die Firma — kein zweiter Firmen-Knoten.
 *
 * Das ist die Hälfte, die den doppelten Eintrag verhindert: `{ '@id': … }` ohne
 * `name`/`address` sagt „das Ding, das anderswo unter dieser ID beschrieben ist".
 * Beschrieben wird es genau einmal, im Root-Layout (`organizationLd`), und damit
 * auf jeder Seite genau einmal.
 */
export function organizationRef(): JsonLdNode {
  return { '@id': ORGANIZATION_ID }
}

/**
 * Organization + LocalBusiness — der globale Firmen-Knoten (§6.4).
 *
 * WARUM EIN KNOTEN MIT ZWEI TYPEN und nicht zwei Knoten: `LocalBusiness` IST in
 * der schema.org-Hierarchie eine `Organization`. COOLiN ENERGY ist EINE Firma
 * mit EINER Wiener Adresse — zwei Knoten (auch verlinkte) behaupteten zwei
 * Dinge. Die Typliste sagt korrekt „dieses eine Ding ist beides", trägt EIN
 * `@id` und kann deshalb gar nicht doppelt gezählt werden. Dass `Organization`
 * neben `LocalBusiness` streng genommen redundant ist (Unterklasse), ist
 * beabsichtigt: §6.4 verlangt beide ausdrücklich, und ein Konsument, der die
 * Klassenhierarchie nicht auflöst, sieht so trotzdem beides.
 *
 * WAS FEHLT, FEHLT MIT ABSICHT — die Begründung steht bei `COMPANY`
 * (`lib/nav.ts`): Rechtsform, UID, Firmenbuchnummer und Geschäftsführung sind
 * OP#13 und im Bestands-Impressum selbst „[ergänzen]". Telefon, Social-Profile
 * (`sameAs`), Öffnungszeiten, `geo`-Koordinaten und ein `logo` (OP#7) existieren
 * nicht bzw. sind unbestätigt. Ein schlankes, wahres LocalBusiness ist mehr wert
 * als ein vollständiges mit geratenen Feldern: Die geratenen Felder merkt
 * niemand — bis sie jemand glaubt.
 */
export function organizationLd(): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'LocalBusiness'],
    '@id': ORGANIZATION_ID,
    name: COMPANY.name,
    url: absoluteUrl('/'),
    email: COMPANY.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: COMPANY.address.street,
      postalCode: COMPANY.address.postalCode,
      addressLocality: COMPANY.address.locality,
      addressCountry: COMPANY.address.countryCode,
    },
  }
}

/**
 * `FAQPage` — die strukturierte Fassung der SICHTBAREN FAQ.
 *
 * Nimmt exakt die Liste entgegen, die `FaqSection` rendert, und wird auch von
 * dort aufgerufen. Das ist keine Bequemlichkeit, sondern die Absicherung: Frage
 * und Antwort können nicht vom sichtbaren Text abweichen, weil es derselbe
 * String im selben Render ist. Zwei Quellen wären zwei Gelegenheiten, gegen
 * Googles Richtlinie („markup must match visible content") zu verstoßen.
 *
 * Der Fließtext geht unverändert in `text` — Google erlaubt dort begrenztes
 * HTML, unsere Antworten sind reiner Text und bleiben es.
 */
export function faqPageLd(items: FaqItem[]): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

/**
 * Der Autor eines Artikels.
 *
 * WARUM DIE FALLUNTERSCHEIDUNG statt eines festen Typs: Das Frontmatter trägt
 * einen NAMEN, keinen Typ. „COOLiN ENERGY" fest als `Person` auszugeben, erfände
 * einen Menschen dieses Namens; ein späteres „Martin Muster" fest als
 * `Organization` auszugeben, erfände eine Firma. Beides sind Falschaussagen über
 * eine reale Entität — die Sorte Fehler, die ein Knowledge Graph übernimmt und
 * nicht mehr hergibt.
 *
 * Steht der Firmenname da, ist der Autor NACHWEISLICH die Firma, die diese Seite
 * betreibt — dann der Verweis auf denselben `@id`-Knoten statt einer zweiten
 * Beschreibung derselben Firma.
 */
function authorLd(author: string): JsonLdNode {
  if (author === COMPANY.name) return organizationRef()
  return { '@type': 'Person', name: author }
}

/**
 * `Article` — nur auf `/wissen/<slug>`, vollständig aus dem Frontmatter (§6.4).
 *
 * Das Frontmatter wurde in Prompt 11 ausdrücklich JSON-LD-ready gebaut
 * (`lib/wissen.ts`); hier wird es eingelöst, ohne dass eine einzige Angabe neu
 * erfasst werden musste.
 *
 * `headline` ist der REINE Artikeltitel, nicht der `<title>` der Seite: Der trägt
 * das Marken-Suffix („… — COOLiN ENERGY"), das im Titel des Artikels nichts zu
 * suchen hat. `description`, `datePublished`, `author` sind 1:1 die Felder, die
 * auch die Seite zeigt.
 *
 * `dateModified` fällt auf `date` zurück, wenn `updated` fehlt — das ist keine
 * Notlösung, sondern die Wahrheit: Ein nie überarbeiteter Artikel wurde zuletzt
 * bei seiner Veröffentlichung geändert. Die sichtbare Meta-Zeile lässt „Aktualisiert"
 * in diesem Fall korrekt ganz weg (nichts zu melden), das Feld hier braucht einen
 * Wert — beide sagen dasselbe.
 *
 * KEIN `image`: Die einzige Bildquelle der Seite ist die OG-Karte aus
 * `opengraph-image.tsx`, und ihre URL ist eine Next-INTERNE Route mit
 * generiertem Hash (gemessen: `/de/opengraph-image-1yhjss?5d6238ec81b4ed34` —
 * Pfad-Hash UND Cache-Buster stammen aus dem Dateiinhalt, es gibt keine API
 * dafür). Sie hier nachzubauen hieße, Next-Interna zu kopieren, die beim
 * nächsten Karten-Wechsel STILL auf ein 404 zeigen. `image` ist bei Google für
 * `Article` empfohlen, nicht erforderlich — ein fehlendes Feld ist ehrlicher als
 * ein totes. Der saubere Weg ist ein eigenes `image`-Frontmatter-Feld, sobald es
 * echte Artikelbilder gibt (OP#7); dann validiert `lib/wissen.ts` es wie die
 * übrigen Pflichtfelder.
 */
export function articleLd(article: Article, url: string): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    /*
     * Verankert den Artikel an SEINER Seite. Ohne das muss ein Crawler raten, ob
     * der Knoten die Seite beschreibt oder ein anderswo veröffentlichtes Werk,
     * das hier nur zitiert wird.
     */
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    headline: article.title,
    description: article.description,
    datePublished: article.date,
    dateModified: article.updated ?? article.date,
    author: authorLd(article.author),
    publisher: organizationRef(),
    inLanguage: article.locale,
  }
}

/**
 * Der Pro-Kalkulator als `SoftwareApplication` (§6.4 „Product (Kalkulator)").
 *
 * WARUM NICHT `Product`: Ein `Product` ohne `offers` ist für Google ein
 * unvollständiges Produkt — die Rich Results melden „missing field offers", und
 * die einzige Art, das zu füllen, wäre ein Preis. Den gibt es nicht: OP#1 (frei
 * vs. bezahlt) ist die offene Geschäfts-Weiche, und §3.3 verbietet der Seite
 * schon in der Copy jede endgültige Preis-Aussage. Ein erfundener Preis im
 * Markup wäre dieselbe Lüge, nur unsichtbar.
 *
 * `SoftwareApplication` beschreibt dieselbe Sache ehrlicher — der Kalkulator IST
 * eine Anwendung, keine Ware — und hat keine erforderlichen Preisfelder. Der
 * Preis fehlt hier also nicht als Lücke, sondern weil der Typ ihn nicht braucht.
 *
 * BEWUSST OHNE: `offers`/`price` (s. o.), `aggregateRating`/`review` (es gibt
 * keine Bewertungen — eine erfundene Sternezahl ist bei Google ausdrücklich eine
 * manuelle Maßnahme wert, und §9.5 verbietet erfundene Kennzahlen ohnehin).
 * Ohne diese Felder ist die Anwendung für ein Rich Result nicht qualifiziert —
 * das ist der Preis dafür, keine Zahlen zu erfinden, und er ist richtig bezahlt.
 * Der Knoten trägt trotzdem: Er sagt Suchmaschinen, WAS diese Seite anbietet und
 * WER es anbietet.
 */
export function calculatorLd({
  name,
  description,
  url,
  locale,
}: {
  name: string
  description: string
  url: string
  locale: string
}): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${url}#calculator`,
    name,
    description,
    url,
    /** Ein Werkzeug für Betriebe, kein Consumer-Produkt — schema.org-Vokabular. */
    applicationCategory: 'BusinessApplication',
    /** Läuft im Browser; es gibt keine Installation und kein Zielsystem. */
    operatingSystem: 'Web',
    provider: organizationRef(),
    inLanguage: locale,
  }
}
