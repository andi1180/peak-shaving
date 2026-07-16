import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Emblem } from '@/components/brand/emblem'
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
    // sticky: die Nav bleibt beim Scrollen erreichbar. Dünne Linie statt Schatten (§7.5).
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <Container className="flex h-16 items-center justify-between gap-4">
        {/* Lockup → Startseite */}
        <Link
          href="/"
          aria-label={t('home')}
          className="flex shrink-0 items-center gap-2.5 rounded-md text-navy outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Emblem className="h-8 w-8" />
          <HeaderWordmark className="h-[22px] w-auto" />
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
                        <div className="grid grid-cols-3 gap-x-6 gap-y-2">
                          {item.groups.map((group) => (
                            <div key={group.labelKey}>
                              <p className="px-3 pb-1 text-label uppercase text-text-muted">
                                {t(group.labelKey)}
                              </p>
                              <ul className="space-y-0.5">
                                {group.items.map((leaf) => (
                                  <li key={leaf.href}>
                                    <MenuLink href={leaf.href} label={t(leaf.labelKey)} />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                        {item.overviewKey ? (
                          <div className="mt-3 border-t border-line pt-3">
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
