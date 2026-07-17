import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { LeistungPage, leistungMetadata } from '@/components/leistung/leistung-page'
import { EsgScopeGraphic } from '@/components/leistung/esg-scope-graphic'

/**
 * /leistungen/esg — gerendert vom GEMEINSAMEN Leistungs-Template
 * (`components/leistung/leistung-page.tsx`). Diese Datei trägt bewusst nur den
 * Schlüssel: Layout kommt aus dem Template, Struktur aus `lib/leistungen.ts`,
 * Texte aus `messages/de.json` (`Leistungen.Pages.esg`).
 *
 * Sechste und letzte der 6 Leistungsseiten, die den optionalen
 * `firstSectionGraphic`-Slot des Templates befüllen (Prompt 22, s.
 * `leistung-page.tsx`) — damit hat jede der 6 Seiten genau eine Grafik.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return leistungMetadata(locale, 'esg')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LeistungPage leistungKey="esg" firstSectionGraphic={<EsgScopeGraphic />} />
}
