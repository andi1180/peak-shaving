import { useTranslations } from 'next-intl'
import { Cpu, FileBarChart, FileUp, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Container, Eyebrow, Num, Section } from '@/components/ui/layout'

/**
 * „So funktioniert's" — die 4 Schritte des Kalkulator-Flows, NATIV im
 * coolin.at-Design nachgebaut (kein Bild, kein iframe).
 *
 * Inhaltliche Quelle: die 4-Schritte-Sektion der Kalkulator-App
 * (`apps/website/components/marketing/how-it-works.tsx`). Sinngemäß übernommen,
 * nicht kopiert: die App-Copy ist dort als `[MARTIN: Copy]` provisorisch
 * markiert, und der Ton hier ist der der Marketing-Seite. Die Aussagen decken
 * sich mit dem, was die Engine wirklich tut (Root-`CLAUDE.md`: client-seitiges
 * Parsen, SoC-Simulation über alle Viertelstunden, aufgeschlüsselte Ersparnis) —
 * keine erfundenen Zusagen (§9.5).
 *
 * FORM: die nummerierte Sequenz aus `components/home/vorgehen.tsx` (Linie oben,
 * Akzent-Ziffer, kein Kasten) statt der Karten der App. Zwei Gründe: die
 * Nummerierung ist hier eine ECHTE Sequenz und damit zulässig (dieselbe
 * Begründung wie dort), und die Seite trägt bereits zwei Karten-Raster
 * (Leistet, Vergleich) — ein drittes hätte sie zugekachelt.
 *
 * ICONS: schlichte einfarbige lucide-Line-Icons, klein und ruhig — keine
 * Emoji (Pflichtenheft §7.3). `Cpu` statt des `Loader`-Spinners der App: ein
 * eingefrorener Spinner ist auf einer statischen Seite ein Widerspruch.
 */
type Step = { title: string; text: string; icon: LucideIcon }

export function HowItWorks() {
  const t = useTranslations('PeakShavingCalculator.HowItWorks')

  // Icon am Schritt, nicht in einer Parallel-Liste: ein Index-Zugriff wäre unter
  // `noUncheckedIndexedAccess` `LucideIcon | undefined` — und eine zweite Liste
  // kann stillschweigend aus dem Tritt geraten.
  const steps: Step[] = [
    { title: t('s1Title'), text: t('s1Text'), icon: FileUp },
    { title: t('s2Title'), text: t('s2Text'), icon: SlidersHorizontal },
    { title: t('s3Title'), text: t('s3Text'), icon: Cpu },
    { title: t('s4Title'), text: t('s4Text'), icon: FileBarChart },
  ]

  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => {
            const Icon = step.icon
            return (
              <li key={step.title} className="border-t border-line-strong pt-4">
                <div className="flex items-center gap-2.5">
                  {/* tabular-nums: die vier Marker stehen exakt gleich breit (§7.4). */}
                  <Num className="text-label text-accent">{String(i + 1).padStart(2, '0')}</Num>
                  <Icon
                    className="h-4 w-4 shrink-0 text-text-muted"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </div>
                {/*
                 * Zwei Zeilen für den Titel reserviert (wie in `vorgehen.tsx`):
                 * ohne reservierte Höhe startet der Fließtext je Spalte auf einer
                 * anderen Höhe, sobald ein Titel umbricht — die Sequenz läuft
                 * dann unruhig. Erst ab `sm`, weil einspaltig keine Nachbarspalte
                 * existiert, an der auszurichten wäre.
                 */}
                <h3 className="mt-3 text-h4 text-ink sm:min-h-[3.2rem]">{step.title}</h3>
                <p className="mt-2 text-small text-text-muted">{step.text}</p>
              </li>
            )
          })}
        </ol>
      </Container>
    </Section>
  )
}
