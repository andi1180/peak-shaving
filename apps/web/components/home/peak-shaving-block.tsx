import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Eyebrow, Num } from '@/components/ui/layout'
import { SignatureField } from '@/components/brand/signature'
import { CTA_HREF } from '@/lib/nav'

/**
 * Peak-Shaving-Block (§4.4 Nr. 2, §4.2 „best of both worlds").
 *
 * Peak Shaving ist bewusst KEINE der Portfolio-Kacheln — es steht als
 * Flaggschiff für sich (§4.2). Deshalb der einzige Navy-Grund der Seite: die
 * tragende Ankerfläche markiert, was hier anders wiegt als die Kacheln darunter.
 *
 * Substanz aus `reference/coolin-legacy.html` (Peak-Shaving-Sektion): Titel,
 * Einleitung und die drei Punkte sind der Bestandstext.
 *
 * SIGNATURE-MOTIV — der EINE Auftritt dieser Seite (DESIGN.md „Boldness an
 * einer Stelle", max. 1× pro Seitenansicht). Er wurde dafür aus dem Footer
 * entfernt; ein zweiter Auftritt darf hier nicht dazukommen.
 */
export function PeakShavingBlock() {
  const t = useTranslations('Home.Peak')

  const points = [
    { title: t('point1Title'), text: t('point1Text') },
    { title: t('point2Title'), text: t('point2Text') },
    { title: t('point3Title'), text: t('point3Text') },
  ]

  return (
    <section className="relative overflow-hidden bg-navy text-navy-foreground">
      {/* Dekor → aria-hidden steckt in SignatureField. Zeigt nur auf großen
          Flächen; auf Mobile würde es hinter dem Text nur Unruhe erzeugen. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 lg:block">
        <SignatureField />
      </div>

      <Container className="relative py-16 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Erklärung */}
          <div>
            {/* Eyebrow trägt sonst den Teal-Akzent — auf Navy wäre er zu dunkel
                (kein AA gegen #18336f). Hier deshalb der helle Knoten-Ton. */}
            <Eyebrow className="text-node">{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-h2 text-navy-foreground">{t('title')}</h2>
            <p className="mt-5 max-w-prose text-body text-white/80">{t('lead')}</p>

            <ul className="mt-8 space-y-5">
              {points.map((point) => (
                <li key={point.title} className="flex gap-3">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-node"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-h4 text-navy-foreground">{point.title}</p>
                    <p className="mt-1 text-small text-white/70">{point.text}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild variant="primary" size="md">
                <Link href={CTA_HREF}>{t('ctaPrimary')}</Link>
              </Button>
              <Button asChild variant="secondary" size="md">
                <Link href="/peak-shaving">{t('ctaSecondary')}</Link>
              </Button>
            </div>
          </div>

          {/*
           * Schnellrechner — PLATZHALTER-Rahmen.
           *
           * Bewusst keine Eingaben, keine Formel, keine Beispielzahl: eine
           * gerechnete Zahl ohne Rechenlogik wäre eine erfundene Kennzahl
           * (§9.5). Der Rahmen hält nur die Fläche und benennt ehrlich, dass
           * der Rechner folgt (§5.4, eigener Prompt).
           */}
          <div className="lg:pt-10">
            {/*
             * Fläche bewusst DECKEND (bg-navy-hover = der dunklere Navy-Ton),
             * nicht `bg-white/5`: das Signature-Motiv liegt in derselben
             * Sektionshälfte, und durch eine durchscheinende Karte liefen seine
             * Linien quer über Titel und Text — genau das „konkurriert mit dem
             * Inhalt", das DESIGN.md dem Motiv verbietet. Deckend läuft es
             * sauber HINTER der Karte durch. Tiefe kommt so aus der Fläche,
             * nicht aus einem Schatten (§7.5).
             */}
            <div className="relative rounded-lg border border-white/25 bg-navy-hover p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-h4 text-navy-foreground">{t('teaserTitle')}</p>
                <span className="rounded-sm border border-white/25 px-2 py-0.5 text-caption text-white/70">
                  {t('teaserSoon')}
                </span>
              </div>
              <p className="mt-3 text-small text-white/70">{t('teaserNote')}</p>

              {/* Angedeutete Zeilen des künftigen Rechners — reine Fläche, keine
                  Werte. Dekorativ, daher aus dem Screenreader ausgeblendet. */}
              <div className="mt-6 space-y-3" aria-hidden="true">
                <div className="h-9 rounded-md border border-white/15 bg-white/5" />
                <div className="h-9 rounded-md border border-white/15 bg-white/5" />
                <div className="h-9 rounded-md border border-white/15 bg-white/5" />
                <div className="mt-5 h-px bg-white/15" />
                <div className="flex items-center justify-between pt-1">
                  <div className="h-3 w-40 rounded-sm bg-white/15" />
                  <Num className="text-h3 text-white/25">—</Num>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
