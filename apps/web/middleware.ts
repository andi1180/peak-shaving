import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { updateSession } from './lib/supabase/middleware'
import { ADMIN_HREF, ADMIN_PATHNAME_HEADER } from './lib/admin/config'

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
  /*
   * `/admin` (T4-4) steht bewusst AUSSERHALB der Sprach-Struktur — ein interner Verwaltungsbereich
   * ist kein Seiteninhalt (dieselbe Begründung wie beim Styleguide, s. `app/(dev)/layout.tsx`).
   * Ohne diesen Zweig schriebe next-intl ihn in die Locale-Struktur um und `/admin` bekäme ein
   * Locale-Präfix.
   *
   * ABER: anders als `/auth` (unten im matcher ausgeschlossen) läuft der Session-Refresh hier
   * WEITER. Der Callback-Handler ist ausgenommen, weil er seine Cookies selbst setzt — dieser Grund
   * gilt für `/admin` nicht. Ein Admin-Bereich ohne Refresh flöge mitten in der Arbeit aus der
   * Session, sobald das Access-Token abläuft, ohne dass eine andere Seite zwischendurch aufgerufen
   * wurde. Deshalb: next-intl übersprungen, `updateSession` nicht.
   */
  if (request.nextUrl.pathname.startsWith(ADMIN_HREF)) {
    /*
     * Der angeforderte Pfad reist als Kopfzeile mit, damit die Zugangsschranke einen abgemeldeten
     * Besucher MIT Rücksprungziel zum Admin-Eingang schicken kann (statt ihn nach dem Anmelden auf
     * `/konto` abzusetzen). Begründung, warum es dafür eine Kopfzeile braucht und warum sie nicht
     * fälschbar ist: `ADMIN_PATHNAME_HEADER` in `lib/admin/config.ts`.
     *
     * `headers.set` auf einer KOPIE der Anfrage-Kopfzeilen: ein vom Browser mitgeschickter Wert
     * gleichen Namens wird dadurch überschrieben, nicht ergänzt.
     */
    const headers = new Headers(request.headers)
    headers.set(ADMIN_PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search)
    return await updateSession(request, NextResponse.next({ request: { headers } }))
  }

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
