import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BranchePage, brancheMetadata } from '@/components/branche/branche-page'
import { LeadCaptureForm } from '@/components/leads/lead-capture-form'
import { Link as TextLink } from '@/components/ui/link'
import { loadLeadCaptureTexts } from '@/lib/leads/capture-texts'
import { WARTELISTE_HREF } from '@/lib/nav'

/**
 * /branchen/handwerk — gerendert vom GEMEINSAMEN Branchen-Template
 * (`components/branche/branche-page.tsx`). Diese Datei trägt bewusst nur den
 * Schlüssel: Layout kommt aus dem Template, Struktur aus `lib/branchen.ts`,
 * Texte aus `messages/de.json` (`Branchen.Pages.handwerk`).
 *
 * ── B3-2: DIE PLATZIERTE BRANCHENSEITE ───────────────────────────────────────
 * Von den fünf Branchenseiten trägt genau diese die Erfassungskomponente
 * (Einstiegspunkt 'branchenseite'). Die Wahl ist nicht beliebig: das Handwerk ist
 * der Fall, den der Flaggschiff-Artikel „Leistungstarif 2027" wörtlich
 * durchrechnet (drei Geräte, die gleichzeitig anlaufen — die Werkstatt), und es
 * ist die einzige Branchenseite, auf die der Artikel verlinkt. Wer von dort
 * kommt, ist genau das Publikum, für das die E-Mail-Strecke gedacht ist.
 *
 * ── WARUM DIE SEITE ISR BEKOMMT ──────────────────────────────────────────────
 * `revalidate` statt statischem Vorrendern für immer: der angezeigte
 * Einwilligungswortlaut kommt aus `platform.consent_texts` und ist append-only —
 * eine neue, juristisch geprüfte Fassung (`version 2`) soll ohne Deploy
 * durchschlagen. Eine Marketing-Seite pro Request zu rendern wäre die falsche
 * Rechnung; dasselbe Muster wie `/kontakt` (B1-2).
 *
 * FÄLLT DAS LESEN AUS (keine Env im CI-Build, DB nicht erreichbar), liefert
 * `loadLeadCaptureTexts` `null`-Werte, die Komponente rendert NICHTS, und die
 * Seite bleibt im Übrigen unverändert. Fail-closed: ohne Wortlaut keine
 * Einwilligung.
 */
export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return brancheMetadata(locale, 'handwerk')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const consentTexts = await loadLeadCaptureTexts('branchenseite', locale)
  const t = await getTranslations({ locale, namespace: 'Warteliste' })

  return (
    <BranchePage
      brancheKey="handwerk"
      leadCapture={
        <>
          <LeadCaptureForm sourceKey="branchenseite" consentTexts={consentTexts} />
          {/*
           * B3-4: der Verweis auf die Warteliste — bewusst NUR hier und nicht im gemeinsamen
           * Branchen-Template. Er steht auf der einzigen Branchenseite, die die Erfassung trägt,
           * und wäre auf den übrigen vier eine Aufforderung ohne den Zusammenhang, der sie trägt.
           *
           * Er tritt NICHT in Konkurrenz zum Formular darüber: dieses erhebt nur die Adresse, die
           * Warteliste zusätzlich die Branche — für wen das zu viel ist, bleibt das Formular; wer
           * gezielt auf die Sätze wartet, ist auf der Warteliste besser aufgehoben. Beide schreiben
           * unter EIGENER Herkunft in den Bestand, die Auswertung bleibt also unterscheidbar.
           */}
          <p className="mt-4 max-w-prose text-small text-text-muted">
            {t('crossLinkIntro')} <TextLink href={WARTELISTE_HREF}>{t('crossLinkLabel')}</TextLink>
          </p>
        </>
      }
    />
  )
}
