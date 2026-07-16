import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { KontaktPage } from '@/components/kontakt/kontakt-page'
import { pageAlternates } from '@/lib/seo'

/**
 * /kontakt — Kontaktseite mit Formular (Pflichtenheft §5.5).
 *
 * Ersetzt den `PagePlaceholder` („in Aufbau"), der hier bis zu diesem Schritt
 * stand. Layout und Inhalt kommen aus `components/kontakt/kontakt-page.tsx`.
 *
 * Die Seite bleibt STATISCH vorgerendert (kein `searchParams`-Zugriff): Der
 * Deep-Link `?thema=<key>` wird im Formular nach der Hydration gelesen — die
 * Begründung steht dort. Ein `searchParams`-Zugriff hier würde die ganze Seite
 * inkl. Adressblock pro Request rendern lassen, um ein Dropdown vorzubelegen.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Kontakt' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    /*
     * Ohne Query: Der Deep-Link `?thema=<key>` zeigt dieselbe Seite mit einem
     * vorbelegten Dropdown — der Canonical führt ihn korrekt auf die eine
     * Kontaktseite zurück, statt jede Themen-Variante als eigene Seite
     * erscheinen zu lassen.
     */
    alternates: pageAlternates(locale, '/kontakt'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <KontaktPage />
}
