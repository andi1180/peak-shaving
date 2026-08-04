import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { PORTAL_NAV_ITEMS } from '@/lib/partner-portal/nav'

/**
 * Navigation des Portalbereichs (B18-3) — Vorbild: `components/admin/nav.tsx`.
 *
 * ── ZWEI UNTERSCHIEDE ZUM ADMIN-VORBILD, BEIDE BEGRÜNDET ────────────────────────────────────────
 * (1) KEIN `'use client'`, und damit kein `usePathname`. Der Admin-Bereich ermittelt den aktiven
 * Punkt im Browser; hier weiss der SERVER es bereits — er rendert ja genau diese Seite und reicht
 * `active` als Prop herein. Das ist nicht nur weniger Code: Auf dem Portal-Host unterscheiden sich
 * die Adresse im Browser (`/marketing`) und die gerenderte Route (`/portal/marketing`), weil die
 * Middleware intern umschreibt. Ein Vergleich des Browser-Pfades mit den `href`s ginge heute gut
 * und wäre eine Falle für jeden, der die Abbildung später anfasst.
 *
 * (2) NATIVES `<a>`, weder `next/link` noch das locale-bewusste `components/ui/link.tsx`. Der
 * locale-bewusste Link scheidet aus demselben Grund aus wie im Admin-Bereich: Der Portalbereich
 * liegt ausserhalb der Sprach-Struktur, und eine zweite Sprache erzeugte `/en/marketing` — eine
 * Adresse, die es auf diesem Host nicht gibt. Gegen `next/link` spricht der Rewrite: Ein
 * clientseitiger Wechsel holt die Route über eine RSC-Anfrage nach, die dieselbe Umschreibung ein
 * zweites Mal durchlaufen muss. Ein voller Seitenwechsel ist bei einem Bereich mit zwei Reitern
 * nicht spürbar und immer richtig.
 */
export function PortalNav({
  /** `href` des aktiven Reiters — der Server weiss, welche Seite er rendert. */
  active,
}: {
  active: string
}) {
  const t = useTranslations('PartnerPortal.nav')

  return (
    <nav aria-label={t('label')} className="border-b border-line bg-surface">
      <ul className="mx-auto flex w-full max-w-container gap-1 overflow-x-auto px-4 sm:px-6">
        {PORTAL_NAV_ITEMS.map((item) => {
          const isActive = item.href === active
          return (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-small font-medium transition-colors',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isActive
                    ? 'border-accent text-ink'
                    : 'border-transparent text-text-muted hover:text-ink',
                )}
              >
                {t(item.labelKey)}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
