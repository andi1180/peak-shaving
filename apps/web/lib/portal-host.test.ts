import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTH_HREFS } from './auth/config'
import { PARTNER_PORTAL_HREF } from './partner-portal/config'
import {
  PORTAL_HOST,
  PORTAL_HOST_PATHS,
  isPortalHost,
  isPortalPath,
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
  it('führt genau das Portal und die Auth-Routen', () => {
    // Gepinnt, damit ein zusätzlicher Pfad eine BEWUSSTE Entscheidung bleibt: Was hier landet, ist
    // auf der Subdomain erreichbar und darf deshalb nichts Öffentliches sein.
    expect([...PORTAL_HOST_PATHS].sort()).toEqual(
      ['/anmelden', '/konto', '/partner-portal', '/passwort-neu', '/passwort-vergessen', '/registrieren'].sort(),
    )
    expect(PORTAL_HOST_PATHS).toContain(PARTNER_PORTAL_HREF)
    for (const href of AUTH_HREFS) expect(PORTAL_HOST_PATHS).toContain(href)
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
    expect(isPortalPath('/de')).toBe(false)
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
      '/',
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

describe('leavesPortalHost — nur Portal-Host UND Nicht-Portal-Pfad', () => {
  it('leitet nicht-portale Pfade auf dem Portal-Host weg', () => {
    for (const pathname of ['/', '/leistungen', '/admin/leads']) {
      expect(leavesPortalHost(PORTAL_HOST, pathname), pathname).toBe(true)
    }
  })

  it('lässt portale Pfade auf dem Portal-Host stehen', () => {
    for (const pathname of ['/partner-portal', '/anmelden', '/konto', '/de/anmelden']) {
      expect(leavesPortalHost(PORTAL_HOST, pathname), pathname).toBe(false)
    }
  })

  it('fasst die Hauptdomain, localhost und Previews auf KEINEM Pfad an', () => {
    for (const host of ['coolin.at', 'www.coolin.at', 'localhost:3000', 'peak-shaving-web.vercel.app']) {
      for (const pathname of ['/', '/leistungen', '/admin/leads', '/partner-portal', '/anmelden']) {
        expect(leavesPortalHost(host, pathname), `${host}${pathname}`).toBe(false)
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
    for (const pathname of PORTAL_HOST_PATHS) {
      const route = SITE_ROUTES.find((entry) => entry.href === pathname)
      expect(route, `${pathname} fehlt in SITE_ROUTES`).toBeDefined()
      expect(route?.indexable, pathname).toBe(false)
    }
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
})
