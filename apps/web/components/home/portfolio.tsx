import { useTranslations } from 'next-intl'
import { ArrowRight, ClipboardCheck, Coins, Gauge, ScrollText, Sun, Thermometer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { LEISTUNGEN_FLAT } from '@/lib/nav'

/**
 * Leistungsportfolio (§4.4 Nr. 3) — die 6 Leistungen als Kacheln.
 *
 * Reihenfolge und Links kommen aus `lib/nav.ts` (LEISTUNGEN_FLAT), nicht aus
 * einer zweiten Liste: eine neue Leistung wird einmal in der IA eingetragen und
 * erscheint hier automatisch. Peak Shaving ist bewusst KEINE Kachel (§4.2) —
 * es hat den eigenen Block darüber.
 *
 * Kurzbeschreibungen aus `reference/coolin-legacy.html` (Leistungsportfolio).
 * Ausnahme: „Smart Heating" ist im Bestand nicht vorhanden ([NEU] laut
 * Pflichtenheft §5.1) — der Text folgt dessen Beschreibung, keine Erfindung.
 *
 * ICONS: schlichte, einfarbige Line-Icons (lucide), klein und ruhig — KEINE
 * Emoji-Icons (Pflichtenheft §7.3; der Bestand nutzt ☀️📜📊⚡💶🧾, genau der
 * Hauptgrund für den verspielten Eindruck).
 */
const ICONS: Record<string, LucideIcon> = {
  pvSpeicher: Sun,
  energiemanagement: Gauge,
  smartHeating: Thermometer,
  ppa: ScrollText,
  finanzierung: Coins,
  esg: ClipboardCheck,
}

export function Portfolio() {
  const t = useTranslations('Home.Portfolio')
  const tNav = useTranslations('Nav')

  return (
    <Section tone="alt">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        {/*
         * `items-stretch` (Grid-Default) + `h-full` auf der Karte: alle Karten
         * einer Zeile sind gleich hoch und stehen auf einer Baseline, auch wenn
         * die Beschreibungen unterschiedlich lang sind. Der Pfeil sitzt über
         * `mt-auto` immer am unteren Rand.
         */}
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LEISTUNGEN_FLAT.map((leaf) => {
            const Icon = ICONS[leaf.labelKey]
            return (
              <li key={leaf.href}>
                <Link
                  href={leaf.href}
                  className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {Icon ? (
                    <Icon
                      className="h-5 w-5 shrink-0 text-text-muted"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  ) : null}
                  <h3 className="mt-4 text-h4 text-ink">{tNav(leaf.labelKey)}</h3>
                  <p className="mt-2 text-small text-text-muted">{t(leaf.labelKey)}</p>
                  <div className="mt-auto pt-5">
                    <ArrowRight
                      className="h-4 w-4 text-text-muted transition-colors group-hover:text-accent"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </Container>
    </Section>
  )
}
