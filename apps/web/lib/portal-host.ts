/**
 * DER PORTAL-HOST `partner.coolin.at` (B18-1a).
 *
 * REIN: kein `server-only`, kein `next/server`, keine Datenbank, kein Request-Objekt. Die
 * Middleware liest das hier im Edge-Runtime, `app/robots.ts` in einer Server Component, und die
 * Tests prüfen es ohne Request und ohne Datenbank. Dieselbe Rolle wie `lib/auth/config.ts` für den
 * Auth-Bereich.
 *
 * ── WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────────────────────────────
 * `lib/site.ts` bestimmt `SITE_URL`/`IS_PRODUCTION_SITE` aus der UMGEBUNG (`NEXT_PUBLIC_SITE_URL`),
 * nicht aus dem Host der Anfrage. Seit `partner.coolin.at` auf dasselbe Vercel-Projekt zeigt,
 * liefert diese Subdomain deshalb dieselbe komplette Website aus wie die Hauptdomain — mit
 * denselben Canonicals und derselben `robots.txt`. Sie wäre damit eine indexierbare Zweitdomain mit
 * identischem Inhalt.
 *
 * Diese Datei ist die EINE Stelle, an der der Host der Anfrage bewertet wird. Ein String-Vergleich
 * an mehreren Orten wäre genau die Sorte Fehler, die kein Test fängt: Weicht eine der Stellen ab,
 * verhalten sich Weiche und Indexierungssignal unterschiedlich, und beides sieht für sich genommen
 * richtig aus.
 *
 * ── DIE VERGLEICHSRICHTUNG IST DIE EIGENTLICHE ENTSCHEIDUNG ─────────────────────────────────────
 * Erkannt wird AUSSCHLIESSLICH der eine, exakt benannte Portal-Host. Es gibt bewusst KEINEN
 * Ausdruck der Form „alles, was nicht die Hauptdomain ist" — der wäre die naheliegende Umkehrung
 * und stillschweigend falsch: Eine lokale Entwicklung (`localhost:3000`) und jedes
 * Preview-Deployment (`*.vercel.app`) sind WEDER die Hauptdomain NOCH die Subdomain. Mit der weiten
 * Fassung würde jede Preview zur Portal-Domain (die Startseite einer Preview leitete auf die
 * Produktivdomain um, und niemand bemerkte es beim Testen der Portal-Routen, weil die ja bleiben).
 * Mit der engen Fassung verhalten sich beide exakt wie bisher.
 *
 * Bewusst KEINE zweite Umgebungsvariable für die Portal-Domain: Der Host steht in jeder Anfrage,
 * und eine Variable, die man in einer Umgebung zu setzen vergisst, machte aus dem Portal-Host
 * still wieder eine vollständige Zweitdomain.
 */

import { routing } from '@/i18n/routing'
import { AUTH_HREFS } from '@/lib/auth/config'
import { PARTNER_PORTAL_HREF } from '@/lib/partner-portal/config'

/**
 * Die Subdomain, die ausschliesslich den Portalbereich bedient.
 *
 * Steht hier und NICHT in `lib/site.ts` neben `PRODUCTION_ORIGIN`: Jene Datei beantwortet „unter
 * welcher Adresse liegt diese Auslieferung", diese hier „welcher Host hat die Anfrage gestellt".
 * Das sind zwei verschiedene Fragen — die erste kommt aus der Umgebung, die zweite aus der Anfrage.
 */
export const PORTAL_HOST = 'partner.coolin.at'

/**
 * Die Pfade, die auf dem Portal-Host BLEIBEN. Alles andere wird auf die kanonische Basis umgeleitet.
 *
 * ── WARUM DIE AUTH-ROUTEN MITKOMMEN ─────────────────────────────────────────────────────────────
 * `sanitizeNext` (`lib/auth/config.ts`) lässt ausschliesslich seiten-interne Pfade mit genau einem
 * führenden „/" zu. Ein Rücksprungziel auf einem ANDEREN Host ist damit strukturell nicht
 * darstellbar. Läge `/anmelden` nur auf der Hauptdomain, müsste die Zugangsschranke des Portals von
 * hier aus ein Host-tragendes `next` erzeugen — das verlangte eine Host-Allowlist und wäre ein
 * zweites Open-Redirect-Verfahren neben `sanitizeNext`. Genau das hat der B17-Nachzug vermieden.
 *
 * Die Liste ist ABGELEITET, nicht abgetippt: `AUTH_HREFS` ist bereits der Fundort der Auth-Routen
 * (`/registrieren`, `/anmelden`, `/passwort-vergessen`, `/passwort-neu`, `/konto`). Eine zweite
 * Aufzählung liefe beim ersten neuen Auth-Slug auseinander — und zwar still: Die neue Seite
 * funktionierte auf der Hauptdomain und leitete auf dem Portal-Host mitten im Anmeldevorgang weg.
 *
 * `/konto` ist dabei kein Beiwerk, sondern der strukturelle Rückfallwert des gesamten
 * Auth-Systems: der Vorgabewert von `sanitizeNext`, das Ziel von `signInAction` ohne `next`, von
 * `setNewPasswordAction` und des Auth-Callbacks. Fehlte er hier, verliesse JEDER Anmeldevorgang,
 * der sein `next` verliert, den Portal-Host.
 *
 * NICHT dabei und bewusst so: `/` (die Startseite ist Marketing — nach dem Abmelden ist die
 * Hauptdomain das richtige Ziel), `/partner-werden` (die öffentliche Bewerbung, auf die der
 * Partner-Kontext der Anmeldeseite verweist — eine öffentliche Inhaltsseite gehört auf die
 * Hauptdomain), `/login` (englischer Alt-Slug, leitet ohnehin nur auf `/anmelden` um) und der
 * gesamte `/admin`-Bereich.
 */
export const PORTAL_HOST_PATHS: readonly string[] = [PARTNER_PORTAL_HREF, ...AUTH_HREFS]

/**
 * Host-Kopfzeile auf die reine Namensform bringen.
 *
 * Ein Port (`localhost:3000`) und die FQDN-Schreibweise mit Punkt am Ende (`partner.coolin.at.`)
 * bezeichnen denselben Host. Ohne Normalisierung wäre die zweite Form ein NICHT erkannter
 * Portal-Host — und damit wieder eine vollständige Zweitdomain. Die Normalisierung kann nur
 * zusätzliche Schreibweisen ALS Portal-Host erkennen, nie einen fremden Host dazu machen.
 *
 * Der Port wird nur als abschliessendes `:<Ziffern>` entfernt, damit eine IPv6-Adresse (`[::1]`)
 * nicht mitten im Literal abgeschnitten wird.
 */
function normalizeHost(host: string | null | undefined): string {
  if (!host) return ''
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/** Kommt die Anfrage über die Portal-Subdomain? Exakter Vergleich, s. Kopf dieser Datei. */
export function isPortalHost(host: string | null | undefined): boolean {
  return normalizeHost(host) === PORTAL_HOST
}

/**
 * Entfernt ein führendes Locale-Segment.
 *
 * `localePrefix: 'as-needed'` (i18n/routing.ts) liefert Deutsch OHNE Präfix aus — `/de/anmelden`
 * ist aber weiterhin eine gültige Adresse (next-intl leitet sie auf `/anmelden` um), und eine
 * zweite Sprache brächte `/en/anmelden`. Die Weiche läuft VOR dem Locale-Routing und sieht deshalb
 * den rohen Pfad. Ohne diesen Schritt würde `/de/anmelden` auf dem Portal-Host weggeleitet,
 * mitten im Anmeldevorgang.
 */
function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }
  return pathname
}

/**
 * Gehört dieser Pfad zum Portalbereich?
 *
 * Der Vergleich verlangt Gleichheit ODER einen Schrägstrich dahinter — dasselbe Muster wie in
 * `lib/auth/login-context.ts` und `lib/leads/registration-source.ts`, und aus demselben Grund:
 * Ein naives `startsWith` liesse ein erfundenes `/partner-portal-fremd` als Portalpfad durchgehen.
 */
export function isPortalPath(pathname: string): boolean {
  const path = stripLocale(pathname)
  return PORTAL_HOST_PATHS.some((portal) => path === portal || path.startsWith(`${portal}/`))
}

/**
 * Muss diese Anfrage den Portal-Host verlassen?
 *
 * DIE eine benannte Ableitung, die Middleware und Indexierungssignal teilen. Wahr ausschliesslich
 * für eine Anfrage, die ÜBER den Portal-Host kommt und NICHT auf den Portalbereich zielt.
 */
export function leavesPortalHost(host: string | null | undefined, pathname: string): boolean {
  return isPortalHost(host) && !isPortalPath(pathname)
}
