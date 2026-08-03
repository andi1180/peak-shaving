import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routing } from '@/i18n/routing'
import { AUTH_HREFS } from './auth/config'
import { PARTNER_PORTAL_HREF } from './partner-portal/config'
import {
  PORTAL_HOST,
  PORTAL_HOST_PATHS,
  PORTAL_HOST_ROOT,
  PORTAL_ROOT_RENDER_PATH,
  isPortalHost,
  isPortalHostRequest,
  isPortalHostRoot,
  isPortalPath,
  isPortalRootRenderPath,
  leavesPortalHost,
} from './portal-host'
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
  it('führt die Wurzel, das Portal und die Auth-Routen', () => {
    // Gepinnt, damit ein zusätzlicher Pfad eine BEWUSSTE Entscheidung bleibt: Was hier landet, ist
    // auf der Subdomain erreichbar und darf deshalb nichts Öffentliches sein.
    expect([...PORTAL_HOST_PATHS].sort()).toEqual(
      ['/', '/anmelden', '/konto', '/partner-portal', '/passwort-neu', '/passwort-vergessen', '/registrieren'].sort(),
    )
    expect(PORTAL_HOST_PATHS).toContain(PORTAL_HOST_ROOT)
    expect(PORTAL_HOST_PATHS).toContain(PARTNER_PORTAL_HREF)
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
    for (const pathname of PORTAL_HOST_PATHS.filter((path) => path !== PORTAL_HOST_ROOT)) {
      const route = SITE_ROUTES.find((entry) => entry.href === pathname)
      expect(route, `${pathname} fehlt in SITE_ROUTES`).toBeDefined()
      expect(route?.indexable, pathname).toBe(false)
    }
  })

  /*
   * ⚠ DIE WURZEL IST DIE EINE AUSNAHME, UND SIE IST KEINE LÜCKE. `/` ist auf der Hauptdomain die
   * Marketing-Startseite und dort selbstverständlich indexierbar — dieselbe Route, zwei Hosts, zwei
   * Bedeutungen. Was auf dem Portal-Host unter `/` ausgeliefert wird, ist NICHT dieser Eintrag,
   * sondern `PORTAL_ROOT_RENDER_PATH`; dessen `noindex` wird unten am Quelltext festgehalten.
   * Zusätzlich steht der gesamte Portal-Host in `app/robots.ts` auf `Disallow: /`.
   */
  it('die Wurzel ist auf der Hauptdomain weiterhin indexierbar', () => {
    const route = SITE_ROUTES.find((entry) => entry.href === PORTAL_HOST_ROOT)
    expect(route).toBeDefined()
    expect(route?.indexable).toBe(true)
  })
})

/* ─── Die Wurzel des Portal-Hosts und ihr internes Rewrite-Ziel ──────────────────────────────── */

describe('isPortalHostRoot — nur das exakte „/"', () => {
  it('erkennt die Wurzel', () => {
    expect(isPortalHostRoot('/')).toBe(true)
  })

  /*
   * `/de` gehört bewusst NICHT dazu: die präfixte Fassung der Default-Locale beantwortet next-intl
   * seit jeher selbst (`as-needed` leitet sie auf `/` um), und diese Zuständigkeit soll nicht in
   * zwei Hände fallen. Für den Aufrufer sieht beides gleich aus — `/de` landet nach der Umleitung
   * auf `/` und damit im Portal; `isPortalPath('/de')` hält die Umleitung dafür AUF dem Host.
   */
  it('fasst die locale-präfixte Fassung nicht an — die gehört next-intl', () => {
    for (const pathname of ['/de', '/de/', '/leistungen', '/anmelden', '']) {
      expect(isPortalHostRoot(pathname), pathname).toBe(false)
    }
    expect(isPortalPath('/de')).toBe(true)
  })
})

describe('isPortalRootRenderPath — das interne Ziel, von aussen tabu', () => {
  it('erkennt es mit und ohne Locale-Präfix und alles darunter', () => {
    for (const pathname of [
      PORTAL_ROOT_RENDER_PATH,
      `${PORTAL_ROOT_RENDER_PATH}/`,
      `${PORTAL_ROOT_RENDER_PATH}/tiefer`,
      `/de${PORTAL_ROOT_RENDER_PATH}`,
      `/de${PORTAL_ROOT_RENDER_PATH}/tiefer`,
    ]) {
      expect(isPortalRootRenderPath(pathname), pathname).toBe(true)
    }
  })

  it('fällt nicht auf Namensverwandte herein', () => {
    // Sie bekommen die gewöhnliche 404 der Anwendung, keine Sonderbehandlung.
    for (const pathname of [`${PORTAL_ROOT_RENDER_PATH}-fremd`, '/portal-host', '/', '/wurzel']) {
      expect(isPortalRootRenderPath(pathname), pathname).toBe(false)
    }
  })

  it('ist KEIN Portalpfad — der Wächter entscheidet vor der Weiche, nicht die Liste', () => {
    /*
     * Die Unerreichbarkeit hängt am Wächter in `middleware.ts`, der VOR der 308-Weiche steht. Stünde
     * das Ziel stattdessen in `PORTAL_HOST_PATHS`, wäre es auf dem Portal-Host direkt aufrufbar —
     * genau das Gegenteil der Auflage.
     */
    expect(PORTAL_HOST_PATHS).not.toContain(PORTAL_ROOT_RENDER_PATH)
    expect(isPortalPath(PORTAL_ROOT_RENDER_PATH)).toBe(false)
  })

  it('steht in KEINER SiteRoute und kann damit in keine sitemap geraten', () => {
    expect(SITE_ROUTES.find((entry) => entry.href === PORTAL_ROOT_RENDER_PATH)).toBeUndefined()
  })
})

/*
 * ⚠ STOLPERDRAHT FÜR DIE ZWEITE SPRACHE. Der Rewrite in `middleware.ts` setzt das Locale-Präfix aus
 * `routing.defaultLocale`, statt es auszuhandeln — solange es genau EINE Locale gibt, ist das
 * dasselbe Ergebnis, das next-intl liefern würde. Kommt eine zweite dazu, ist das eine Entscheidung
 * und keine Kleinigkeit: Sie soll hier auffallen und nicht als „Portal spricht immer Deutsch" im
 * Betrieb.
 */
describe('die Abkürzung im Rewrite gilt nur für eine einzige Locale', () => {
  it('bricht laut, sobald eine zweite Sprache dazukommt', () => {
    expect(
      routing.locales.length,
      'Zweite Locale erkannt: der Rewrite der Portal-Host-Wurzel in middleware.ts nimmt routing.defaultLocale. Vor dem Erweitern von routing.locales entscheiden, wie die Locale dort ausgehandelt wird.',
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
  it('der Wächter über das Rewrite-Ziel steht VOR der 308-Weiche', () => {
    const middleware = stripComments(read('middleware.ts'))
    const guard = middleware.indexOf('isPortalRootRenderPath(')
    const rewrite = middleware.indexOf('isPortalHostRoot(')
    const weiche = middleware.indexOf('leavesPortalHost(')

    expect(guard, 'middleware.ts ruft isPortalRootRenderPath nicht auf').toBeGreaterThan(-1)
    expect(rewrite, 'middleware.ts ruft isPortalHostRoot nicht auf').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(rewrite)
    expect(rewrite).toBeLessThan(weiche)
  })

  it('der Rewrite ist ein rewrite und kein redirect', () => {
    // Ein Redirect schriebe den internen Pfad in die Adresszeile — genau das ist ausgeschlossen.
    const middleware = stripComments(read('middleware.ts'))
    const branch = middleware.slice(
      middleware.indexOf('isPortalHostRoot('),
      middleware.indexOf('leavesPortalHost('),
    )
    expect(branch).toMatch(/NextResponse\.rewrite\(/)
    expect(branch).not.toMatch(/NextResponse\.redirect\(/)
    // Und der Session-Refresh läuft auf GENAU dieser Response (die Komposition bleibt gewahrt).
    expect(branch).toMatch(/updateSession\(request, NextResponse\.rewrite\(/)
  })

  it('das Rewrite-Ziel liegt als echte Route auf der Platte und ist nirgends verlinkt', () => {
    const page = read(`app/(site)/[locale]${PORTAL_ROOT_RENDER_PATH}/page.tsx`)
    // Es rendert den geteilten Portalbereich — keine zweite Fassung davon.
    expect(stripComments(page)).toMatch(/PartnerPortalRoute/)
    // Und es trifft die noindex-Entscheidung nicht selbst, sondern erbt sie vom Portalbereich.
    expect(stripComments(page)).toMatch(/robotsFor\(PARTNER_PORTAL_HREF\)/)
  })

  it('beide Portal-Routen benutzen DIESELBE Fassung des Portalbereichs', () => {
    for (const file of [
      `app/(site)/[locale]${PORTAL_ROOT_RENDER_PATH}/page.tsx`,
      `app/(site)/[locale]${PARTNER_PORTAL_HREF}/page.tsx`,
    ]) {
      const source = stripComments(read(file))
      expect(source, file).toMatch(/from '@\/components\/partner-portal\/partner-portal-route'/)
      // Eine zweite, kopierte Fassung des Ablaufs würde auseinanderlaufen — sie ist hier
      // strukturell ausgeschlossen: keine der beiden Routen liest die Sitzung selbst.
      expect(source, file).not.toMatch(/getUser\(/)
      expect(source, file).not.toMatch(/get_my_partner/)
    }
  })

  /*
   * Das Rücksprungziel auf dem Portal-Host ist `/` — nicht `/partner-portal`. Ein Portal-Pfad im
   * `next`-Parameter wäre genau die Sichtbarkeit, die dieser Schritt beseitigt; und sie entstünde
   * still, weil die Anmeldung trotzdem funktionierte.
   */
  it('die Wurzel schickt zur Anmeldung mit dem Ziel „/", die Bestandsroute mit ihrem eigenen', () => {
    const root = stripComments(read(`app/(site)/[locale]${PORTAL_ROOT_RENDER_PATH}/page.tsx`))
    expect(root).toMatch(/signInNext=\{PORTAL_HOST_ROOT\}/)
    expect(root).not.toMatch(/signInNext=\{PARTNER_PORTAL_HREF\}/)

    const bestand = stripComments(read(`app/(site)/[locale]${PARTNER_PORTAL_HREF}/page.tsx`))
    expect(bestand).toMatch(/signInNext=\{PARTNER_PORTAL_HREF\}/)
  })
})
