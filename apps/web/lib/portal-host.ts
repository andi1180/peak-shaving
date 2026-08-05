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
 *
 * ── SEIT DER ZWEITEN SUBDOMAIN LIEGEN DIE HELFER IN `lib/host-match.ts` ─────────────────────────
 * Normalisierung, die Zwei-Kopfzeilen-Regel und das Abtrennen des Locale-Präfixes standen hier als
 * private Funktionen — richtig, solange es genau eine Subdomain gab. Mit `access.coolin.at`
 * (Zugangsplattform) stellt eine zweite Datei exakt dieselben drei Fragen; beide lesen die Antwort
 * jetzt aus EINER Fassung. Das Verhalten ist unverändert, die Begründungen sind mitgewandert und
 * stehen dort am Code (sie sind GEMESSEN, nicht abgeleitet — eine Kopie erbt den Code, nicht die
 * Messung). DIESE Datei beantwortet weiterhin allein „welcher Host ist der Portal-Host und welche
 * Pfade gehören ihm".
 */

import { AUTH_HREFS } from '@/lib/auth/config'
import { matchesHost, requestMatchesHost, stripLocale, type HostHeaders } from '@/lib/host-match'
import { PARTNER_AKTIVIEREN_HREF, PARTNER_PORTAL_HREF } from '@/lib/partner-portal/config'
import { IS_PRODUCTION_SITE, absoluteUrl } from '@/lib/site'

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
 * Der zweite Reiter des Portalbereichs (B18-3) — die Adresse, unter der ein Fachbetrieb seinen
 * Empfehlungslink und die Textvorlagen findet.
 *
 * ── ER IST EINE ADRESSE AUF DEM PORTAL-HOST, KEIN PFAD DER WEBSITE ──────────────────────────────
 * `partner.coolin.at/marketing` — auf `coolin.at` gibt es diesen Pfad nicht und soll es nicht
 * geben. Der Name bleibt bewusst kurz und ohne Bereichspräfix: Die Domain trägt die Bedeutung
 * bereits (dieselbe Überlegung, aus der die Wurzel in B18-1a kein „/portal" bekommen hat).
 *
 * ⚠ Wer hier später eine öffentliche Seite `/marketing` auf coolin.at anlegt, verschattet sie auf
 * dem Portal-Host — ein Fachbetrieb bekäme dort seinen Portalreiter statt der Marketingseite. Die
 * Kollision ist am Namen erkennbar und wird nicht abgefangen; ein Präfix, das sie ausschlösse,
 * stünde in jeder Adresszeile des Portals.
 */
export const PORTAL_MARKETING_PATH = '/marketing'

/**
 * Der dritte Reiter des Portalbereichs (B18-6) — die Anfragen, die über den Empfehlungslink dieses
 * Fachbetriebs entstanden sind.
 *
 * Dieselbe Namensregel wie `/marketing`: kurz, ohne Bereichspräfix, weil die Domain die Bedeutung
 * bereits trägt. „leads" und nicht „anfragen", obwohl der Bereich sonst deutsch beschriftet ist —
 * die ADRESSE folgt der Konvention der übrigen Pfade dieses Hosts (englisch, kleingeschrieben,
 * einwortig), die BESCHRIFTUNG steht im Nachrichtenkatalog und ist deutsch. Beides zu vermischen
 * hiesse, dass eine spätere Umbenennung des Reiters die Adresse mitzöge, die ein Fachbetrieb sich
 * womöglich als Lesezeichen abgelegt hat.
 *
 * ⚠ Wer hier später eine öffentliche Seite `/leads` auf coolin.at anlegt, verschattet sie auf dem
 * Portal-Host — dieselbe Kollision und dieselbe bewusste Nicht-Abfangung wie bei `/marketing`.
 */
export const PORTAL_LEADS_PATH = '/leads'

/**
 * Der vierte Reiter des Portalbereichs (B18-4) — der Peak-Shaving-Kalkulator: Beschreibung und
 * Anfrage, solange kein Zugang besteht, danach das Werkzeug selbst.
 *
 * Dieselbe Namensregel wie `/marketing` und `/leads`: kurz, ohne Bereichspräfix, weil die Domain
 * die Bedeutung bereits trägt. „kalkulator" und nicht „calculator", weil dieses eine Wort auf
 * coolin.at durchgehend deutsch geführt wird (`/peak-shaving/kalkulator`) — es ist der Produktname,
 * nicht ein Strukturbegriff wie „leads"; ihn hier zu übersetzen hiesse, für dasselbe Produkt zwei
 * Adressen zu haben.
 *
 * ⚠ Wer hier später eine öffentliche Seite `/kalkulator` auf coolin.at anlegt, verschattet sie auf
 * dem Portal-Host — dieselbe Kollision und dieselbe bewusste Nicht-Abfangung wie bei `/marketing`
 * und `/leads`.
 */
export const PORTAL_KALKULATOR_PATH = '/kalkulator'

/**
 * Die eigenen Seiten des Portalbereichs, wie sie AUF DEM PORTAL-HOST adressiert sind (B18-3).
 *
 * Die Wurzel ist „Allgemein" (Stammdaten des Betriebs), `/marketing` der zweite Reiter. Sie stehen
 * hier und nicht in `lib/partner-portal/config.ts`, weil diese Datei die Frage „welche Adressen hat
 * der Portal-Host" beantwortet — jene die Konstanten des Portals als Produkt.
 *
 * Die Liste ist zugleich die Vorlage des internen Rewrites (s. `portalRenderPath`) und Teil von
 * `PORTAL_HOST_PATHS`. Ein neuer Reiter (B18-4 Peak Shaving) ist genau ein Eintrag hier plus eine
 * Datei unter `app/portal/` — Weiche, Rewrite und Nav ziehen von selbst nach. Bei `/leads` (B18-6)
 * war es genau das: dieser Eintrag, ein Eintrag in `PORTAL_NAV_ITEMS`, eine Seite.
 */
export const PORTAL_AREA_PATHS: readonly string[] = [
  PORTAL_HOST_ROOT,
  PORTAL_MARKETING_PATH,
  PORTAL_LEADS_PATH,
  PORTAL_KALKULATOR_PATH,
]

/**
 * Die Wurzel des Routen-Baums, unter dem der Portalbereich GERENDERT wird — das Ziel eines rein
 * INTERNEN Rewrites, das von aussen auf KEINEM Host erreichbar ist.
 *
 * ── WARUM ES IHN ÜBERHAUPT GIBT ─────────────────────────────────────────────────────────────────
 * Zwei Routen können nicht denselben Pfad belegen: `app/(site)/[locale]/page.tsx` ist die
 * Marketing-Startseite und muss es bleiben. Der naheliegende Ausweg — dieselbe Datei liest den Host
 * und rendert einmal Marketing, einmal Portal — ist gemessen der teurere: Ein `headers()`-Zugriff
 * nimmt der Startseite das statische Vorrendern, und zwar auf BEIDEN Hosts. Die wichtigste Seite
 * der Website würde ab dann bei jedem Aufruf serverseitig gebaut, damit eine Subdomain mit einer
 * Handvoll Nutzern ihren Eingang bekommt. Der Rewrite hält die Kosten dort, wo der Sonderfall ist:
 * `/` auf coolin.at bleibt statisch, allein dieser Baum ist dynamisch.
 *
 * ── SEIT B18-3 IST ES EIN BAUM, KEINE EINZELNE SEITE ────────────────────────────────────────────
 * Bis dahin lag hier genau eine Route (`/portal-host-wurzel`) unter `app/(site)/[locale]/`, und der
 * Rewrite musste ihr das Locale-Präfix voranstellen. Der Portalbereich liegt jetzt als eigener
 * Root-Layout-Baum unter `app/portal/**` — AUSSERHALB der Sprach-Struktur, dieselbe Entscheidung
 * und dieselbe Begründung wie bei `/admin` (`lib/admin/config.ts`): ein eingeloggter Bereich ist
 * kein Seiteninhalt, er braucht kein Locale-Präfix und keine Übersetzung. Der Rewrite baut deshalb
 * kein Präfix mehr; die Locale setzt das Portal-Layout selbst.
 *
 * ── DIE AUFLAGE IST DIE UNSICHTBARKEIT, NICHT DER NAME ──────────────────────────────────────────
 * Der Pfad darf auf keinem Host direkt aufrufbar sein und in keiner Adresszeile, keinem
 * Location-Header, keinem `next`-Parameter und keiner sitemap auftauchen. Durchgesetzt wird das an
 * drei Stellen, und keine davon ist Disziplin:
 *
 *   1. `middleware.ts` beantwortet JEDEN eingehenden Aufruf dieses Baums mit 404 — auf beiden
 *      Hosts, und VOR der 308-Weiche. Die Reihenfolge ist die eigentliche Entscheidung: liefe die
 *      Weiche zuerst, stünde der Pfad auf dem Portal-Host in einem Location-Header nach coolin.at,
 *      und dort würde er anschliessend gerendert. Der eigene Rewrite läuft nicht in diesen Wächter:
 *      Ein Middleware-Rewrite betritt die Middleware kein zweites Mal.
 *   2. `lib/routes.ts` kann ihn per Konstruktion nicht führen: Der Abgleich mit der Platte liest
 *      ausschliesslich `app/(site)/[locale]/`, und dort liegt der Baum nicht mehr. Er steht damit in
 *      KEINER `SiteRoute` — eine stärkere Zusage als der frühere Ausnahmeeintrag, der ihn kannte.
 *   3. Kein `next`-Parameter zeigt je hierher: Der Anmelde-Rücksprung ist die Adresse AUF DEM
 *      PORTAL-HOST (`/` bzw. `/marketing`), nie der Render-Pfad.
 *
 * OFFENGELEGT: Der Name steht als Skript-Pfad im ausgelieferten HTML (`chunks/app/portal/…`) — das
 * ist bei DATEISYSTEM-Routing unvermeidbar und gilt für jede Route dieser App. Er ist keine
 * Adresse: der Aufruf antwortet gemessen 404.
 */
export const PORTAL_RENDER_ROOT = '/portal'

/**
 * Der Render-Pfad zu einer Adresse des Portalbereichs — oder `null`, wenn der Pfad keine ist.
 *
 * EXAKTER Vergleich, ohne Locale-Behandlung, und beides mit Grund: Die präfixte Fassung der
 * Default-Locale beantwortet next-intl seit jeher selbst (`localePrefix: 'as-needed'` leitet `/de`
 * auf `/` und `/de/marketing` auf `/marketing` um), und diese eine Zuständigkeit soll nicht in zwei
 * Hände fallen. Für den Aufrufer sieht beides gleich aus — die präfixte Adresse landet nach einer
 * Umleitung auf der präfixlosen und damit im Portal.
 *
 * ⚠ EINE ZWEITE SPRACHE MUSS HIER ENTSCHIEDEN WERDEN: `/en/marketing` würde bei `as-needed` NICHT
 * auf `/marketing` umgeleitet (für eine Nicht-Default-Locale ist das Präfix nötig) und liefe damit
 * an dieser Abbildung vorbei — die Anfrage bliebe auf dem Portal-Host und endete in der 404 der
 * Anwendung. Ein Test in `lib/portal-host.test.ts` bricht laut, sobald `routing.locales` wächst.
 */
export function portalRenderPath(pathname: string): string | null {
  if (!PORTAL_AREA_PATHS.includes(pathname)) return null
  return pathname === PORTAL_HOST_ROOT ? PORTAL_RENDER_ROOT : `${PORTAL_RENDER_ROOT}${pathname}`
}

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
 * ── DIE EIGENEN SEITEN DES PORTALS KOMMEN ABGELEITET DAZU (B18-1a-Nachbesserung, B18-3) ────────
 * `PORTAL_AREA_PATHS` führt sie an EINER Stelle; die Wurzel ist der Eingang zum Portal und nicht
 * die Marketing-Startseite (Begründung bei `PORTAL_HOST_ROOT`). Gerendert werden sie unter
 * `PORTAL_RENDER_ROOT`, erreicht über den internen Rewrite in `middleware.ts`.
 *
 * ── `/partner-aktivieren` GEHÖRT DAZU (B18-2a) ─────────────────────────────────────────────────
 * Der Aktivierungslink aus der Freischaltungsmail zeigt auf diesen Host, und das ist keine
 * Kosmetik: Der Klick setzt die Auth-Cookies, und die sind HOST-gebunden. Fiele die Seite unter die
 * 308-Weiche, entstünde die Sitzung auf `coolin.at` — der Fachbetrieb landete anschliessend auf der
 * Marketing-Startseite statt in seinem Portal und wäre auf `partner.coolin.at` weiterhin
 * abgemeldet.
 *
 * NICHT dabei und bewusst so: `/partner-werden` (die öffentliche Bewerbung, auf die der
 * Partner-Kontext der Anmeldeseite verweist — eine öffentliche Inhaltsseite gehört auf die
 * Hauptdomain), `/login` (englischer Alt-Slug, leitet ohnehin nur auf `/anmelden` um) und der
 * gesamte `/admin`-Bereich.
 */
export const PORTAL_HOST_PATHS: readonly string[] = [
  ...PORTAL_AREA_PATHS,
  PARTNER_PORTAL_HREF,
  PARTNER_AKTIVIEREN_HREF,
  ...AUTH_HREFS,
]

/**
 * Eine absolute URL auf dem Portal-Host — für Links, die in eine E-MAIL wandern (B18-2a).
 *
 * ── WARUM NICHT `absoluteUrl` AUS `lib/site.ts` ────────────────────────────────────────────────
 * Jene Datei beantwortet „unter welcher kanonischen Adresse liegt diese Auslieferung" und ist die
 * einzige Quelle für Canonicals, hreflang, sitemap und die 308-Weiche. Sie kennt den Portal-Host
 * nicht und soll ihn nicht kennen — die Trennung der beiden Fragen ist der Grund, warum es diese
 * Datei überhaupt gibt (s. Kopf). Ein Aktivierungslink auf `coolin.at` funktionierte zwar, setzte
 * die Sitzung aber auf der falschen Herkunft (s. `PORTAL_HOST_PATHS` oben).
 *
 * ── AUSSERHALB DER PRODUKTIVDOMAIN GIBT ES DEN PORTAL-HOST NICHT ───────────────────────────────
 * Lokal und in jeder Preview existiert `partner.coolin.at` nicht; ein dorthin zeigender Link wäre
 * beim Testen schlicht tot. Dann gilt die gewöhnliche Basis-URL — dieselbe Fallunterscheidung und
 * dieselbe Richtung wie bei `redirectBaseUrl()` (`lib/auth/server-helpers.ts`): in Produktion der
 * eine feststehende Host, sonst das, was tatsächlich ausgeliefert wird. `IS_PRODUCTION_SITE` ist
 * fail-closed (ein unbekannter Origin gilt NICHT als Produktion), der Fehler geht also in die
 * harmlose Richtung.
 */
export function portalAbsoluteUrl(pathname: string): string {
  return IS_PRODUCTION_SITE ? new URL(pathname, `https://${PORTAL_HOST}`).toString() : absoluteUrl(pathname)
}

/**
 * Die Adresse, unter der ein Fachbetrieb sein Portal wiederfindet.
 *
 * ZWEI Aufrufer, und beide meinen dasselbe: der Portal-Verweis in der Freischaltungsmail
 * (`lib/partner-portal/mail.ts`, B18-2a) und der „Schon Partner? Anmelden"-Zweig auf
 * `/partner-werden` (`components/partner/partner-application-page.tsx`, B18-2b). Der zweite ist
 * der Grund, warum hier nicht mehr „für die Mail und nur dafür" steht: Wer seine Mail nicht mehr
 * findet, sucht den Eingang auf der öffentlichen Seite — und beide müssen auf dieselbe Adresse
 * zeigen, sonst gäbe es zwei Auslegungen davon, wo das Portal liegt.
 *
 * In Produktion ist das die WURZEL des Portal-Hosts, ohne Pfadanhang (B18-1a: die Domain trägt die
 * Bedeutung bereits, ein zusätzliches „/partner-portal" wiederholte sie nur). Sonst — lokal, in
 * jeder Preview — gibt es diesen Host nicht, und die richtige Adresse ist der Pfad auf der
 * ausgelieferten Basis: `PORTAL_HOST_ROOT` wäre dort die Marketing-Startseite und damit falsch.
 *
 * Dass beide Fälle DENSELBEN Portalbereich zeigen, ist bereits gebaut und keine Annahme:
 * `components/partner-portal/partner-portal-route.tsx` ist eine Fassung mit zwei Adressen.
 */
export function portalEntryUrl(): string {
  return IS_PRODUCTION_SITE ? `https://${PORTAL_HOST}${PORTAL_HOST_ROOT}` : absoluteUrl(PARTNER_PORTAL_HREF)
}

/** Kommt die Anfrage über die Portal-Subdomain? Exakter Vergleich, s. `lib/host-match.ts`. */
export function isPortalHost(host: string | null | undefined): boolean {
  return matchesHost(host, PORTAL_HOST)
}

/**
 * Läuft DIESE Anfrage über den Portal-Host?
 *
 * Prüft `host` UND `x-forwarded-host` — die Begründung dafür ist gemessen und steht bei
 * `requestMatchesHost` in `lib/host-match.ts`. Kurzfassung: Nach einer Server-Action-Weiterleitung
 * trägt `host` den Server selbst; ohne die zweite Kopfzeile sähe ein Fachbetrieb unmittelbar nach
 * dem Anmelden die Marketing-Startseite statt seines Portals.
 */
export function isPortalHostRequest(headers: HostHeaders): boolean {
  return requestMatchesHost(headers, PORTAL_HOST)
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
       * ⚠ DIE EIGENEN SEITEN DES PORTALS GELTEN AUSSCHLIESSLICH EXAKT, NIE ALS PRÄFIX.
       *
       * Für `/` ist das die harte Anforderung: Als Präfix hiesse „alles" — das genaue Gegenteil
       * dessen, wofür diese Liste da ist; die Weiche wäre wirkungslos und niemandem fiele es auf,
       * weil jeder einzelne Pfad weiterhin funktioniert. Die Bedingung ist dabei nicht bloss
       * theoretisch: `${'/'}/` ist „//", und ein Pfad wie „//admin" ist eine gültige Anfrage-
       * Adresse, die sonst als Portalpfad durchginge.
       *
       * Für die übrigen Reiter (B18-3) ist es dieselbe Regel aus einem zweiten Grund: Ihre Adressen
       * werden über `portalRenderPath` EXAKT auf den internen Baum abgebildet. Ein `/marketing/xyz`
       * hat dort kein Ziel; es auf dem Host zu behalten hiesse, eine Adresse anzubieten, die
       * anschliessend nur die 404 der Anwendung erreichen kann.
       */
      (!PORTAL_AREA_PATHS.includes(portal) && path.startsWith(`${portal}/`)),
  )
}

/**
 * Zielt diese Anfrage von aussen auf den internen Render-Baum?
 *
 * Wahr für den Pfad selbst, für seine locale-präfixte Fassung und für alles darunter — jeder
 * Reiter des Portals liegt darunter, und ein künftiger soll nicht versehentlich erreichbar werden.
 * Die Grenzprüfung (Gleichheit ODER Schrägstrich dahinter) ist dieselbe wie in `isPortalPath`,
 * damit ein erfundenes `/portal-fremd` NICHT als internes Ziel gilt und ganz normal die 404 der
 * Anwendung bekommt statt einer Sonderbehandlung.
 */
export function isPortalRenderPath(pathname: string): boolean {
  const path = stripLocale(pathname)
  return path === PORTAL_RENDER_ROOT || path.startsWith(`${PORTAL_RENDER_ROOT}/`)
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
