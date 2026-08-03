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
 * Die Wurzel — auf dem Portal-Host der Eingang zum Portal, auf der Hauptdomain die
 * Marketing-Startseite. DIESELBE Route, zwei Hosts, zwei Bedeutungen.
 *
 * ── ⚠ DIE KORRIGIERTE ANNAHME (B18-1a-Nachbesserung) ────────────────────────────────────────────
 * Bis hierher stand `/` ausdrücklich NICHT im Portalbereich, begründet mit „die Startseite ist
 * Marketing — nach dem Abmelden ist die Hauptdomain das richtige Ziel". Der erste Halbsatz stimmt
 * für coolin.at und sagt über DIESEN Host nichts: Wer `partner.coolin.at` aufruft, will das Portal,
 * nicht die Marketing-Startseite. GEMESSEN hat die Subdomain ihre eigene Wurzel per 308 auf
 * `https://coolin.at/` geschickt — das genaue Gegenteil ihres Zwecks.
 *
 * Der zweite Halbsatz ist damit ebenfalls hinfällig: Abmelden führt weiterhin auf `/` (unverändert
 * `signOutAction`), und `/` ist auf diesem Host der Anmeldebildschirm. Das Ziel ist also richtig —
 * nur liegt es nicht mehr auf der Hauptdomain, sondern auf demselben Host.
 */
export const PORTAL_HOST_ROOT = '/'

/**
 * Die Route, die auf dem Portal-Host unter `/` GERENDERT wird — das Ziel eines rein INTERNEN
 * Rewrites, das von aussen auf KEINEM Host erreichbar ist.
 *
 * ── WARUM ES SIE ÜBERHAUPT GIBT ─────────────────────────────────────────────────────────────────
 * Zwei Routen können nicht denselben Pfad belegen: `app/(site)/[locale]/page.tsx` ist die
 * Marketing-Startseite und muss es bleiben. Der naheliegende Ausweg — dieselbe Datei liest den Host
 * und rendert einmal Marketing, einmal Portal — ist gemessen der teurere: Ein `headers()`-Zugriff
 * nimmt der Startseite das statische Vorrendern, und zwar auf BEIDEN Hosts. Die wichtigste Seite
 * der Website würde ab dann bei jedem Aufruf serverseitig gebaut, damit eine Subdomain mit einer
 * Handvoll Nutzern ihren Eingang bekommt. Der Rewrite hält die Kosten dort, wo der Sonderfall ist:
 * `/` auf coolin.at bleibt statisch, allein diese Route ist dynamisch.
 *
 * ── DIE AUFLAGE IST DIE UNSICHTBARKEIT, NICHT DER NAME ──────────────────────────────────────────
 * Der Pfad darf auf keinem Host direkt aufrufbar sein und in keiner Adresszeile, keinem
 * Location-Header, keinem `next`-Parameter und keiner sitemap auftauchen. Durchgesetzt wird das an
 * drei Stellen, und keine davon ist Disziplin:
 *
 *   1. `middleware.ts` beantwortet JEDEN eingehenden Aufruf dieses Pfades mit 404 — auf beiden
 *      Hosts, und VOR der 308-Weiche. Die Reihenfolge ist die eigentliche Entscheidung: liefe die
 *      Weiche zuerst, stünde der Pfad auf dem Portal-Host in einem Location-Header nach coolin.at,
 *      und dort würde er anschliessend gerendert. Der eigene Rewrite läuft nicht in diesen Wächter:
 *      Ein Middleware-Rewrite betritt die Middleware kein zweites Mal.
 *   2. `lib/routes.ts` führt den Pfad als internes Ziel — er steht damit in KEINER `SiteRoute` und
 *      kann per Konstruktion in keine sitemap geraten; der Abgleich mit der Platte kennt ihn und
 *      meldet ihn nicht als vergessene Seite.
 *   3. Kein `next`-Parameter zeigt je hierher: Der Anmelde-Rücksprung dieser Route ist `/`.
 *
 * OFFENGELEGT: Der Name steht als Skript-Pfad im ausgelieferten HTML (`chunks/app/(site)/…`) — das
 * ist bei DATEISYSTEM-Routing unvermeidbar und gilt für jede Route dieser App. Er ist keine
 * Adresse: der Aufruf antwortet gemessen 404.
 */
export const PORTAL_ROOT_RENDER_PATH = '/portal-host-wurzel'

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
 * ── `/` GEHÖRT DAZU (B18-1a-Nachbesserung) ─────────────────────────────────────────────────────
 * Es ist der Eingang zum Portal, nicht die Marketing-Startseite — die Begründung steht bei
 * `PORTAL_HOST_ROOT`. Gerendert wird dort `PORTAL_ROOT_RENDER_PATH`.
 *
 * NICHT dabei und bewusst so: `/partner-werden` (die öffentliche Bewerbung, auf die der
 * Partner-Kontext der Anmeldeseite verweist — eine öffentliche Inhaltsseite gehört auf die
 * Hauptdomain), `/login` (englischer Alt-Slug, leitet ohnehin nur auf `/anmelden` um) und der
 * gesamte `/admin`-Bereich.
 */
export const PORTAL_HOST_PATHS: readonly string[] = [
  PORTAL_HOST_ROOT,
  PARTNER_PORTAL_HREF,
  ...AUTH_HREFS,
]

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

/** Der Ausschnitt, den beide Aufrufer erfüllen: `request.headers` und `await headers()`. */
type HostHeaders = { get(name: string): string | null }

/**
 * Läuft DIESE Anfrage über den Portal-Host?
 *
 * ── ⚠ WARUM ZWEI KOPFZEILEN, UND WARUM DAS GEMESSEN IST ─────────────────────────────────────────
 * Der naheliegende Weg — allein `host` — ist an einer Stelle nachweislich falsch, und zwar an
 * genau der, an der es am meisten weh tut: Leitet eine Server Action mit `redirect('/')` weiter,
 * rendert Next das ZIEL innerhalb derselben Antwort und lässt dafür die Middleware ein zweites Mal
 * laufen — mit einer INTERNEN Anfrage. Gemessen gegen den Production-Build:
 *
 *     POST /anmelden   host= partner.coolin.at   x-forwarded-host= partner.coolin.at
 *     GET  /           host= localhost:3990      x-forwarded-host= partner.coolin.at
 *
 * `host` trägt dort den Server selbst, `x-forwarded-host` den echten Host. Ohne die zweite
 * Kopfzeile bekäme ein Fachbetrieb unmittelbar nach dem Anmelden die MARKETING-Startseite zu sehen
 * (die Adresse `/` stimmte, der Inhalt nicht) und erst nach einem Neuladen sein Portal — und beim
 * Abmelden dasselbe. Ein Fehler, den kein Statuscode und kein Location-Header zeigt.
 *
 * ── DIE VERKNÜPFUNG IST BEWUSST „ODER", ALSO MONOTON ────────────────────────────────────────────
 * Sie kann eine Anfrage nur ZUSÄTZLICH als Portal-Host erkennen, nie eine als etwas anderes
 * ausweisen — dieselbe Richtung wie die Normalisierung oben, und aus demselben Grund. Praktisch:
 * Wer `x-forwarded-host: partner.coolin.at` von Hand mitschickt, bekommt für seine eigene Anfrage
 * die ENGERE Behandlung (Portalbereich oder 308 auf die kanonische Basis, dazu `Disallow: /`) —
 * niemals eine weitere. Die umgekehrte Verknüpfung („nur wenn beide zustimmen") wäre der
 * gefährliche Entwurf: Mit ihr liesse sich die 308-Weiche auf dem Portal-Host abschalten und die
 * vollständige Website unter der Subdomain ausliefern — genau der Zustand, den B18-1a beseitigt hat.
 */
export function isPortalHostRequest(headers: HostHeaders): boolean {
  return isPortalHost(headers.get('host')) || isPortalHost(headers.get('x-forwarded-host'))
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
  return PORTAL_HOST_PATHS.some(
    (portal) =>
      path === portal ||
      /*
       * ⚠ `/` GILT AUSSCHLIESSLICH EXAKT, NIE ALS PRÄFIX. Als Präfix hiesse „alles" — das genaue
       * Gegenteil dessen, wofür diese Liste da ist; die Weiche wäre wirkungslos und niemandem fiele
       * es auf, weil jeder einzelne Pfad weiterhin funktioniert. Die Bedingung ist dabei nicht
       * bloss theoretisch: `${'/'}/` ist „//", und ein Pfad wie „//admin" ist eine gültige
       * Anfrage-Adresse, die sonst als Portalpfad durchginge.
       */
      (portal !== PORTAL_HOST_ROOT && path.startsWith(`${portal}/`)),
  )
}

/**
 * Ist das die WURZEL des Portal-Hosts — also der Aufruf, der das Portal rendern soll?
 *
 * Bewusst NUR das exakte `/` und ausdrücklich NICHT `/de`: Die präfixte Fassung der Default-Locale
 * beantwortet next-intl seit jeher selbst (`localePrefix: 'as-needed'` leitet sie auf `/` um), und
 * diese eine Zuständigkeit soll nicht in zwei Hände fallen. Für den Aufrufer sieht beides gleich
 * aus — `/de` landet nach einer Umleitung auf `/` und damit im Portal —, aber die Locale-Regel
 * bleibt vollständig bei next-intl.
 */
export function isPortalHostRoot(pathname: string): boolean {
  return pathname === PORTAL_HOST_ROOT
}

/**
 * Zielt diese Anfrage von aussen auf das interne Rewrite-Ziel?
 *
 * Wahr für den Pfad selbst, für seine locale-präfixte Fassung und für alles darunter — ein
 * künftiges Kindsegment soll nicht versehentlich erreichbar werden. Die Grenzprüfung (Gleichheit
 * ODER Schrägstrich dahinter) ist dieselbe wie in `isPortalPath`, damit ein erfundenes
 * `…-wurzel-fremd` NICHT als internes Ziel gilt und ganz normal 404 der Anwendung bekommt statt
 * einer Sonderbehandlung.
 */
export function isPortalRootRenderPath(pathname: string): boolean {
  const path = stripLocale(pathname)
  return path === PORTAL_ROOT_RENDER_PATH || path.startsWith(`${PORTAL_ROOT_RENDER_PATH}/`)
}

/**
 * Muss diese Anfrage den Portal-Host verlassen?
 *
 * DIE eine benannte Ableitung, die Middleware und Indexierungssignal teilen. Wahr ausschliesslich
 * für eine Anfrage, die ÜBER den Portal-Host kommt und NICHT auf den Portalbereich zielt.
 */
export function leavesPortalHost(headers: HostHeaders, pathname: string): boolean {
  return isPortalHostRequest(headers) && !isPortalPath(pathname)
}
