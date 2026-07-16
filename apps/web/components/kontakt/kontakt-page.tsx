import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { KontaktForm } from '@/components/kontakt/kontakt-form'
import { COMPANY } from '@/lib/nav'

/**
 * `/kontakt` — die kanonische Kontaktseite (Pflichtenheft §5.5).
 *
 * Ersetzt den `PagePlaceholder`. Aufbau: kurze Einordnung → Formular →
 * Kontaktblock. Bewusst EINE Seite und KEIN Modal wie im Bestand
 * (`reference/coolin-legacy.html`): Ein Formular im Overlay hat keine Adresse,
 * die man teilen, verlinken oder indexieren kann — und genau die brauchen sowohl
 * die CTAs der ganzen Seite als auch Local-SEO (§6.4).
 *
 * SERVER-KOMPONENTE: Nur das Formular selbst ist `'use client'`. Adresse,
 * Überschriften und der Unterlagen-Block stehen dadurch ohne JavaScript im HTML —
 * für Local-SEO ist genau das der Punkt.
 *
 * DAS FORMULAR LIEGT LINKS UND ZUERST im DOM: Es ist die Aufgabe der Seite. Der
 * Kontaktblock ist die Alternative für den, der lieber selbst schreibt oder eine
 * Adresse sucht — nicht das, was zuerst gelesen werden soll.
 */
export function KontaktPage() {
  const t = useTranslations('Kontakt')

  const docs = [t('docs.doc1'), t('docs.doc2'), t('docs.doc3'), t('docs.doc4'), t('docs.doc5')]

  return (
    <>
      <Container className="py-16 sm:py-24">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
        <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>
      </Container>

      <Section tone="alt" className="border-t border-line">
        <Container>
          {/*
           * 3:2 ab `lg`, darunter einspaltig. Das Formular bekommt die breitere
           * Spalte, weil es zweispaltige Feldpaare trägt (Name/E-Mail); der
           * Kontaktblock ist reiner Fließtext und liest sich schmal besser.
           */}
          <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-3">
              <KontaktForm />
            </div>

            <div className="space-y-6 lg:col-span-2">
              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('direct.title')}</h2>
                {/*
                 * `<address>` ist die semantisch richtige Klammer für die
                 * Kontaktdaten des Seitenbetreibers — und der Anker, an dem ein
                 * späteres LocalBusiness-JSON-LD (§6.4, eigener Prompt) sitzt.
                 * `not-italic`: Browser kursivieren <address> per Default.
                 */}
                <address className="mt-4 not-italic text-body text-text-muted">
                  <span className="font-semibold text-ink">{COMPANY.name}</span>
                  <br />
                  <a
                    href={`mailto:${COMPANY.email}`}
                    className="text-accent underline decoration-accent-border underline-offset-4 hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {COMPANY.email}
                  </a>
                  <br />
                  {COMPANY.street}
                  <br />
                  {COMPANY.city}
                </address>
                <p className="mt-4 text-small text-text-muted">{t('direct.note')}</p>
              </section>

              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('docs.title')}</h2>
                <p className="mt-2 text-small text-text-muted">{t('docs.lead')}</p>
                <ul className="mt-4 space-y-2">
                  {docs.map((doc) => (
                    <li key={doc} className="flex gap-3 text-small text-text-muted">
                      {/* Aufzählungspunkt als Fläche, nicht als Zeichen — kein Emoji,
                          kein Icon-Rauschen (§7.3). Dekor → aria-hidden.
                          Gleiche Mechanik wie `components/home/kontakt-cta.tsx`. */}
                      <span
                        className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                      {doc}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </Container>
      </Section>
    </>
  )
}
