import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { FaqSection } from '@/components/faq-section'
import { LeadCaptureForm } from '@/components/leads/lead-capture-form'
import type { LeadCaptureConsentTexts } from '@/lib/leads/capture-texts'

/**
 * `/vertragsende-erinnerung` — die Landingpage der Vertragsablauf-Erinnerung (B4-2, Fahrplan B4).
 *
 * ── WARUM ES DIESE SEITE ERST JETZT GIBT ────────────────────────────────────────────────────────
 * Der Registry-Eintrag `vertragsablauf-landing` existiert seit B3-2, war dort aber ausdrücklich
 * NICHT platziert — mit der Begründung: „Ein Vertragsende zu erfassen und die versprochene
 * Erinnerung nicht senden zu können, ist ein gebrochenes Versprechen an eine reale Person, kein
 * Terminproblem." Der zeitgesteuerte Versand steht seit B4-2; damit fällt der Grund weg, und der
 * Eintrag wird platziert. Der Kommentar an der Registry ist entsprechend nachgezogen.
 *
 * ── DIE SEITE IST INDEXIERBAR ───────────────────────────────────────────────────────────────────
 * Anders als Bestätigungs- und Abmeldeseite (B1-2, persönliche Einmal-Adressen mit Token) ist das
 * hier eine öffentliche Leistungsbeschreibung, die gefunden werden SOLL. Kein `noindex`; der
 * Eintrag in `lib/routes.ts` fällt bewusst auf `indexable: true`.
 *
 * ── DER ERKLÄRTEXT BESCHREIBT DEN TRIGGER, ER VERSPRICHT IHN NICHT ──────────────────────────────
 * „Bei Widerruf werden die Angaben gelöscht" ist auf dieser Seite keine Absichtserklärung, sondern
 * die Beschreibung von `platform.clear_contract_data_on_withdrawal` (B3-1, seit B4-2 zusätzlich um
 * das Versandprotokoll erweitert): ein Datenbank-Trigger, der auch für `service_role` und für ein
 * `psql` gilt. Deshalb steht dort „unsere Datenbank löscht … automatisch" und nicht „wir löschen".
 * Der Unterschied ist der zwischen einer Zusage und einer Invariante.
 *
 * SERVER-KOMPONENTE: nur das Formular selbst ist `'use client'`. Erklärtext und FAQ stehen dadurch
 * ohne JavaScript im HTML — für eine Seite, deren Zweck Auffindbarkeit ist, ist genau das der Punkt.
 */
export function VertragsendePage({
  /** Wortlaute aus `platform.consent_texts` — serverseitig geladen, s. `lib/leads/capture-texts.ts`. */
  consentTexts,
}: {
  consentTexts: LeadCaptureConsentTexts
}) {
  const t = useTranslations('Vertragsende')

  const steps = [
    { title: t('how.step1Title'), body: t('how.step1Body') },
    { title: t('how.step2Title'), body: t('how.step2Body') },
    { title: t('how.step3Title'), body: t('how.step3Body') },
  ]

  const promises = [
    { title: t('privacy.purposeTitle'), body: t('privacy.purposeBody') },
    { title: t('privacy.withdrawTitle'), body: t('privacy.withdrawBody') },
    { title: t('privacy.noAdTitle'), body: t('privacy.noAdBody') },
  ]

  const faq = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
  ]

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
           * 3:2 ab `lg` wie `/kontakt`: das Formular bekommt die breitere Spalte und steht ZUERST
           * im DOM — es ist die Aufgabe der Seite. Der Ablauf daneben ist die Begründung, warum
           * jemand sie ausfüllt, nicht das, was zuerst gelesen werden soll.
           */}
          <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-3">
              <LeadCaptureForm sourceKey="vertragsablauf-landing" consentTexts={consentTexts} />
            </div>

            <div className="lg:col-span-2">
              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('how.title')}</h2>
                <ol className="mt-4 space-y-5">
                  {steps.map((step, index) => (
                    <li key={step.title} className="flex gap-3">
                      {/* Ziffer als Fläche, kein Icon-Rauschen (§7.3) — dieselbe Mechanik wie die
                          Aufzählungspunkte auf `/kontakt`. `tabular-nums` (DESIGN.md). */}
                      <span
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-caption font-semibold tabular-nums text-accent"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-small font-semibold text-ink">{step.title}</p>
                        <p className="mt-1 text-small text-text-muted">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('privacy.title')}</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {promises.map((item) => (
              <section key={item.title} className="rounded-lg border border-line bg-surface p-6">
                <h3 className="text-h4 text-ink">{item.title}</h3>
                <p className="mt-2 text-small text-text-muted">{item.body}</p>
              </section>
            ))}
          </div>
        </Container>
      </Section>

      <FaqSection title={t('faq.title')} items={faq} tone="alt" />
    </>
  )
}
