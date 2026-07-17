import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { UeberUnsPage } from '@/components/ueber-uns/ueber-uns-page'
import { pageAlternates } from '@/lib/seo'
import { robotsFor } from '@/lib/routes'

/**
 * /ueber-uns (Prompt 20) — echte Inhaltsseite, ersetzt den bisherigen
 * `PagePlaceholder`. Mit dem Inhalt fällt der Href aus `PLACEHOLDER_HREFS`
 * (`lib/routes.ts`), die Seite wird damit wieder indexierbar (`robotsFor` gibt
 * `undefined` zurück) und erscheint in der sitemap.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const tPages = await getTranslations({ locale, namespace: 'Pages' })
  const t = await getTranslations({ locale, namespace: 'UeberUns' })
  return {
    // Tab-Titel bewusst „Über uns — …" (Pages-Label), nicht „Über COOLiN ENERGY
    // — COOLiN ENERGY" (H1) — sonst stünde die Marke doppelt im Titel.
    title: `${tPages('ueberUns')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    alternates: pageAlternates(locale, '/ueber-uns'),
    robots: robotsFor('/ueber-uns'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <UeberUnsPage />
}
