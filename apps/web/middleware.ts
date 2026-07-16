import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  /*
   * Alles außer: Next-Interna, API-Routen, Dateien mit Endung (Assets) — und
   * `/styleguide`. Der Styleguide ist ein Entwickler-Werkzeug außerhalb der
   * Sprach-Struktur (§7); ohne den Ausschluss würde die Middleware ihn in die
   * Locale-Struktur umschreiben.
   *
   * `opengraph-image` (§6.3): Das OG-Bild ist eine erzeugte Route, kein
   * Seiteninhalt — es trägt KEINE Dateiendung und fiele deshalb nicht unter den
   * Asset-Ausschluss `.*\..*`. Ohne diesen Eintrag würde die Middleware seine
   * fertige URL (`/de/opengraph-image-…`, so wie Next sie ins `og:image`
   * schreibt) per 307 auf die präfixlose Fassung UMLEITEN — `localePrefix:
   * 'as-needed'` streicht das „/de" ja aus allen URLs. Ein Umweg über eine
   * Weiterleitung ist genau das, worauf sich ein Social-Crawler nicht verlassen
   * muss; er darf das Bild direkt und mit 200 bekommen. Der Ausschluss steht
   * bewusst als `.*opengraph-image` (nicht am Anfang verankert wie die anderen):
   * die Route liegt IM Locale-Segment, der Pfad beginnt also mit „/de/".
   */
  matcher: ['/((?!api|_next|_vercel|styleguide|.*opengraph-image|.*\\..*).*)'],
}
