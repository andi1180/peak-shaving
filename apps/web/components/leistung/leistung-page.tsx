import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { Link as TextLink } from '@/components/ui/link'
import { kontaktHrefFor } from '@/lib/kontakt/themen'
import { findLeistung, type Leistung } from '@/lib/leistungen'
import { pageAlternates } from '@/lib/seo'

/**
 * DAS Template aller 6 Leistungsseiten (Pflichtenheft §5.1).
 *
 * Es gibt genau diese eine Layout-Datei; die 6 Routen unter
 * `app/(site)/[locale]/leistungen/*` sind je vier Zeilen, die hier einen
 * `leistungKey` hereinreichen. Struktur und Daten kommen aus `lib/leistungen.ts`,
 * die Texte aus `messages/de.json` (`Leistungen.Pages.<key>`).
 *
 * Aufbau (§5.1 „Problem → Vorgehen → Nutzen → Cross-Link"):
 *   Hero (Nutzenversprechen) → Ausgangslage → Was wir tun → Nutzen →
 *   Cross-Links → Kontakt-CTA.
 *
 * DIE PRIMÄRE AKTION IST KONTAKT, nicht der Kalkulator. Leistungen sind die
 * BERATUNGS-Achse (§3.1: „Wir machen es für Sie", High-Touch, Lead-Gen); der
 * Kalkulator ist die PRODUKT-Achse (Self-Service). Der Kalkulator taucht hier
 * deshalb höchstens als Cross-Link auf — und auch das nur, wo er wirklich das
 * nächste Werkzeug ist (s. CROSS_LINKS in lib/leistungen.ts).
 *
 * KEIN SIGNATURE-MOTIV: kanonischer Ort ist der Footer (DESIGN.md), der auf
 * diesen Seiten bereits läuft. Ein Auftritt hier wäre der zweite.
 */

/** Der Titel-/Description-Bau ist für alle 6 Seiten identisch — also einmal. */
export async function leistungMetadata(locale: string, key: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: `Leistungen.Pages.${key}` })
  return {
    title: `${t('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    /*
     * Der Canonical kommt aus `findLeistung(key).href` — also aus `lib/nav.ts`,
     * derselben Quelle, aus der auch die Route und jeder Link auf sie stammen.
     * Ein hier getippter Pfad wäre eine zweite Stelle, an der ein Slug-Wechsel
     * vergessen werden kann (§4.1).
     */
    alternates: pageAlternates(locale, findLeistung(key).href),
  }
}

export function LeistungPage({ leistungKey }: { leistungKey: string }) {
  const leistung = findLeistung(leistungKey)

  return (
    <>
      <LeistungHero leistung={leistung} />
      <AusgangslageSection leistung={leistung} />
      <VorgehenSection leistung={leistung} />
      <NutzenSection leistung={leistung} />
      <CrossLinkSection leistung={leistung} />
      <KontaktCta leistung={leistung} />
    </>
  )
}

/** Namespace-Helfer: jede Sektion liest aus demselben Seiten-Block. */
function usePage(leistung: Leistung) {
  return useTranslations(`Leistungen.Pages.${leistung.key}`)
}

function LeistungHero({ leistung }: { leistung: Leistung }) {
  const t = usePage(leistung)
  const tCommon = useTranslations('Leistungen')
  const Icon = leistung.icon

  return (
    <Container className="py-16 sm:py-24">
      {/* Das Icon ist hier das EINZIGE Grafik-Element der Seite — klein, einfarbig,
          neben dem Eyebrow statt als Kachel-Deko. */}
      <div className="flex items-center gap-2.5">
        <Icon className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />
        <Eyebrow>{tCommon('eyebrow')}</Eyebrow>
      </div>
      <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
      {/* Ein Satz Nutzenversprechen, Service-Intent (§6.2). */}
      <p className="mt-5 max-w-prose text-lead text-text">{t('promise')}</p>
    </Container>
  )
}

/** Problem/Ausgangslage — kurz, in der Sprache des Kunden, kein Fachjargon. */
function AusgangslageSection({ leistung }: { leistung: Leistung }) {
  const t = usePage(leistung)
  const paragraphs = t.raw('problem.text') as string[]

  return (
    <Section tone="alt">
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('problem.title')}</h2>
        <div className="mt-5 max-w-prose space-y-4 text-body text-text-muted">
          {paragraphs.map((p, i) => (
            // Der erste Absatz ist die Zuspitzung und trägt den dunkleren Ton —
            // Hierarchie über Ton, nicht über eine zweite Farbe.
            <p key={p} className={i === 0 ? 'text-lead text-text' : undefined}>
              {p}
            </p>
          ))}
        </div>
      </Container>
    </Section>
  )
}

/**
 * Was wir tun / Vorgehen — die konkreten Leistungsbausteine.
 *
 * Nummerierte Liste statt Karten-Raster: die Bausteine haben eine Reihenfolge
 * (Analyse vor Auslegung vor Umsetzung), und ein Raster würde sie als
 * gleichrangige, beliebig sortierbare Kacheln lesen. Dieselbe ruhige
 * Sequenzform wie `components/home/vorgehen.tsx`.
 */
function VorgehenSection({ leistung }: { leistung: Leistung }) {
  const t = usePage(leistung)
  const items = t.raw('vorgehen.items') as { title: string; text: string }[]

  return (
    <Section>
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('vorgehen.title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('vorgehen.lead')}</p>

        <ol className="mt-10 space-y-8 sm:space-y-10">
          {items.map((item, i) => (
            <li key={item.title} className="grid gap-x-5 gap-y-2 sm:grid-cols-[3rem_1fr]">
              {/* tabular-nums über <Num> braucht es nicht: die Ziffern stehen
                  untereinander in eigener Spalte, es wird nichts verglichen. */}
              <span
                aria-hidden="true"
                className="text-h4 tabular-nums text-text-muted"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="max-w-prose border-t border-line-strong pt-3 sm:border-t-0 sm:pt-0">
                <h3 className="text-h3 text-ink">{item.title}</h3>
                <p className="mt-2 text-body text-text-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>

        {/*
         * Fachlicher Vorbehalt, wo es einen gibt (§9.5: keine Zusagen, die wir
         * nicht halten können — z. B. Steuerrecht bei „Finanzierung", CSRD-
         * Berichtspflicht bei „ESG"). Optional: `t.has` prüft, ob die Seite einen
         * Hinweis definiert — kein leerer Kasten auf den übrigen Seiten.
         */}
        {t.has('vorgehen.note') ? (
          <p className="mt-10 max-w-prose rounded-lg border border-line bg-surface-sunken p-4 text-small text-text">
            {t('vorgehen.note')}
          </p>
        ) : null}
      </Container>
    </Section>
  )
}

/** Nutzen/Ergebnis — was der Kunde davon hat. */
function NutzenSection({ leistung }: { leistung: Leistung }) {
  const t = usePage(leistung)
  const items = t.raw('nutzen.items') as { title: string; text: string }[]

  return (
    <Section tone="alt">
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('nutzen.title')}</h2>

        {/* `items-stretch` (Grid-Default) + `h-full`: gleiche Höhen, eine Baseline. */}
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {items.map((item) => (
            <li key={item.title} className="h-full">
              <div className="flex h-full flex-col rounded-lg border border-line bg-surface p-5">
                <h3 className="text-h4 text-ink">{item.title}</h3>
                <p className="mt-2 text-small text-text-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}

/**
 * Cross-Links (§4.2/§6.4). Ziele kommen aus `lib/leistungen.ts`, der Titel aus
 * dem Nav-Label des Ziels (ein zweiter Name für dieselbe Seite wäre eine Falle),
 * der Erklärtext aus dieser Seite — warum SIE dorthin verweist.
 */
function CrossLinkSection({ leistung }: { leistung: Leistung }) {
  const t = usePage(leistung)
  const tNav = useTranslations('Nav')

  if (leistung.crossLinks.length === 0) return null

  return (
    <Section>
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('related.title')}</h2>

        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {leistung.crossLinks.map((link) => (
            <li key={link.href}>
              <TextLink variant="standalone" href={link.href} className="group block">
                <span className="flex items-center gap-2 text-h4">
                  {tNav(link.navKey)}
                  <ArrowRight
                    className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
                <span className="mt-1 block text-small text-text-muted">
                  {t(`related.${link.key}`)}
                </span>
              </TextLink>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}

/**
 * Abschluss: der EINE laute Punkt der Seite — das Gespräch (§3.1 Beratungs-Achse).
 *
 * Navy-Fläche + genau EIN Button. Kein zweiter CTA daneben: zwei gleich laute
 * Ziele in einer Sektion sind der Fehler, der auf der Startseite schon einmal
 * behoben wurde (DESIGN.md „Akzent sparsam"). Wer stattdessen rechnen will,
 * findet den Weg über die Cross-Links darüber.
 *
 * WARUM `secondary` (weiße Fläche) und nicht der Teal-Primary: auf Navy trennt
 * sich Teal 700 kaum vom Grund (gerechnet: 2,05:1 Flächenkontrast #0f766e gegen
 * #18336f) — der lauteste Punkt der Seite sähe gedämpft aus. Die weiße Fläche
 * liegt bei 12,06:1 und IST hier der Primary. Dieselbe Wahl wie im Navy-CTA von
 * `/peak-shaving`.
 */
/*
 * DEEP-LINK MIT THEMA: `leistung.key` IST ein Thema-Key des Kontaktformulars
 * (`lib/kontakt/themen.ts` leitet die Themen aus genau diesen Leistungen ab) —
 * die Vorauswahl ist hier also geschenkt, nicht geraten. Wer von „ESG / CSRD"
 * aus auf „Gespräch vereinbaren" klickt, findet das Dropdown auf ESG stehen.
 *
 * BEWUSST NUR HIER: Die Branchenseiten und die Startseite haben kein Thema zur
 * Hand (eine Branche ist keine Leistung), und der Flaggschiff-CTA führt zum
 * Kalkulator, nicht zum Formular. Ein dort erfundener Kontext wäre eine
 * Vorauswahl, die der Nutzer erst wegklicken muss.
 */
function KontaktCta({ leistung }: { leistung: Leistung }) {
  const t = usePage(leistung)
  const tCommon = useTranslations('Leistungen')

  return (
    <section className="bg-navy text-navy-foreground">
      <Container className="py-16 sm:py-24">
        <div className="max-w-prose">
          {/* Auf Navy trägt der Eyebrow den hellen Knoten-Ton — Teal 700 erreicht
              gegen #18336f kein AA (gleiche Regel wie auf der Startseite). */}
          <Eyebrow className="text-node">{tCommon('Cta.eyebrow')}</Eyebrow>
          <h2 className="mt-3 text-h2 text-navy-foreground">{t('cta.title')}</h2>
          <p className="mt-5 text-body text-white/80">{t('cta.lead')}</p>

          <Button asChild variant="secondary" size="lg" className="mt-8">
            <Link href={kontaktHrefFor(leistung.key)}>{tCommon('Cta.button')}</Link>
          </Button>
        </div>
      </Container>
    </section>
  )
}
