import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { WissenOverview } from '@/components/wissen/wissen-overview'
import { WISSEN_HREF } from '@/lib/wissen'
import { pageAlternates } from '@/lib/seo'

/**
 * /wissen — die Übersicht des Wissen-Bereichs (§6.2 Info-Intent).
 *
 * Ersetzt den `PagePlaceholder` („in Aufbau"), der hier bis zu diesem Schritt
 * stand. Layout kommt aus `components/wissen/wissen-overview.tsx`, die Artikel
 * aus `lib/wissen.ts` (Verzeichnis `content/wissen/`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Wissen.Overview' })
  return {
    title: `${t('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    // `WISSEN_HREF` statt „/wissen": Der Bereichspfad hat in `lib/wissen.ts`
    // bereits einen Fundort — `articleHref` baut jede Artikel-URL daraus.
    alternates: pageAlternates(locale, WISSEN_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <WissenOverview locale={locale} />
}
