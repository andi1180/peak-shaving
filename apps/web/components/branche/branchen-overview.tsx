import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { BRANCHEN } from '@/lib/branchen'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * Übersicht `/branchen` (Pflichtenheft §5.3) — der interne Link-Hub.
 *
 * Spiegelt `components/leistung/leistungen-overview.tsx`: gleiche Kachel, gleicher
 * Aufbau (Hero → Kacheln → Flaggschiff-Block → Kontakt-CTA). Der eine Unterschied
 * ist, dass die Branchen KEINE Gruppen haben — es sind vier gleichrangige
 * Einstiege, kein Portfolio mit Achsen. Deshalb ein Raster statt der gruppierten
 * Abschnitte.
 *
 * Reihenfolge und Links kommen aus `BRANCHEN` (das seinerseits aus `lib/nav.ts`
 * fällt) — Menü, Startseiten-Karten und diese Seite können damit nicht
 * auseinanderlaufen.
 *
 * BEWUSST SCHLANK (§5.3 „wenige starke statt vieler dünner Seiten"): Der Hub
 * verteilt, er erklärt nicht. Was eine Branche ausmacht, steht auf ihrer Seite —
 * hier ist es je EINE Zeile.
 */
export function BranchenOverview() {
  const t = useTranslations('Branchen.Overview')
  const tCommon = useTranslations('Branchen')
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
          {/*
           * `items-stretch` (Grid-Default) + `h-full` auf der Karte: alle Karten
           * stehen auf einer Baseline, auch wenn die Zeilen unterschiedlich lang
           * sind. Der Pfeil sitzt über `mt-auto` am unteren Rand — dieselbe
           * Mechanik wie in `portfolio.tsx` und `leistungen-overview.tsx`.
           */}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BRANCHEN.map((branche) => {
              const Icon = branche.icon
              return (
                <li key={branche.href}>
                  <Link
                    href={branche.href}
                    className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Icon
                      className="h-5 w-5 shrink-0 text-text-muted"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <h2 className="mt-4 text-h4 text-ink">{tNav(branche.key)}</h2>
                    {/* GENAU der Text, den auch die Startseiten-Karten tragen
                        (`Branchen.teaser.*`) — `components/home/branchen-teaser.tsx`
                        liest dieselben Keys. Ein zweiter Text für dieselbe Kachel
                        wäre nur eine weitere Stelle, an der die Seite von sich
                        selbst abweichen kann. */}
                    <p className="mt-2 text-small text-text-muted">
                      {tCommon(`teaser.${branche.key}`)}
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
        </Container>
      </Section>

      {/* Verweis aufs Flaggschiff (§4.2/§6.4) — der Hub soll auf die „Money-Page"
          zeigen. Gleiche Fläche und gleiche Rolle wie in der Leistungs-Übersicht. */}
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
