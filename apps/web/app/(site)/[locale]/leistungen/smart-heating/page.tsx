import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { LeistungPage, leistungMetadata } from '@/components/leistung/leistung-page'
import { SmartHeatingGraphic } from '@/components/leistung/smart-heating-graphic'

/**
 * /leistungen/smart-heating — gerendert vom GEMEINSAMEN Leistungs-Template
 * (`components/leistung/leistung-page.tsx`). Diese Datei trägt bewusst nur den
 * Schlüssel: Layout kommt aus dem Template, Struktur aus `lib/leistungen.ts`,
 * Texte aus `messages/de.json` (`Leistungen.Pages.smartHeating`).
 *
 * Eine von drei Leistungsseiten, die den optionalen `firstSectionGraphic`-Slot
 * des Templates befüllen (Prompt 19, s. `leistung-page.tsx`) — die anderen 3
 * `page.tsx` bleiben unverändert ohne diesen Prop.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return leistungMetadata(locale, 'smartHeating')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LeistungPage leistungKey="smartHeating" firstSectionGraphic={<SmartHeatingGraphic />} />
}
