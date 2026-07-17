import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { LeistungPage, leistungMetadata } from '@/components/leistung/leistung-page'
import { PvVerbrauchHeroGraphic } from '@/components/leistung/pv-verbrauch-hero-graphic'

/**
 * /leistungen/pv-speicher — gerendert vom GEMEINSAMEN Leistungs-Template
 * (`components/leistung/leistung-page.tsx`). Diese Datei trägt bewusst nur den
 * Schlüssel: Layout kommt aus dem Template, Struktur aus `lib/leistungen.ts`,
 * Texte aus `messages/de.json` (`Leistungen.Pages.pvSpeicher`).
 *
 * EINZIGE der 6 Leistungsseiten, die den optionalen `heroGraphic`-Slot des
 * Templates befüllt (Prompt 16) — die anderen 5 `page.tsx` bleiben
 * unverändert ohne diesen Prop.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return leistungMetadata(locale, 'pvSpeicher')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LeistungPage leistungKey="pvSpeicher" heroGraphic={<PvVerbrauchHeroGraphic />} />
}
