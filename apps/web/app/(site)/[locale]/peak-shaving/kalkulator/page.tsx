import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { useTranslations } from 'next-intl'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { Link as TextLink } from '@/components/ui/link'
import { ScreenshotPlaceholder } from '@/components/peak-shaving/screenshot-placeholder'
import { EXTERNAL_CALCULATOR_URL } from '@/lib/config'

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
      <CtaSection />
    </>
  )
}

/**
 * Der externe Absprung, an EINER Stelle.
 *
 * `target="_blank"` + `rel="noopener noreferrer"`: Der Kalkulator ist eine
 * fremde Origin; `noopener` nimmt der geöffneten Seite den `window.opener`-Zugriff.
 *
 * BEWUSST ein plain `<a>`, NICHT der Link aus `@/i18n/navigation`: Letzterer
 * setzt das Locale-Präfix — auf einer externen URL wäre das falsch.
 *
 * „Öffnet in neuem Tab" ist doppelt signalisiert: sichtbar über das Line-Icon
 * (Konvention) und für Screenreader über den `sr-only`-Zusatz IM Linktext. Ein
 * `aria-label` allein hätte den sichtbaren Text ersetzt statt ihn zu ergänzen.
 */
function ExternalCalculatorButton({
  label,
  hint,
  size = 'md',
}: {
  label: string
  hint: string
  size?: 'md' | 'lg'
}) {
  return (
    <Button asChild variant="primary" size={size}>
      <a href={EXTERNAL_CALCULATOR_URL} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalLink className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">({hint})</span>
      </a>
    </Button>
  )
}

function CalculatorHero() {
  const t = useTranslations('PeakShavingCalculator.Hero')
  return (
    <Container className="py-16 sm:py-24">
      <Eyebrow>{t('eyebrow')}</Eyebrow>
      {/*
       * `hyphens-auto break-words`: „Speicherempfehlung" ist bei text-h1 (40 px,
       * feste Stufe) breiter als die 343 px Textspalte eines 375-px-Geräts und
       * lief ohne das hier sichtbar aus dem Bild. Die globale `overflow-x`-Bremse
       * in globals.css verhindert dabei nur die Scrollleiste — sie SCHNEIDET das
       * Wort ab, statt es zu retten. Deutsche Komposita sind auf einer AT-Seite
       * der Normalfall, nicht der Sonderfall: `hyphens-auto` trennt sie sauber
       * (greift, weil <html lang="de"> gesetzt ist), `break-words` ist das Netz
       * für Wörter ohne Trennstelle.
       */}
      <h1 className="mt-3 max-w-prose hyphens-auto break-words text-h1 text-ink">{t('title')}</h1>
      <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <ExternalCalculatorButton label={t('cta')} hint={t('ctaHint')} size="lg" />
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
            <ExternalCalculatorButton label={t('cta')} hint={t('hint')} size="lg" />
          </div>

          {/*
           * Der Hinweis auf den externen Absprung gehört sichtbar auf die Seite,
           * nicht nur in einen Code-Kommentar: Wer hier klickt, landet auf einer
           * anderen Adresse als coolin.at — das darf keine Überraschung sein.
           * Fällt in Phase 2 mit der Konsolidierung weg (§8.1, lib/config.ts).
           */}
          <p className="mt-8 border-t border-white/20 pt-6 text-caption text-white/70">
            {t('external')}
          </p>
        </div>
      </Container>
    </section>
  )
}
