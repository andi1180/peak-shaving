import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/layout'
import { HeroAnimation } from '@/components/home/hero-animation'
import { CtaErsparnisLink } from '@/components/analytics/cta-ersparnis-link'

/**
 * Hero (§4.4 Nr. 1) — Problem/Lösung in einem Satz.
 *
 * Text und Animation seit Leadgen-Umbau Schritt 2: H1 und Unterzeile wörtlich, rechts (ab `lg`)
 * bzw. darunter (mobil, per DOM-Reihenfolge) die Animation nach dem freigegebenen Prototyp
 * `docs/prototypes/hero-animation-prototyp.html`. Spaltenverhältnis ebenfalls aus dem Prototyp.
 */
export function Hero() {
  const t = useTranslations('Home.Hero')

  return (
    <Container className="py-16 sm:py-24">
      <div className="grid gap-9 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.18fr)] lg:items-center lg:gap-14">
        <div className="min-w-0 max-w-3xl">
          {/* Die EINZIGE h1 der Seite — alle Sektionen darunter laufen als h2. */}
          <h1 className="text-h1 text-ink sm:text-[3rem] sm:leading-[3.4rem]">{t('title')}</h1>

          <p className="mt-6 max-w-prose text-lead text-text">{t('lead')}</p>
          <p className="mt-3 max-w-prose text-body text-text-muted">{t('audience')}</p>

          {/* Genau EIN Button: der Weg zum Schnellrechner direkt darunter (Leadgen-Umbau Schritt 1). */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild variant="primary" size="lg">
              <CtaErsparnisLink position="hero">{t('ctaPrimary')}</CtaErsparnisLink>
            </Button>
          </div>
        </div>

        <HeroAnimation />
      </div>
    </Container>
  )
}
