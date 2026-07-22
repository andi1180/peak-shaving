import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { PartnerApplicationForm } from '@/components/partner/partner-application-form'

/**
 * `/partner-werden` — die öffentliche Bewerbungsseite für Fachbetriebe (B16-3, Modell A).
 *
 * Sie richtet sich an Elektro- und Installationsbetriebe, die ihre Bestandskunden an COOLiN
 * verweisen wollen. Das Gegenstück ist die Landingpage `/partner/<slug>` (B16-2) — die richtet sich
 * an die KUNDEN eines bereits aufgenommenen Betriebs. Beide dürfen nicht verwechselt werden, und sie
 * liegen deshalb auf getrennten Pfaden: `/partner-werden` ist bewusst KEIN Kindsegment von
 * `/partner/`, wo seit B16-2 das dynamische `[slug]` sitzt (begründet in
 * `lib/partner-application/config.ts`).
 *
 * ── DIESE SEITE IST INDEXIERBAR — anders als die Landingpages ───────────────────────────────────
 * Die Doorway-Page-Sorge aus B16-2 (viele fast identische Seiten, die sich nur im Firmennamen
 * unterscheiden) trifft hier gerade nicht zu: Es gibt genau EINE Seite, mit eigenem Inhalt, und sie
 * soll von suchenden Fachbetrieben gefunden werden. Kein `noindex`, Eintrag in der sitemap.
 *
 * ── ⚠ ARBEITSSTAND DER TEXTE ────────────────────────────────────────────────────────────────────
 * Gerüst und Platzhaltertexte stammen aus dem Bau; die endgültigen Formulierungen kommen von
 * Andreas/Martina. Die Texte liegen unter `PartnerBewerbung.*` in `messages/de.json` und tragen dort
 * einen entsprechenden Vermerk.
 *
 * Sie enthalten AUSDRÜCKLICH KEINE Provisions- oder Umsatzversprechen und KEINE Zusage über die
 * Bearbeitungsdauer. Beides wäre eine Zahl bzw. eine Frist, die niemand zugesagt hat und die
 * trotzdem gemessen wird — und für die Provision gilt zusätzlich, dass das Modell (erstes
 * Zugriffsrecht auf die Montage) gar keine ist.
 *
 * SERVER-KOMPONENTE: Nur das Formular ist `'use client'`. Der Erklärtext steht dadurch ohne
 * JavaScript im HTML — für eine Seite, deren Zweck Auffindbarkeit ist, ist genau das der Punkt.
 */
export function PartnerApplicationPage({
  /** Adresse der laufenden Sitzung, falls angemeldet — s. `PartnerApplicationForm`. */
  sessionEmail = null,
}: {
  sessionEmail?: string | null
}) {
  const t = useTranslations('PartnerBewerbung')

  const steps = [
    { title: t('how.step1Title'), body: t('how.step1Body') },
    { title: t('how.step2Title'), body: t('how.step2Body') },
    { title: t('how.step3Title'), body: t('how.step3Body') },
  ]

  const fits = [t('fit.item1'), t('fit.item2'), t('fit.item3')]

  return (
    <>
      <Container className="py-16 sm:py-24">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
        <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>
      </Container>

      <Section tone="alt" className="border-t border-line">
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('how.title')}</h2>
          <p className="mt-4 max-w-prose text-body text-text-muted">{t('how.intro')}</p>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-lg border border-line bg-surface p-6">
                {/* Ziffer statt Icon — die Reihenfolge IST die Information (§7.3). */}
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-accent-border text-small font-semibold tabular-nums text-accent"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <h3 className="mt-3 text-h4 text-ink">{step.title}</h3>
                <p className="mt-2 text-small text-text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section>
        <Container>
          {/*
            3:2 ab `lg` wie `/kontakt`, `/warteliste` und die Partner-Landingpage: das Formular
            bekommt die breitere Spalte und steht ZUERST im DOM — es ist die Aufgabe der Seite. Die
            Einordnung daneben ist der Grund, warum jemand es ausfüllt, nicht das zuerst zu Lesende.
          */}
          <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-3">
              <h2 className="text-h2 text-ink">{t('formTitle')}</h2>
              <p className="mt-3 max-w-prose text-body text-text-muted">{t('formIntro')}</p>
              <div className="mt-6">
                <PartnerApplicationForm sessionEmail={sessionEmail} />
              </div>
            </div>

            <div className="flex flex-col gap-6 lg:col-span-2">
              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('fit.title')}</h2>
                <ul className="mt-4 space-y-3">
                  {fits.map((item) => (
                    <li key={item} className="text-small text-text-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-lg border border-line bg-surface p-6">
                <h2 className="text-h4 text-ink">{t('account.title')}</h2>
                <p className="mt-3 text-small text-text-muted">{t('account.body')}</p>
              </section>

              {/*
                Was NICHT versprochen wird, steht sichtbar auf der Seite und nicht nur im Code:
                keine Provisionszusage, keine Frist. Ein Betrieb, der sich bewirbt, soll vorher
                wissen, worauf er sich einlässt — und was offen bleibt.
              */}
              <p className="text-caption text-text-muted">{t('note')}</p>
            </div>
          </div>
        </Container>
      </Section>
    </>
  )
}
