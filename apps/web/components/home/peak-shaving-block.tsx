import { useLocale, useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Link as TextLink } from '@/components/ui/link'
import { Container, Eyebrow } from '@/components/ui/layout'
import { QuickCalculator } from '@/components/quick-calculator'
import { NetzebenenGrafik } from '@/components/wissen/charts/netzebenen-grafik'
import { articleHref, findArticle } from '@/lib/wissen'

/**
 * Peak-Shaving-Block (§4.4 Nr. 2, §4.2 „best of both worlds").
 *
 * Peak Shaving ist bewusst KEINE der Portfolio-Kacheln — es steht als
 * Flaggschiff für sich (§4.2). Deshalb der einzige Navy-Grund der Seite: die
 * tragende Ankerfläche markiert, was hier anders wiegt als die Kacheln darunter.
 *
 * Substanz aus `reference/coolin-legacy.html` (Peak-Shaving-Sektion): Titel,
 * Einleitung und die drei Punkte sind der Bestandstext.
 *
 * KEIN SIGNATURE-MOTIV mehr in dieser Sektion. Kanonischer Ort ist jetzt der
 * Footer (DESIGN.md „Signature-Motiv"): der läuft auf JEDER Seite, wodurch das
 * Motiv überall genau 1× erscheint statt nur auf der Startseite. Ein Auftritt
 * hier wäre damit der zweite auf dieser Seite — die Regel „max. 1× pro
 * Seitenansicht" verbietet ihn. Die neue Netzebenen-Grafik (Prompt 14, s. u.)
 * ist ein Recharts-fremder HTML-Baustein, kein Signature-Motiv — zählt also
 * nicht auf dieses Limit ein.
 */
export function PeakShavingBlock() {
  const t = useTranslations('Home.Peak')
  const locale = useLocale()

  const points = [
    { title: t('point1Title'), text: t('point1Text') },
    { title: t('point2Title'), text: t('point2Text') },
    { title: t('point3Title'), text: t('point3Text') },
  ]

  /*
   * GRAFIK 3 (Prompt 14): kompakter Netzebenen-Teaser, wirft laut statt still
   * auf einen toten Slug zu zeigen — gleiches Muster wie der 13c-Cross-Link in
   * `components/branche/branche-page.tsx`.
   */
  const netzebenenArticle = findArticle(locale, 'leistungstarif-2027')
  if (!netzebenenArticle) {
    throw new Error(
      `Home.Peak (Netzebenen-Teaser) verweist auf Artikel-Slug "leistungstarif-2027", der für Locale "${locale}" nicht existiert (lib/wissen.ts)`,
    )
  }

  return (
    <section className="bg-navy text-navy-foreground">
      <Container className="py-16 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Erklärung */}
          <div>
            {/* Eyebrow trägt sonst den Teal-Akzent — auf Navy wäre er zu dunkel
                (kein AA gegen #18336f). Hier deshalb der helle Knoten-Ton. */}
            <Eyebrow className="text-node">{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-h2 text-navy-foreground">{t('title')}</h2>
            <p className="mt-5 max-w-prose text-body text-white/80">{t('lead')}</p>

            <ul className="mt-8 space-y-5">
              {points.map((point) => (
                <li key={point.title} className="flex gap-3">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-node"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-h4 text-navy-foreground">{point.title}</p>
                    <p className="mt-1 text-small text-white/70">{point.text}</p>
                  </div>
                </li>
              ))}
            </ul>

            {/*
             * NUR EIN Sektions-CTA, und der ist bewusst sekundär.
             *
             * Vorher standen hier zwei Teal-Buttons auf DASSELBE Ziel: links
             * „Peak-Shaving Kalkulator", rechts in der Karte „Zum Kalkulator" —
             * auf Desktop gleichzeitig sichtbar. Zwei Primary nebeneinander
             * heben sich gegenseitig auf und widersprechen „Akzent sparsam"
             * (DESIGN.md). Die Karte trägt den Kalkulator-CTA am besseren Ort:
             * direkt unter der gerechneten Zahl. Der einzige Primary der
             * Sektion sitzt also dort, hier bleibt der ERKLÄR-Weg
             * (→ /peak-shaving) als sekundäre Alternative.
             */}
            <div className="mt-9">
              <Button asChild variant="secondary" size="md">
                <Link href="/peak-shaving">{t('ctaSecondary')}</Link>
              </Button>
            </div>
          </div>

          {/*
           * Schnellrechner — der freie Teaser (§5.4), jetzt echt rechnend.
           *
           * Die Komponente liegt bewusst NICHT unter components/home/: sie wird
           * auch auf der Peak-Shaving-Seite und auf Branchenseiten eingebettet.
           * Sie bringt ihren eigenen hellen Kartengrund mit und ist damit von
           * dieser Navy-Sektion unabhängig — hier wird nichts konfiguriert, die
           * Default-Werte sind Teil der Komponente.
           */}
          <div className="lg:pt-10">
            <QuickCalculator />
          </div>
        </div>

        {/*
         * GRAFIK 3 (Prompt 14) — Netzebenen-Teaser, „Neu ab 2027".
         *
         * Eigene Zeile UNTER dem 2-Spalten-Raster, abgesetzt durch eine
         * dünne Trennlinie (`border-white/10` — Tailwinds eigene Palette,
         * kein `/alpha` auf einem `var()`-Hex-Token, DESIGN.md).
         *
         * KEIN ERLÄUTERUNGSTEXT: Anders als im Artikel (`ChartFigure`-Caption)
         * steht hier nur eine kurze Überschrift + der Link zurück — die
         * Erklärung („Wen es trifft", RLM-Schwelle, Übergangsregel) bleibt
         * ausschließlich im Artikel. Das ist ein Vorgeschmack, keine
         * Redundanz-Vollversion (der Wissen-Teaser weiter unten bleibt der
         * Haupt-Touchpoint zum Artikel).
         *
         * Weißer Kartengrund für die Grafik selbst (wie `QuickCalculator`):
         * ihre Farbtokens (`border-line`, `bg-surface-sunken`, `text-ink`)
         * sind gegen Weiß vermessen, nicht gegen Navy.
         */}
        <div className="mt-14 border-t border-white/10 pt-12 lg:mt-16">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-16">
            <div>
              <Eyebrow className="text-node">{t('netzebenenEyebrow')}</Eyebrow>
              <h3 className="mt-2 text-h3 text-navy-foreground">{t('netzebenenTitle')}</h3>
              <div className="mt-4">
                <TextLink
                  href={articleHref(netzebenenArticle.slug)}
                  variant="standalone"
                  className="text-node"
                >
                  {t('netzebenenLink')}
                </TextLink>
              </div>
            </div>
            <Card>
              <CardContent className="pt-5">
                <NetzebenenGrafik compact />
              </CardContent>
            </Card>
          </div>
        </div>
      </Container>
    </section>
  )
}
