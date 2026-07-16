import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { Link as TextLink } from '@/components/ui/link'
import { ScreenshotPlaceholder } from '@/components/peak-shaving/screenshot-placeholder'
import { HowItWorks } from '@/components/peak-shaving/how-it-works'
import { EnergyFlow } from '@/components/peak-shaving/energy-flow'
import { CALCULATOR_RUN_HREF } from '@/lib/nav'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'PeakShavingCalculator' })
  const tPages = await getTranslations({ locale, namespace: 'Pages' })
  return {
    title: `${tPages('peakShavingCalculator')} — COOLiN ENERGY`,
    description: t('metaDescription'),
  }
}

/**
 * Produktseite des Peak-Shaving Kalkulators (Pflichtenheft §5.2b) — die
 * Produkt-Intent-Hälfte des Flaggschiffs. Die Methode erklärt `/peak-shaving`;
 * hier steht, was das Werkzeug leistet und wie es sich vom freien Schnellrechner
 * unterscheidet (§5.4).
 *
 * PHASE 1 vs. PHASE 2: Der CTA springt EXTERN auf `apps/website` ab — die
 * eigenständige, laufende Kalkulator-App (§8.1). `apps/web` importiert dafür
 * bewusst weder Engine noch Kalkulator-UI. Die URL steht als benannte Konstante
 * in `lib/config.ts`; dort ist auch dokumentiert, was in Phase 2 daraus wird.
 *
 * OP#1 (Kalkulator frei vs. bezahlt) ist OFFEN: Diese Seite trifft deshalb KEINE
 * endgültige Preis-Aussage. Der Badge nennt nur den Ist-Zustand („Derzeit frei
 * zugänglich") — kein „für immer kostenlos", kein „kostenlos testen" im CTA
 * selbst (§3.3: Preis-Aussage höchstens als Subtext/Badge neben dem Button).
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <>
      <CalculatorHero />
      <LeistetSection />
      <VergleichSection />
      <ScreensSection />
      {/* Die zwei nativ nachgebauten Grafik-Sektionen (Prompt 7) — bewusst direkt
          VOR dem CTA: erst zeigen, wie es geht und was gerechnet wird, dann der
          Absprung. Beide Sektionen tragen ihren eigenen `Section`-Grund; die
          Abfolge alt/default/alt/navy bleibt dadurch im Wechsel. */}
      <HowItWorks />
      <EnergyFlow />
      <CtaSection />
    </>
  )
}

/**
 * Der Absprung zum Rechner, an EINER Stelle.
 *
 * WAR EXTERN, IST JETZT INTERN: Bis Prompt 6 sprang dieser Button per
 * `target="_blank"` auf `apps/website` — der Nutzer verließ coolin.at, und der
 * Button trug ein „öffnet in neuem Tab"-Icon. Seit Prompt 7 führt er auf
 * `/peak-shaving/kalkulator/rechner`; dort läuft derselbe Rechner im iframe
 * innerhalb der coolin.at-Hülle. Damit entfallen `target`/`rel`/das
 * ExternalLink-Icon und der `sr-only`-Zusatz „öffnet in neuem Tab" — sie wären
 * jetzt schlicht falsch.
 *
 * Die externe URL ist NICHT weg, sie ist nur umgezogen: sie ist ab jetzt die
 * iframe-Quelle (`EMBEDDED_CALCULATOR_SRC` in `lib/config.ts`) und taucht auf
 * dieser Seite nicht mehr auf.
 *
 * `Link` aus `@/i18n/navigation` (nicht `next/link`): nur der setzt das
 * Locale-Präfix — bei der externen URL wäre genau das falsch gewesen, bei einer
 * internen Route ist es Pflicht.
 */
function CalculatorButton({ label, size = 'md' }: { label: string; size?: 'md' | 'lg' }) {
  return (
    <Button asChild variant="primary" size={size}>
      <Link href={CALCULATOR_RUN_HREF}>
        {label}
        <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      </Link>
    </Button>
  )
}

function CalculatorHero() {
  const t = useTranslations('PeakShavingCalculator.Hero')
  return (
    <Container className="py-16 sm:py-24">
      <Eyebrow>{t('eyebrow')}</Eyebrow>
      {/* Silbentrennung („Speicherempfehlung" sprengt bei 375px die Spalte) kommt
          seit Prompt 7 GLOBAL aus globals.css für h1/h2 — hier bewusst keine
          Wiederholung als Utility-Klasse. */}
      <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
      <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <CalculatorButton label={t('cta')} size="lg" />
        {/* Preis-Aussage als Badge NEBEN dem Button, nie im CTA-Text (§3.3) —
            der CTA-Text muss den Übergang frei→bezahlt überleben. */}
        <Badge variant="neutral">{t('badge')}</Badge>
      </div>
    </Container>
  )
}

function LeistetSection() {
  const t = useTranslations('PeakShavingCalculator.Leistet')

  const features = [
    { title: t('f1Title'), text: t('f1Text') },
    { title: t('f2Title'), text: t('f2Text') },
    { title: t('f3Title'), text: t('f3Text') },
  ]

  return (
    <Section tone="alt">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-small text-text-muted">{feature.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Container>
    </Section>
  )
}

/**
 * Teaser vs. Pro (§5.4). Der Punkt ist die GEGENÜBERSTELLUNG, deshalb zwei
 * gleich gebaute Karten nebeneinander — unterschieden nur durch den Rand und
 * die Farbe der Rolle. Kein „gut/schlecht": Der Schnellrechner ist die richtige
 * Antwort auf eine andere Frage, und er bleibt verlinkt.
 */
function VergleichSection() {
  const t = useTranslations('PeakShavingCalculator.Vergleich')

  const columns = [
    {
      title: t('teaserTitle'),
      sub: t('teaserSub'),
      accent: false,
      items: [t('teaser1'), t('teaser2'), t('teaser3'), t('teaser4')],
    },
    {
      title: t('proTitle'),
      sub: t('proSub'),
      accent: true,
      items: [t('pro1'), t('pro2'), t('pro3'), t('pro4')],
    },
  ]

  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {columns.map((column) => (
            <Card key={column.title} className={column.accent ? 'border-accent-border' : undefined}>
              <CardHeader>
                <p
                  className={
                    column.accent
                      ? 'text-label uppercase text-accent'
                      : 'text-label uppercase text-text-muted'
                  }
                >
                  {column.sub}
                </p>
                <CardTitle>{column.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {column.items.map((item) => (
                    <li key={item} className="flex gap-3 text-small text-text-muted">
                      {/* Neutraler Strich als Marker statt eines Häkchens: Ein
                          Häkchen läse sich als „erfüllt/nicht erfüllt" — hier
                          stehen aber zwei gültige Werkzeuge nebeneinander. */}
                      <span
                        aria-hidden="true"
                        className="mt-2.5 h-px w-3 shrink-0 bg-line-strong"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-prose text-body text-text">{t('note')}</p>

        <p className="mt-4 text-small">
          <TextLink href="/peak-shaving">{t('teaserLink')}</TextLink>
        </p>
      </Container>
    </Section>
  )
}

/**
 * Screenshots — bis OP#7 (Owner: Andreas) sind das PLATZHALTER, sichtbar als
 * solche. Begründung, warum hier bewusst kein Fake-UI steht:
 * `components/peak-shaving/screenshot-placeholder.tsx`.
 */
function ScreensSection() {
  const t = useTranslations('PeakShavingCalculator.Screens')
  const tPrivacy = useTranslations('PeakShavingCalculator.Privacy')

  return (
    <Section tone="alt">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <ScreenshotPlaceholder label={t('shot1Label')} caption={t('shot1Caption')} />
          <ScreenshotPlaceholder label={t('shot2Label')} caption={t('shot2Caption')} />
        </div>

        {/* Getönte Akzent-Fläche über das `*-subtle`-Token — KEIN /alpha auf
            var()-Hex-Tokens: Tailwind verwirft das still (DESIGN.md). */}
        <div className="mt-10 rounded-lg border border-accent-border bg-accent-subtle p-5 sm:p-6">
          <h3 className="text-h4 text-ink">{tPrivacy('title')}</h3>
          <p className="mt-2 max-w-prose text-small text-text">{tPrivacy('text')}</p>
        </div>
      </Container>
    </Section>
  )
}

function CtaSection() {
  const t = useTranslations('PeakShavingCalculator.Cta')

  return (
    <section className="bg-navy text-navy-foreground">
      <Container className="py-16 sm:py-24">
        <div className="max-w-prose">
          <h2 className="text-h2 text-navy-foreground">{t('title')}</h2>
          <p className="mt-5 text-body text-white/80">{t('lead')}</p>

          <div className="mt-8">
            <CalculatorButton label={t('cta')} size="lg" />
          </div>

          {/*
           * Stand Prompt 6 warnte hier ein Hinweis, dass der Klick auf eine
           * FREMDE Adresse führt. Das stimmt nicht mehr — der Rechner läuft jetzt
           * in dieser Hülle. Statt den Satz ersatzlos zu streichen, steht hier
           * die Zusage, die an dieser Stelle wirklich zählt und die der Rechner
           * einlöst (Kalkulator-Prinzip 4: die Daten verlassen den Browser nicht).
           */}
          <p className="mt-8 border-t border-white/20 pt-6 text-caption text-white/70">
            {t('external')}
          </p>
        </div>
      </Container>
    </section>
  )
}
