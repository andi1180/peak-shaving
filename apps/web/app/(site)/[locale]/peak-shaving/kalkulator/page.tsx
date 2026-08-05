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
import { ReportGallery } from '@/components/peak-shaving/report-gallery'
import { HowItWorks } from '@/components/peak-shaving/how-it-works'
import { EnergyFlow } from '@/components/peak-shaving/energy-flow'
import { JsonLd } from '@/components/json-ld'
import { kontaktHrefFor } from '@/lib/kontakt/themen'
import { calculatorLd } from '@/lib/json-ld'
import { canonicalUrl, pageAlternates } from '@/lib/seo'

/*
 * Der Pfad DIESER Route — bewusst literal und NICHT `CTA_HREF` (das denselben
 * Wert hat): `CTA_HREF` bedeutet „wohin der CTA im Header zeigt" — eine Aussage
 * über die Navigation, nicht über diese Route. Zeigte der CTA später woanders
 * hin, würde der Canonical dieser Seite still mitwandern.
 *
 * Steht als Konstante da, seit ihn zwei Stellen brauchen: der Canonical und die
 * `url` des `SoftwareApplication`-JSON-LD. Beide müssen dieselbe Adresse nennen.
 */
const KALKULATOR_HREF = '/peak-shaving/kalkulator'

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
    alternates: pageAlternates(locale, KALKULATOR_HREF),
  }
}

/**
 * Produktseite des Peak-Shaving Kalkulators (Pflichtenheft §5.2b) — die
 * Produkt-Intent-Hälfte des Flaggschiffs. Die Methode erklärt `/peak-shaving`;
 * hier steht, was das Werkzeug leistet und wie es sich vom freien Schnellrechner
 * unterscheidet (§5.4).
 *
 * DER CTA FÜHRT NICHT MEHR IN DEN RECHNER, sondern zur Kontaktanfrage — s. die
 * ausführliche Begründung an `KontaktanfrageButton` weiter unten. Der Rechner
 * selbst liegt unverändert in `apps/website` und läuft unter
 * `/peak-shaving/kalkulator/rechner` im iframe (`EMBEDDED_CALCULATOR_SRC` in
 * `lib/config.ts`); diese Seite verlinkt ihn nur nicht mehr direkt.
 *
 * OP#1 (Kalkulator frei vs. bezahlt) ist OFFEN: Diese Seite trifft deshalb KEINE
 * endgültige Preis-Aussage. Der Badge nennt nur den Ist-Zustand („Zugang auf
 * Anfrage") — kein Preis, keine Zusage über eine Bearbeitungsdauer, kein
 * „kostenlos testen" im CTA selbst (§3.3: Preis-Aussage höchstens als
 * Subtext/Badge neben dem Button).
 *
 * ⚠ DER BADGE SAGTE BIS B16-Einstieg „Derzeit frei zugänglich" — das war seit B10-2
 * unzutreffend: Die Rechner-Route verlangt seither eine Sitzung UND ein aktives
 * `calculator_pro`-Entitlement, vergeben über Gutscheincodes an ausgewählte
 * Betriebe (`lib/kalkulator/access.ts`). Wer nicht freigeschaltet ist, landet auf
 * dem Anfrage-Zustand (`components/peak-shaving/calculator-access-request.tsx`) —
 * die Seite versprach also einen Zugang, den sie nicht mehr gewährte. Wer den
 * Zugangsweg erneut ändert, ändert diesen Satz mit.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'PeakShavingCalculator' })

  return (
    <>
      {/*
       * Der Kalkulator als `SoftwareApplication` (§6.4) — OHNE Preis.
       *
       * Warum nicht `Product`, und warum kein `offers`: s. `calculatorLd`. Kurz:
       * OP#1 (frei vs. bezahlt) ist offen; §3.3 verbietet dieser Seite schon in
       * der sichtbaren Copy jede endgültige Preis-Aussage — im Markup gilt
       * dasselbe. Der Badge daneben sagt „Zugang auf Anfrage", und genau so viel
       * weiß auch das Markup: nämlich nichts über einen Preis.
       *
       * `name` ist ein eigener Message-Key und nicht der Nav-Label „Der
       * Kalkulator" oder der Hero-Eyebrow: Ein Produktname ist eine eigene Rolle
       * — die anderen beiden sind Menü- bzw. Layout-Text und dürfen sich ändern,
       * ohne dass die Anwendung anders heißt.
       */}
      <JsonLd
        schema={calculatorLd({
          name: t('appName'),
          description: t('metaDescription'),
          url: canonicalUrl(locale, KALKULATOR_HREF),
          locale,
        })}
      />
      <CalculatorHero />
      <LeistetSection />
      <VergleichSection />
      {/* Die zwei nativ nachgebauten Grafik-Sektionen (Prompt 7): erst erklären,
          wie es geht und was gerechnet wird … */}
      <HowItWorks />
      <EnergyFlow />
      {/*
       * … dann das ERGEBNIS zeigen, direkt vor dem Absprung (Prompt 9).
       *
       * Die Galerie stand bis Prompt 9 weiter oben (gleich nach dem
       * Schnellrechner-Vergleich) und trug nur Platzhalter-Rahmen. Mit echten
       * Report-Bildern gehört sie ans Ende: Der Beweis, dass das Werkzeug
       * liefert, wirkt unmittelbar vor der Handlungsaufforderung — nicht drei
       * Sektionen davor. Erklärung → Ergebnis → Start.
       *
       * Grund-Wechsel: Der Rhythmus alt/default/alt/…/navy bleibt erhalten,
       * weil HowItWorks und EnergyFlow ihre Töne getauscht haben (alt/default
       * statt default/alt). Ohne den Tausch stünden nach dem Umzug zwei
       * gleichfarbige Sektionen aneinander und die Kante zwischen ihnen wäre weg.
       */}
      <ReportGallery />
      <CtaSection />
    </>
  )
}

/**
 * Der CTA dieser Seite, an EINER Stelle — er führt zur KONTAKTANFRAGE.
 *
 * ZWEI MAL UMGEZOGEN, und der zweite Umzug ist der wichtige:
 * (1) Bis Prompt 6 sprang der Button per `target="_blank"` auf `apps/website` —
 *     der Nutzer verließ coolin.at.
 * (2) Ab Prompt 7 führte er auf `/peak-shaving/kalkulator/rechner`, den Rechner
 *     im iframe innerhalb der coolin.at-Hülle.
 * (3) Seit B18-4 ist genau das eine FALSCHE ZUSAGE für nahezu jeden Besucher:
 *     die Rechner-Route verlangt eine Sitzung UND ein aktives
 *     `calculator_pro`-Entitlement (`lib/kalkulator/access.ts`). Wer nicht
 *     angemeldet ist, wird auf `/anmelden` umgeleitet; wer angemeldet, aber
 *     nicht freigeschaltet ist, landet auf dem Anfrage-Zustand. Ein Knopf
 *     „Kalkulator starten" versprach damit einen Start, den er nicht liefern
 *     kann — und der Badge daneben sagt seit dem B16-Einstieg das Gegenteil
 *     („Zugang auf Anfrage").
 *
 * Der Knopf führt deshalb dorthin, wo die Anfrage tatsächlich hingehört:
 * `/kontakt?thema=peakShaving`, der BESTEHENDE Deep-Link — kein neuer Parameter
 * und kein zweiter Kontaktweg. Er wird über `kontaktHrefFor` gebaut und nicht
 * als Zeichenkette getippt: die Funktion WIRFT bei einem unbekannten Thema, ein
 * Tippfehler wäre sonst ein Deep-Link, der still auf „Bitte wählen" stehen
 * bliebe (`lib/kontakt/themen.ts`).
 *
 * ⚠ DIE RECHNER-ROUTE BLEIBT UNANGETASTET und ist weiter erreichbar (Lesezeichen,
 * Portal-Reiter „Kalkulator", `/konto`) — sie ist hier nur nicht mehr der Knopf,
 * den ein anonymer Besucher als Erstes sieht. `CALCULATOR_RUN_HREF` wird von
 * dieser Datei folglich nicht mehr importiert.
 *
 * `Link` aus `@/i18n/navigation` (nicht `next/link`): nur der setzt das
 * Locale-Präfix. Der Query-Teil reist dabei mit — im Browserlauf gemessen.
 */
function KontaktanfrageButton({ label, size = 'md' }: { label: string; size?: 'md' | 'lg' }) {
  return (
    <Button asChild variant="primary" size={size}>
      <Link href={kontaktHrefFor('peakShaving')}>
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
        <KontaktanfrageButton label={t('cta')} size="lg" />
        {/* Zugangs-/Preis-Aussage als Badge NEBEN dem Button, nie im CTA-Text (§3.3) —
            der CTA-Text muss den Übergang frei→bezahlt überleben. Der Badge selbst
            benennt den Ist-Zustand seit B10-2: Zugang auf Anfrage. Knopf und Badge
            sagen seit B18-4 dasselbe („Zugang anfragen" / „Zugang auf Anfrage")
            statt einander zu widersprechen — das ist der Grund, warum der Badge
            unverändert bleiben konnte. */}
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

function CtaSection() {
  const t = useTranslations('PeakShavingCalculator.Cta')

  return (
    <section className="bg-navy text-navy-foreground">
      <Container className="py-16 sm:py-24">
        <div className="max-w-prose">
          <h2 className="text-h2 text-navy-foreground">{t('title')}</h2>
          <p className="mt-5 text-body text-white/80">{t('lead')}</p>

          <div className="mt-8">
            <KontaktanfrageButton label={t('cta')} size="lg" />
          </div>

          {/*
           * DER SATZ HAT DREIMAL DIE AUSSAGE GEWECHSELT, WEIL DER KNOPF ES TAT:
           * Stand Prompt 6 warnte er vor dem Sprung auf eine FREMDE Adresse; ab
           * Prompt 7 trug er die Zusage, die der Rechner in dieser Hülle einlöst
           * (Kalkulator-Prinzip 4: die Daten verlassen den Browser nicht). Beides
           * setzt voraus, dass der Knopf in den Rechner führt — seit B18-4 tut er
           * das nicht mehr, und eine Datenschutz-Zusage über eine Verarbeitung,
           * die auf den nächsten Klick gar nicht folgt, wäre eine Zusage über
           * etwas anderes, als hier gerade passiert.
           *
           * Jetzt sagt er schlicht, was der Klick auslöst: eine Anfrage, auf die
           * wir uns melden. Bewusst OHNE Zusage über die Bearbeitungsdauer und
           * ohne Preis (OP#1 offen) — dieselbe Leitplanke wie bei den übrigen
           * Anfrage-Texten (`CalculatorFrame.access`, `PartnerBewerbung.*`).
           *
           * Der Schlüssel hiess bis B18-4 `external` — ein Name aus der Zeit des
           * externen Absprungs, der für einen Hinweis auf das EIGENE Kontaktformular
           * in die Irre führt (dieselbe Umbenennung und derselbe Grund wie
           * `Nav.cta` → `Nav.partner` in Prompt 25).
           */}
          <p className="mt-8 border-t border-white/20 pt-6 text-caption text-white/70">
            {t('ctaNote')}
          </p>
        </div>
      </Container>
    </section>
  )
}
