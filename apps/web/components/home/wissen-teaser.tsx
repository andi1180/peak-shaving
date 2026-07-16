import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Link as TextLink } from '@/components/ui/link'
import { Container, Eyebrow, Section } from '@/components/ui/layout'

/**
 * Wissen-Teaser (§4.4 Nr. 5) — 2–3 Artikel, prominent „Leistungstarif 2027".
 *
 * Der 2027-Artikel ist der strategische Hebel (§6.1) und bekommt deshalb die
 * breite Karte; die beiden anderen sind schmale Anreißer. Nur Aufhänger, kein
 * Volltext — die Artikel selbst sind eine eigene Phase.
 *
 * LINKZIEL: alle drei zeigen auf `/wissen`. `/wissen/leistungstarif-2027`
 * existiert noch nicht (dieser Schritt legt keine Seite an) — dorthin zu
 * verlinken hieße, wissentlich in einen 404 zu führen. Sobald der Artikel
 * gebaut ist, wird hier das Ziel gesetzt.
 *
 * Inhaltliche Substanz der Anreißer: Pflichtenheft §6.1/§6.5 (SNE-GV/ElWG,
 * 1.1.2027, monatlicher Leistungspeak auf Netzebene 7) und §6.2
 * (Terminologie: RLM, Schwelle 100.000 kWh). Nichts erfunden, keine
 * Kennzahl behauptet.
 */
const WISSEN_HREF = '/wissen'

export function WissenTeaser() {
  const t = useTranslations('Home.Wissen')

  const secondary = [
    { tag: t('a2Tag'), title: t('a2Title'), text: t('a2Text') },
    { tag: t('a3Tag'), title: t('a3Title'), text: t('a3Text') },
  ]

  return (
    <Section tone="alt">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
            <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>
          </div>
          <TextLink href={WISSEN_HREF} variant="standalone" className="text-small">
            {t('more')}
          </TextLink>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {/* Flaggschiff-Artikel — zwei von drei Spalten (§6.1). */}
          <Link
            href={WISSEN_HREF}
            className="group flex flex-col rounded-lg border border-accent-border bg-accent-subtle p-6 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:col-span-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-label uppercase text-accent">{t('a1Tag')}</span>
              <span className="rounded-sm border border-accent-border px-1.5 py-0.5 text-caption text-text-muted">
                {t('soon')}
              </span>
            </div>
            <h3 className="mt-3 text-h3 text-ink">{t('a1Title')}</h3>
            <p className="mt-3 max-w-prose text-body text-text">{t('a1Text')}</p>
            <div className="mt-auto pt-6">
              <ArrowRight
                className="h-4 w-4 text-accent transition-transform group-hover:translate-x-0.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </div>
          </Link>

          {/* Anreißer — gleich hoch, gestapelt. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {secondary.map((article) => (
              <Link
                key={article.title}
                href={WISSEN_HREF}
                className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label uppercase text-text-muted">{article.tag}</span>
                  <span className="rounded-sm border border-line px-1.5 py-0.5 text-caption text-text-muted">
                    {t('soon')}
                  </span>
                </div>
                <h3 className="mt-2 text-h4 text-ink">{article.title}</h3>
                <p className="mt-2 text-small text-text-muted">{article.text}</p>
              </Link>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  )
}
