import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container, Eyebrow } from '@/components/ui/layout'
import { HeroLoadChart } from '@/components/home/hero-load-chart'
import { CTA_HREF, KONTAKT_HREF } from '@/lib/nav'

/**
 * Hero (§4.4 Nr. 1) — Problem/Lösung in einem Satz.
 *
 * Substanz aus `reference/coolin-legacy.html` (Hero-Block): Eyebrow, H1 und
 * Einleitung sind der Bestandstext, nur gestrafft. Keine neue Behauptung, keine
 * Kennzahl.
 *
 * Gestaltung bewusst ruhig (Pflichtenheft §7.1/§7.2): eine Textspalte, flache
 * Fläche, kein Gradient, kein „big number"-Klischee, kein Teaser-Rechner —
 * der sitzt im Peak-Shaving-Block darunter (§4.4 Nr. 2).
 *
 * GRAFIK 1 (Prompt 14): die kompakte „Lastgang vor/nach Kappung"-Grafik steht
 * NEBEN der Headline (ab `lg`, zweispaltig) und UNTER ihr (Mobile, per
 * DOM-Reihenfolge). Weißer Kartengrund unter dem Chart aus demselben Grund wie
 * bei allen übrigen Chart-Sektionen: Die in DESIGN.md gemessenen Kontraste sind
 * gegen Weiß vermessen. Kein zweites Signature-Motiv-Vorkommen (§DESIGN.md) —
 * diese Grafik ist ein Recharts-Diagramm, kein `SignatureRule`/`SignatureField`.
 */
export function Hero() {
  const t = useTranslations('Home.Hero')
  const tChart = useTranslations('Home.HeroChart')

  return (
    <Container className="py-16 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-center lg:gap-14">
        <div className="max-w-3xl">
          <Eyebrow>{t('eyebrow')}</Eyebrow>

          {/* Die EINZIGE h1 der Seite — alle Sektionen darunter laufen als h2. */}
          <h1 className="mt-3 text-h1 text-ink sm:text-[3rem] sm:leading-[3.4rem]">
            {t('title')}
          </h1>

          <p className="mt-6 max-w-prose text-lead text-text">{t('lead')}</p>
          <p className="mt-3 max-w-prose text-body text-text-muted">{t('focus')}</p>

          {/* Hierarchie: Primär = der EINE Akzent, Sekundär = Navy-Kontur (§4.1). */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild variant="primary" size="lg">
              <Link href={CTA_HREF}>{t('ctaPrimary')}</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href={KONTAKT_HREF}>{t('ctaSecondary')}</Link>
            </Button>
          </div>
        </div>

        <div>
          <Card>
            <CardContent className="pt-5">
              <HeroLoadChart />
            </CardContent>
          </Card>
          <p className="mt-3 text-caption text-text-muted">{tChart('caption')}</p>
        </div>
      </div>
    </Container>
  )
}
