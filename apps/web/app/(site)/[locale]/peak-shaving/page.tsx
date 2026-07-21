import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { Link as TextLink } from '@/components/ui/link'
import { QuickCalculator } from '@/components/quick-calculator'
import { LoadCurveChart } from '@/components/peak-shaving/load-curve-chart'
import { loadLeadCaptureTexts, type LeadCaptureConsentTexts } from '@/lib/leads/capture-texts'
import { CTA_HREF } from '@/lib/nav'
import { pageAlternates } from '@/lib/seo'

/**
 * ISR statt „einmal statisch für immer" (B3-2) — dieselbe Begründung wie auf `/kontakt` und
 * `/branchen/handwerk`: der Einwilligungswortlaut der Erfassung unter dem Schnellrechner kommt aus
 * `platform.consent_texts` (append-only) und soll ohne Deploy nachziehen können.
 */
export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'PeakShaving' })
  const tHero = await getTranslations({ locale, namespace: 'PeakShaving.Hero' })
  return {
    title: `${tHero('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    alternates: pageAlternates(locale, '/peak-shaving'),
  }
}

/**
 * Peak-Shaving-Erklärseite (Pflichtenheft §5.2a) — die Info-Intent-Hälfte des
 * Flaggschiffs. Sie erklärt die METHODE; die Produkt-/Kaufseite ist
 * `/peak-shaving/kalkulator` (§5.2b). Die Trennung ist Absicht: zwei Intents,
 * zwei Seiten, kein Keyword doppelt (§6.2).
 *
 * Aufbau folgt §5.2a: Was es ist → Leistungspreis vs. Arbeitspreis → RLM →
 * Diagramm → physikalische vs. RLM-Kappung → Speicher/Steuerung/Strategie →
 * Cross-Links → Schnellrechner + CTA zum Kalkulator.
 *
 * KEIN SIGNATURE-MOTIV: kanonischer Ort ist der Footer (DESIGN.md), der auf
 * dieser Seite bereits läuft. Ein Auftritt hier wäre der zweite.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  /*
   * B3-2: DER PLATZIERTE SCHNELLRECHNER. Von den vier Einbettungen des Schnellrechners (Startseite,
   * Branchenseiten, Artikel, hier) trägt genau diese die Zusendung des Ergebnisses — sie ist die
   * einzige, bei der der Rechner der Zweck des Abschnitts ist und nicht Beiwerk. Die anderen drei
   * bleiben unverändert.
   *
   * Die Texte werden HIER geladen und durchgereicht, weil `QuickCalculator` eine Client-Komponente
   * ist und keine Datenbank sehen darf.
   */
  const leadCaptureTexts = await loadLeadCaptureTexts('rechnerergebnis', locale)

  return (
    <>
      <PeakHero />
      <PreisSection />
      <RlmSection />
      <ChartSection />
      <KappungSection />
      <ZusammenspielSection />
      <RelatedSection />
      <CtaSection leadCaptureTexts={leadCaptureTexts} />
    </>
  )
}

function PeakHero() {
  const t = useTranslations('PeakShaving.Hero')
  return (
    <Container className="py-16 sm:py-24">
      <Eyebrow>{t('eyebrow')}</Eyebrow>
      {/* „die Regel gehört an die Stufe, nicht an den Zufall eines kurzen Titels" —
          seit Prompt 7 eingelöst: h1/h2 trennen global (globals.css). */}
      <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
      <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>
      <p className="mt-5 max-w-prose text-body text-text-muted">{t('intro')}</p>
    </Container>
  )
}

/**
 * Leistungspreis vs. Arbeitspreis. Zwei gleichrangige Karten nebeneinander,
 * weil der Punkt der Sektion der KONTRAST ist — untereinander läse es sich als
 * Reihenfolge/Wichtung statt als Gegenüberstellung.
 */
function PreisSection() {
  const t = useTranslations('PeakShaving.Preis')

  const cards = [
    {
      title: t('arbeitTitle'),
      unit: t('arbeitUnit'),
      text: t('arbeitText'),
      hint: t('arbeitHint'),
    },
    {
      title: t('leistungTitle'),
      unit: t('leistungUnit'),
      text: t('leistungText'),
      hint: t('leistungHint'),
    },
  ]

  return (
    <Section tone="alt">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {cards.map((card) => (
            <Card key={card.title}>
              <CardHeader>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <CardTitle>{card.title}</CardTitle>
                  {/* Die Einheit IST hier die halbe Erklärung: „ct/kWh" vs.
                      „€/kW·a" macht den Unterschied sichtbar, bevor der Text
                      ihn ausformuliert. tabular-nums über <Num> braucht es
                      nicht — es sind keine Zahlen, die verglichen werden. */}
                  <span className="text-small font-semibold text-accent">{card.unit}</span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-body text-text-muted">{card.text}</p>
                <p className="mt-4 border-t border-line pt-4 text-small font-medium text-ink">
                  {card.hint}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-prose text-body text-text">{t('note')}</p>
      </Container>
    </Section>
  )
}

function RlmSection() {
  const t = useTranslations('PeakShaving.Rlm')
  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <div className="mt-5 max-w-prose space-y-4 text-body text-text-muted">
          <p>{t('text1')}</p>
          <p>{t('text2')}</p>
          <p className="text-text">{t('text3')}</p>
        </div>
      </Container>
    </Section>
  )
}

/**
 * Das Diagramm (§5.2a, §7.5). Die Kurve ist SYNTHETISCH — die Kennzeichnung
 * trägt der Eyebrow („Beispielhafte Darstellung") UND der Disclaimer unter dem
 * Chart, beide sichtbar und nicht nur im Code (§9.5). Details zur Herkunft der
 * Daten: `components/peak-shaving/load-curve-chart.tsx`.
 */
function ChartSection() {
  const t = useTranslations('PeakShaving.Chart')
  return (
    <Section tone="alt">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        {/* Weißer Kartengrund unter dem Chart: Die in DESIGN.md gemessenen
            Kontraste sind gegen Weiß vermessen — und die Achsenbeschriftung
            steht auf `surface-alt` sonst auf einem zweiten, ungemessenen Ton. */}
        <Card className="mt-8">
          <CardContent className="pt-5">
            <LoadCurveChart />
          </CardContent>
        </Card>

        <p className="mt-4 max-w-prose text-caption text-text-muted">{t('disclaimer')}</p>
      </Container>
    </Section>
  )
}

function KappungSection() {
  const t = useTranslations('PeakShaving.Kappung')

  const modes = [
    { title: t('physTitle'), text: t('physText') },
    { title: t('rlmTitle'), text: t('rlmText') },
  ]

  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          {modes.map((mode) => (
            <div key={mode.title} className="border-t border-line-strong pt-4">
              <h3 className="text-h3 text-ink">{mode.title}</h3>
              <p className="mt-3 text-body text-text-muted">{mode.text}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-prose text-body text-text">{t('note')}</p>
      </Container>
    </Section>
  )
}

function ZusammenspielSection() {
  const t = useTranslations('PeakShaving.Zusammenspiel')

  const parts = [
    { title: t('p1Title'), text: t('p1Text') },
    { title: t('p2Title'), text: t('p2Text') },
    { title: t('p3Title'), text: t('p3Text') },
  ]

  return (
    <Section tone="alt">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {parts.map((part) => (
            <Card key={part.title}>
              <CardHeader>
                <CardTitle>{part.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-small text-text-muted">{part.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-prose text-body text-text">{t('note')}</p>
      </Container>
    </Section>
  )
}

/**
 * Interne Verlinkung (§4.2/§6.4): Die Leistungs-Seiten und das Flaggschiff
 * verweisen aufeinander. Bewusst nur zwei Ziele — PV/Speicher (dieselbe
 * Batterie, mehrere Nutzen) und Energiemanagement (die Datengrundlage).
 */
function RelatedSection() {
  const t = useTranslations('PeakShaving.Related')

  const links = [
    { title: t('pvTitle'), text: t('pvText'), href: '/leistungen/pv-speicher' },
    { title: t('emTitle'), text: t('emText'), href: '/leistungen/energiemanagement' },
  ]

  return (
    <Section>
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-body text-text-muted">{t('lead')}</p>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.href}>
              <TextLink variant="standalone" href={link.href} className="group block">
                <span className="flex items-center gap-2 text-h4">
                  {link.title}
                  <ArrowRight
                    className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
                <span className="mt-1 block text-small text-text-muted">{link.text}</span>
              </TextLink>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}

/**
 * Abschluss der Seite: der wiederverwendbare Schnellrechner (§5.4) + der CTA
 * zur Produktseite. Der Rechner wird hier NICHT neu gebaut — es ist exakt die
 * Komponente der Startseite, mit denselben Default-Werten. Sie bringt ihren
 * eigenen hellen Kartengrund mit und funktioniert deshalb auch auf Navy.
 *
 * WARUM DER SEKTIONS-CTA SEKUNDÄR IST: Der Schnellrechner trägt bereits einen
 * eigenen Primary („Zum Kalkulator") auf DASSELBE Ziel. Zwei Teal-Buttons auf
 * dasselbe Ziel in einer Sektion sind genau der Fehler, der auf der Startseite
 * gerade behoben wurde (DESIGN.md „Akzent sparsam"). Der Primary bleibt dort,
 * wo er am meisten wiegt: direkt unter der gerechneten Zahl. Dieser hier ist
 * der Weg für alle, die gar nicht erst schätzen wollen.
 */
function CtaSection({ leadCaptureTexts }: { leadCaptureTexts: LeadCaptureConsentTexts }) {
  const t = useTranslations('PeakShaving.Cta')

  return (
    <section className="bg-navy text-navy-foreground">
      <Container className="py-16 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            {/* Auf Navy trägt der Eyebrow den hellen Knoten-Ton — Teal 700
                erreicht gegen #18336f kein AA (gleiche Regel wie auf der
                Startseite). */}
            <Eyebrow className="text-node">{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-h2 text-navy-foreground">{t('title')}</h2>
            <p className="mt-5 max-w-prose text-body text-white/80">{t('lead')}</p>

            <Button asChild variant="secondary" size="md" className="mt-8">
              <Link href={CTA_HREF}>{t('cta')}</Link>
            </Button>
          </div>

          <div>
            <QuickCalculator capture={{ consentTexts: leadCaptureTexts }} />
          </div>
        </div>
      </Container>
    </section>
  )
}
