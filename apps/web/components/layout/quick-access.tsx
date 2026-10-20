'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { CtaErsparnisLink } from '@/components/analytics/cta-ersparnis-link'
import { track } from '@/lib/analytics/events'
import { KONTAKT_HREF, PROFI_REPORT_HREF } from '@/lib/nav'
import { PARTNER_BEWERBUNG_HREF } from '@/lib/partner-application/config'
import { PROFI_REPORT_ANFRAGE_ID } from '@/lib/profi-report/links'
import { isTextEntry, quickAccessVariant, type QuickAccessVariant } from '@/lib/quick-access'
import { cn } from '@/lib/utils'

/*
 * Schnellzugriff (Leadgen 6): ab `lg` zwei Buttons im Header, darunter eine feste Leiste unten.
 * Beides hängt am Pfad (`lib/quick-access.ts`) und wird serverseitig mitgerendert — die Leiste
 * reserviert ihren Platz damit schon im ersten HTML, ohne Layout-Verschiebung.
 */

function useQuickAccessVariant(): QuickAccessVariant | null {
  return quickAccessVariant(usePathname())
}

type ProfiReportCtaProps = Omit<React.ComponentProps<'a'>, 'href'> & {
  position: 'header' | 'bottombar'
  variant: QuickAccessVariant
}

/** „Profi-Report" → /profi-report, auf der Seite selbst „Jetzt anfragen" → #anfrage. */
const ProfiReportCta = React.forwardRef<HTMLAnchorElement, ProfiReportCtaProps>(
  function ProfiReportCta({ position, variant, onClick, ...props }, ref) {
    const t = useTranslations('Nav')
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      track('cta_profi_report_click', { position, variant })
      onClick?.(event)
    }
    if (variant === 'jetzt_anfragen') {
      return (
        <a ref={ref} {...props} href={`#${PROFI_REPORT_ANFRAGE_ID}`} onClick={handleClick}>
          {t('jetztAnfragen')}
        </a>
      )
    }
    return (
      <Link ref={ref} {...props} href={PROFI_REPORT_HREF} onClick={handleClick}>
        {t('profiReport')}
      </Link>
    )
  },
)

/** Rechte Header-Spalte (ohne Hamburger). Ohne Schnellzugriff wie vor Leadgen 6. */
export function HeaderActions() {
  const t = useTranslations('Nav')
  const variant = useQuickAccessVariant()

  return (
    <>
      <Button asChild variant="secondary" size="sm" className="hidden lg:inline-flex">
        <Link href={KONTAKT_HREF}>{t('kontakt')}</Link>
      </Button>
      {/*
       * Partner-Einstieg (B16): ab `xl`, und nur ohne Schnellzugriff — neben Nav, Kontakt und den
       * zwei Schnellzugriff-Buttons passt er in 1152 px nicht mehr (gemessen). Fusszeile,
       * Startseiten-Banner und Menü führen weiter dorthin.
       */}
      {variant ? null : (
        <Button asChild variant="secondary" size="sm" className="hidden xl:inline-flex">
          <Link href={PARTNER_BEWERBUNG_HREF}>{t('partner')}</Link>
        </Button>
      )}
      {variant ? (
        <Button
          asChild
          variant="secondary"
          size="sm"
          className="hidden whitespace-nowrap lg:inline-flex"
        >
          <ProfiReportCta position="header" variant={variant} />
        </Button>
      ) : null}
      {/* Mit Schnellzugriff steht „Ersparnis berechnen" unter `lg` in der Leiste unten. */}
      <Button
        asChild
        variant="primary"
        size="sm"
        className={cn('whitespace-nowrap', variant && 'hidden lg:inline-flex')}
      >
        <CtaErsparnisLink position="header">{t('ersparnisBerechnen')}</CtaErsparnisLink>
      </Button>
    </>
  )
}

/** Feste Leiste unter `lg`; weicht, solange ein Eingabefeld den Fokus hat oder #anfrage im Bild ist. */
export function QuickAccessBar() {
  const t = useTranslations('Nav')
  const variant = useQuickAccessVariant()
  const [typing, setTyping] = React.useState(false)
  const [anfrageInView, setAnfrageInView] = React.useState(false)

  React.useEffect(() => {
    if (!variant) return
    setTyping(isTextEntry(document.activeElement))
    const onFocusIn = (event: FocusEvent) => setTyping(isTextEntry(event.target as Element))
    const onFocusOut = (event: FocusEvent) =>
      setTyping(isTextEntry(event.relatedTarget as Element | null))
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [variant])

  React.useEffect(() => {
    setAnfrageInView(false)
    if (variant !== 'jetzt_anfragen') return
    const section = document.getElementById(PROFI_REPORT_ANFRAGE_ID)
    if (!section || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) =>
      setAnfrageInView(entries.some((entry) => entry.isIntersecting)),
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [variant])

  if (!variant) return null
  const hidden = typing || anfrageInView

  return (
    <>
      {/* Platzhalter in Leistenhöhe: Fusszeile und letzte Inhalte bleiben über der Leiste. */}
      <div
        aria-hidden="true"
        className="lg:hidden"
        style={{ height: 'calc(4rem + 1px + env(safe-area-inset-bottom))' }}
      />
      <nav
        aria-label={t('quickAccess')}
        data-quick-access-bar=""
        data-hidden={hidden ? '' : undefined}
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3 lg:hidden',
          'transition-[opacity,transform,visibility] duration-200 motion-reduce:transition-none',
          hidden ? 'invisible translate-y-full opacity-0' : 'visible',
        )}
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Button asChild variant="primary" size="md" className="w-full whitespace-nowrap px-2">
            <CtaErsparnisLink position="bottombar">{t('ersparnisBerechnen')}</CtaErsparnisLink>
          </Button>
          <Button asChild variant="secondary" size="md" className="w-full whitespace-nowrap px-2">
            <ProfiReportCta position="bottombar" variant={variant} />
          </Button>
        </div>
      </nav>
    </>
  )
}
