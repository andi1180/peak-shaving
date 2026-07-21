import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { LeadCaptureForm } from '@/components/leads/lead-capture-form'
import type { LeadCaptureConsentTexts } from '@/lib/leads/capture-texts'
import type { WartelisteSourceKey } from '@/lib/leads/warteliste'

/**
 * Die Warteliste zum Leistungstarif 2027 (B3-4) — EINE Seite, ZWEI Herkünfte.
 *
 * `/warteliste` (organisch, indexierbar) und `/warteliste/wko` (der gedruckte QR-Code, `noindex`)
 * rendern beide diese Komponente. Sie unterscheiden sich in genau zwei Dingen: der `sourceKey`, der
 * über die Registry Zweck, Felder und Formulartexte bestimmt — und die ANSPRACHE im Kopf der Seite,
 * weil die eine Fassung ein Anschreiben voraussetzen darf und die andere nicht.
 *
 * Alles Übrige ist bewusst identisch. Zwei getrennte Seitenfassungen wären zwei Orte, an denen
 * dieselbe Aussage über eine laufende Verordnung gepflegt werden müsste — und die eine liefe
 * irgendwann der anderen hinterher.
 *
 * ── AUF DIESER SEITE STEHT KEINE ZAHL ────────────────────────────────────────────────────────────
 * Kein Betrag, kein Prozentsatz, keine Ersparnisangabe — und das ist der Inhalt der Seite, nicht
 * eine Auslassung: Die Tarifverordnung mit den Sätzen ist nicht veröffentlicht, jede Zahl hier wäre
 * erfunden. Der Flaggschiff-Artikel schliesst aus demselben Grund mit „die Beträge stehen noch nicht
 * fest"; diese Seite sagt es im zweiten Absatz und ist im Übrigen das Angebot, sich zu melden,
 * sobald sich das ändert. Wer hier später eine Grössenordnung ergänzen will: erst die Verordnung,
 * dann der Satz.
 *
 * SERVER-KOMPONENTE: nur das Formular ist `'use client'`. Erklärtext steht dadurch ohne JavaScript
 * im HTML — für die organische Fassung, deren Zweck Auffindbarkeit ist, ist genau das der Punkt.
 */
export function WartelistePage({
  /** Bestimmt die Herkunft der Eintragung UND (über die Registry) die Texte des Formulars. */
  sourceKey,
  /** Wortlaute aus `platform.consent_texts` — serverseitig geladen, s. `lib/leads/capture-texts.ts`. */
  consentTexts,
}: {
  sourceKey: WartelisteSourceKey
  consentTexts: LeadCaptureConsentTexts
}) {
  const t = useTranslations('Warteliste')
  const fromLetter = sourceKey === 'wko-postaktion-qr'

  const promises = [
    { title: t('promise.noCostTitle'), body: t('promise.noCostBody') },
    { title: t('promise.unsubscribeTitle'), body: t('promise.unsubscribeBody') },
    { title: t('promise.confirmTitle'), body: t('promise.confirmBody') },
  ]

  return (
    <>
      <Container className="py-16 sm:py-24">
        <Eyebrow>{fromLetter ? t('wkoEyebrow') : t('eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
        <p className="mt-5 max-w-prose text-lead text-text">
          {fromLetter ? t('wkoLead') : t('lead')}
        </p>
      </Container>

      <Section tone="alt" className="border-t border-line">
        <Container>
          {/*
           * 3:2 ab `lg` wie `/kontakt` und `/vertragsende-erinnerung`: das Formular bekommt die
           * breitere Spalte und steht ZUERST im DOM — es ist die Aufgabe der Seite. Die Erklärung
           * daneben ist der Grund, warum jemand sie ausfüllt, nicht das zuerst zu Lesende.
           */}
          <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-3">
              <LeadCaptureForm sourceKey={sourceKey} consentTexts={consentTexts} />
            </div>

            <div className="lg:col-span-2 flex flex-col gap-6">
              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('change.title')}</h2>
                <p className="mt-3 text-small text-text-muted">{t('change.body1')}</p>
                <p className="mt-3 text-small text-text-muted">{t('change.body2')}</p>
              </section>

              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('effect.title')}</h2>
                <p className="mt-3 text-small text-text-muted">{t('effect.body')}</p>
              </section>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('promise.title')}</h2>
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
    </>
  )
}
