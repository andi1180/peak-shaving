import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { LeistungPage, leistungMetadata } from '@/components/leistung/leistung-page'
import { PpaPreisGraphic } from '@/components/leistung/ppa-preis-graphic'

/**
 * /leistungen/ppa — gerendert vom GEMEINSAMEN Leistungs-Template
 * (`components/leistung/leistung-page.tsx`). Diese Datei trägt bewusst nur den
 * Schlüssel: Layout kommt aus dem Template, Struktur aus `lib/leistungen.ts`,
 * Texte aus `messages/de.json` (`Leistungen.Pages.ppa`).
 *
 * Befüllt den optionalen `firstSectionGraphic`-Slot des Templates (Prompt 20,
 * „Spotmarktpreis vs. PPA-Preis") — die vierte von sechs Leistungsseiten mit
 * einer Grafik (s. `leistung-page.tsx`); die Hero-Sektion bleibt einspaltig.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return leistungMetadata(locale, 'ppa')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LeistungPage leistungKey="ppa" firstSectionGraphic={<PpaPreisGraphic />} />
}
