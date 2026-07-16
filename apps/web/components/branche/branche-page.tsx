import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { Link as TextLink } from '@/components/ui/link'
import { QuickCalculator } from '@/components/quick-calculator'
import { FaqSection, type FaqItem } from '@/components/faq-section'
import { TagesverlaufChart } from '@/components/branche/tagesverlauf-chart'
import { findBranche, FLAGSHIP_LINKS, type Branche } from '@/lib/branchen'
import { KONTAKT_HREF } from '@/lib/nav'
import { pageAlternates } from '@/lib/seo'

/**
 * DAS Template aller 4 Branchenseiten (Pflichtenheft §5.3).
 *
 * Exakt nach dem Muster von `components/leistung/leistung-page.tsx`: Es gibt
 * genau diese eine Layout-Datei; die 4 Routen unter
 * `app/(site)/[locale]/branchen/*` sind je vier Zeilen, die hier einen
 * `brancheKey` hereinreichen. Struktur und Daten kommen aus `lib/branchen.ts`,
 * die Texte aus `messages/de.json` (`Branchen.Pages.<key>`).
 *
 * Aufbau (§5.3): Hero (Schmerz) → Tageslastverlauf → passende Hebel →
 * Kostentreiber → FAQ → Schnellrechner → „Was wir für … tun" → Kontakt-CTA.
 *
 * DIE PRIMÄRE AKTION IST KONTAKT (§3.1 Beratungs-Achse) — wie bei den
 * Leistungen. Der Kalkulator ist die Produkt-Achse und steht auf halbem Weg:
 * als Hebel-Cross-Link und als der Button, den der Schnellrechner ohnehin
 * mitbringt. Er nimmt dem Abschluss nicht die Bühne.
 *
 * SEKTIONS-TÖNE: weiß / alt / weiß / alt / weiß / alt / weiß / navy — derselbe
 * Wechsel wie im Leistungs-Template, nur zwei Sektionen länger. Zwei gleichfarbige
 * Sektionen nebeneinander würden die Kante zwischen ihnen verschlucken.
 *
 * KEIN SIGNATURE-MOTIV: kanonischer Ort ist der Footer (DESIGN.md), der auf
 * diesen Seiten bereits läuft. Ein Auftritt hier wäre der zweite.
 */

/** Der Titel-/Description-Bau ist für alle 4 Seiten identisch — also einmal. */
export async function brancheMetadata(locale: string, key: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: `Branchen.Pages.${key}` })
  return {
    title: `${t('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    // Pfad aus `lib/nav.ts` über `findBranche` — gleiche Begründung wie im
    // Leistungs-Template: der Canonical darf keinen zweiten Fundort haben (§4.1).
    alternates: pageAlternates(locale, findBranche(key).href),
  }
}

export function BranchePage({ brancheKey }: { brancheKey: string }) {
  const branche = findBranche(brancheKey)

  return (
    <>
      <BrancheHero branche={branche} />
      <LastgangSection branche={branche} />
      <HebelSection branche={branche} />
      <KostentreiberSection branche={branche} />
      <BrancheFaq branche={branche} />
      <RechnerSection branche={branche} />
      <TunSection branche={branche} />
      <KontaktCta branche={branche} />
    </>
  )
}

/** Namespace-Helfer: jede Sektion liest aus demselben Seiten-Block. */
function usePage(branche: Branche) {
  return useTranslations(`Branchen.Pages.${branche.key}`)
}

/** Hero: der branchenspezifische Schmerz (§5.3 Nr. 1). */
function BrancheHero({ branche }: { branche: Branche }) {
  const t = usePage(branche)
  const tCommon = useTranslations('Branchen')
  const Icon = branche.icon

  return (
    <Container className="py-16 sm:py-24">
      {/* Icon klein und einfarbig neben dem Eyebrow — gleiche Platzierung wie im
          Leistungs-Hero, damit beide Seitentypen als ein System lesen. */}
      <div className="flex items-center gap-2.5">
        <Icon className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />
        <Eyebrow>{tCommon('eyebrow')}</Eyebrow>
      </div>
      <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
      <p className="mt-5 max-w-prose text-lead text-text">{t('promise')}</p>
      <p className="mt-5 max-w-prose text-body text-text-muted">{t('intro')}</p>
    </Container>
  )
}

/**
 * „Wo Ihr Strom hingeht" (§5.3 Nr. 2) — der schematische Tageslastverlauf.
 *
 * §9.5: Titel und Caption kennzeichnen das Bild SICHTBAR als Schema. Beide sind
 * bewusst GETEILTE Keys (`Branchen.Chart`), nicht je Branche kopiert: Die
 * Aussage „das ist keine Messung" muss auf allen vier Seiten wortgleich stehen
 * und darf nicht an einer Stelle verwässert werden können. Was sich je Branche
 * unterscheidet, ist der `lead` darüber — er erklärt DIESE Kurve.
 */
function LastgangSection({ branche }: { branche: Branche }) {
  const t = usePage(branche)
  const tChart = useTranslations('Branchen.Chart')

  return (
    <Section tone="alt">
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{tChart('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('chart.lead')}</p>

        {/* Weißer Kartengrund unter dem Chart: Die in DESIGN.md gemessenen
            Kontraste sind gegen Weiß vermessen — auf `surface-alt` stünde die
            Achsenbeschriftung sonst auf einem zweiten, ungemessenen Ton.
            Gleiche Lösung wie die Chart-Sektion auf /peak-shaving. */}
        <Card className="mt-8">
          <CardContent className="pt-5">
            <TagesverlaufChart profile={branche.profile} />
          </CardContent>
        </Card>

        <p className="mt-4 max-w-prose text-caption text-text-muted">{tChart('caption')}</p>
      </Container>
    </Section>
  )
}

/**
 * Passende Hebel (§5.3 Nr. 3) — die Leistungen als Kacheln, das Flaggschiff
 * hervorgehoben daneben.
 *
 * Die Kachel-Optik ist die der Leistungs-Übersicht (gleiche Karte, gleiches
 * Icon, gleicher Pfeil): Wer von `/leistungen` kommt, erkennt dieselbe Sache
 * wieder. Der Titel des Links IST das Nav-Label (`tNav`), der Erklärtext kommt
 * von DIESER Seite — warum ausgerechnet die Bäckerei auf Smart Heating zeigt,
 * ist eine andere Aussage als beim Hotel.
 *
 * DAS FLAGGSCHIFF IST KEINE VIERTE KACHEL (§4.2), sondern ein eigener,
 * abgesetzter Block — exakt wie in `leistungen-overview.tsx`. Sein Text ist
 * branchenspezifisch, und im Handel sagt er ausdrücklich, dass Peak Shaving
 * dort selten der erste Hebel ist (§9.5: keine Zusage, die das Lastprofil nicht
 * hergibt).
 */
function HebelSection({ branche }: { branche: Branche }) {
  const t = usePage(branche)
  const tNav = useTranslations('Nav')

  return (
    <Section>
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('hebel.title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('hebel.lead')}</p>

        {/* `items-stretch` (Grid-Default) + `h-full`: gleiche Höhen, eine Baseline.
            Der Pfeil sitzt über `mt-auto` immer am unteren Rand. */}
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branche.hebel.map((link) => {
            const Icon = link.icon
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Icon
                    className="h-5 w-5 shrink-0 text-text-muted"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <h3 className="mt-4 text-h4 text-ink">{tNav(link.navKey)}</h3>
                  <p className="mt-2 text-small text-text-muted">{t(`hebel.${link.key}`)}</p>
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

        {/* Der prominente Verweis aufs Flaggschiff. Akzent-Fläche statt eines
            weiteren Teal-Buttons: Der laute Punkt der Seite bleibt der Kontakt
            am Ende (DESIGN.md „Akzent sparsam"). */}
        <div className="mt-10 max-w-prose rounded-lg border border-accent-border bg-accent-subtle p-6">
          <h3 className="text-h3 text-ink">{t('hebel.flagshipTitle')}</h3>
          <p className="mt-3 text-body text-text">{t('hebel.flagshipText')}</p>
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            {FLAGSHIP_LINKS.map((link) => (
              <li key={link.href}>
                <TextLink
                  variant="standalone"
                  href={link.href}
                  className="group inline-flex items-center gap-2 text-small"
                >
                  {tNav(link.navKey)}
                  <ArrowRight
                    className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </Section>
  )
}

/**
 * Kostentreiber & Hebel in der Branche (§5.3 Nr. 4) — QUALITATIV.
 *
 * §9.5 / §5.3 Nr. 4 verlangen für Benchmarks echte, verlinkbare Quellen und
 * Ranges statt Scheingenauigkeit. Wir haben diese Quellen nicht — also steht
 * hier KEINE Zahl. Kein „bis zu 30 %", kein „typischerweise 200 kW". Die
 * Aussagen sind fachliche Zusammenhänge, die ohne Messung gelten; die Zahl zum
 * eigenen Betrieb liefert der Lastgang, nicht diese Seite.
 *
 * Form: Trennlinie + Überschrift + Absatz, zweispaltig — dieselbe ruhige
 * Gegenüberstellung wie `KappungSection` auf /peak-shaving. Bewusst KEINE
 * Karten: Das sind Feststellungen, keine Features.
 */
function KostentreiberSection({ branche }: { branche: Branche }) {
  const t = usePage(branche)
  const items = t.raw('kostentreiber.items') as { title: string; text: string }[]

  return (
    <Section tone="alt">
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('kostentreiber.title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('kostentreiber.lead')}</p>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          {items.map((item) => (
            <div key={item.title} className="border-t border-line-strong pt-4">
              <h3 className="text-h3 text-ink">{item.title}</h3>
              <p className="mt-3 text-body text-text-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  )
}

/**
 * Kurze FAQ — die Fragen, die vor dem Erstgespräch kommen.
 *
 * Markup und Begründung (kein Accordion, Antworten im DOM) stehen jetzt in der
 * GETEILTEN `components/faq-section.tsx`: Der Wissen-Bereich trägt dieselbe FAQ,
 * nur aus einer anderen Quelle (Frontmatter statt Messages). Zwei Kopien
 * derselben Struktur wären zwei Gelegenheiten, dass ein späterer
 * FAQPage-JSON-LD (§6.4) und das sichtbare HTML auseinanderlaufen.
 *
 * Was hier bleibt, ist die Datenherkunft: `Branchen.Pages.<key>.faq` — die
 * Struktur (`items: [{ q, a }]`) ist unverändert.
 */
function BrancheFaq({ branche }: { branche: Branche }) {
  const t = usePage(branche)
  const items = t.raw('faq.items') as FaqItem[]

  return <FaqSection title={t('faq.title')} items={items} />
}

/**
 * Eingebetteter Schnellrechner (§5.3 Nr. 5 / §5.4).
 *
 * UNVERÄNDERT wiederverwendet — dieselbe Komponente wie auf der Startseite und
 * auf /peak-shaving, inklusive ihrer Default-Werte. Bewusst OHNE
 * branchenspezifische Vorbelegung: Eine Zahl, die auf `/branchen/baeckerei`
 * schon im Feld steht, liest sich als „so viel hat eine Bäckerei" — also als
 * Benchmark, den wir nicht belegen können (§9.5). Die Vorbelegung bleibt das
 * neutrale Rechenbeispiel, das die Komponente selbst als solches ausweist.
 *
 * KEIN ZWEITER CTA-BUTTON: Der Schnellrechner trägt bereits einen Primary („Zum
 * Kalkulator") auf die Produktseite — genau das geforderte Ziel. Ein zweiter
 * Button daneben wäre der Doppel-CTA-Fehler, der auf der Startseite und auf
 * /peak-shaving schon einmal behoben wurde. Links steht deshalb der Lead-in,
 * nicht ein Knopf, der dasselbe tut.
 */
function RechnerSection({ branche }: { branche: Branche }) {
  const t = usePage(branche)

  return (
    <Section tone="alt">
      <Container>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-h2 text-ink">{t('rechner.title')}</h2>
            <p className="mt-5 max-w-prose text-body text-text-muted">{t('rechner.lead')}</p>
          </div>
          <div>
            <QuickCalculator />
          </div>
        </div>
      </Container>
    </Section>
  )
}

/**
 * „Was wir für [Branche] tun" (§5.3 Nr. 6).
 *
 * OP#9 / §9.5: KEINE Referenzkunden, keine Testimonials, keine Logos, keine
 * „schon über X Betriebe". Was hier steht, sind FÄHIGKEITEN — überprüfbar an
 * dem, was wir tun, nicht an einer Behauptung über Dritte. Der Abschnitt heißt
 * im Pflichtenheft „Referenz / Was wir für [Branche] tun"; bis es echte,
 * freigegebene Referenzen gibt, ist nur die zweite Hälfte davon ehrlich.
 *
 * Nummerierte Sequenz statt Karten: Die Schritte haben eine Reihenfolge (lesen
 * vor bewerten vor umsetzen). Gleiche Form wie `VorgehenSection` im
 * Leistungs-Template und `components/home/vorgehen.tsx`.
 */
function TunSection({ branche }: { branche: Branche }) {
  const t = usePage(branche)
  const items = t.raw('tun.items') as { title: string; text: string }[]

  return (
    <Section>
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('tun.title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('tun.lead')}</p>

        <ol className="mt-10 space-y-8 sm:space-y-10">
          {items.map((item, i) => (
            <li key={item.title} className="grid gap-x-5 gap-y-2 sm:grid-cols-[3rem_1fr]">
              <span aria-hidden="true" className="text-h4 tabular-nums text-text-muted">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="max-w-prose border-t border-line-strong pt-3 sm:border-t-0 sm:pt-0">
                <h3 className="text-h3 text-ink">{item.title}</h3>
                <p className="mt-2 text-body text-text-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  )
}

/**
 * Abschluss: der EINE laute Punkt der Seite — das Gespräch (§3.1).
 *
 * Identisch zum Leistungs-Template, inklusive der Begründung für `secondary`:
 * Auf Navy trennt sich Teal 700 kaum vom Grund (2,05:1 Flächenkontrast #0f766e
 * gegen #18336f); die weiße Fläche liegt bei 12,06:1 und IST hier der Primary.
 * Der Eyebrow trägt aus demselben Grund den hellen Knoten-Ton.
 */
function KontaktCta({ branche }: { branche: Branche }) {
  const t = usePage(branche)
  const tCommon = useTranslations('Branchen')

  return (
    <section className="bg-navy text-navy-foreground">
      <Container className="py-16 sm:py-24">
        <div className="max-w-prose">
          <Eyebrow className="text-node">{tCommon('Cta.eyebrow')}</Eyebrow>
          <h2 className="mt-3 text-h2 text-navy-foreground">{t('cta.title')}</h2>
          <p className="mt-5 text-body text-white/80">{t('cta.lead')}</p>

          <Button asChild variant="secondary" size="lg" className="mt-8">
            <Link href={KONTAKT_HREF}>{tCommon('Cta.button')}</Link>
          </Button>
        </div>
      </Container>
    </section>
  )
}
