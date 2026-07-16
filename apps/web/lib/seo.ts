/**
 * Canonical + hreflang für jede Seite (Pflichtenheft §6.3/§6.4).
 *
 * WARUM ÜBER `getPathname` UND NICHT ÜBER EINEN GETIPPTEN STRING:
 * `getPathname` ist exakt die Funktion, die auch `Link` aus `@/i18n/navigation`
 * benutzt, um ein Ziel in eine URL zu übersetzen. Der Canonical entsteht damit
 * aus DERSELBEN Quelle wie die Links, die auf die Seite zeigen — er kann nicht
 * eine andere URL behaupten als die, die ausgeliefert wird. Ein
 * zusammengebautes `${SITE_URL}/de${href}` wäre eine zweite, stille Auslegung
 * des Routings: `localePrefix: 'as-needed'` (i18n/routing.ts) liefert Deutsch
 * OHNE Präfix aus, und genau dieser Unterschied wäre in einem handgebauten
 * String nicht sichtbar.
 *
 * PHASE 1 IST NUR DEUTSCH, DIE STRUKTUR IST MEHRSPRACHIG (§8.7): Die
 * hreflang-Liste läuft über `routing.locales`. Eine zweite Sprache ist damit ein
 * Eintrag in `i18n/routing.ts` — die Alternates aller Seiten erweitern sich von
 * selbst, ohne dass eine Seite angefasst wird.
 */

import type { Metadata } from 'next'
import { getPathname } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { absoluteUrl } from './site'

/**
 * Canonical (selbstreferenzierend) + hreflang-Alternates einer Seite.
 *
 * `href` ist der seiten-interne Pfad OHNE Locale-Präfix — dasselbe, was auch an
 * `Link` übergeben wird (z. B. „/leistungen/pv-speicher"). Wo die Route bereits
 * eine Datenquelle hat, kommt er von dort (`lib/nav.ts` über `Leistung.href` /
 * `Branche.href`, `articleHref` für Artikel), damit ein Slug-Wechsel weiterhin
 * genau einen Fundort hat (§4.1).
 *
 * DER hreflang-CODE IST DIE LOCALE SELBST („de"), BEWUSST NICHT „de-AT" —
 * obwohl die Seite auf Österreich zielt (§6.1): hreflang beschreibt, für WEN
 * eine Sprachfassung gedacht ist. „de-AT" grenzte sie auf Österreich EIN, es
 * gibt aber nur diese eine deutsche Fassung, und sie ist auch für einen Leser in
 * München die richtige. „de" ist die weitere, damit sichere Angabe und deckt
 * sich mit `<html lang="de">` aus dem Root-Layout. Eine Region gehört erst dazu,
 * wenn es eine zweite deutsche Fassung gibt, zwischen der Google wählen müsste —
 * dann steht hier eine Zuordnung Locale -> Code statt der Locale selbst.
 *
 * `x-default` zeigt auf die Default-Locale: die Fassung, die ein Sucher ohne
 * passende Sprache bekommen soll. In Phase 1 ist das dieselbe URL wie „de" —
 * das ist kein Fehler, sondern der korrekte Ausdruck von „es gibt genau eine
 * Fassung, und sie ist auch die Rückfallebene".
 */
export function pageAlternates(locale: string, href: string): Metadata['alternates'] {
  const languages: Record<string, string> = {}
  for (const alternate of routing.locales) {
    languages[alternate] = absoluteUrl(getPathname({ href, locale: alternate }))
  }
  languages['x-default'] = absoluteUrl(getPathname({ href, locale: routing.defaultLocale }))

  return {
    canonical: absoluteUrl(getPathname({ href, locale })),
    languages,
  }
}
