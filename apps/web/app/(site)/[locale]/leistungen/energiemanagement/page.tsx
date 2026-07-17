import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { LeistungPage, leistungMetadata } from '@/components/leistung/leistung-page'
import { EnergiemanagementAggregationGraphic } from '@/components/leistung/energiemanagement-aggregation-graphic'

/**
 * /leistungen/energiemanagement — gerendert vom GEMEINSAMEN Leistungs-Template
 * (`components/leistung/leistung-page.tsx`). Diese Datei trägt bewusst nur den
 * Schlüssel: Layout kommt aus dem Template, Struktur aus `lib/leistungen.ts`,
 * Texte aus `messages/de.json` (`Leistungen.Pages.energiemanagement`).
 *
 * Eine von zwei Leistungsseiten, die den optionalen `firstSectionGraphic`-Slot
 * des Templates befüllen (Prompt 18, s. `leistung-page.tsx`) — die anderen 4
 * `page.tsx` bleiben unverändert ohne diesen Prop.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return leistungMetadata(locale, 'energiemanagement')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return (
    <LeistungPage
      leistungKey="energiemanagement"
      firstSectionGraphic={<EnergiemanagementAggregationGraphic />}
    />
  )
}
