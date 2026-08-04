import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { updateSession } from './lib/supabase/middleware'
import { ADMIN_HREF, ADMIN_PATHNAME_HEADER } from './lib/admin/config'
import {
  isPortalHostRequest,
  isPortalRenderPath,
  leavesPortalHost,
  portalRenderPath,
} from './lib/portal-host'
import { SITE_URL } from './lib/site'

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
   * ⚠ DER WÄCHTER ÜBER DEN INTERNEN RENDER-BAUM (B18-1a-Nachbesserung, mit B18-3 auf den ganzen
   * Baum erweitert) — er steht VOR ALLEM ANDEREN, und diese Reihenfolge ist die eigentliche
   * Absicherung, nicht der 404 selbst.
   *
   * `PORTAL_RENDER_ROOT` sind echte Dateien unter `app/portal/` und damit echte Routen — Next kennt
   * keinen anderen Weg, etwas zu rendern. Erreichbar sein dürfen sie trotzdem auf KEINEM Host: Sie
   * sind ausschliesslich das Ziel des Rewrites unten.
   *
   * WARUM GANZ OBEN UND NICHT NACH DER 308-WEICHE: Stünde der Wächter danach, liefe ein Aufruf auf
   * dem Portal-Host zuerst in die Weiche — der interne Pfad stünde dann in einem
   * `Location`-Header nach `coolin.at` und würde dort anschliessend gerendert. Genau das ist
   * ausgeschlossen: das Ziel taucht in keiner Adresszeile und in keinem Location-Header auf.
   *
   * WARUM DER EIGENE REWRITE NICHT HIER HÄNGENBLEIBT: Ein Middleware-Rewrite betritt die
   * Middleware kein zweites Mal — er ist eine Anweisung an den Router, keine neue Anfrage. Der
   * Wächter sieht ausschliesslich, was von aussen kommt.
   *
   * 404 OHNE RUMPF, bewusst: Für diesen Pfad gibt es keine Seite, die ein Mensch sehen soll — auch
   * keine gestaltete Fehlerseite, die den Pfad als „gibt es, nur nicht hier" ausweisen würde.
   */
  if (isPortalRenderPath(request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 })
  }

  /*
   * DER PORTALBEREICH AUF DEM PORTAL-HOST (B18-1a-Nachbesserung, mit B18-3 auf mehrere Reiter
   * erweitert).
   *
   * `partner.coolin.at/` IST das Portal — nicht die Marketing-Startseite; `/marketing` ist sein
   * zweiter Reiter. Weil zwei Routen nicht denselben Pfad belegen können, wird hier intern auf den
   * Baum unter `PORTAL_RENDER_ROOT` umgeschrieben: ein REWRITE, kein Redirect. Die Adresszeile
   * bleibt exakt die aufgerufene, der Host bleibt der Portal-Host, und in keiner Adresse taucht
   * „portal" auf.
   *
   * ── WARUM DIESER ZWEIG next-intl NICHT DURCHLÄUFT ──────────────────────────────────────────────
   * Weil es hier nichts zu lokalisieren gibt: Der Portalbereich liegt seit B18-3 als eigener
   * Root-Layout-Baum unter `app/portal/**` und damit AUSSERHALB der Sprach-Struktur — dieselbe
   * Entscheidung und dieselbe Begründung wie beim `/admin`-Zweig unten. Das Zielsegment `[locale]`
   * gibt es dort gar nicht, also gibt es auch kein Präfix zu ergänzen (bis B18-3 baute dieser Zweig
   * eines, weil das Ziel unter `app/(site)/[locale]/` lag). Die präfixte Fassung der Default-Locale
   * bleibt vollständig bei next-intl: `/de` und `/de/marketing` laufen weiterhin ungebremst dorthin
   * (`portalRenderPath` ist bewusst nur für die exakten Adressen wahr) und werden von dort wie
   * bisher auf die präfixlose Fassung umgeleitet.
   *
   * WAS AUSDRÜCKLICH BLEIBT: die Reihenfolge „erst die Response, dann Supabase". `updateSession`
   * bekommt GENAU DIESE Response und schreibt die refreshten Auth-Cookies darauf. Der
   * Session-Refresh ist hier nicht Beiwerk, sondern der Kern: An diesen Routen entscheidet sich, ob
   * jemand angemeldet ist — die Wurzel ist Anmeldebildschirm und Portal in einem.
   */
  if (isPortalHostRequest(request.headers)) {
    const renderPath = portalRenderPath(request.nextUrl.pathname)
    if (renderPath) {
      const target = request.nextUrl.clone()
      target.pathname = renderPath
      return await updateSession(request, NextResponse.rewrite(target))
    }
  }

  /*
   * DIE HOST-WEICHE (B18-1a) — sie steht VOR der Komposition aus next-intl und Supabase, und das
   * ist der einzige Ort, an dem sie stehen kann, ohne diese zu berühren. (Seit der Nachbesserung
   * stehen zwei Zweige über ihr: der Wächter über den internen Render-Baum und der Portalbereich
   * selbst. Beide sind für sie unsichtbar — der eine antwortet abschliessend mit 404, der andere
   * behandelt Pfade, die zum Portalbereich gehören und die sie deshalb ohnehin durchgelassen
   * hätte.)
   *
   * `partner.coolin.at` zeigt seit dem Aufschalten der Domain auf dasselbe Vercel-Projekt und
   * lieferte damit die komplette Website ein zweites Mal aus. Ausserhalb des Portalbereichs geht
   * jede Anfrage dieses Hosts deshalb dauerhaft auf denselben Pfad unter der kanonischen Basis.
   *
   * WARUM VOR ALLEM ANDEREN: Eine Umleitung ist eine ABSCHLIESSENDE Entscheidung — es gibt danach
   * keine Response mehr, auf die next-intl oder Supabase noch schreiben könnten. Sie weiter unten
   * einzuhängen hiesse, erst eine Response zu bauen und einen Session-Refresh auszulösen (also
   * Auth-Cookies auf dem Portal-Host zu setzen), um beides anschliessend zu verwerfen. Umgekehrt
   * bleibt die Reihenfolge next-intl → Supabase (s. u.) für ALLES, was hier durchfällt, wörtlich
   * unangetastet: Auf den Routen, die auf dem Portal-Host BLEIBEN, läuft der Session-Refresh
   * unverändert weiter — sie erreichen den Zweig darunter genauso wie auf der Hauptdomain.
   *
   * Der Ziel-Origin kommt aus `SITE_URL` (`lib/site.ts`), nicht als zweiter getippter Host: Es gibt
   * genau eine Quelle der kanonischen Basis-URL, und Canonicals, sitemap und diese Weiche müssen
   * dieselbe nennen. Pfad und Query reisen unverändert mit — ein Link auf eine Inhaltsseite soll
   * auf der Hauptdomain an derselben Stelle ankommen und nicht auf der Startseite.
   *
   * 308 statt 301/302: dauerhaft UND methodenerhaltend. Der Unterschied ist hier bewusst
   * andersherum als bei den `.html`-Alt-Pfaden in `next.config.mjs` (dort ist 301 richtig, weil ein
   * altes Formular-POST nicht als POST weitergereicht werden soll) — auf dieser Subdomain gibt es
   * keine Alt-Formulare, wohl aber Server Actions, und deren POST still zu einem GET zu machen
   * verlöre die Aktion, statt sie am richtigen Ort auszuführen.
   *
   * Der Vergleich selbst steht in `lib/portal-host.ts` als EINE benannte Ableitung — hier
   * absichtlich kein String-Vergleich. Insbesondere erkennt er ausschliesslich den exakten
   * Portal-Host: `localhost:<port>` und `*.vercel.app` sind weder die Hauptdomain noch die
   * Subdomain und laufen unverändert weiter (Begründung ausführlich dort).
   */
  if (leavesPortalHost(request.headers, request.nextUrl.pathname)) {
    const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, SITE_URL)
    return NextResponse.redirect(target, 308)
  }

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
   *
   * ── B18-1a: DER MATCHER BLEIBT UNVERÄNDERT, UND ZWAR NICHT AUS BEQUEMLICHKEIT ──────────────────
   * Die Host-Weiche oben läuft nur, wo dieser Matcher greift. Genau die hier ausgeschlossenen
   * Pfade sind die, die auf dem Portal-Host NICHT umgeleitet werden dürfen:
   *
   *   – `_next`/`_vercel`/Dateien mit Endung: die Skript-, Stil- und Schriftdateien der Seite. Sie
   *     mitzunehmen hiesse, jeden Chunk einer Portal-Seite per 308 auf die Hauptdomain zu schicken
   *     — die Seite auf `partner.coolin.at` lüde ihr eigenes JavaScript von einer fremden Herkunft
   *     nach. Das ist der teuerste denkbare Fehler dieser Weiche und wäre erst im Browser sichtbar.
   *   – `auth`: der Supabase-Callback tauscht den Code gegen eine Session und setzt seine Cookies
   *     SELBST (s. o.). Ein 308 legte diesen Austausch auf eine andere Herkunft, deren Cookie-Jar
   *     den PKCE-Verifier nicht hat — der Link aus der Bestätigungsmail schlüge fehl.
   *   – `api`: kein Endpunkt wird vom Portalbereich aus aufgerufen, und ein methodenerhaltender 308
   *     machte aus einem POST eine herkunftsübergreifende Wiederholung desselben POST.
   *
   * Ein Ausweiten des Matchers wäre also nicht neutral, sondern in jedem der drei Fälle ein
   * Rückschritt. Was hier ausgeschlossen ist, wird auf dem Portal-Host ganz normal ausgeliefert.
   */
  matcher: ['/((?!api|auth|_next|_vercel|styleguide|.*opengraph-image|.*\\..*).*)'],
}
