import createMiddleware from 'next-intl/middleware'
import type { NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { updateSession } from './lib/supabase/middleware'

const handleI18nRouting = createMiddleware(routing)

/**
 * EINE Middleware, zwei Aufgaben (Next erlaubt nur genau eine): next-intl-Locale-Routing UND
 * Supabase-Session-Refresh (T4-2, Invariante J2).
 *
 * REIHENFOLGE ist hier NICHT beliebig — sie ist die eigentliche Absicherung:
 *  1. next-intl ZUERST: `handleI18nRouting` entscheidet das Locale-Routing und BAUT die Response
 *     (bei einer zweiten Sprache ein 307-Redirect, sonst ein Pass-through/Rewrite — plus
 *     NEXT_LOCALE-Cookie/Header).
 *  2. Supabase DANACH, schreibend auf GENAU DIESE Response: `updateSession` refresht die Session
 *     und legt die neuen Auth-Cookies auf das von next-intl erzeugte `response`-Objekt.
 *
 * Der umgekehrte, „naive" Weg (Supabase baut sein eigenes `NextResponse.next()`, dann erzeugt
 * next-intl eine frische Response, die man zurückgibt) verwirft die refreshten Tokens STILL — der
 * Nutzer flöge scheinbar zufällig aus der Session. Genau das vermeidet die Komposition hier.
 */
export async function middleware(request: NextRequest): Promise<Response> {
  const response = handleI18nRouting(request)
  return await updateSession(request, response)
}

export const config = {
  /*
   * Alles außer: Next-Interna, API-Routen, Dateien mit Endung (Assets) — und
   * `/styleguide`. Der Styleguide ist ein Entwickler-Werkzeug außerhalb der
   * Sprach-Struktur (§7); ohne den Ausschluss würde die Middleware ihn in die
   * Locale-Struktur umschreiben.
   *
   * `auth` (T4-2): Der Supabase-Callback-Route-Handler (`app/auth/callback`) liegt bewusst
   * AUSSERHALB des Locale-Segments und darf WEDER von next-intl in die Locale-Struktur
   * umgeschrieben WERDEN, NOCH den Middleware-Session-Refresh durchlaufen — er tauscht den Code
   * selbst gegen eine Session und setzt seine Cookies eigenständig. Deshalb hier ausgeschlossen.
   * (Die Auth-SEITEN wie `/anmelden`/`/konto` liegen unter `(site)/[locale]`, matchen also weiter
   * und bekommen Locale-Routing + Session-Refresh.)
   *
   * `opengraph-image` (§6.3): erzeugte Route ohne Dateiendung — ohne den Eintrag würde die
   * Middleware ihre fertige URL per 307 auf die präfixlose Fassung umleiten. Ein Social-Crawler
   * darf das Bild direkt und mit 200 bekommen.
   */
  matcher: ['/((?!api|auth|_next|_vercel|styleguide|.*opengraph-image|.*\\..*).*)'],
}
