import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ImpressumPage } from '@/components/legal/impressum-page'
import { pageAlternates } from '@/lib/seo'
import { robotsFor } from '@/lib/routes'

/**
 * /impressum (Pflichtenheft §9.1) — echte Inhaltsseite, ersetzt den bisherigen
 * `PagePlaceholder`. Löst OP#13 auf: die ECG-§5-Pflichtangaben sind zugeliefert.
 *
 * Mit dem Inhalt fällt der Href aus `PLACEHOLDER_HREFS` (`lib/routes.ts`): die
 * Seite wird wieder indexierbar (`robotsFor` gibt `undefined` zurück) und
 * erscheint in der sitemap — derselbe Weg wie bei /ueber-uns.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Pages' })
  return {
    title: `${t('impressum')} — COOLiN ENERGY`,
    alternates: pageAlternates(locale, '/impressum'),
    robots: robotsFor('/impressum'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ImpressumPage />
}
