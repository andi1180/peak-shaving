import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { VertragsendePage } from '@/components/leads/vertragsende-page'
import { loadLeadCaptureTexts } from '@/lib/leads/capture-texts'
import { VERTRAGSENDE_ERINNERUNG_HREF } from '@/lib/nav'
import { pageAlternates } from '@/lib/seo'
import { robotsFor } from '@/lib/routes'

/**
 * `/vertragsende-erinnerung` — Landingpage der Vertragsablauf-Erinnerung (B4-2).
 *
 * `revalidate` statt statischem Vorrendern für immer: dasselbe Muster und dieselbe Stunde wie
 * `/kontakt` (B1-2) und `/branchen/handwerk` (B3-2). Der angezeigte Einwilligungswortlaut kommt aus
 * `platform.consent_texts` und ist append-only — eine juristisch geprüfte Fassung (`version 2`) soll
 * ohne Deploy durchschlagen, weil genau dieser Satz anschliessend archiviert wird.
 *
 * INDEXIERBAR: `robotsFor` liest die Entscheidung aus `lib/routes.ts` — dem einen Fundort, an dem
 * auch die sitemap sie liest. Damit kann die Seite nicht in der sitemap stehen und sich zugleich
 * selbst auf `noindex` setzen (die Falle, gegen die 13a/13b gebaut hat). Hier lautet die Antwort:
 * indexierbar, also `undefined` — ein überflüssiges `index, follow` wäre Rauschen.
 *
 * FÄLLT DAS LESEN DER WORTLAUTE AUS (keine Env im CI-Build, Datenbank nicht erreichbar), liefert
 * `loadLeadCaptureTexts` `null`-Werte und die Erfassungskomponente rendert NICHTS — fail-closed:
 * ohne Wortlaut darf keine Einwilligung eingesammelt werden. Erklärtext und FAQ bleiben stehen.
 */
export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Vertragsende' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    alternates: pageAlternates(locale, VERTRAGSENDE_ERINNERUNG_HREF),
    robots: robotsFor(VERTRAGSENDE_ERINNERUNG_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const consentTexts = await loadLeadCaptureTexts('vertragsablauf-landing', locale)

  return <VertragsendePage consentTexts={consentTexts} />
}
