'use client'

/**
 * Navigation des Admin-Bereichs (B1-3).
 *
 * ── WARUM ES SIE JETZT GIBT (T4-4 kam ohne aus) ──────────────────────────────────────────────────
 * T4-4 hat vier Verwaltungsflächen bewusst auf EINE Seite gelegt und dafür keine Navigation
 * gebraucht. Mit B1-3 kommt der erste Bereich dazu, der eine eigene Route BRAUCHT: eine Lead-Liste
 * mit Filtern, Seitenaufteilung und Detailseiten lässt sich nicht als Abschnitt unter die
 * Gutscheincodes hängen — sie hat einen eigenen Zustand in der URL. Zwei Routen sind die Schwelle,
 * ab der man sie benennen muss.
 *
 * ── WARUM `next/link` UND NICHT DAS LOCALE-BEWUSSTE `components/ui/link.tsx` ─────────────────────
 * `/admin` liegt bewusst AUSSERHALB der Sprach-Struktur, und die Middleware nimmt den Pfad vom
 * next-intl-Routing aus. Heute (nur `de`, `localePrefix: 'as-needed'`) wäre der Unterschied
 * unsichtbar — sobald eine zweite Sprache dazukommt, würde der locale-bewusste Link `/en/admin/...`
 * erzeugen, und genau diese Route gibt es nicht. Interne Verwaltungspfade müssen wörtlich bleiben.
 *
 * Client-Komponente allein wegen `usePathname` (welcher Punkt ist der aktive) — sie hält keinen
 * eigenen Zustand.
 */
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ADMIN_HREF } from '@/lib/admin/config'
import { LEADS_HREF } from '@/lib/admin/leads'
import { ANALYSES_HREF } from '@/lib/admin/analyses'
import { PARTNERS_HREF } from '@/lib/admin/partners'
import { PARTNER_APPLICATIONS_HREF } from '@/lib/admin/partner-applications'

const ITEMS = [
  { href: ADMIN_HREF, label: 'Übersicht' },
  { href: LEADS_HREF, label: 'Leads' },
  // B14-2: das Archiv der eingefrorenen Auslegungen. Eigener Punkt und nicht ein Abschnitt unter
  // „Leads": eine Analyse überlebt den Lead bewusst (B14-1, ON DELETE SET NULL statt CASCADE) und
  // kann von vornherein ohne einen entstehen.
  { href: ANALYSES_HREF, label: 'Analysen' },
  // B16-2: die Stammdaten der Fachbetriebe. Eigener Punkt und kein Abschnitt unter „Leads": ein
  // Partner ist eine Vereinbarung mit eigener Lebensdauer — er entsteht vor dem ersten Lead und
  // überlebt dessen Anonymisierung (B16-1 hält `partner_slug` bewusst aus dem Guard heraus).
  { href: PARTNERS_HREF, label: 'Partner' },
  /*
   * B16-3: der Prüf-Eingang der Bewerbungen. Eigener Punkt neben „Partner" und ausdrücklich KEIN
   * Unterpfad davon: `/admin/partner/antraege` hätte wegen der Präfix-Regel unten BEIDE Punkte
   * gleichzeitig markiert — genau der Zustand, den der Kommentar dort ausschliesst. Fachlich sind es
   * ohnehin zwei Dinge: „Partner" sind die aufgenommenen Betriebe, hier stehen die, über die noch
   * nicht entschieden ist.
   */
  { href: PARTNER_APPLICATIONS_HREF, label: 'Partner-Anträge' },
] as const

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Verwaltung" className="border-b border-line bg-surface">
      <ul className="mx-auto flex w-full max-w-container gap-1 px-4 sm:px-6">
        {ITEMS.map((item) => {
          /*
           * „Aktiv" ist bei der Übersicht die EXAKTE Übereinstimmung, sonst auch jede Unterroute:
           * `/admin` ist Präfix von allem und wäre sonst immer mitmarkiert — der Nutzer sähe zwei
           * aktive Punkte und wüsste nicht, wo er ist.
           */
          const active =
            item.href === ADMIN_HREF
              ? pathname === ADMIN_HREF
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-11 items-center border-b-2 px-3 text-small font-medium transition-colors',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-accent text-ink'
                    : 'border-transparent text-text-muted hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
