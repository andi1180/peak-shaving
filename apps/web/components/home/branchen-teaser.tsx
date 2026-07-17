import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { BRANCHEN_FLAT } from '@/lib/nav'

/**
 * Branchen-Teaser (§4.4 Nr. 4) — 5 Karten, problem-orientiert.
 *
 * Bewusst nur Teaser: der Detailtext je Branche (typisches Lastprofil, Hebel,
 * Kostentreiber) steht auf den Branchenseiten (§5.3) — hier steht je Branche EIN
 * Satz zum Schmerz.
 *
 * Der Schmerz je Branche benennt den Mechanismus, der die Spitze erzeugt
 * (Gleichzeitigkeit, Anlauf, Schichtwechsel, Saison). Keine Zahlen — die
 * brauchen Quellen (§9.5).
 *
 * Liste + Links kommen aus `lib/nav.ts` (BRANCHEN_FLAT), nicht aus einer Kopie.
 *
 * DIE EINZEILER STEHEN IN `Branchen.teaser.*`, nicht mehr in `Home.Branchen.*`:
 * Die Übersicht `/branchen` zeigt exakt dieselben Karten und liest exakt dieselben
 * Keys — ein zweiter Text für dieselbe Kachel wäre nur eine weitere Stelle, an der
 * die Seite von sich selbst abweichen kann. Gleiche Mechanik wie `Leistungen.teaser.*`,
 * das sich Startseiten-Portfolio und `/leistungen` teilen. Überschrift und Lead
 * DIESER Sektion bleiben in `Home.Branchen` — die gehören der Startseite.
 */
export function BranchenTeaser() {
  const t = useTranslations('Home.Branchen')
  const tBranchen = useTranslations('Branchen')
  const tNav = useTranslations('Nav')

  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        {/*
         * Gleich hohe Karten auf einer Baseline: h-full + mt-auto (wie im Portfolio).
         *
         * DREI SPALTEN, NICHT FÜNF (seit Prompt 25 sind es 5 Branchen): Bei
         * `max-w-container` (72rem) blieben je Karte rund 200 px — zu wenig für
         * Überschriften wie „Industrie & Verarbeitendes Gewerbe" plus einen Satz;
         * sie brächen auf drei bis vier Zeilen um. 3+2 lässt in der zweiten Zeile
         * eine Lücke, aber die Karten bleiben lesbar. Dieselbe Aufteilung wie in
         * `branchen-overview.tsx` — die zwei Raster zeigen dieselben Kacheln.
         */}
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BRANCHEN_FLAT.map((leaf) => (
            <li key={leaf.href}>
              <Link
                href={leaf.href}
                className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <h3 className="text-h4 text-ink">{tNav(leaf.labelKey)}</h3>
                <p className="mt-2 text-small text-text-muted">
                  {tBranchen(`teaser.${leaf.labelKey}`)}
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
          ))}
        </ul>
      </Container>
    </Section>
  )
}
