import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { LEISTUNGEN_GROUPS } from '@/lib/leistungen'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * Übersicht `/leistungen` (Pflichtenheft §5.1).
 *
 * Gruppiert wie das Mega-Menü (Erzeugen & Optimieren / Beschaffen & Finanzieren
 * / Nachweisen) — und zwar NICHT durch eine zweite, handgepflegte Liste, sondern
 * aus `LEISTUNGEN_GROUPS`, das seinerseits aus `lib/nav.ts` fällt. Menü,
 * Startseiten-Kacheln und diese Seite können damit nicht auseinanderlaufen.
 *
 * PEAK SHAVING IST HIER KEINE KACHEL (§4.2) — es ist Top-Level und Flaggschiff.
 * Der Hinweis darauf steht als eigene Zeile unter den Gruppen, nicht als siebter
 * Eintrag zwischen den Leistungen.
 */
export function LeistungenOverview() {
  const t = useTranslations('Leistungen.Overview')
  const tCommon = useTranslations('Leistungen')
  const tNav = useTranslations('Nav')

  return (
    <>
      <Container className="py-16 sm:py-24">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
        <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>
        <p className="mt-5 max-w-prose text-body text-text-muted">{t('intro')}</p>
      </Container>

      <Section tone="alt">
        <Container>
          <div className="space-y-12">
            {LEISTUNGEN_GROUPS.map((group) => (
              <section key={group.labelKey}>
                <h2 className="text-h3 text-ink">{tNav(group.labelKey)}</h2>
                <p className="mt-2 max-w-prose text-small text-text-muted">
                  {t(`groups.${group.labelKey}`)}
                </p>

                {/*
                 * `items-stretch` (Grid-Default) + `h-full` auf der Karte: alle
                 * Karten einer Zeile stehen auf einer Baseline, auch wenn die
                 * Beschreibungen unterschiedlich lang sind. Der Pfeil sitzt über
                 * `mt-auto` immer am unteren Rand — dieselbe Mechanik wie in
                 * `components/home/portfolio.tsx`.
                 */}
                <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((leistung) => {
                    const Icon = leistung.icon
                    return (
                      <li key={leistung.href}>
                        <Link
                          href={leistung.href}
                          className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <Icon
                            className="h-5 w-5 shrink-0 text-text-muted"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          <h3 className="mt-4 text-h4 text-ink">{tNav(leistung.key)}</h3>
                          {/* GENAU der Text, den auch die Startseiten-Kacheln
                              tragen (`Leistungen.teaser.*`) — die Portfolio-
                              Komponente liest dieselben Keys. Ein zweiter Text
                              für dieselbe Kachel wäre nur eine weitere Stelle,
                              an der die Seite von sich selbst abweichen kann. */}
                          <p className="mt-2 text-small text-text-muted">
                            {tCommon(`teaser.${leistung.key}`)}
                          </p>
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
              </section>
            ))}
          </div>
        </Container>
      </Section>

      {/* Verweis aufs Flaggschiff (§4.2) — bewusst NEBEN den Gruppen, nicht darin. */}
      <Section>
        <Container>
          <div className="max-w-prose rounded-lg border border-accent-border bg-accent-subtle p-6">
            <h2 className="text-h3 text-ink">{t('flagship.title')}</h2>
            <p className="mt-3 text-body text-text">{t('flagship.text')}</p>
            <p className="mt-4">
              <Link
                href="/peak-shaving"
                className="group inline-flex items-center gap-2 text-small font-semibold text-accent underline decoration-accent-border underline-offset-4 hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {tNav('peakShavingWhat')}
                <ArrowRight
                  className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </p>
          </div>
        </Container>
      </Section>

      {/* Primäre Aktion der Beratungs-Achse: das Gespräch (§3.1). */}
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
    </>
  )
}
