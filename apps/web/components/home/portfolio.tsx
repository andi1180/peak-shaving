import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { LEISTUNGEN } from '@/lib/leistungen'

/**
 * Leistungsportfolio (§4.4 Nr. 3) — die 6 Leistungen als Kacheln.
 *
 * Reihenfolge, Links und Icons kommen aus `lib/leistungen.ts` (das seinerseits
 * aus `lib/nav.ts` fällt), die Kurzbeschreibungen aus `Leistungen.teaser.*` —
 * DIESELBEN Keys, die die Übersicht `/leistungen` rendert. Eine neue Leistung
 * wird einmal in der IA eingetragen und erscheint hier automatisch; ein
 * geänderter Teaser ändert sich an beiden Orten. Peak Shaving ist bewusst KEINE
 * Kachel (§4.2) — es hat den eigenen Block darüber.
 *
 * Kurzbeschreibungen aus `reference/coolin-legacy.html` (Leistungsportfolio).
 * Ausnahme: „Smart Heating" ist im Bestand nicht vorhanden ([NEU] laut
 * Pflichtenheft §5.1) — der Text folgt dessen Beschreibung, keine Erfindung.
 *
 * ICONS: schlichte, einfarbige Line-Icons (lucide), klein und ruhig — KEINE
 * Emoji-Icons (Pflichtenheft §7.3; der Bestand nutzt ☀️📜📊⚡💶🧾, genau der
 * Hauptgrund für den verspielten Eindruck).
 */
export function Portfolio() {
  const t = useTranslations('Home.Portfolio')
  const tLeistungen = useTranslations('Leistungen')
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
          {LEISTUNGEN.map((leistung) => {
            const Icon = leistung.icon
            return (
              <li key={leistung.href}>
                <Link
                  href={leistung.href}
                  className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Icon
                    className="h-5 w-5 shrink-0 text-text-muted"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <h3 className="mt-4 text-h4 text-ink">{tNav(leistung.key)}</h3>
                  <p className="mt-2 text-small text-text-muted">
                    {tLeistungen(`teaser.${leistung.key}`)}
                  </p>
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
