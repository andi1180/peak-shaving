import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  /*
   * Alles außer: Next-Interna, API-Routen, Dateien mit Endung (Assets) — und
   * `/styleguide`. Der Styleguide ist ein Entwickler-Werkzeug außerhalb der
   * Sprach-Struktur (§7); ohne den Ausschluss würde die Middleware ihn in die
   * Locale-Struktur umschreiben.
   */
  matcher: ['/((?!api|_next|_vercel|styleguide|.*\\..*).*)'],
}
