import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { WartelistePage } from '@/components/leads/warteliste-page'
import { loadLeadCaptureTexts } from '@/lib/leads/capture-texts'
import { WARTELISTE_HREF } from '@/lib/nav'
import { pageAlternates } from '@/lib/seo'
import { robotsFor } from '@/lib/routes'

/**
 * `/warteliste` — die ÖFFENTLICHE Warteliste zum Leistungstarif 2027 (B3-4).
 *
 * Die organische Fassung: verlinkt (Leistungen-Menü, Flaggschiff-Artikel, Branchenseite Handwerk),
 * indexierbar, in der sitemap. Ihr Zwilling `/warteliste/[quelle]` trägt dieselbe Seite unter einer
 * anderen Herkunft — dort steht, warum.
 *
 * `revalidate` wie `/kontakt` (B1-2), `/branchen/handwerk` (B3-2) und `/vertragsende-erinnerung`
 * (B4-2): der angezeigte Einwilligungswortlaut kommt aus `platform.consent_texts` und ist
 * append-only — eine juristisch geprüfte Fassung (`version 2`) soll ohne Deploy durchschlagen, weil
 * genau dieser Satz anschliessend archiviert wird.
 *
 * INDEXIERBAR: `robotsFor` liest die Entscheidung aus `lib/routes.ts` — dem einen Fundort, an dem
 * auch die sitemap sie liest. Damit kann die Seite nicht in der sitemap stehen und sich zugleich
 * selbst auf `noindex` setzen.
 *
 * FÄLLT DAS LESEN DER WORTLAUTE AUS (keine Env im CI-Build, Datenbank nicht erreichbar), liefert
 * `loadLeadCaptureTexts` `null`-Werte und die Erfassungskomponente rendert NICHTS — fail-closed:
 * ohne Wortlaut darf keine Einwilligung eingesammelt werden. Der Erklärtext bleibt stehen.
 */
export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Warteliste' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    alternates: pageAlternates(locale, WARTELISTE_HREF),
    robots: robotsFor(WARTELISTE_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const consentTexts = await loadLeadCaptureTexts('warteliste', locale)

  return <WartelistePage sourceKey="warteliste" consentTexts={consentTexts} />
}
