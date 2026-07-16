import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { BRANCHEN_FLAT } from '@/lib/nav'

/**
 * Branchen-Teaser (§4.4 Nr. 4) — 4 Karten, problem-orientiert.
 *
 * Bewusst nur Teaser: der Detailtext je Branche (typisches Verbrauchsprofil,
 * Hebel, Benchmarks mit Quellen) gehört auf die Branchenseiten (§5.3, eigene
 * Phase). Hier steht je Branche EIN Satz zum Schmerz.
 *
 * Der Schmerz je Branche folgt Pflichtenheft §5.3 („Hotel: gleichzeitige Last
 * aus Küche + HLK + Wäscherei; Bäckerei: Ofen-Spitzen früh; Gastro: Stoßzeiten;
 * Handel: Kälte/Beleuchtung/Klima"). Keine Zahlen — die brauchen Quellen (§9.5).
 *
 * Liste + Links kommen aus `lib/nav.ts` (BRANCHEN_FLAT), nicht aus einer Kopie.
 */
export function BranchenTeaser() {
  const t = useTranslations('Home.Branchen')
  const tNav = useTranslations('Nav')

  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        {/* Gleich hohe Karten auf einer Baseline: h-full + mt-auto (wie im Portfolio). */}
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BRANCHEN_FLAT.map((leaf) => (
            <li key={leaf.href}>
              <Link
                href={leaf.href}
                className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <h3 className="text-h4 text-ink">{tNav(leaf.labelKey)}</h3>
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
          ))}
        </ul>
      </Container>
    </Section>
  )
}
