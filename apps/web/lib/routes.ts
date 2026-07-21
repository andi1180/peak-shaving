/**
 * Die REALEN Routen dieser Seite — Grundlage der sitemap (Pflichtenheft §6.4).
 *
 * WARUM ES DIESE DATEI GIBT UND NICHT EINE LISTE IN `app/sitemap.ts`: Eine
 * sitemap ist das Artefakt, das niemand ansieht. Fehlt darin eine Seite, oder
 * steht eine drin, die es nicht mehr gibt, merkt das niemand — bis das Ranking
 * fehlt oder Google 404er meldet. Dieselbe Sorte stiller Fehler, gegen die schon
 * `lib/site.ts` (ungültige Basis-URL) und `lib/wissen.ts` (unvollständiges
 * Frontmatter) LAUT brechen. Also bricht auch das hier laut: `assertRoutesMatchDisk()`
 * vergleicht diese Liste beim Bauen mit dem, was wirklich unter
 * `app/(site)/[locale]/` liegt.
 *
 * WAS ABGELEITET IST, WIRD ABGELEITET: Die meisten Routen stehen bereits in
 * `lib/nav.ts` (der IA, §4.1) — sie werden von dort gelesen, nicht abgetippt.
 * Nur die Seiten, die in keinem Menü stehen (Startseite, Footer-Seiten,
 * Rechtstexte), sind hier explizit; sie haben sonst keinen Fundort.
 *
 * INDEXIERBARKEIT STEHT HIER, weil sie sonst zweimal stünde: Die
 * `noindex`-Entscheidung der rechner-Hülle wurde in 13a in ihrer
 * `generateMetadata` getroffen. Stünde sie dort UND hier, könnte die sitemap eine
 * Seite listen, die sich selbst auf `noindex` stellt — ein widersprüchliches
 * Signal an Google. Deshalb liest jetzt umgekehrt die Seite von hier
 * (`robotsFor`), und es gibt genau einen Fundort.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Metadata } from 'next'
import { MAIN_NAV, KONTAKT_HREF, LOGIN_HREF, CALCULATOR_RUN_HREF, MONITOR_GRATIS_CHECK_HREF } from './nav'
import { WISSEN_HREF } from './wissen'
import { AUTH_HREFS } from './auth/config'
import { LEAD_HREFS } from './leads/config'

export type SiteRoute = {
  /** Der Pfad OHNE Locale-Präfix — dasselbe, was `Link`/`pageAlternates` bekommen. */
  href: string
  /**
   * Soll die Seite in den Index? `false` heißt: kein sitemap-Eintrag UND ein
   * `noindex` auf der Seite selbst (s. `robotsFor`) — die beiden können nicht
   * mehr auseinanderlaufen.
   */
  indexable: boolean
}

/**
 * Routen, die in KEINEM Menü stehen und deshalb keinen anderen Fundort haben.
 *
 * Die Startseite ist keine Nav-Zeile (sie IST das Logo), Referenzen/Produkte
 * hängen nur im Footer, Impressum/Datenschutz nur in der Fußzeile. Alles andere
 * kommt unten aus `MAIN_NAV`.
 */
const UNLISTED_HREFS = [
  '/',
  '/produkte',
  '/referenzen',
  '/impressum',
  '/datenschutz',
  KONTAKT_HREF,
  LOGIN_HREF,
] as const

/** Alle Pfade aus der Hauptnavigation: Top-Level + Mega-Menü + flache Listen. */
function navHrefs(): string[] {
  return MAIN_NAV.flatMap((item) => [
    item.href,
    ...(item.groups ?? []).flatMap((group) => group.items.map((leaf) => leaf.href)),
    ...(item.items ?? []).map((leaf) => leaf.href),
  ])
}

/**
 * Seiten OHNE echten Inhalt — reiner `PagePlaceholder` („Inhalt folgt"), noch
 * nicht gebaut (SEO-Nacharbeit, Prompt 13c/§6.4). Sie standen bis hierhin in der
 * sitemap, obwohl sie nichts zum Finden anbieten: eine dünne Seite aktiv zum
 * Indexieren vorzuschlagen, ist nicht gratis — sie kann echten Content derselben
 * Seite im Ranking verdünnen, ohne selbst je Sucher zu bedienen.
 *
 * ZURÜCKSTELLEN, SOBALD ECHTER INHALT DA IST: Diese Zeile hier löschen. Mehr
 * nicht — `SITE_ROUTES` fällt dann auf den Default `indexable: true` zurück,
 * die sitemap nimmt die Seite automatisch wieder auf, und ihr `robots`-Tag
 * (kommt aus `robotsFor`, s. u.) verschwindet mit. Kein zweiter Ort zum Ändern.
 */
const PLACEHOLDER_HREFS = ['/produkte', '/referenzen', '/impressum', LOGIN_HREF]

/**
 * Monitor-Gratis-Check (T3, `Pflichtenheft_Monitor_MVP.md` §6) — WIP-Datenpipe-
 * Beweis (Server-Fetch → Client-Engine → Ergebnis). Noch keine Produktseite,
 * keine Nav-Verlinkung (kommt in der Website-Session, §4.2) — bis dahin
 * `noindex`, aus demselben Grund wie `CALCULATOR_RUN_HREF` unten: eine
 * dünne/experimentelle Seite ohne kuratierten Content soll nicht indexiert
 * werden, bevor sie eine ist.
 *
 * Der Pfad selbst lebt in `lib/nav.ts` (IA, client-safe, oben importiert) — hier
 * nur re-exportiert, damit bestehende `from '@/lib/routes'`-Importe unverändert bleiben.
 */
export { MONITOR_GRATIS_CHECK_HREF }

/**
 * Die statischen Routen der Seite. `/wissen/<slug>` fehlt hier bewusst: Artikel
 * sind eine Collection und kommen aus `lib/wissen.ts` — sie stehen in keiner
 * Liste, sonst wäre jeder neue Artikel wieder eine Code-Änderung (§10.1).
 */
/**
 * Konto-/Auth-Routen (T4-2, J7): Registrierung, Login, Passwort-Reset, Kontoseite. Alle `noindex`
 * — Suchmaschinen haben auf einem Login-Formular oder einer Kontoseite nichts zu suchen. `/login`
 * (englischer Alt-Slug, leitet auf `/anmelden` um) bleibt separat über PLACEHOLDER_HREFS noindex.
 */
const AUTH_HREF_SET: ReadonlySet<string> = new Set(AUTH_HREFS)

/**
 * Lead-Routen (B1-2, J7): Bestätigungsseite des Double-Opt-in und Abmeldeseite. Beide `noindex` aus
 * demselben Grund wie die Auth-Routen, nur schärfer: ihre URL trägt einen persönlichen Token bzw.
 * eine signierte Lead-ID. Eine indexierte Bestätigungsseite hiesse, genau diese Adressen in einen
 * öffentlichen Index zu geben.
 */
const LEAD_HREF_SET: ReadonlySet<string> = new Set(LEAD_HREFS)

export const SITE_ROUTES: SiteRoute[] = Array.from(
  new Set<string>([
    ...UNLISTED_HREFS,
    ...navHrefs(),
    CALCULATOR_RUN_HREF,
    MONITOR_GRATIS_CHECK_HREF,
    ...AUTH_HREFS,
    ...LEAD_HREFS,
  ]),
).map((href) => ({
  href,
  /*
   * Drei UNABHÄNGIGE Gründe für `noindex` unter `(site)`:
   *
   *   – Die rechner-Hülle (13a): Ihr crawlbarer Inhalt ist eine leere Hülle —
   *     der Rechner steckt im iframe und zählt für Google nicht als Inhalt
   *     DIESER Seite. Indexiert konkurrierte sie mit der Produktseite, die den
   *     Content wirklich trägt (§6.2).
   *   – Die Platzhalter-Seiten (13c, `PLACEHOLDER_HREFS` oben): Sie haben noch
   *     gar keinen Inhalt, den man indexieren könnte.
   *   – Der Monitor-Gratis-Check (T3, `MONITOR_GRATIS_CHECK_HREF` oben): WIP-
   *     Datenpipe-Beweis ohne kuratierten Content/Produktseite drumherum.
   *   – Die Lead-Routen (B1-2, `LEAD_HREF_SET` oben): persönliche Einmal-Adressen
   *     aus einer E-Mail, deren Query einen Token bzw. eine signierte Lead-ID trägt.
   *
   * `/styleguide` ist ebenfalls `noindex`, steht aber nicht in dieser Liste: Es
   * liegt in der Route-Group `(dev)` mit eigenem Root-Layout, also außerhalb der
   * Struktur, die hier geprüft wird — und damit von sich aus außerhalb der sitemap.
   */
  indexable:
    href !== CALCULATOR_RUN_HREF &&
    href !== MONITOR_GRATIS_CHECK_HREF &&
    !AUTH_HREF_SET.has(href) &&
    !LEAD_HREF_SET.has(href) &&
    !PLACEHOLDER_HREFS.includes(href),
}))

/**
 * Das `robots`-Metadatum einer Route — die Umkehrung von `indexable`.
 *
 * Gibt `undefined` zurück, wo nichts zu sagen ist: Eine indexierbare Seite
 * braucht KEIN `index, follow`, das ist der Default. Ein überflüssiges
 * `robots`-Tag auf jeder Seite wäre Rauschen, das nur so aussieht, als hätte es
 * jemand entschieden.
 *
 * `follow` bleibt bei `noindex` erhalten: Die Seite soll nicht in den Index, ihre
 * Links sollen aber weiter zählen.
 */
export function robotsFor(href: string): Metadata['robots'] {
  const route = SITE_ROUTES.find((r) => r.href === href)
  if (!route) throw new Error(`Route "${href}" fehlt in SITE_ROUTES (lib/routes.ts)`)
  return route.indexable ? undefined : { index: false, follow: true }
}

/* ─── Der Abgleich mit der Wirklichkeit ──────────────────────────────────── */

/** Wo die Seiten liegen. Route-Groups (`(site)`) tauchen in keiner URL auf. */
const PAGES_DIR = path.join(process.cwd(), 'app', '(site)', '[locale]')

/**
 * Dynamische Segmente, deren konkrete URLs aus einer DATENQUELLE kommen statt aus
 * `SITE_ROUTES`. Steht hier, damit der Abgleich unten sie nicht als „unbekannte
 * Route" meldet — und damit ein neues dynamisches Segment eine bewusste
 * Entscheidung bleibt und nicht still durchrutscht.
 */
const DYNAMIC_TEMPLATES = [`${WISSEN_HREF}/[slug]`]

/** Alle `page.tsx` unter `dir` als Routen-Pfade („/", „/wissen/[slug]", …). */
function walkPages(dir: string, prefix = ''): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...walkPages(path.join(dir, entry.name), `${prefix}/${entry.name}`))
    } else if (entry.name === 'page.tsx') {
      found.push(prefix === '' ? '/' : prefix)
    }
  }
  return found
}

/**
 * Vergleicht `SITE_ROUTES` mit den Seiten AUF DER PLATTE und wirft bei jeder
 * Abweichung — in beide Richtungen:
 *
 *   – Seite da, Eintrag fehlt  → sie fehlte still in der sitemap (unauffindbar).
 *   – Eintrag da, Seite fehlt  → die sitemap schickte Google auf einen 404.
 *
 * Läuft beim BAUEN (`app/sitemap.ts` wird vorgerendert), nicht im Request-Pfad.
 * Das Lesen des Quellbaums ist dabei dieselbe Technik, die `lib/wissen.ts` schon
 * für `content/wissen/` benutzt.
 */
export function assertRoutesMatchDisk(): void {
  const onDisk = new Set(walkPages(PAGES_DIR))
  for (const template of DYNAMIC_TEMPLATES) {
    if (!onDisk.delete(template)) {
      throw new Error(
        `lib/routes.ts: DYNAMIC_TEMPLATES nennt "${template}", aber unter app/(site)/[locale] liegt keine solche Route.`,
      )
    }
  }

  const declared = new Set(SITE_ROUTES.map((route) => route.href))

  const missing = [...onDisk].filter((href) => !declared.has(href))
  if (missing.length > 0) {
    throw new Error(
      `lib/routes.ts: Diese Seiten existieren, stehen aber in keiner Liste — sie fehlten damit still in der sitemap: ${missing
        .sort()
        .join(
          ', ',
        )}. Eintragen (via lib/nav.ts oder UNLISTED_HREFS) oder als DYNAMIC_TEMPLATES führen.`,
    )
  }

  const stale = [...declared].filter((href) => !onDisk.has(href))
  if (stale.length > 0) {
    throw new Error(
      `lib/routes.ts: SITE_ROUTES nennt Routen ohne Seite — die sitemap schickte Crawler auf einen 404: ${stale
        .sort()
        .join(', ')}.`,
    )
  }
}
