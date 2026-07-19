import * as React from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { EmblemImage } from '@/components/brand/emblem-image'
import { WordmarkA } from '@/components/brand/wordmark'
import { MAIN_NAV, CTA_HREF, KONTAKT_HREF } from '@/lib/nav'
import { ANMELDEN_HREF, KONTO_HREF } from '@/lib/auth/config'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { MobileNav } from './mobile-nav'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navItemStyle,
} from '@/components/ui/navigation-menu'

/**
 * WORTMARKE IM HEADER — Variante A („Kompakt").
 *
 * Begründung: bei Nav-Höhe (~20–28 px) ist A die einzige Variante, die trägt.
 * B trägt einen Halo-Ring um den Knoten, der bei dieser Größe zu einem
 * unscharfen Fleck verläuft; C stapelt „ENERGY" gesperrt unter „COOLiN" und
 * wird dort unleserlich. As satter Punkt bleibt der Teal-Knoten in A auch bei
 * 20 px klar als Knoten lesbar — genau die Klammer zum Emblem.
 *
 * Ein Wechsel ist EINE Zeile: Import + diese Konstante.
 */
const HeaderWordmark = WordmarkA

/** Ein Eintrag im aufgeklappten Menü. */
function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <NavigationMenuLink asChild>
      <Link
        href={href}
        className={cn(
          'block rounded-md px-3 py-2 text-small text-text transition-colors',
          'hover:bg-surface-sunken hover:text-accent',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {label}
      </Link>
    </NavigationMenuLink>
  )
}

export async function SiteHeader() {
  const t = await getTranslations('Nav')

  /*
   * Session serverseitig lesen (T4 Nav-Verlinkung): der Login-Platz zeigt
   * eingeloggt „Mein Konto" (→ /konto), sonst „Login" (→ /anmelden). Server-
   * seitig ermittelt = flackerfrei, kein Client-Roundtrip.
   *
   * PREIS: `getUser()` liest die Auth-Cookies → die (site)-Seiten werden dadurch
   * dynamisch statt statisch gerendert (bewusst, s. PR-Bericht). Der eigentliche
   * Token-Refresh läuft ohnehin schon je Request in der Middleware
   * (lib/supabase/middleware) — diese RSC liest nur.
   */
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isLoggedIn = user !== null
  const accountHref = isLoggedIn ? KONTO_HREF : ANMELDEN_HREF
  const accountLabel = isLoggedIn ? t('konto') : t('login')

  return (
    /*
     * sticky: die Nav bleibt beim Scrollen erreichbar. Dünne Linie statt Schatten (§7.5).
     *
     * Dass das WIRKT, hängt an globals.css: `overflow-x: hidden` auf <body> machte
     * body zum Scroll-Container und setzte sticky still außer Kraft (dort im Detail
     * dokumentiert). Wer die Bremse je auf `hidden` zurückdreht, bricht diesen Header.
     *
     * z-40: über dem Inhalt, aber UNTER Mobile-Drawer/Overlay (z-50, ui/sheet.tsx).
     * Deckende Fläche ist Pflicht — der Inhalt läuft darunter durch.
     */
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <Container className="grid h-[var(--header-h)] grid-cols-[auto_1fr_auto] items-center gap-4">
        {/* Lockup → Startseite */}
        <Link
          href="/"
          aria-label={t('home')}
          className="flex shrink-0 items-center justify-self-start gap-2.5 rounded-md text-navy outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <EmblemImage size={44} className="h-11 w-11" priority />
          <HeaderWordmark className="h-11 w-auto" />
        </Link>

        {/*
         * Spalten `auto 1fr auto` (NICHT `1fr auto 1fr`): Logo- und Aktions-
         * Spalte sind je genau so breit wie ihr eigener Inhalt (kein Leerraum
         * INNERHALB dieser Spalten), die mittlere Spalte bekommt den GESAMTEN
         * Rest. Das ist der Unterschied zu `1fr auto 1fr`: dort wären die
         * beiden äußeren Spalten zwar gleich breit, aber Logo (schmal) und
         * Aktions-Block (breiter: Login+Kontakt+Kalkulator) würden diese
         * gleich breiten Spalten unterschiedlich stark ausfüllen — der
         * sichtbare Abstand links/rechts der Nav wäre trotz „gleicher Spalten"
         * spürbar asymmetrisch (gemessen: 124px vs. 48px). Mit `auto 1fr auto`
         * IST die Mittelspalte exakt der Raum zwischen Logos rechter und
         * Aktions-Blocks linker Kante — `justify-self-center` darin zentriert
         * die Nav dadurch tatsächlich mittig zwischen den beiden sichtbaren
         * Blöcken (gemessen: 86px beidseitig, 0px Differenz).
         *
         * WICHTIG: NICHT stattdessen `flex-1` + `justify-center` DIREKT auf der
         * NavigationMenu-Primitive selbst (die von Haus aus `flex-1` trägt)
         * anwenden, um dasselbe Ergebnis in einem Flex-Header zu erreichen —
         * deren Mega-Menü-Viewport dockt intern an der LINKEN Kante der
         * Nav-eigenen Box an (`navigation-menu.tsx`, `absolute left-0`). Würde
         * die Nav-Box selbst gestreckt und nur ihr Inhalt zentriert, säße das
         * Dropdown-Panel an der (dann leeren) linken Boxkante und liefe am
         * zentrierten Trigger vorbei. Hier bleibt die Nav-Box unangetastet
         * (`justify-self-center` zentriert nur die BOX innerhalb der 1fr-
         * Spalte, die Box selbst bleibt exakt content-breit) — das Dropdown
         * bleibt exakt unter seinem Trigger.
         *
         * Bei 1024–1280px eng geprüft (Playwright): die Mittelspalte hat bei
         * 1024px noch reichlich Luft (kein Umbruch, kein Overflow, Nav bleibt
         * einzeilig). Kein Fallback nötig.
         */}
        <NavigationMenu className="hidden justify-self-center lg:flex" aria-label={t('mainLabel')}>
          <NavigationMenuList>
            {MAIN_NAV.map((item) => {
              const hasMenu = Boolean(item.groups || item.items)

              if (!hasMenu) {
                return (
                  <NavigationMenuItem key={item.href}>
                    <NavigationMenuLink asChild>
                      <Link href={item.href} className={navItemStyle}>
                        {t(item.labelKey)}
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )
              }

              return (
                <NavigationMenuItem key={item.href} className="group">
                  <NavigationMenuTrigger>{t(item.labelKey)}</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    {item.groups ? (
                      /* Mega-Menü: Gruppen nebeneinander */
                      /* Breit genug, dass kein Eintrag umbricht — sonst wächst das
                         Panel unnötig in die Höhe und die Spalten laufen unruhig. */
                      <div className="w-[46rem] p-4">
                        {/*
                         * EIN Raster für ALLE Spalten.
                         *
                         * Problem an der Wurzel: Die Gruppen tragen unterschiedlich
                         * viele Einträge (3/2/1), die Überschrift „Beschaffen &
                         * Finanzieren" läuft zweizeilig und Labels wie „PV, Speicher &
                         * Eigenverbrauch" brechen um. Richtet sich jede Spalte an ihrem
                         * EIGENEN Inhalt aus, schiebt jeder dieser Umbrüche alles
                         * Folgende in seiner Spalte nach unten — die Einträge stehen
                         * dann sichtbar auf verschiedenen Höhen.
                         *
                         * Fix: Zeile 1 = alle Überschriften, Zeile 2..n+1 = Eintrag 1..n
                         * jeder Spalte. Die Listen machen KEIN eigenes Raster auf,
                         * sondern hängen sich per `subgrid` in genau diese Zeilen ein.
                         * Jede Zeile ist so hoch wie ihre höchste Zelle → Eintrag i
                         * beginnt in jeder Spalte auf derselben Baseline, egal wie
                         * viele Zeilen ein Label oder eine Überschrift braucht.
                         *
                         * `<ul>`/`<li>` bleiben erhalten: die Zuordnung Überschrift →
                         * Liste ist auch für Screenreader eine echte Gruppierung, nicht
                         * nur Optik.
                         */}
                        {(() => {
                          // Datengetrieben, nicht geraten: die längste Gruppe gibt die
                          // Zeilenzahl vor. Ein neuer Eintrag in lib/nav.ts wirkt hier
                          // automatisch.
                          const rows = Math.max(...item.groups.map((g) => g.items.length))
                          return (
                            <div
                              className="grid grid-cols-3 gap-x-6"
                              style={{ gridTemplateRows: `auto repeat(${rows}, auto)` }}
                            >
                              {item.groups.map((group, col) => (
                                <React.Fragment key={group.labelKey}>
                                  {/*
                                   * Hierarchie Überschrift vs. Eintrag entsteht aus
                                   * Gewicht (600 vs. 400), Größe (12 vs. 14 px),
                                   * Versalien + Sperrung (+0,08em) und dem Abstand
                                   * darunter (pb-3) — NICHT aus mehr Farbe. Ink statt
                                   * Muted ist derselbe neutrale Ton wie in den
                                   * Footer-Spaltenköpfen; der Teal-Akzent bleibt
                                   * sparsam (DESIGN.md).
                                   */}
                                  <p
                                    className="px-3 pb-3 text-label uppercase text-ink"
                                    style={{ gridColumn: col + 1, gridRow: 1 }}
                                  >
                                    {t(group.labelKey)}
                                  </p>
                                  <ul
                                    className="grid grid-rows-subgrid"
                                    style={{ gridColumn: col + 1, gridRow: `2 / span ${rows}` }}
                                  >
                                    {group.items.map((leaf) => (
                                      <li key={leaf.href}>
                                        <MenuLink href={leaf.href} label={t(leaf.labelKey)} />
                                      </li>
                                    ))}
                                  </ul>
                                </React.Fragment>
                              ))}
                            </div>
                          )
                        })()}
                        {item.overviewKey || item.trailingLeaf ? (
                          <div className="mt-4 border-t border-line pt-3">
                            {item.overviewKey ? (
                              <MenuLink href={item.href} label={t(item.overviewKey)} />
                            ) : null}
                            {/* Produkt-Quereinstieg als letzter Punkt (z. B. Strom-Monitor). */}
                            {item.trailingLeaf ? (
                              <MenuLink
                                href={item.trailingLeaf.href}
                                label={t(item.trailingLeaf.labelKey)}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      /* Flache Liste */
                      <ul className="w-64 space-y-0.5 p-2">
                        {item.items!.map((leaf) => (
                          <li key={leaf.href}>
                            <MenuLink href={leaf.href} label={t(leaf.labelKey)} />
                          </li>
                        ))}
                        {item.overviewKey ? (
                          <li className="mt-2 border-t border-line pt-2">
                            <MenuLink href={item.href} label={t(item.overviewKey)} />
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </NavigationMenuContent>
                </NavigationMenuItem>
              )
            })}
          </NavigationMenuList>
        </NavigationMenu>

        {/* Rechte Spalte: Aktionen (Desktop) + Hamburger (Mobile) im selben Grid-Slot */}
        <div className="flex shrink-0 items-center justify-self-end gap-2">
          <div className="hidden items-center gap-2 lg:flex">
            {/*
             * Login-/Konto-Platz (T4 Nav-Verlinkung): echtes Auth steht seit
             * T4-2 (Supabase). Ersetzt den funktionslosen Platzhalter-`<span>`
             * aus Prompt 26. Eingeloggt „Mein Konto" (→ /konto), sonst „Login"
             * (→ /anmelden); der Zustand kommt serverseitig aus getUser() oben.
             */}
            <Link
              href={accountHref}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-small text-text-muted',
                'transition-colors hover:text-ink',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              {accountLabel}
            </Link>
            <Button asChild variant="secondary" size="sm">
              <Link href={KONTAKT_HREF}>{t('kontakt')}</Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href={CTA_HREF}>{t('cta')}</Link>
            </Button>
          </div>

          {/* Mobile */}
          <MobileNav isLoggedIn={isLoggedIn} />
        </div>
      </Container>
    </header>
  )
}
