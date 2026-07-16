import type { MetadataRoute } from 'next'
import { getPathname } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { assertRoutesMatchDisk, SITE_ROUTES } from '@/lib/routes'
import { absoluteUrl } from '@/lib/site'
import { articleHref, articlesFor } from '@/lib/wissen'

/**
 * /sitemap.xml (Pflichtenheft §6.4).
 *
 * DIE URLS ENTSTEHEN ÜBER `getPathname` — dieselbe Funktion, aus der `Link` und
 * der Canonical (`lib/seo.ts`) ihre Adressen bauen. Das ist die entscheidende
 * Eigenschaft dieser Datei: Eine sitemap-URL, die vom Canonical derselben Seite
 * abweicht, ist bestenfalls ein verschwendeter Crawl und schlimmstenfalls ein
 * Widerspruch („crawle X" / „X ist eigentlich Y"). Ein zusammengebautes
 * `${SITE_URL}/de${href}` wäre genau diese zweite Auslegung von
 * `localePrefix: 'as-needed'` — Deutsch läuft ohne Präfix, und das sieht man
 * einem getippten String nicht an.
 *
 * NOINDEX-SEITEN FEHLEN HIER: `indexable` kommt aus `lib/routes.ts`, wo auch die
 * Seite selbst ihr `noindex` herholt — die beiden können nicht auseinanderlaufen.
 * `/styleguide` liegt in der Route-Group `(dev)` und ist damit von vornherein
 * nicht Teil dieser Struktur.
 *
 * MEHRSPRACHIG OHNE ARBEIT: Die Schleife läuft über `routing.locales`. Phase 1
 * hat genau eine Locale; eine zweite erscheint hier von selbst (§8.7).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Bricht den Build, wenn Seiten und Liste auseinandergelaufen sind (s. dort).
  assertRoutesMatchDisk()

  return routing.locales.flatMap((locale) => [
    ...SITE_ROUTES.filter((route) => route.indexable).map((route) => ({
      url: absoluteUrl(getPathname({ href: route.href, locale })),
      /*
       * KEIN `lastModified` — und das ist eine Aussage, keine Lücke: Für diese
       * Seiten gibt es kein ehrliches Änderungsdatum. Die naheliegende Krücke
       * wäre die Bauzeit; die behauptete bei JEDEM Deploy, dass sich JEDE Seite
       * geändert hat. Google lernt daraus binnen weniger Deploys, dem Feld nicht
       * zu glauben — der Preis für eine Zahl, die nichts weiß. Die Artikel unten
       * haben ein echtes Datum und bekommen es deshalb.
       *
       * KEIN `changeFrequency`/`priority`: Google ignoriert beide erklärtermaßen.
       * Eine ausgedachte Prioritätenliste wäre Ritual, kein Signal.
       */
    })),
    ...articlesFor(locale).map((article) => ({
      url: absoluteUrl(getPathname({ href: articleHref(article.slug), locale })),
      /* Das echte Datum aus dem Frontmatter — `updated`, sonst die Erstveröffentlichung. */
      lastModified: article.updated ?? article.date,
    })),
  ])
}
