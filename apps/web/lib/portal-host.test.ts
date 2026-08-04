import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routing } from '@/i18n/routing'
import { AUTH_HREFS } from './auth/config'
import { activationUrlFor } from './partner-portal/activation-url'
import { PARTNER_AKTIVIEREN_HREF, PARTNER_PORTAL_HREF } from './partner-portal/config'
import {
  PORTAL_AREA_PATHS,
  PORTAL_HOST,
  PORTAL_HOST_PATHS,
  PORTAL_HOST_ROOT,
  PORTAL_MARKETING_PATH,
  PORTAL_RENDER_ROOT,
  isPortalHost,
  isPortalHostRequest,
  isPortalPath,
  isPortalRenderPath,
  leavesPortalHost,
  portalAbsoluteUrl,
  portalEntryUrl,
  portalRenderPath,
} from './portal-host'
import { PORTAL_NAV_ITEMS } from './partner-portal/nav'
import { IS_PRODUCTION_SITE, SITE_URL } from './site'
import { SITE_ROUTES } from './routes'

/**
 * Die Host-Weiche des Portal-Hosts (B18-1a, `lib/portal-host.ts`).
 *
 * ── DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST ─────────────────────────────────────────────
 * Ein Lauf gegen `partner.coolin.at` und `coolin.at` beweist, dass die Weiche auf DIESEN BEIDEN
 * Hosts das Richtige tut. Er sagt nichts über den dritten Fall — und genau dort sitzt die Gefahr:
 * Fiele der Vergleich auf einen zu weiten Ausdruck zurück („alles, was nicht die Hauptdomain ist"),
 * blieben beide gemessenen Hosts grün, während jede Preview (`*.vercel.app`) und jede lokale
 * Entwicklung (`localhost:<port>`) zur Portal-Domain würde: Die Startseite einer Preview leitete
 * dann auf die Produktivdomain um, und beim Testen der Portal-Routen fiele es nicht auf, weil die
 * ja bleiben sollen. Deshalb steht der preview-artige dritte Host hier als eigener Fall.
 *
 * Dieselbe Haltung wie die Quelltextprüfung in `lib/admin/guard.test.ts`: Was ein Laufzeittest
 * strukturell nicht sehen kann, wird am Quelltext festgehalten.
 */

/* ─── Der Host ───────────────────────────────────────────────────────────────────────────────── */

describe('isPortalHost erkennt ausschliesslich die Portal-Subdomain', () => {
  it('erkennt den Portal-Host', () => {
    expect(isPortalHost('partner.coolin.at')).toBe(true)
  })

  it('erkennt ihn unabhängig von Schreibweise, Port und FQDN-Punkt', () => {
    // Alle drei bezeichnen denselben Host. Ohne Normalisierung wäre jede dieser Formen ein NICHT
    // erkannter Portal-Host — und damit wieder eine vollständige Zweitdomain.
    for (const host of ['PARTNER.COOLIN.AT', 'Partner.Coolin.at', 'partner.coolin.at:443', 'partner.coolin.at.', ' partner.coolin.at ']) {
      expect(isPortalHost(host), host).toBe(true)
    }
  })

  /*
   * ⚠ DER FALL, DEN EIN LAUF GEGEN DIE ZWEI ECHTEN HOSTS NICHT ABDECKT.
   */
  it('lässt lokale Entwicklung und Preview-Deployments unberührt', () => {
    for (const host of [
      'localhost:3000',
      'localhost',
      '127.0.0.1:3000',
      '[::1]:3000',
      'peak-shaving-web.vercel.app',
      'peak-shaving-web-git-feat-b18-andi1180.vercel.app',
      'peak-shaving-web-abc123def-andi1180.vercel.app',
    ]) {
      expect(isPortalHost(host), host).toBe(false)
    }
  })

  it('lässt die Hauptdomain in beiden Schreibweisen unberührt', () => {
    for (const host of ['coolin.at', 'www.coolin.at']) {
      expect(isPortalHost(host), host).toBe(false)
    }
  })

  it('fällt nicht auf ähnlich aussehende Hosts herein', () => {
    // Ein Präfix-/Suffix-Vergleich statt Gleichheit machte aus jedem dieser Namen den Portal-Host.
    for (const host of [
      'notpartner.coolin.at',
      'partner.coolin.at.evil.example',
      'partner-coolin.at',
      'partner.coolin.at.attacker.test',
      'evil.example',
      'partner.example.at',
    ]) {
      expect(isPortalHost(host), host).toBe(false)
    }
  })

  it('behandelt eine fehlende Kopfzeile als „nicht der Portal-Host"', () => {
    // Ohne Host gibt es nichts umzuleiten; die Anfrage läuft wie bisher weiter.
    for (const host of [null, undefined, '']) {
      expect(isPortalHost(host)).toBe(false)
    }
  })
})

/* ─── Die Pfade ──────────────────────────────────────────────────────────────────────────────── */

describe('isPortalPath — was auf dem Portal-Host bleibt', () => {
  it('führt die Wurzel, das Portal, die Aktivierung und die Auth-Routen', () => {
    // Gepinnt, damit ein zusätzlicher Pfad eine BEWUSSTE Entscheidung bleibt: Was hier landet, ist
    // auf der Subdomain erreichbar und darf deshalb nichts Öffentliches sein.
    expect([...PORTAL_HOST_PATHS].sort()).toEqual(
      [
        '/',
        '/marketing',
        // B18-6: der dritte Reiter. Er ist auf der Subdomain erreichbar und zeigt Kontaktdaten
        // fremder Personen — die Aufnahme hier ist genau die bewusste Entscheidung, für die dieser
        // Pin da ist. Die Seite dahinter prüft die Sitzung selbst (s. weiter unten).
        '/leads',
        '/anmelden',
        '/konto',
        '/partner-aktivieren',
        '/partner-portal',
        '/passwort-neu',
        '/passwort-vergessen',
        '/registrieren',
      ].sort(),
    )
    expect(PORTAL_HOST_PATHS).toContain(PORTAL_HOST_ROOT)
    // B18-3: die eigenen Reiter des Portalbereichs kommen ABGELEITET dazu, nicht abgetippt.
    for (const area of PORTAL_AREA_PATHS) expect(PORTAL_HOST_PATHS).toContain(area)
    expect(PORTAL_HOST_PATHS).toContain(PARTNER_PORTAL_HREF)
    /*
     * ⚠ B18-2a: Der Aktivierungslink aus der Freischaltungsmail zeigt auf DIESEN Host. Fiele die
     * Seite unter die 308-Weiche, entstünde die Sitzung auf `coolin.at` — der Fachbetrieb landete
     * auf der Marketing-Startseite und wäre auf seiner eigenen Subdomain weiterhin abgemeldet.
     * Auth-Cookies sind host-gebunden; das ist keine Kosmetik, sondern der ganze Weg.
     */
    expect(PORTAL_HOST_PATHS).toContain(PARTNER_AKTIVIEREN_HREF)
    for (const href of AUTH_HREFS) expect(PORTAL_HOST_PATHS).toContain(href)
  })

  /*
   * ⚠ DIE KORRIGIERTE ANNAHME (B18-1a-Nachbesserung), und der Fall, den die erste Fassung NICHT
   * gefangen hätte: Sie pinnte `/` ausdrücklich als NICHT-Portalpfad — die Prüfung war grün, und
   * das Verhalten war trotzdem falsch. Ein Test kann nur so richtig sein wie die Annahme, die er
   * festhält; deshalb steht die Begründung jetzt AM Wert (`PORTAL_HOST_ROOT`) und nicht nur hier.
   */
  it('lässt die Wurzel durch — sie IST der Eingang zum Portal', () => {
    expect(isPortalPath('/')).toBe(true)
    expect(isPortalPath('/de')).toBe(true)
    expect(isPortalPath('/de/')).toBe(true)
  })

  it('nimmt die Wurzel NUR exakt, nie als Präfix', () => {
    /*
     * Als Präfix hiesse „alles" — die Weiche wäre wirkungslos, und niemandem fiele es auf, weil
     * jeder einzelne Pfad weiterhin funktioniert. `//admin` ist dabei kein Kunstfall: es ist eine
     * gültige Anfrage-Adresse und wäre mit einer naiven `startsWith`-Fassung ein Portalpfad.
     */
    for (const pathname of ['//admin', '//leistungen', '//']) {
      expect(isPortalPath(pathname), pathname).toBe(false)
    }
  })

  /*
   * B18-3: Der zweite Reiter ist eine Adresse AUF DEM PORTAL-HOST. Fiele er unter die 308-Weiche,
   * schickte sie einen angemeldeten Fachbetrieb mitten aus seinem Portal auf `coolin.at/marketing`
   * — eine Seite, die es dort nicht gibt.
   */
  it('lässt den Marketing-Reiter durch, mit und ohne Locale-Präfix', () => {
    expect(isPortalPath(PORTAL_MARKETING_PATH)).toBe(true)
    expect(isPortalPath(`/de${PORTAL_MARKETING_PATH}`)).toBe(true)
  })

  it('nimmt die Reiter EXAKT — Unterpfade und Namensverwandte sind keine Portalpfade', () => {
    /*
     * Anders als `/partner-portal` (das Unterpfade führen darf) werden die Reiter über
     * `portalRenderPath` EXAKT auf den internen Baum abgebildet. Ein `/marketing/xyz` hat dort kein
     * Ziel; ihn auf dem Host zu behalten hiesse, eine Adresse anzubieten, die nur die 404 der
     * Anwendung erreichen kann.
     */
    for (const pathname of ['/marketing/', '/marketing/vorlagen', '/marketing-fremd']) {
      expect(isPortalPath(pathname), pathname).toBe(false)
    }
  })

  it('lässt das Portal und jede Auth-Route durch', () => {
    for (const pathname of [PARTNER_PORTAL_HREF, ...AUTH_HREFS]) {
      expect(isPortalPath(pathname), pathname).toBe(true)
    }
  })

  it('lässt sie auch mit Locale-Präfix durch', () => {
    // `/de/anmelden` ist eine gültige Adresse (next-intl leitet sie auf `/anmelden` um). Die Weiche
    // läuft VOR dem Locale-Routing; ohne Berücksichtigung des Präfixes flöge jemand mitten im
    // Anmeldevorgang vom Portal-Host.
    expect(isPortalPath('/de/anmelden')).toBe(true)
    expect(isPortalPath('/de/partner-portal')).toBe(true)
  })

  it('lässt Unterpfade durch, aber keine Namensverwandten', () => {
    expect(isPortalPath('/partner-portal/')).toBe(true)
    // Ein naives `startsWith` machte aus diesen drei Portalpfade.
    for (const pathname of ['/partner-portal-fremd', '/partner-werden', '/konto-loeschen']) {
      expect(isPortalPath(pathname), pathname).toBe(false)
    }
  })

  it('lässt die öffentliche Seite und den Admin-Bereich NICHT durch', () => {
    for (const pathname of [
      '/leistungen',
      '/leistungen/pv-speicher',
      '/peak-shaving/kalkulator',
      '/wissen/leistungstarif-2027',
      '/kontakt',
      '/partner/raymann',
      '/admin',
      '/admin/leads',
      '/admin/anmelden',
      '/login',
      '/abmelden',
    ]) {
      expect(isPortalPath(pathname), pathname).toBe(false)
    }
  })
})

/* ─── Die Adressen, die in eine E-Mail wandern (B18-2a) ──────────────────────────────────────── */

describe('portalAbsoluteUrl / portalEntryUrl — Adressen für die Freischaltungsmail', () => {
  /*
   * ⚠ DIESE ZEILEN LAUFEN OHNE `NEXT_PUBLIC_SITE_URL`, also im Nicht-Produktions-Zweig. Das ist
   * kein Mangel des Tests, sondern der Zustand, in dem lokal und in jeder Preview gebaut wird —
   * und genau dort muss die Adresse benutzbar bleiben. Der Produktionszweig wird darunter über
   * seine EIGENSCHAFTEN geprüft (Host, Pfad), nicht über eine nachgestellte Umgebung: `SITE_URL`
   * entsteht beim Modul-Laden aus einer zur Bauzeit ersetzten Konstante und lässt sich im Test
   * nicht glaubwürdig umschalten.
   */
  it('ausserhalb der Produktivdomain zeigen beide auf die ausgelieferte Basis', () => {
    expect(IS_PRODUCTION_SITE).toBe(false)
    expect(portalAbsoluteUrl(PARTNER_AKTIVIEREN_HREF)).toBe(`${SITE_URL}${PARTNER_AKTIVIEREN_HREF}`)
    // Nicht `/` — das wäre lokal die MARKETING-Startseite und damit die falsche Adresse.
    expect(portalEntryUrl()).toBe(`${SITE_URL}${PARTNER_PORTAL_HREF}`)
    expect(portalEntryUrl()).not.toBe(`${SITE_URL}/`)
  })

  it('der Aktivierungslink trägt den Token als Query und den Pfad der Aktivierungsseite', () => {
    const url = new URL(activationUrlFor('abc123'))

    expect(url.pathname).toBe(PARTNER_AKTIVIEREN_HREF)
    expect(url.searchParams.get('token')).toBe('abc123')
  })

  it('ein Token mit Sonderzeichen wird kodiert und kommt unverändert wieder heraus', () => {
    /*
     * GoTrue liefert heute Hex. Die Zusicherung soll aber nicht an der Zeichenmenge eines fremden
     * Systems hängen: Ändert sich das Format, darf der Link nicht still zerfallen.
     */
    const token = 'a+b/c=d&e f'
    const url = new URL(activationUrlFor(token))

    expect(url.searchParams.get('token')).toBe(token)
    expect(url.toString()).not.toContain(' ')
  })

  it('die Aktivierungsseite ist NICHT indexierbar — ihre Adresse trägt einen einlösbaren Token', () => {
    const route = SITE_ROUTES.find((entry) => entry.href === PARTNER_AKTIVIEREN_HREF)
    expect(route, 'die Aktivierungsseite fehlt in SITE_ROUTES').toBeDefined()
    expect(route?.indexable).toBe(false)
  })
})

/* ─── Die Ableitung, die die Middleware benutzt ──────────────────────────────────────────────── */

/** Kopfzeilen-Attrappe — dieselbe Form wie `request.headers` und `await headers()`. */
const headersOf = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
})

describe('isPortalHostRequest — zwei Kopfzeilen, monoton verknüpft', () => {
  it('erkennt den Portal-Host über „host"', () => {
    expect(isPortalHostRequest(headersOf({ host: PORTAL_HOST }))).toBe(true)
  })

  /*
   * ⚠ DER GEMESSENE FALL: Leitet eine Server Action mit `redirect('/')` weiter, rendert Next das
   * Ziel innerhalb derselben Antwort und lässt die Middleware dafür mit einer INTERNEN Anfrage
   * laufen — `host` trägt dann den Server selbst, `x-forwarded-host` den echten Host. Ohne die
   * zweite Kopfzeile sähe ein Fachbetrieb unmittelbar nach dem Anmelden die Marketing-Startseite.
   */
  it('erkennt ihn auch, wenn nur „x-forwarded-host" ihn trägt', () => {
    expect(
      isPortalHostRequest(headersOf({ host: 'localhost:3990', 'x-forwarded-host': PORTAL_HOST })),
    ).toBe(true)
  })

  it('lässt Hauptdomain, localhost und Previews unberührt', () => {
    for (const host of ['coolin.at', 'www.coolin.at', 'localhost:3000', 'peak-shaving-web.vercel.app']) {
      expect(isPortalHostRequest(headersOf({ host, 'x-forwarded-host': host })), host).toBe(false)
    }
    expect(isPortalHostRequest(headersOf({}))).toBe(false)
  })

  /*
   * Die Verknüpfung ist „ODER" und damit monoton: Sie kann eine Anfrage nur ZUSÄTZLICH als
   * Portal-Host erkennen. Ein von Hand mitgeschicktes `x-forwarded-host` bekommt deshalb die
   * ENGERE Behandlung (Portalbereich oder 308), nie eine weitere — und umgekehrt lässt sich die
   * 308-Weiche auf dem Portal-Host NICHT durch eine widersprechende Kopfzeile abschalten.
   */
  it('lässt sich nicht durch eine widersprechende Kopfzeile abschalten', () => {
    expect(
      isPortalHostRequest(headersOf({ host: PORTAL_HOST, 'x-forwarded-host': 'coolin.at' })),
    ).toBe(true)
    expect(leavesPortalHost(headersOf({ host: PORTAL_HOST, 'x-forwarded-host': 'coolin.at' }), '/leistungen')).toBe(true)
  })
})

describe('leavesPortalHost — nur Portal-Host UND Nicht-Portal-Pfad', () => {
  const portal = headersOf({ host: PORTAL_HOST })

  it('leitet nicht-portale Pfade auf dem Portal-Host weg', () => {
    for (const pathname of ['/leistungen', '/admin/leads', '/partner-werden', '/wissen']) {
      expect(leavesPortalHost(portal, pathname), pathname).toBe(true)
    }
  })

  it('lässt portale Pfade auf dem Portal-Host stehen — die Wurzel eingeschlossen', () => {
    for (const pathname of ['/', '/de', '/partner-portal', '/anmelden', '/konto', '/de/anmelden']) {
      expect(leavesPortalHost(portal, pathname), pathname).toBe(false)
    }
  })

  it('⚠ B18-2a: die Aktivierungsseite bleibt — SAMT Query, denn dort steht der Token', () => {
    /*
     * Die Wirkung, an der der ganze Schritt hängt: Würde dieser Pfad weggeleitet, entstünde die
     * Sitzung auf der Hauptdomain (Auth-Cookies sind host-gebunden), und der Fachbetrieb wäre auf
     * `partner.coolin.at` weiterhin abgemeldet — bei einem 308, der äusserlich völlig richtig
     * aussieht. `isPortalPath` bewertet nur den Pfad; die Query fährt bei einer 308 ohnehin mit
     * (`middleware.ts`), hier steht sie als Erinnerung daran, dass der Token in ihr steckt.
     */
    expect(leavesPortalHost(portal, PARTNER_AKTIVIEREN_HREF)).toBe(false)
    expect(leavesPortalHost(portal, `/de${PARTNER_AKTIVIEREN_HREF}`)).toBe(false)
    // Gegenprobe: der Namensverwandte ist KEIN Portalpfad und wird ganz normal weggeleitet.
    expect(leavesPortalHost(portal, `${PARTNER_AKTIVIEREN_HREF}-fremd`)).toBe(true)
  })

  it('fasst die Hauptdomain, localhost und Previews auf KEINEM Pfad an', () => {
    for (const host of ['coolin.at', 'www.coolin.at', 'localhost:3000', 'peak-shaving-web.vercel.app']) {
      for (const pathname of ['/', '/leistungen', '/admin/leads', '/partner-portal', '/anmelden']) {
        expect(leavesPortalHost(headersOf({ host }), pathname), `${host}${pathname}`).toBe(false)
      }
    }
  })
})

/* ─── Die Verbindung zum Indexierungssignal ──────────────────────────────────────────────────── */

/*
 * Der Grund, warum `app/robots.ts` mit EINER zusätzlichen Bedingung auskommt und nirgends sonst
 * etwas nachzutragen war: Was auf dem Portal-Host erreichbar bleibt, ist ohnehin schon `noindex`.
 * Diese Deckungsgleichheit ist heute wahr — würde jemand einen dieser Pfade später indexierbar
 * machen (oder einen indexierbaren in die Liste aufnehmen), entstünde eine indexierbare Seite auf
 * einer Domain, die nicht indexiert werden soll. Ohne diesen Test fiele das niemandem auf.
 */
describe('jeder Pfad auf dem Portal-Host ist bereits nicht indexierbar', () => {
  it('steht in lib/routes.ts und dort auf indexable: false', () => {
    for (const pathname of PORTAL_HOST_PATHS.filter(
      (path) => !PORTAL_AREA_PATHS.includes(path),
    )) {
      const route = SITE_ROUTES.find((entry) => entry.href === pathname)
      expect(route, `${pathname} fehlt in SITE_ROUTES`).toBeDefined()
      expect(route?.indexable, pathname).toBe(false)
    }
  })

  /*
   * ⚠ DIE EIGENEN SEITEN DES PORTALS SIND DIE AUSNAHME, UND SIE SIND KEINE LÜCKE. `/` ist auf der
   * Hauptdomain die Marketing-Startseite und dort selbstverständlich indexierbar — dieselbe Route,
   * zwei Hosts, zwei Bedeutungen; `/marketing` gibt es auf der Hauptdomain gar nicht. Was auf dem
   * Portal-Host ausgeliefert wird, ist NICHT der `/`-Eintrag, sondern der Baum unter
   * `PORTAL_RENDER_ROOT`; dessen `noindex` wird unten am Quelltext festgehalten. Zusätzlich steht
   * der gesamte Portal-Host in `app/robots.ts` auf `Disallow: /`.
   */
  it('die Wurzel ist auf der Hauptdomain weiterhin indexierbar', () => {
    const route = SITE_ROUTES.find((entry) => entry.href === PORTAL_HOST_ROOT)
    expect(route).toBeDefined()
    expect(route?.indexable).toBe(true)
  })

  it('der Marketing-Reiter ist auf der Hauptdomain gar keine Route', () => {
    expect(SITE_ROUTES.find((entry) => entry.href === PORTAL_MARKETING_PATH)).toBeUndefined()
  })
})

/* ─── Die Adressen des Portalbereichs und ihr interner Render-Baum ───────────────────────────── */

describe('portalRenderPath — die Abbildung Adresse → interner Baum', () => {
  it('bildet die Wurzel auf den Baum selbst ab, den Reiter auf ein Kindsegment', () => {
    expect(portalRenderPath(PORTAL_HOST_ROOT)).toBe(PORTAL_RENDER_ROOT)
    expect(portalRenderPath(PORTAL_MARKETING_PATH)).toBe(`${PORTAL_RENDER_ROOT}/marketing`)
  })

  it('deckt JEDE Adresse des Bereichs ab — sonst liefe ein Reiter in die 308-Weiche', () => {
    // Ohne diese Prüfung wäre ein neuer Eintrag in `PORTAL_AREA_PATHS` ohne Abbildung ein Reiter,
    // der auf dem Portal-Host sichtbar ist und beim Klick auf coolin.at landet.
    for (const area of PORTAL_AREA_PATHS) {
      expect(portalRenderPath(area), area).toBeTruthy()
    }
  })

  /*
   * `/de` und `/de/marketing` gehören bewusst NICHT dazu: die präfixte Fassung der Default-Locale
   * beantwortet next-intl seit jeher selbst (`as-needed` leitet sie auf die präfixlose um), und
   * diese Zuständigkeit soll nicht in zwei Hände fallen. Für den Aufrufer sieht beides gleich aus;
   * `isPortalPath` hält die Umleitung dafür AUF dem Host.
   */
  it('fasst die locale-präfixte Fassung nicht an — die gehört next-intl', () => {
    for (const pathname of ['/de', '/de/', '/de/marketing', '/leistungen', '/anmelden', '']) {
      expect(portalRenderPath(pathname), pathname).toBeNull()
    }
    expect(isPortalPath('/de')).toBe(true)
    expect(isPortalPath('/de/marketing')).toBe(true)
  })

  it('bildet Namensverwandte und Unterpfade NICHT ab', () => {
    for (const pathname of ['/marketing/', '/marketing/vorlagen', '/marketing-fremd', '//']) {
      expect(portalRenderPath(pathname), pathname).toBeNull()
    }
  })

  /*
   * ⚠ DIE REITER DER NAVIGATION MÜSSEN DIE ADRESSEN AUF DEM PORTAL-HOST TRAGEN, nie die
   * Render-Pfade: Ein Link auf den Render-Baum liefe in den 404-Wächter. Der Reiter wäre sichtbar,
   * und der Klick endete auf einer leeren Seite — ein Fehler, den kein Build zeigt.
   */
  it('jeder Navigationspunkt ist eine Adresse des Bereichs', () => {
    for (const item of PORTAL_NAV_ITEMS) {
      expect(PORTAL_AREA_PATHS, item.href).toContain(item.href)
      expect(isPortalRenderPath(item.href), item.href).toBe(false)
    }
    expect(PORTAL_NAV_ITEMS.map((item) => item.href)).toEqual([...PORTAL_AREA_PATHS])
  })
})

describe('isPortalRenderPath — der interne Baum, von aussen tabu', () => {
  it('erkennt ihn mit und ohne Locale-Präfix und alles darunter', () => {
    for (const pathname of [
      PORTAL_RENDER_ROOT,
      `${PORTAL_RENDER_ROOT}/`,
      `${PORTAL_RENDER_ROOT}/marketing`,
      `${PORTAL_RENDER_ROOT}/tiefer`,
      `/de${PORTAL_RENDER_ROOT}`,
      `/de${PORTAL_RENDER_ROOT}/marketing`,
    ]) {
      expect(isPortalRenderPath(pathname), pathname).toBe(true)
    }
  })

  it('fällt nicht auf Namensverwandte herein', () => {
    // Sie bekommen die gewöhnliche 404 der Anwendung, keine Sonderbehandlung.
    for (const pathname of [`${PORTAL_RENDER_ROOT}-fremd`, '/portal-host', '/', '/marketing']) {
      expect(isPortalRenderPath(pathname), pathname).toBe(false)
    }
  })

  it('ist KEIN Portalpfad — der Wächter entscheidet vor der Weiche, nicht die Liste', () => {
    /*
     * Die Unerreichbarkeit hängt am Wächter in `middleware.ts`, der VOR der 308-Weiche steht. Stünde
     * der Baum stattdessen in `PORTAL_HOST_PATHS`, wäre er auf dem Portal-Host direkt aufrufbar —
     * genau das Gegenteil der Auflage.
     */
    expect(PORTAL_HOST_PATHS).not.toContain(PORTAL_RENDER_ROOT)
    expect(isPortalPath(PORTAL_RENDER_ROOT)).toBe(false)
    expect(isPortalPath(`${PORTAL_RENDER_ROOT}/marketing`)).toBe(false)
  })

  it('steht in KEINER SiteRoute und kann damit in keine sitemap geraten', () => {
    /*
     * Seit B18-3 ist das eine Eigenschaft der ABLAGE, nicht einer gepflegten Ausnahmeliste: Der Baum
     * liegt unter `app/portal/**` und damit ausserhalb des Verzeichnisses, das `assertRoutesMatchDisk`
     * liest. Es gibt keinen `SiteRoute`-Eintrag, aus dem ein sitemap-Eintrag entstehen könnte.
     */
    for (const route of SITE_ROUTES) {
      expect(isPortalRenderPath(route.href), route.href).toBe(false)
    }
  })
})

/*
 * ⚠ STOLPERDRAHT FÜR DIE ZWEITE SPRACHE. Der Portalbereich liegt AUSSERHALB der Sprach-Struktur
 * (wie `/admin`) und rendert unter `routing.defaultLocale`; seine Adressen werden EXAKT auf den
 * internen Baum abgebildet, ohne Locale-Behandlung. Das ist richtig, solange es genau EINE Locale
 * gibt: `/de/marketing` leitet next-intl von sich aus auf `/marketing` um. Mit einer zweiten Sprache
 * gilt das nicht mehr — `/en/marketing` behielte sein Präfix, liefe an der Abbildung vorbei und
 * endete in der 404 der Anwendung. Das ist eine Entscheidung und keine Kleinigkeit: Sie soll hier
 * auffallen und nicht als „Portal spricht immer Deutsch" im Betrieb.
 */
describe('die Abkürzung im Rewrite gilt nur für eine einzige Locale', () => {
  it('bricht laut, sobald eine zweite Sprache dazukommt', () => {
    expect(
      routing.locales.length,
      'Zweite Locale erkannt: der Portalbereich (middleware.ts, portalRenderPath) bildet seine Adressen ohne Locale-Behandlung ab und rendert unter routing.defaultLocale. Vor dem Erweitern von routing.locales entscheiden, welche Sprache ein angemeldeter Bereich zeigt und wie /<locale>/marketing behandelt wird.',
    ).toBe(1)
  })
})

/* ─── Die Lücke, die ein Laufzeittest nicht schliesst ────────────────────────────────────────── */

/*
 * ⚠ Der Host-Vergleich wirkt nur, wenn die Middleware ihn auch benutzt. Schriebe jemand dort einen
 * eigenen Vergleich (oder einen weiteren daneben), bliebe hier alles grün: Diese Datei prüft die
 * Ableitung, nicht ihren Aufrufer. Deshalb wird am Quelltext festgehalten, dass es GENAU EINE Stelle
 * mit dem Hostnamen gibt und dass die Middleware die benannte Ableitung aufruft.
 */
describe('die Ableitung hat genau einen Fundort und einen Aufrufer', () => {
  const read = (...segments: string[]): string =>
    fs.readFileSync(path.resolve(import.meta.dirname, '..', ...segments), 'utf8')

  /** Kommentare weg, sonst wertete der Wächter das ERKLÄREN der Regel als Verstoss (B11-Falle). */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('die Middleware ruft die benannte Ableitung auf', () => {
    const middleware = stripComments(read('middleware.ts'))
    expect(middleware).toMatch(/from '\.\/lib\/portal-host'/)
    expect(middleware).toMatch(/leavesPortalHost\(/)
  })

  it('die Middleware baut das Ziel aus SITE_URL, nicht aus einem zweiten getippten Host', () => {
    const middleware = stripComments(read('middleware.ts'))
    expect(middleware).toMatch(/from '\.\/lib\/site'/)
    expect(middleware).toMatch(/SITE_URL/)
  })

  it('der Hostname steht nirgends sonst im Quelltext', () => {
    for (const file of ['middleware.ts', 'app/robots.ts', 'lib/site.ts', 'lib/routes.ts']) {
      expect(stripComments(read(file)), file).not.toContain(PORTAL_HOST)
    }
    expect(stripComments(read('lib/portal-host.ts'))).toContain(PORTAL_HOST)
  })

  it('robots.ts entscheidet über dieselbe Ableitung', () => {
    const robots = stripComments(read('app/robots.ts'))
    expect(robots).toMatch(/from '@\/lib\/portal-host'/)
    expect(robots).toMatch(/isPortalHost\(/)
  })

  /*
   * ⚠ DIE UNERREICHBARKEIT DES REWRITE-ZIELS IST EINE EIGENSCHAFT DER REIHENFOLGE, und die sieht
   * ein Laufzeittest dieser Datei strukturell nicht: Sie prüft Ableitungen, nicht ihren Aufrufer.
   * Rutschte der Wächter unter die 308-Weiche, bliebe hier alles grün — der interne Pfad stünde
   * dann auf dem Portal-Host in einem Location-Header nach coolin.at und würde dort gerendert.
   * Deshalb wird die Position am Quelltext festgehalten.
   */
  it('der Wächter über den Render-Baum steht VOR der 308-Weiche', () => {
    const middleware = stripComments(read('middleware.ts'))
    const guard = middleware.indexOf('isPortalRenderPath(')
    const rewrite = middleware.indexOf('portalRenderPath(')
    const weiche = middleware.indexOf('leavesPortalHost(')

    expect(guard, 'middleware.ts ruft isPortalRenderPath nicht auf').toBeGreaterThan(-1)
    expect(rewrite, 'middleware.ts ruft portalRenderPath nicht auf').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(rewrite)
    expect(rewrite).toBeLessThan(weiche)
  })

  it('der Rewrite ist ein rewrite und kein redirect', () => {
    // Ein Redirect schriebe den internen Pfad in die Adresszeile — genau das ist ausgeschlossen.
    const middleware = stripComments(read('middleware.ts'))
    const branch = middleware.slice(
      middleware.indexOf('portalRenderPath('),
      middleware.indexOf('leavesPortalHost('),
    )
    expect(branch).toMatch(/NextResponse\.rewrite\(/)
    expect(branch).not.toMatch(/NextResponse\.redirect\(/)
    // Und der Session-Refresh läuft auf GENAU dieser Response (die Komposition bleibt gewahrt).
    expect(branch).toMatch(/updateSession\(request, NextResponse\.rewrite\(/)
  })

  /*
   * ⚠ B18-3: Der Render-Baum liegt AUSSERHALB von `app/(site)/[locale]/`. Das ist keine
   * Ablage-Vorliebe, sondern der Grund, warum er in keine sitemap geraten kann (der Abgleich in
   * `lib/routes.ts` liest nur jenes Verzeichnis) und warum er den öffentlichen Website-Header nicht
   * mehr trägt. Zöge ihn jemand zurück, wäre beides still wieder da.
   */
  it('der Render-Baum liegt unter app/portal/ und nicht in der Sprach-Struktur', () => {
    const dir = path.resolve(import.meta.dirname, '..', 'app', PORTAL_RENDER_ROOT.slice(1))
    expect(fs.existsSync(path.join(dir, 'layout.tsx')), 'app/portal/layout.tsx fehlt').toBe(true)
    expect(fs.existsSync(path.join(dir, 'page.tsx')), 'app/portal/page.tsx fehlt').toBe(true)
    expect(
      fs.existsSync(path.resolve(import.meta.dirname, '..', 'app', '(site)', '[locale]', 'portal')),
      'der Portalbereich darf nicht in der Sprach-Struktur liegen',
    ).toBe(false)
  })

  /**
   * Jede Adresse des Bereichs hat eine Datei, und jede Datei liegt an ihrer Adresse. Ohne die zweite
   * Richtung wäre ein umbenannter Ordner ein Reiter, der auf eine 404 zeigt — der Build bliebe grün.
   */
  it('zu jedem Reiter gibt es eine Seite unter dem Render-Baum', () => {
    for (const area of PORTAL_AREA_PATHS) {
      const renderPath = portalRenderPath(area)
      expect(renderPath, area).toBeTruthy()
      const file = path.resolve(import.meta.dirname, '..', 'app', `${renderPath!.slice(1)}/page.tsx`)
      expect(fs.existsSync(file), `${area} → ${file}`).toBe(true)
    }
  })

  /*
   * ⚠ DIE ZUGANGSPRÜFUNG SITZT IN JEDER SEITE, NICHT IM LAYOUT — dieselbe Lehre wie im
   * Admin-Bereich: Dass ein Layout `children` nicht rendert, verhindert nicht, dass Next die Seite
   * rendert und ins Flight-Payload schreibt. Eine neue Seite ohne `readPortal` wäre ein
   * Portalbereich ohne Anmeldung, und sie funktionierte tadellos.
   */
  it('jede Seite des Bereichs liest die Sitzung über den EINEN Leseweg', () => {
    const dir = path.resolve(import.meta.dirname, '..', 'app', PORTAL_RENDER_ROOT.slice(1))
    const pages: string[] = []
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(current, entry.name))
        else if (entry.name === 'page.tsx') pages.push(path.join(current, entry.name))
      }
    }
    walk(dir)

    expect(pages.length, 'keine Seiten gefunden — der Test prüfte sonst nichts').toBeGreaterThan(1)
    for (const file of pages) {
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      expect(source, file).toMatch(/readPortal\(\)/)
      // Eine zweite, kopierte Fassung des Ablaufs würde auseinanderlaufen — sie ist hier
      // strukturell ausgeschlossen: keine Seite liest die Sitzung selbst.
      expect(source, file).not.toMatch(/getUser\(/)
      expect(source, file).not.toMatch(/get_my_partner/)
    }
  })

  it('die Bestandsroute benutzt DENSELBEN Leseweg und liest die Sitzung nicht selbst', () => {
    const route = stripComments(read('components/partner-portal/partner-portal-route.tsx'))
    expect(route).toMatch(/readPortal\(\)/)
    expect(route).not.toMatch(/getUser\(/)
    expect(route).not.toMatch(/get_my_partner/)

    const bestand = stripComments(read(`app/(site)/[locale]${PARTNER_PORTAL_HREF}/page.tsx`))
    expect(bestand).toMatch(/from '@\/components\/partner-portal\/partner-portal-route'/)
  })

  /*
   * ⚠ KEIN `next`-PARAMETER ZEIGT AUF DEN RENDER-BAUM. Das Rücksprungziel ist die Adresse AUF DEM
   * PORTAL-HOST; ein Render-Pfad dort führte nach dem Anmelden in den 404-Wächter — und zwar still,
   * weil die Anmeldung selbst funktionierte. Geprüft über den GESAMTEN Quellbaum, nicht nur an den
   * bekannten Stellen.
   */
  it('kein next-Parameter im Repo zeigt auf den Render-Baum', () => {
    const roots = ['app', 'components', 'lib', 'messages', 'middleware.ts']
    const offenders: string[] = []
    const check = (file: string) => {
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      // Die Konstanten selbst und ihre Erklärung sind erlaubt; ein NEXT_PARAM/`next=` daneben nicht.
      for (const match of source.matchAll(/NEXT_PARAM\]:\s*([A-Za-z_.]+)/g)) {
        if (/RENDER/.test(match[1] ?? '')) offenders.push(`${file}: ${match[0]}`)
      }
      if (source.includes(`next=${PORTAL_RENDER_ROOT}`)) offenders.push(`${file}: next=`)
    }
    const walk = (current: string) => {
      const stat = fs.statSync(current)
      if (stat.isFile()) {
        if (/\.(tsx?|json)$/.test(current) && !current.endsWith('.test.ts')) check(current)
        return
      }
      for (const entry of fs.readdirSync(current)) walk(path.join(current, entry))
    }
    for (const root of roots) walk(path.resolve(import.meta.dirname, '..', root))

    expect(offenders).toEqual([])
  })

  /*
   * Das Rücksprungziel auf dem Portal-Host ist die aufgerufene Adresse — nicht `/partner-portal`.
   * Ein Portal-Pfad im `next`-Parameter wäre genau die Sichtbarkeit, die B18-1a beseitigt hat; und
   * sie entstünde still, weil die Anmeldung trotzdem funktionierte.
   */
  it('jeder Reiter schickt zur Anmeldung mit SEINER eigenen Adresse zurück', () => {
    const root = stripComments(read('app/portal/page.tsx'))
    expect(root).toMatch(/NEXT_PARAM\]:\s*PORTAL_HOST_ROOT/)
    expect(root).not.toMatch(/PARTNER_PORTAL_HREF/)

    const marketing = stripComments(read('app/portal/marketing/page.tsx'))
    expect(marketing).toMatch(/NEXT_PARAM\]:\s*PORTAL_MARKETING_PATH/)

    const bestand = stripComments(read(`app/(site)/[locale]${PARTNER_PORTAL_HREF}/page.tsx`))
    expect(bestand).toMatch(/signInNext=\{PARTNER_PORTAL_HREF\}/)
  })

  /*
   * ⚠ /anmelden IST EINE GETEILTE ROUTE (öffentliche Website UND Partner-Login, je nach Host
   * dieselbe Datei) und bekommt bewusst KEINEN Portal-Rahmen. Ihn dort zu zeigen verlangte eine
   * Host-Prüfung im `(site)/[locale]`-Layout — genau das Muster, das B18-2 entfernt hat, weil es
   * die gesamte Website dynamisch rendert (35 vorgerenderte Seiten wären wieder 6).
   */
  it('der Portal-Rahmen wird ausschliesslich aus dem Portalbereich heraus gerendert', () => {
    const consumers: string[] = []
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          const source = stripComments(fs.readFileSync(full, 'utf8'))
          if (/from '(@\/components\/portal\/shell|\.\/shell)'/.test(source)) consumers.push(full)
        }
      }
    }
    const appDir = path.resolve(import.meta.dirname, '..', 'app')
    walk(appDir)
    walk(path.resolve(import.meta.dirname, '..', 'components'))

    expect(consumers.map((file) => path.relative(appDir, file)).sort()).toEqual([
      'portal/leads/page.tsx',
      'portal/marketing/page.tsx',
      'portal/page.tsx',
    ])
  })
})
