'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Menu, X } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { EmblemImage } from '@/components/brand/emblem-image'
import { MAIN_NAV, CTA_HREF, KONTAKT_HREF, type NavLeaf } from '@/lib/nav'
import { ANMELDEN_HREF, KONTO_HREF } from '@/lib/auth/config'
import { cn } from '@/lib/utils'

/*
 * Mobile-Menü — echtes Drawer-Pattern (Pflichtenheft §7.5: die `prompt()`-basierte
 * Mobilnavigation der Bestandsseite muss weg).
 *
 * Barrierefreiheit kommt aus Radix Dialog: Fokus-Falle, Escape schließt,
 * Fokus-Rückgabe an den Hamburger, `aria-modal`, Scroll-Lock. `aria-expanded`
 * setzt Radix am Trigger automatisch aus dem offenen State.
 *
 * `open` wird kontrolliert gehalten, damit ein Klick auf einen Link das Menü
 * schließt — sonst bliebe es nach der Navigation offen stehen.
 */

/** Link im Drawer. Schließt das Menü beim Navigieren (via SheetClose asChild). */
function DrawerLink({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <SheetClose asChild>
      <Link
        href={href}
        className={cn(
          'block rounded-md py-2 text-body text-text transition-colors hover:text-accent',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
      >
        {children}
      </Link>
    </SheetClose>
  )
}

export function MobileNav({ isLoggedIn }: { isLoggedIn: boolean }) {
  const t = useTranslations('Nav')
  const [open, setOpen] = useState(false)
  const accountHref = isLoggedIn ? KONTO_HREF : ANMELDEN_HREF
  const accountLabel = isLoggedIn ? t('konto') : t('login')

  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={t('openMenu')}
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md text-ink',
              'transition-colors hover:bg-surface-sunken',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </SheetTrigger>

        <SheetContent>
          {/* Kopf des Drawers */}
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
            <SheetTitle className="flex items-center gap-2 text-h4 text-ink">
              <EmblemImage size={28} className="h-7 w-7" />
              {t('menuTitle')}
            </SheetTitle>
            <SheetClose
              aria-label={t('closeMenu')}
              className={cn(
                'inline-flex h-10 w-10 items-center justify-center rounded-md text-ink',
                'transition-colors hover:bg-surface-sunken',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </SheetClose>
          </div>

          {/* Navigation — scrollt, wenn sie länger als der Schirm wird */}
          <nav aria-label={t('mainLabel')} className="flex-1 overflow-y-auto px-4">
            <Accordion type="multiple" className="w-full">
              {MAIN_NAV.map((item) => {
                const flat: NavLeaf[] | undefined =
                  item.groups?.flatMap((g) => g.items) ?? item.items

                // Kein Untermenü → direkter Link, kein leeres Accordion.
                if (!flat) {
                  return (
                    <div key={item.href} className="border-b border-line">
                      <DrawerLink href={item.href} className="py-3 font-medium text-ink">
                        {t(item.labelKey)}
                      </DrawerLink>
                    </div>
                  )
                }

                return (
                  <AccordionItem key={item.href} value={item.href}>
                    <AccordionTrigger>{t(item.labelKey)}</AccordionTrigger>
                    <AccordionContent>
                      {item.groups ? (
                        <div className="space-y-3">
                          {item.groups.map((group) => (
                            <div key={group.labelKey}>
                              <p className="pb-1 text-label uppercase text-text-muted">
                                {t(group.labelKey)}
                              </p>
                              <ul className="pl-1">
                                {group.items.map((leaf) => (
                                  <li key={leaf.href}>
                                    <DrawerLink href={leaf.href}>{t(leaf.labelKey)}</DrawerLink>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <ul className="pl-1">
                          {item.items!.map((leaf) => (
                            <li key={leaf.href}>
                              <DrawerLink href={leaf.href}>{t(leaf.labelKey)}</DrawerLink>
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.overviewKey ? (
                        <DrawerLink href={item.href} className="mt-2 font-medium text-accent">
                          {t(item.overviewKey)}
                        </DrawerLink>
                      ) : null}
                      {/* Produkt-Quereinstieg als letzter Punkt (z. B. Strom-Monitor). */}
                      {item.trailingLeaf ? (
                        <DrawerLink href={item.trailingLeaf.href} className="mt-1">
                          {t(item.trailingLeaf.labelKey)}
                        </DrawerLink>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </nav>

          {/*
           * Aktionen unten: am Daumen erreichbar und immer sichtbar, egal wie
           * weit die Nav gescrollt ist. Reihenfolge wie im Desktop-Header —
           * laut (CTA) zuerst, leise (Login) zuletzt.
           */}
          <div className="shrink-0 space-y-2 border-t border-line p-4">
            <SheetClose asChild>
              <Button asChild variant="primary" size="lg" className="w-full">
                <Link href={CTA_HREF}>{t('cta')}</Link>
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button asChild variant="secondary" size="lg" className="w-full">
                <Link href={KONTAKT_HREF}>{t('kontakt')}</Link>
              </Button>
            </SheetClose>
            {/*
             * Konto-Einstieg (T4 Nav-Verlinkung): eingeloggt „Mein Konto"
             * (→ /konto), sonst „Login" (→ /anmelden) — Zustand aus der
             * Server-Session (site-header.tsx, als Prop hereingereicht).
             * SheetClose schließt den Drawer beim Klick. Der Monitor-Einstieg
             * lebt jetzt im Leistungen-Accordion (trailingLeaf), nicht mehr hier —
             * kein doppelter Eintrag im selben Drawer.
             */}
            <div className="flex items-center justify-center pt-1 text-small">
              <SheetClose asChild>
                <Link
                  href={accountHref}
                  className={cn(
                    'text-text-muted transition-colors hover:text-accent',
                    'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  )}
                >
                  {accountLabel}
                </Link>
              </SheetClose>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
