import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Num, Section } from '@/components/ui/layout'

/**
 * Vorgehen / Vertrauen (§4.4 Nr. 6) — „So arbeiten wir".
 *
 * Die vier Schritte kommen verbatim-nah aus `reference/coolin-legacy.html`
 * (Vorgehen-Sektion): Potenzialanalyse → Business Cases & Priorisierung →
 * Partner & Umsetzung → Tracking & Reporting.
 *
 * KENNZAHLEN — bewusste Auswahl (§9.5, „keine erfundenen Kennzahlen"):
 * - „6–10 Wochen von der Potenzialanalyse bis zur umsetzbaren Roadmap" ist
 *   übernommen: eine echte Spanne über den EIGENEN Prozess, als solche
 *   formuliert und nachprüfbar durch COOLiN selbst.
 * - „bis zu −25 % typische Energiekostenreduktion" aus dem Bestand ist
 *   WEGGELASSEN: ein Bestwert-Versprechen über Kundenergebnisse, ohne Quelle
 *   und ohne Referenzfall. Im Zweifel weglassen statt Scheingenauigkeit.
 *
 * Nummerierte Marker (01–04) sind hier zulässig, weil es eine echte Sequenz
 * ist — im Gegensatz zu den Kacheln, wo eine Nummer nur Dekor wäre.
 */
export function Vorgehen() {
  const t = useTranslations('Home.Vorgehen')

  const steps = [
    { title: t('s1Title'), text: t('s1Text') },
    { title: t('s2Title'), text: t('s2Text') },
    { title: t('s3Title'), text: t('s3Text') },
    { title: t('s4Title'), text: t('s4Text') },
  ]

  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title} className="border-t border-line-strong pt-4">
              {/* tabular-nums: die vier Marker stehen exakt gleich breit (§7.4). */}
              <Num className="text-label text-accent">
                {String(i + 1).padStart(2, '0')}
              </Num>
              {/*
               * Zwei Zeilen für den Schritt-Titel reserviert: „Business Cases &
               * Priorisierung" bricht um, die drei anderen nicht — ohne
               * reservierte Höhe startet der Fließtext je Spalte auf einer
               * anderen Höhe und die Sequenz läuft unruhig. Erst ab `sm`, weil
               * einspaltig (Mobile) keine Nachbarspalte existiert, an der etwas
               * auszurichten wäre. 2 × line-height der h4-Stufe (1,6rem).
               */}
              <h3 className="mt-3 text-h4 text-ink sm:min-h-[3.2rem]">{step.title}</h3>
              <p className="mt-2 text-small text-text-muted">{step.text}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-small text-text-muted">{t('duration')}</p>
      </Container>
    </Section>
  )
}
