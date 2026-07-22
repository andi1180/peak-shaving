import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { KontaktForm } from '@/components/kontakt/kontakt-form'

/**
 * Die Partner-Landingpage `/partner/<slug>` (B16-2, Modell A).
 *
 * Ein Fachbetrieb schreibt seine eigenen Bestandskunden an und verweist sie über einen
 * personalisierten Link hierher. Die Seite hat genau eine Aufgabe: aus dem Klick eine Anfrage zu
 * machen, ohne etwas zu versprechen.
 *
 * ── ⚠ ARBEITSSTAND DER TEXTE ─────────────────────────────────────────────────────────────────────
 * Gerüst und Platzhaltertexte stammen aus dem Bau (B16-2); die endgültigen Formulierungen kommen von
 * Andreas/Martina. Die Texte liegen unter `Partner.*` in `messages/de.json` und tragen dort einen
 * entsprechenden Vermerk. Sie sind bewusst nüchtern: KEIN Preisversprechen, KEINE Ergebniszusage —
 * die Seite führt zur Kontaktanfrage, nicht zu einem Sofortergebnis.
 *
 * ── DATENSPARSAMKEIT: NUR DER ANZEIGENAME ────────────────────────────────────────────────────────
 * Die Komponente bekommt `partnerName` und `partnerSlug` und sonst NICHTS über den Fachbetrieb. Die
 * Ansprechperson (`contact_first_name`/`contact_last_name` in `platform.partners`) erreicht sie
 * nicht — und kann sie nicht erreichen, weil bereits der Datenbank-Wrapper
 * (`public.get_active_partner`, B16-2) sie nicht herausgibt. Das ist die eigentliche Absicherung:
 * Was eine Server Component liest, landet im ausgelieferten HTML bzw. im Flight-Payload, sobald es
 * durch eine Komponentengrenze wandert — auch dann, wenn niemand es rendert.
 *
 * ── DAS FORMULAR STEHT OBEN, NICHT AM ENDE ───────────────────────────────────────────────────────
 * Wer diesem Link folgt, hat die Empfehlung seines Elektrikers bereits gelesen; er soll nicht erst
 * eine Marketingseite durchscrollen. Erklärung und Formular stehen deshalb nebeneinander (ab `lg`),
 * darunter einspaltig mit dem Formular ZUERST im DOM — es ist die Aufgabe der Seite.
 *
 * SERVER-KOMPONENTE: Nur das Formular selbst ist `'use client'`.
 */
export function PartnerLandingPage({
  partnerName,
  partnerSlug,
  /** Wortlaut der Marketing-Einwilligung aus `platform.consent_texts` (B1-2) — s. `KontaktForm`. */
  marketingConsentText = null,
}: {
  partnerName: string
  partnerSlug: string
  marketingConsentText?: string | null
}) {
  const t = useTranslations('Partner')

  const steps = [
    t('next.step1'),
    t('next.step2'),
    t('next.step3', { partner: partnerName }),
  ]

  return (
    <>
      <Container className="py-12 sm:py-16">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">
          {t('title', { partner: partnerName })}
        </h1>
        <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>
      </Container>

      <Section tone="alt" className="border-t border-line">
        <Container>
          <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-3">
              <h2 className="sr-only">{t('formTitle')}</h2>
              {/*
                DASSELBE MODUL WIE `/kontakt` — nicht eine Kopie davon. Zwei Unterschiede, beide
                begründet:

                `endpoint`: Der Slug reist über die ADRESSE des Endpunkts, nicht im Rumpf. Er wird
                hier serverseitig aus dem Pfad hereingereicht; die Route liest ihn aus ihren eigenen
                `params` und ignoriert ein etwaiges `partner` im Rumpf. Ein verstecktes Feld wäre im
                Browser änderbar, und an der Zuordnung hängt später die Zuteilung eines
                Montageprojekts.

                `showReferredBy={false}`: Das Freitextfeld „Empfohlen durch" erscheint hier NICHT —
                der Fachbetrieb ist über den Pfad bereits bekannt. Ein zweites Feld für dieselbe
                Frage stiftet Verwirrung und könnte im ungünstigen Fall einen anderen Namen tragen
                als der Link, über den die Person gekommen ist.
              */}
              <KontaktForm
                marketingConsentText={marketingConsentText}
                endpoint={`/api/partner/${partnerSlug}/kontakt`}
                showReferredBy={false}
              />
            </div>

            <div className="space-y-6 lg:col-span-2">
              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('next.title')}</h2>
                <ol className="mt-4 space-y-3">
                  {steps.map((step, index) => (
                    <li key={step} className="flex gap-3 text-small text-text-muted">
                      {/* Ziffer statt Icon — die Reihenfolge IST die Information (§7.3). */}
                      <span
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent-border text-caption font-semibold tabular-nums text-accent"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </section>

              <p className="text-caption text-text-muted">{t('note')}</p>
            </div>
          </div>
        </Container>
      </Section>
    </>
  )
}
