import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routing } from '@/i18n/routing'
import {
  ACCESS_AREA_PATHS,
  ACCESS_HOST,
  ACCESS_HOST_PATHS,
  ACCESS_HOST_ROOT,
  ACCESS_RENDER_ROOT,
  accessRenderPath,
  isAccessHost,
  isAccessHostRequest,
  isAccessPath,
  isAccessRenderPath,
  leavesAccessHost,
} from './access-host'
import { PORTAL_HOST, PORTAL_RENDER_ROOT } from './portal-host'
import { SITE_ROUTES } from './routes'

/**
 * Die Host-Weiche der Zugangsplattform (Baustein 1, `lib/access-host.ts`).
 *
 * ── DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST ─────────────────────────────────────────────
 * Ein Lauf gegen `access.coolin.at` und `coolin.at` beweist, dass die Weiche auf DIESEN BEIDEN Hosts
 * das Richtige tut. Er sagt nichts über den dritten Fall — und genau dort sitzt die Gefahr: Fiele der
 * Vergleich auf einen zu weiten Ausdruck zurück („alles, was nicht die Hauptdomain ist"), blieben
 * beide gemessenen Hosts grün, während jede Preview (`*.vercel.app`) und jede lokale Entwicklung
 * (`localhost:<port>`) zur Plattform-Domain würde: Die Startseite einer Preview leitete dann auf die
 * Produktivdomain um, und beim Testen der Plattform-Route fiele es nicht auf, weil die ja bleiben
 * soll. Deshalb steht der preview-artige dritte Host hier als eigener Fall.
 *
 * Dieselbe Haltung wie `lib/portal-host.test.ts` und die Quelltextprüfung in `lib/admin/guard.test.ts`:
 * Was ein Laufzeittest strukturell nicht sehen kann, wird am Quelltext festgehalten.
 */

const read = (...segments: string[]): string =>
  fs.readFileSync(path.resolve(import.meta.dirname, '..', ...segments), 'utf8')

/** Kommentare weg, sonst wertete der Wächter das ERKLÄREN der Regel als Verstoss (B11-Falle). */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/* ─── Der Host ───────────────────────────────────────────────────────────────────────────────── */

describe('isAccessHost erkennt ausschliesslich die Zugangsplattform-Subdomain', () => {
  it('erkennt den Plattform-Host', () => {
    expect(isAccessHost(ACCESS_HOST)).toBe(true)
  })

  it('erkennt ihn unabhängig von Schreibweise, Port und FQDN-Punkt', () => {
    // Alle bezeichnen denselben Host. Ohne Normalisierung wäre jede dieser Formen ein NICHT
    // erkannter Plattform-Host — und damit wieder eine vollständige Zweitdomain.
    for (const host of [
      'ACCESS.COOLIN.AT',
      'Access.Coolin.at',
      'access.coolin.at:443',
      'access.coolin.at.',
      ' access.coolin.at ',
    ]) {
      expect(isAccessHost(host), host).toBe(true)
    }
  })

  /*
   * ⚠ DER FALL, DEN EIN LAUF GEGEN DIE ZWEI ECHTEN HOSTS NICHT ABDECKT. Ein zu weiter Vergleich
   * machte jede Preview und jede lokale Entwicklung zur Plattform-Domain, s. Kopf dieser Datei.
   */
  it('erkennt weder Hauptdomain noch Preview noch localhost als Plattform-Host', () => {
    for (const host of [
      'coolin.at',
      'www.coolin.at',
      'localhost:3000',
      'peak-shaving-web.vercel.app',
      'peak-shaving-web-git-main-team.vercel.app',
      '',
      null,
      undefined,
    ]) {
      expect(isAccessHost(host), String(host)).toBe(false)
    }
  })

  /*
   * ⚠ DIE ZWEI SUBDOMAINS DÜRFEN SICH NICHT ÜBERSCHNEIDEN. Beide Weichen laufen in derselben
   * Middleware hintereinander; erkennte eine den Host der anderen, bekäme ein Nutzer den falschen
   * Produktbereich — und zwar unter der richtigen Adresse, also ohne dass irgendetwas nach einem
   * Fehler aussieht.
   */
  it('Plattform-Host und Portal-Host sind verschieden und schliessen sich gegenseitig aus', () => {
    expect(ACCESS_HOST).not.toBe(PORTAL_HOST)
    expect(isAccessHost(PORTAL_HOST)).toBe(false)
  })

  it('ein Präfix- oder Suffix-Nachbar ist NICHT der Plattform-Host', () => {
    // Ein naives `includes`/`endsWith` liesse genau diese Formen durchgehen.
    for (const host of [
      'access.coolin.at.evil.example',
      'xaccess.coolin.at',
      'access.coolin.att',
    ]) {
      expect(isAccessHost(host), host).toBe(false)
    }
  })
})

describe('isAccessHostRequest liest host UND x-forwarded-host', () => {
  const headersOf = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  })

  it('erkennt den Host aus der gewöhnlichen host-Kopfzeile', () => {
    expect(isAccessHostRequest(headersOf({ host: ACCESS_HOST }))).toBe(true)
  })

  /*
   * ⚠ DER GEMESSENE FALL (B18-1a-Nachbesserung, `lib/host-match.ts`): Nach einer
   * Server-Action-Weiterleitung rendert Next das Ziel in derselben Antwort und schickt die Middleware
   * eine INTERNE Anfrage, deren `host` den Server selbst trägt und deren `x-forwarded-host` den
   * echten Host. Ohne die zweite Kopfzeile sähe ein Nutzer unmittelbar nach dem Anmelden die
   * Marketing-Startseite statt seines Bereichs — ein Fehler, den kein Statuscode zeigt.
   */
  it('erkennt den Host, wenn nur x-forwarded-host ihn trägt', () => {
    expect(
      isAccessHostRequest(headersOf({ host: 'localhost:3990', 'x-forwarded-host': ACCESS_HOST })),
    ).toBe(true)
  })

  it('erkennt ihn nicht, wenn keine der beiden Kopfzeilen ihn trägt', () => {
    expect(isAccessHostRequest(headersOf({ host: 'coolin.at' }))).toBe(false)
    expect(isAccessHostRequest(headersOf({}))).toBe(false)
    expect(
      isAccessHostRequest(headersOf({ host: PORTAL_HOST, 'x-forwarded-host': PORTAL_HOST })),
    ).toBe(false)
  })
})

/* ─── Die Pfade ──────────────────────────────────────────────────────────────────────────────── */

describe('accessRenderPath bildet die Adressen EXAKT auf den internen Baum ab', () => {
  it('bildet die Wurzel auf den Render-Baum ab', () => {
    expect(accessRenderPath(ACCESS_HOST_ROOT)).toBe(ACCESS_RENDER_ROOT)
  })

  it('bildet ausschliesslich die Bereichspfade ab', () => {
    for (const pathname of ['/leistungen', '/anmelden', '/de', '/marketing', '//', '/kontakt']) {
      expect(accessRenderPath(pathname), pathname).toBeNull()
    }
  })

  /**
   * Jede Adresse des Bereichs hat eine Datei, und jede Datei liegt an ihrer Adresse. Ohne die zweite
   * Richtung wäre ein umbenannter Ordner eine Adresse, die auf eine 404 zeigt — der Build bliebe grün.
   */
  it('zu jeder Adresse des Bereichs gibt es eine Seite unter dem Render-Baum', () => {
    expect(ACCESS_AREA_PATHS.length).toBeGreaterThan(0)
    for (const area of ACCESS_AREA_PATHS) {
      const renderPath = accessRenderPath(area)
      expect(renderPath, area).toBeTruthy()
      const file = path.resolve(
        import.meta.dirname,
        '..',
        'app',
        `${renderPath!.slice(1)}/page.tsx`,
      )
      expect(fs.existsSync(file), `${area} → ${file}`).toBe(true)
    }
  })
})

describe('isAccessPath gilt für die Bereichspfade und AUSSCHLIESSLICH exakt', () => {
  it('die Wurzel gehört dazu', () => {
    expect(isAccessPath(ACCESS_HOST_ROOT)).toBe(true)
    // Die präfixte Fassung der Default-Locale ebenfalls — sonst würde `/de` weggeleitet, bevor
    // next-intl es auf `/` umleiten kann.
    expect(isAccessPath(`/${routing.defaultLocale}`)).toBe(true)
  })

  /*
   * ⚠ DIE HARTE ANFORDERUNG. Wäre `/` ein PRÄFIX-Treffer, hiesse das „alles" — die Weiche wäre
   * wirkungslos, und niemandem fiele es auf, weil jeder einzelne Pfad weiterhin funktioniert. `//`
   * ist dabei nicht theoretisch: `//admin` ist eine gültige Anfrage-Adresse.
   */
  it('die Wurzel gilt NICHT als Präfix für beliebige Pfade', () => {
    for (const pathname of ['/leistungen', '/admin', '//admin', '/kontakt', '//', '/anmelden']) {
      expect(isAccessPath(pathname), pathname).toBe(false)
    }
  })

  /*
   * ⚠ DIE AUTH-ROUTEN GEHÖREN HEUTE BEWUSST NICHT DAZU (dieser Baustein baut keine Auth). Der Test
   * hält den Zustand fest, damit er eine ENTSCHEIDUNG bleibt und nicht ein Zufall: Wer die Anmeldung
   * baut, sieht hier, dass er `ACCESS_HOST_PATHS` erweitern muss — sonst führt der 308 den Nutzer
   * mitten im Anmeldevorgang auf die Hauptdomain, wo die Auth-Cookies auf der falschen Herkunft
   * entstehen. Die Begründung samt `sanitizeNext` steht bei `ACCESS_HOST_PATHS`.
   */
  it('die Auth-Routen liegen noch NICHT auf diesem Host — bewusst, s. ACCESS_HOST_PATHS', () => {
    expect(ACCESS_HOST_PATHS).toEqual([...ACCESS_AREA_PATHS])
    for (const pathname of ['/anmelden', '/konto', '/registrieren']) {
      expect(isAccessPath(pathname), pathname).toBe(false)
    }
  })
})

describe('der Render-Baum ist von aussen kein Bereichspfad', () => {
  it('er steht in keiner Liste des Hosts', () => {
    expect(ACCESS_HOST_PATHS).not.toContain(ACCESS_RENDER_ROOT)
    expect(ACCESS_AREA_PATHS).not.toContain(ACCESS_RENDER_ROOT)
    expect(isAccessPath(ACCESS_RENDER_ROOT)).toBe(false)
  })

  it('isAccessRenderPath trifft den Baum, seine Locale-Fassung und alles darunter', () => {
    for (const pathname of [
      ACCESS_RENDER_ROOT,
      `${ACCESS_RENDER_ROOT}/`,
      `${ACCESS_RENDER_ROOT}/tiefer`,
      `/${routing.defaultLocale}${ACCESS_RENDER_ROOT}`,
      `/${routing.defaultLocale}${ACCESS_RENDER_ROOT}/tiefer`,
    ]) {
      expect(isAccessRenderPath(pathname), pathname).toBe(true)
    }
  })

  it('ein Namensverwandter ist NICHT der Render-Baum', () => {
    // `/access-fremd` soll die gewöhnliche 404 der Anwendung bekommen, keine Sonderbehandlung.
    for (const pathname of [`${ACCESS_RENDER_ROOT}-fremd`, '/access-host', '/', '/leistungen']) {
      expect(isAccessRenderPath(pathname), pathname).toBe(false)
    }
  })

  /*
   * ⚠ DIE ZWEI RENDER-BÄUME DÜRFEN SICH NICHT ÜBERSCHNEIDEN — sonst beantwortete der eine Wächter
   * Aufrufe des anderen und einer der beiden Rewrites liefe in eine 404.
   */
  it('der Render-Baum überschneidet sich nicht mit dem des Portalbereichs', () => {
    expect(ACCESS_RENDER_ROOT).not.toBe(PORTAL_RENDER_ROOT)
    expect(isAccessRenderPath(PORTAL_RENDER_ROOT)).toBe(false)
  })

  /*
   * ⚠ ER KANN IN KEINE SITEMAP GERATEN, und das ist eine Eigenschaft der ABLAGE, nicht der Disziplin:
   * `assertRoutesMatchDisk` (`lib/routes.ts`) liest ausschliesslich `app/(site)/[locale]/`, und dort
   * liegt der Baum nicht. Zöge ihn jemand dorthin, wäre er still in der sitemap — mit dem
   * Middleware-Wächter davor also eine Adresse, die Google angeboten wird und 404 antwortet.
   */
  it('keine SiteRoute führt den Render-Baum oder eine Adresse dieses Hosts', () => {
    const hrefs = SITE_ROUTES.map((route) => route.href)
    expect(hrefs).not.toContain(ACCESS_RENDER_ROOT)
    for (const area of ACCESS_AREA_PATHS) {
      // Die Wurzel `/` IST eine echte SiteRoute (die Marketing-Startseite) — sie gehört dort hin.
      // Geprüft wird deshalb nur, dass keine Adresse dieses Hosts eine EIGENE Route erzeugt hat.
      if (area === '/') continue
      expect(hrefs, area).not.toContain(area)
    }
  })
})

describe('leavesAccessHost ist wahr für alles, was nicht zur Plattform gehört', () => {
  const headersOf = (host: string) => ({
    get: (name: string) => (name.toLowerCase() === 'host' ? host : null),
  })

  it('leitet die Website-Pfade vom Plattform-Host weg', () => {
    for (const pathname of ['/leistungen', '/kontakt', '/admin', '/anmelden', '/partner-werden']) {
      expect(leavesAccessHost(headersOf(ACCESS_HOST), pathname), pathname).toBe(true)
    }
  })

  it('lässt die Plattform selbst auf ihrem Host', () => {
    expect(leavesAccessHost(headersOf(ACCESS_HOST), ACCESS_HOST_ROOT)).toBe(false)
  })

  it('greift auf keinem anderen Host', () => {
    for (const host of ['coolin.at', 'www.coolin.at', PORTAL_HOST, 'localhost:3000']) {
      expect(leavesAccessHost(headersOf(host), '/leistungen'), host).toBe(false)
    }
  })
})

/* ─── Der Stolperdraht für eine zweite Sprache ───────────────────────────────────────────────── */

/*
 * Der Rewrite bildet die Adressen ohne Locale-Behandlung ab und rendert unter `defaultLocale` —
 * richtig, solange es genau eine Sprache gibt. `/en/` würde bei `as-needed` NICHT auf `/` umgeleitet
 * und liefe an der Abbildung vorbei: Die Anfrage bliebe auf dem Host und endete in der 404 der
 * Anwendung. Dieselbe Bedingung wie in `lib/portal-host.test.ts`, für diesen Baum eigens gepinnt.
 */
describe('die Abkürzung im Rewrite gilt nur für eine einzige Locale', () => {
  it('bricht laut, sobald eine zweite Sprache dazukommt', () => {
    expect(
      routing.locales.length,
      'Zweite Locale erkannt: die Zugangsplattform (middleware.ts, accessRenderPath, app/access/layout.tsx) bildet ihre Adressen ohne Locale-Behandlung ab und rendert unter routing.defaultLocale. Vor dem Erweitern von routing.locales entscheiden, welche Sprache ein angemeldeter Bereich zeigt und wie /<locale>/ auf diesem Host behandelt wird.',
    ).toBe(1)
  })
})

/* ─── Die Lücke, die ein Laufzeittest nicht schliesst ────────────────────────────────────────── */

/*
 * ⚠ Der Host-Vergleich wirkt nur, wenn die Middleware ihn auch benutzt. Schriebe jemand dort einen
 * eigenen Vergleich (oder einen weiteren daneben), bliebe hier alles grün: Diese Datei prüft die
 * Ableitung, nicht ihren Aufrufer.
 */
describe('die Ableitung hat genau einen Fundort und einen Aufrufer', () => {
  it('die Middleware ruft die benannten Ableitungen auf', () => {
    const middleware = stripComments(read('middleware.ts'))
    expect(middleware).toMatch(/from '\.\/lib\/access-host'/)
    expect(middleware).toMatch(/leavesAccessHost\(/)
    expect(middleware).toMatch(/accessRenderPath\(/)
    expect(middleware).toMatch(/isAccessRenderPath\(/)
  })

  it('die Middleware baut das Ziel aus SITE_URL, nicht aus einem zweiten getippten Host', () => {
    const middleware = stripComments(read('middleware.ts'))
    expect(middleware).toMatch(/from '\.\/lib\/site'/)
    expect(middleware).toMatch(/SITE_URL/)
  })

  it('der Hostname steht nirgends sonst im Quelltext', () => {
    for (const file of [
      'middleware.ts',
      'app/robots.ts',
      'lib/site.ts',
      'lib/routes.ts',
      'lib/host-match.ts',
      'lib/portal-host.ts',
    ]) {
      expect(stripComments(read(file)), file).not.toContain(ACCESS_HOST)
    }
    expect(stripComments(read('lib/access-host.ts'))).toContain(ACCESS_HOST)
  })

  it('robots.ts entscheidet über dieselbe Ableitung', () => {
    const robots = stripComments(read('app/robots.ts'))
    expect(robots).toMatch(/from '@\/lib\/access-host'/)
    expect(robots).toMatch(/isAccessHost\(/)
  })

  /*
   * ⚠ DIE UNERREICHBARKEIT DES REWRITE-ZIELS IST EINE EIGENSCHAFT DER REIHENFOLGE, und die sieht ein
   * Laufzeittest strukturell nicht. Rutschte der Wächter unter die 308-Weiche, bliebe hier alles grün
   * — der interne Pfad stünde dann auf dem Plattform-Host in einem Location-Header nach coolin.at
   * und würde dort gerendert.
   */
  it('der Wächter über den Render-Baum steht VOR Rewrite und 308-Weiche', () => {
    const middleware = stripComments(read('middleware.ts'))
    const guard = middleware.indexOf('isAccessRenderPath(')
    const rewrite = middleware.indexOf('accessRenderPath(')
    const weiche = middleware.indexOf('leavesAccessHost(')

    expect(guard, 'middleware.ts ruft isAccessRenderPath nicht auf').toBeGreaterThan(-1)
    expect(rewrite, 'middleware.ts ruft accessRenderPath nicht auf').toBeGreaterThan(-1)
    expect(weiche, 'middleware.ts ruft leavesAccessHost nicht auf').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(rewrite)
    expect(rewrite).toBeLessThan(weiche)
  })

  it('der Rewrite ist ein rewrite und kein redirect', () => {
    // Ein Redirect schriebe den internen Pfad in die Adresszeile — genau das ist ausgeschlossen.
    const middleware = stripComments(read('middleware.ts'))
    const rewrite = middleware.indexOf('accessRenderPath(')
    /*
     * Ende ist die ERSTE Weiche nach dem Rewrite, nicht `leavesAccessHost` — zwischen den beiden
     * liegt die 308-Weiche des Portal-Hosts, und die trägt naturgemäss ein `redirect`. Ein bis
     * dorthin reichender Ausschnitt prüfte also den fremden Zweig mit.
     */
    const branch = middleware.slice(rewrite, middleware.indexOf('leaves', rewrite))
    expect(branch).toMatch(/NextResponse\.rewrite\(/)
    expect(branch).not.toMatch(/NextResponse\.redirect\(/)
    // Und der Session-Refresh läuft auf GENAU dieser Response (die Komposition bleibt gewahrt).
    expect(branch).toMatch(/updateSession\(request, NextResponse\.rewrite\(/)
  })
})

/* ─── Die Trennung von der Website (Pflichtenheft §8) ────────────────────────────────────────── */

/*
 * §8 verlangt ein „klar abgegrenztes Modul/Route-Gruppe, nicht mit Website-Marketing-Code
 * vermischt". Das ist hier keine Konvention, sondern messbar — und genau deshalb steht es als Test:
 * Ein späterer Griff nach einer Marketing-Komponente („den Header haben wir doch schon") wäre in
 * keinem Build und in keinem Laufzeittest sichtbar, würde aber genau die Trennung aufheben, um die
 * es geht: Der öffentliche Header verlinkt die gesamte Website, und seine Links verlassen diesen Host.
 */
describe('der Bereich ist von den Website-Marketing-Pfaden getrennt', () => {
  const accessFiles = (): string[] => {
    const files: string[] = []
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) files.push(full)
      }
    }
    walk(path.resolve(import.meta.dirname, '..', 'app', ACCESS_RENDER_ROOT.slice(1)))
    walk(path.resolve(import.meta.dirname, '..', 'components', 'access'))
    return files
  }

  it('der Render-Baum liegt unter app/access/ und nicht in der Sprach-Struktur', () => {
    const dir = path.resolve(import.meta.dirname, '..', 'app', ACCESS_RENDER_ROOT.slice(1))
    expect(fs.existsSync(path.join(dir, 'layout.tsx')), 'app/access/layout.tsx fehlt').toBe(true)
    expect(fs.existsSync(path.join(dir, 'page.tsx')), 'app/access/page.tsx fehlt').toBe(true)
    expect(
      fs.existsSync(path.resolve(import.meta.dirname, '..', 'app', '(site)', '[locale]', 'access')),
      'die Zugangsplattform darf nicht in der Sprach-Struktur liegen',
    ).toBe(false)
  })

  it('keine Datei des Bereichs zieht Website-Layout oder Marketing-Komponenten herein', () => {
    const offenders: string[] = []
    for (const file of accessFiles()) {
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      for (const forbidden of [
        '@/components/layout/',
        '@/components/home/',
        '@/components/leistung/',
        '@/components/branche/',
        '@/components/wissen/',
        '@/components/peak-shaving/',
        '@/components/kontakt/',
      ]) {
        if (source.includes(forbidden)) offenders.push(`${path.basename(file)}: ${forbidden}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /*
   * Umgekehrte Richtung: Der Rahmen der Plattform wird ausschliesslich aus ihrem eigenen Baum heraus
   * gerendert. Ihn auf einer Website-Route zu zeigen verlangte eine Host-Prüfung im
   * `(site)/[locale]`-Layout — genau das Muster, das B18-2 entfernt hat, weil es die gesamte Website
   * dynamisch rendert (35 vorgerenderte Seiten wären wieder 6).
   */
  it('der Rahmen wird ausschliesslich aus dem Bereich heraus gerendert', () => {
    const consumers: string[] = []
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          const source = stripComments(fs.readFileSync(full, 'utf8'))
          if (/from '(@\/components\/access\/shell|\.\/shell)'/.test(source)) consumers.push(full)
        }
      }
    }
    const appDir = path.resolve(import.meta.dirname, '..', 'app')
    walk(appDir)
    walk(path.resolve(import.meta.dirname, '..', 'components'))

    expect(consumers.map((file) => path.relative(appDir, file)).sort()).toEqual(['access/page.tsx'])
  })

  /*
   * ⚠ KEIN `next`-PARAMETER ZEIGT AUF DEN RENDER-BAUM. Ein Rücksprungziel ist die Adresse AUF DEM
   * PLATTFORM-HOST; ein Render-Pfad dort führte nach dem Anmelden in den 404-Wächter — und zwar
   * still, weil die Anmeldung selbst funktionierte. Geprüft über den GESAMTEN Quellbaum, nicht nur
   * an den bekannten Stellen, weil der Fehler beim Bau von Baustein 6.1 entsteht und nicht hier.
   */
  it('kein next-Parameter im Repo zeigt auf den Render-Baum', () => {
    const offenders: string[] = []
    const check = (file: string) => {
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/NEXT_PARAM\]:\s*([A-Za-z_.]+)/g)) {
        if (/RENDER/.test(match[1] ?? '')) offenders.push(`${file}: ${match[0]}`)
      }
      if (source.includes(`next=${ACCESS_RENDER_ROOT}`)) offenders.push(`${file}: next=`)
    }
    const walk = (current: string) => {
      const stat = fs.statSync(current)
      if (stat.isFile()) {
        if (/\.(tsx?|json)$/.test(current) && !current.endsWith('.test.ts')) check(current)
        return
      }
      for (const entry of fs.readdirSync(current)) walk(path.join(current, entry))
    }
    for (const root of ['app', 'components', 'lib', 'messages', 'middleware.ts']) {
      walk(path.resolve(import.meta.dirname, '..', root))
    }

    expect(offenders).toEqual([])
  })

  /*
   * ⚠ DIE SERVER-ONLY-AUFLAGE AUS §8, so weit sie heute prüfbar ist: Der Bereich hat noch keine
   * Geheimnisse — aber er darf auch keine in eine Client-Komponente ziehen. Ein `'use client'` in
   * diesem Baum ist deshalb heute ein Verstoss und muss, wenn er einmal nötig wird, eine BEWUSSTE
   * Entscheidung sein: RMS-Credentials und jede Freischaltungslogik dürfen nie im Client-Bundle
   * landen.
   */
  it('der Bereich hat keine Client-Komponente und liest keine Geheimnisse', () => {
    for (const file of accessFiles()) {
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      expect(source, file).not.toMatch(/['"]use client['"]/)
      expect(source, file).not.toMatch(/serverEnv|process\.env/)
    }
  })
})
