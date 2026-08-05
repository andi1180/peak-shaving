/**
 * DER HOST DER ZUGANGSPLATTFORM `access.coolin.at` (Zugangsplattform, Baustein 1).
 *
 * REIN: kein `server-only`, kein `next/server`, keine Datenbank, kein Request-Objekt. Die
 * Middleware liest das im Edge-Runtime, `app/robots.ts` in einer Server Component, und die Tests
 * prüfen es ohne Request und ohne Datenbank. Struktureller Zwilling von `lib/portal-host.ts`.
 *
 * ── WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────────────────────────────
 * `lib/site.ts` bestimmt `SITE_URL`/`IS_PRODUCTION_SITE` aus der UMGEBUNG (`NEXT_PUBLIC_SITE_URL`),
 * nicht aus dem Host der Anfrage. `access.coolin.at` zeigt auf DASSELBE Vercel-Projekt wie
 * coolin.at und partner.coolin.at (`peak-shaving-web`) — die Subdomain lieferte damit dieselbe
 * komplette Marketing-Website aus, mit denselben Canonicals und derselben `robots.txt`.
 *
 * GEMESSEN VOR DEM BAU (05.08.2026, gegen die Live-Domain): `https://access.coolin.at/` antwortete
 * **200 mit der Marketing-Startseite**, `…/leistungen` ebenfalls **200**. Also exakt der Zustand,
 * den B18-1a für `partner.coolin.at` beseitigt hat, ein zweites Mal: eine indexierbare Zweitdomain
 * mit identischem Inhalt.
 *
 * Diese Datei ist die EINE Stelle, an der der Host der Zugangsplattform benannt wird. Der VERGLEICH
 * selbst liegt in `lib/host-match.ts` und ist mit dem Portal-Host geteilt — zwei Fassungen desselben
 * Vergleichs sind genau die Sorte Fehler, die kein Test fängt: Weicht eine ab, verhalten sich Weiche
 * und Indexierungssignal unterschiedlich, und beides sieht für sich genommen richtig aus.
 *
 * ── WAS DIESER BAUSTEIN AUSDRÜCKLICH NICHT TUT ─────────────────────────────────────────────────
 * Keine Auth-Logik, kein Datenbankzugriff, keine RMS-/Teltonika-Anbindung, kein Rollenmodell. Das
 * sind die Bausteine 6.1/6.2/6.3 des Pflichtenhefts (`Pflichtenheft_Zugangsplattform_MVP.md`, §6).
 * Was hier entsteht, ist ausschliesslich die Struktur, in die jene hineinkommen — und die
 * Absicherung, dass die Subdomain ab jetzt nicht mehr die Website ausliefert.
 */

import { matchesHost, requestMatchesHost, stripLocale, type HostHeaders } from '@/lib/host-match'

/**
 * Die Subdomain, die ausschliesslich die Zugangsplattform bedient.
 *
 * Steht hier und NICHT in `lib/site.ts` neben `PRODUCTION_ORIGIN`: Jene Datei beantwortet „unter
 * welcher Adresse liegt diese Auslieferung", diese hier „welcher Host hat die Anfrage gestellt".
 * Das sind zwei verschiedene Fragen — die erste kommt aus der Umgebung, die zweite aus der Anfrage.
 *
 * ⚠ DER NAME IST IM PFLICHTENHEFT ALS VORLÄUFIG GEKENNZEICHNET (§8, §9: „finaler Subdomain-Name
 * bestätigen"). Er ist in Vercel bereits auf `peak-shaving-web` aufgeschaltet und verifiziert;
 * eine Umbenennung ist deshalb kein Einzeiler hier, sondern zusätzlich eine Domain- und
 * DNS-Änderung. Solange nichts von aussen auf diesen Host verlinkt, ist sie folgenlos möglich.
 */
export const ACCESS_HOST = 'access.coolin.at'

/**
 * Die Wurzel — auf dem Zugangsplattform-Host der Eingang zur Plattform, auf der Hauptdomain die
 * Marketing-Startseite. DIESELBE Route, zwei Hosts, zwei Bedeutungen.
 *
 * Die Lehre aus der B18-1a-Nachbesserung ist hier von Anfang an eingebaut, statt sie ein zweites
 * Mal zu machen: Dort war `/` zunächst ausdrücklich NICHT Teil des Bereichs, begründet mit „die
 * Startseite ist Marketing". Der Satz stimmt für coolin.at und sagt über eine Produkt-Subdomain
 * nichts — wer `access.coolin.at` aufruft, will die Zugangsplattform, nicht die Marketing-
 * Startseite. Gemessen hatte die Subdomain ihre eigene Wurzel damals auf `https://coolin.at/`
 * geschickt, das genaue Gegenteil ihres Zwecks.
 */
export const ACCESS_HOST_ROOT = '/'

/**
 * Die eigenen Seiten der Zugangsplattform, wie sie AUF DEM ZUGANGSPLATTFORM-HOST adressiert sind.
 *
 * Zurzeit genau eine: die Wurzel. Weitere Bereiche (Zugriffsobjekte, Personen, Protokolle — §6.2
 * und §6.6 des Pflichtenhefts) sind je ein Eintrag hier plus eine Datei unter `app/access/`; Weiche
 * und Rewrite ziehen von selbst nach. Beim Partner-Portal war ein neuer Reiter genau das.
 *
 * ⚠ KEIN BEREICHSPRÄFIX IN DEN ADRESSEN. Die Domain trägt die Bedeutung bereits — dieselbe
 * Entscheidung wie beim Portal-Host (`PORTAL_HOST_ROOT`); ein zusätzliches „/zugang" stünde in
 * jeder Adresszeile und wiederholte nur, was der Host schon sagt.
 *
 * ⚠ WER HIER EINE ADRESSE ERGÄNZT, BELEGT SIE AUF DIESEM HOST FÜR DIE WEBSITE MIT. Eine später auf
 * coolin.at angelegte Seite gleichen Namens wäre auf `access.coolin.at` verschattet. Die Kollision
 * ist am Namen erkennbar und wird bewusst nicht abgefangen — ein Präfix, das sie ausschlösse, stünde
 * in jeder Adresszeile der Plattform (dieselbe Abwägung wie bei `/marketing` und `/leads` im
 * Portalbereich).
 */
export const ACCESS_AREA_PATHS: readonly string[] = [ACCESS_HOST_ROOT]

/**
 * Die Wurzel des Routen-Baums, unter dem die Zugangsplattform GERENDERT wird — das Ziel eines rein
 * INTERNEN Rewrites, das von aussen auf KEINEM Host erreichbar ist.
 *
 * ── WARUM ES IHN ÜBERHAUPT GIBT ─────────────────────────────────────────────────────────────────
 * Zwei Routen können nicht denselben Pfad belegen: `app/(site)/[locale]/page.tsx` ist die
 * Marketing-Startseite und muss es bleiben. Der naheliegende Ausweg — dieselbe Datei liest den Host
 * und rendert einmal Marketing, einmal die Plattform — ist beim Portal-Host gemessen der teurere:
 * Ein `headers()`-Zugriff nimmt der Startseite das statische Vorrendern, und zwar auf ALLEN Hosts.
 * Die wichtigste Seite der Website würde ab dann bei jedem Aufruf serverseitig gebaut, damit eine
 * Subdomain mit einer Handvoll Nutzern ihren Eingang bekommt. Der Rewrite hält die Kosten dort, wo
 * der Sonderfall ist.
 *
 * ── DIE AUFLAGE IST DIE UNSICHTBARKEIT, NICHT DER NAME ──────────────────────────────────────────
 * Der Pfad darf auf keinem Host direkt aufrufbar sein und in keiner Adresszeile, keinem
 * Location-Header, keinem `next`-Parameter und keiner sitemap auftauchen. Durchgesetzt wird das an
 * drei Stellen, und keine davon ist Disziplin:
 *
 *   1. `middleware.ts` beantwortet JEDEN eingehenden Aufruf dieses Baums mit 404 — auf allen Hosts,
 *      und VOR der 308-Weiche. Die Reihenfolge ist die eigentliche Entscheidung: liefe die Weiche
 *      zuerst, stünde der Pfad auf dem Plattform-Host in einem Location-Header nach coolin.at, und
 *      dort würde er anschliessend gerendert. Der eigene Rewrite läuft nicht in diesen Wächter: Ein
 *      Middleware-Rewrite betritt die Middleware kein zweites Mal.
 *   2. `lib/routes.ts` kann ihn per Konstruktion nicht führen: Der Abgleich mit der Platte liest
 *      ausschliesslich `app/(site)/[locale]/`, und dort liegt der Baum nicht. Er steht damit in
 *      KEINER `SiteRoute` und kann in keine sitemap geraten.
 *   3. Kein `next`-Parameter zeigt je hierher: Ein Rücksprungziel ist die Adresse AUF DEM
 *      PLATTFORM-HOST, nie der Render-Pfad.
 *
 * ⚠ FOLGE, die beim Anlegen einer öffentlichen Seite `/access` auf coolin.at zu beachten ist: Der
 * Wächter beantwortet diesen Pfad auf JEDEM Host mit 404. Eine solche Marketingseite ist damit
 * ausgeschlossen, solange dieser Name hier steht.
 *
 * OFFENGELEGT: Der Name steht als Skript-Pfad im ausgelieferten HTML (`chunks/app/access/…`) — das
 * ist bei DATEISYSTEM-Routing unvermeidbar und gilt für jede Route dieser App. Er ist keine
 * Adresse: der Aufruf antwortet 404.
 */
export const ACCESS_RENDER_ROOT = '/access'

/**
 * Der Render-Pfad zu einer Adresse der Zugangsplattform — oder `null`, wenn der Pfad keine ist.
 *
 * EXAKTER Vergleich, ohne Locale-Behandlung, und beides mit Grund: Die präfixte Fassung der
 * Default-Locale beantwortet next-intl seit jeher selbst (`localePrefix: 'as-needed'` leitet `/de`
 * auf `/` um), und diese eine Zuständigkeit soll nicht in zwei Hände fallen. Für den Aufrufer sieht
 * beides gleich aus — die präfixte Adresse landet nach einer Umleitung auf der präfixlosen und
 * damit in der Plattform.
 *
 * ⚠ EINE ZWEITE SPRACHE MUSS HIER ENTSCHIEDEN WERDEN: `/en/` würde bei `as-needed` NICHT auf `/`
 * umgeleitet (für eine Nicht-Default-Locale ist das Präfix nötig) und liefe damit an dieser
 * Abbildung vorbei — die Anfrage bliebe auf dem Plattform-Host und endete in der 404 der
 * Anwendung. Ein Test in `lib/access-host.test.ts` bricht laut, sobald `routing.locales` wächst.
 */
export function accessRenderPath(pathname: string): string | null {
  if (!ACCESS_AREA_PATHS.includes(pathname)) return null
  return pathname === ACCESS_HOST_ROOT ? ACCESS_RENDER_ROOT : `${ACCESS_RENDER_ROOT}${pathname}`
}

/**
 * Die Pfade, die auf dem Zugangsplattform-Host BLEIBEN. Alles andere wird auf die kanonische Basis
 * umgeleitet.
 *
 * ── ⚠ DIE AUTH-ROUTEN STEHEN HIER BEWUSST NOCH NICHT ────────────────────────────────────────────
 * Der Portal-Host führt `AUTH_HREFS` mit, weil dort angemeldet wird. Dieser Baustein baut
 * ausdrücklich KEINE Auth-Logik — und ohne Anmeldeweg gibt es keinen Grund, `/anmelden` auf diesem
 * Host zu behalten: Kein Link zeigt dorthin, und die Seite trüge dort den öffentlichen
 * Website-Header, also eine Navigation, die den Host wieder verlässt. Ein 308 auf die Hauptdomain
 * ist für sie heute die richtige Antwort.
 *
 * ⚠ WER DIE ANMELDUNG BAUT (Baustein 6.1), ERGÄNZT HIER `...AUTH_HREFS` — und zwar ABGELEITET aus
 * `lib/auth/config.ts`, nicht abgetippt. Der Grund ist derselbe wie beim Portal-Host und er ist
 * zwingend, nicht kosmetisch: `sanitizeNext` (`lib/auth/config.ts`) lässt ausschliesslich
 * seiten-INTERNE Pfade mit genau einem führenden „/" zu. Ein Rücksprungziel auf einem ANDEREN Host
 * ist damit strukturell nicht darstellbar. Läge `/anmelden` nur auf der Hauptdomain, müsste die
 * Zugangsschranke von hier aus ein Host-tragendes `next` erzeugen — das verlangte eine
 * Host-Allowlist und wäre ein zweites Open-Redirect-Verfahren neben `sanitizeNext`. Genau das hat
 * der B17-Nachzug vermieden. Dazu gehört `/konto` zwingend mit: Es ist der strukturelle
 * Rückfallwert des gesamten Auth-Systems (Vorgabewert von `sanitizeNext`, Ziel von `signInAction`
 * ohne `next`); fehlte es, verliesse JEDER Anmeldevorgang, der sein `next` verliert, den Host.
 */
export const ACCESS_HOST_PATHS: readonly string[] = [...ACCESS_AREA_PATHS]

/** Kommt die Anfrage über die Zugangsplattform-Subdomain? Exakter Vergleich, s. Kopf dieser Datei. */
export function isAccessHost(host: string | null | undefined): boolean {
  return matchesHost(host, ACCESS_HOST)
}

/**
 * Läuft DIESE Anfrage über den Zugangsplattform-Host?
 *
 * Prüft `host` UND `x-forwarded-host` — die Begründung ist gemessen und steht bei
 * `requestMatchesHost` in `lib/host-match.ts`. Sie gilt hier vorausschauend: Sobald auf diesem Host
 * angemeldet wird, rendert Next das Ziel einer Server-Action-Weiterleitung in derselben Antwort und
 * schickt die Middleware dabei eine INTERNE Anfrage, deren `host` den Server selbst trägt.
 */
export function isAccessHostRequest(headers: HostHeaders): boolean {
  return requestMatchesHost(headers, ACCESS_HOST)
}

/**
 * Gehört dieser Pfad zur Zugangsplattform?
 *
 * ⚠ DIE EIGENEN SEITEN GELTEN AUSSCHLIESSLICH EXAKT, NIE ALS PRÄFIX.
 *
 * Für `/` ist das die harte Anforderung: Als Präfix hiesse „alles" — das genaue Gegenteil dessen,
 * wofür diese Liste da ist; die Weiche wäre wirkungslos und niemandem fiele es auf, weil jeder
 * einzelne Pfad weiterhin funktioniert. Die Bedingung ist dabei nicht bloss theoretisch: `${'/'}/`
 * ist „//", und ein Pfad wie „//admin" ist eine gültige Anfrage-Adresse, die sonst als Pfad der
 * Plattform durchginge.
 *
 * Für künftige Bereiche gilt dieselbe Regel aus einem zweiten Grund: Ihre Adressen werden über
 * `accessRenderPath` EXAKT auf den internen Baum abgebildet. Ein `/objekte/xyz` hat dort kein Ziel;
 * es auf dem Host zu behalten hiesse, eine Adresse anzubieten, die anschliessend nur die 404 der
 * Anwendung erreichen kann.
 *
 * Der Zweig für Pfade AUSSERHALB von `ACCESS_AREA_PATHS` (Gleichheit ODER Schrägstrich dahinter —
 * dasselbe Muster wie in `lib/portal-host.ts`, damit ein erfundenes `/anmelden-fremd` nicht
 * durchgeht) ist heute unerreichbar, weil `ACCESS_HOST_PATHS` ausschliesslich Bereichspfade führt.
 * Er steht bereits da, weil er mit den Auth-Routen (s. `ACCESS_HOST_PATHS`) gebraucht wird — und
 * weil ein dann nachträglich ergänztes `startsWith` genau die Grenzprüfung vergessen würde.
 */
export function isAccessPath(pathname: string): boolean {
  const path = stripLocale(pathname)
  return ACCESS_HOST_PATHS.some(
    (area) => path === area || (!ACCESS_AREA_PATHS.includes(area) && path.startsWith(`${area}/`)),
  )
}

/**
 * Zielt diese Anfrage von aussen auf den internen Render-Baum?
 *
 * Wahr für den Pfad selbst, für seine locale-präfixte Fassung und für alles darunter — jeder
 * künftige Bereich der Plattform liegt darunter und soll nicht versehentlich erreichbar werden. Die
 * Grenzprüfung (Gleichheit ODER Schrägstrich dahinter) ist dieselbe wie in `isAccessPath`, damit ein
 * erfundenes `/access-fremd` NICHT als internes Ziel gilt und ganz normal die 404 der Anwendung
 * bekommt statt einer Sonderbehandlung.
 */
export function isAccessRenderPath(pathname: string): boolean {
  const path = stripLocale(pathname)
  return path === ACCESS_RENDER_ROOT || path.startsWith(`${ACCESS_RENDER_ROOT}/`)
}

/**
 * Muss diese Anfrage den Zugangsplattform-Host verlassen?
 *
 * DIE eine benannte Ableitung, die Middleware und Indexierungssignal teilen. Wahr ausschliesslich
 * für eine Anfrage, die ÜBER den Plattform-Host kommt und NICHT auf die Plattform zielt.
 */
export function leavesAccessHost(headers: HostHeaders, pathname: string): boolean {
  return isAccessHostRequest(headers) && !isAccessPath(pathname)
}
