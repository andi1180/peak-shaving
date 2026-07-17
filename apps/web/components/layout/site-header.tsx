import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { EmblemImage } from '@/components/brand/emblem-image'
import { WordmarkA } from '@/components/brand/wordmark'
import { MAIN_NAV, CTA_HREF, KONTAKT_HREF, LOGIN_HREF } from '@/lib/nav'
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

export function SiteHeader() {
  const t = useTranslations('Nav')

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
      <Container className="flex h-[var(--header-h)] items-center justify-between gap-4">
        {/* Lockup → Startseite */}
        <Link
          href="/"
          aria-label={t('home')}
          className="flex shrink-0 items-center gap-2.5 rounded-md text-navy outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <EmblemImage size={44} className="h-11 w-11" priority />
          <HeaderWordmark className="h-11 w-auto" />
        </Link>

        {/* Desktop-Navigation */}
        <NavigationMenu className="hidden lg:flex" aria-label={t('mainLabel')}>
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
                        {item.overviewKey ? (
                          <div className="mt-4 border-t border-line pt-3">
                            <MenuLink href={item.href} label={t(item.overviewKey)} />
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

        {/* Rechte Aktionen — Hierarchie leise → laut (§4.1) */}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Link
            href={LOGIN_HREF}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-small text-text-muted',
              'transition-colors hover:text-ink',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            {t('login')}
            <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-caption text-text-muted">
              {t('loginSoon')}
            </span>
          </Link>
          <Button asChild variant="secondary" size="sm">
            <Link href={KONTAKT_HREF}>{t('kontakt')}</Link>
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link href={CTA_HREF}>{t('cta')}</Link>
          </Button>
        </div>

        {/* Mobile */}
        <MobileNav />
      </Container>
    </header>
  )
}
