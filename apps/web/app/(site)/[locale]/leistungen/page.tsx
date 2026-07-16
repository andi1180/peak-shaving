import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LeistungenOverview } from '@/components/leistung/leistungen-overview'
import { pageAlternates } from '@/lib/seo'

/**
 * /leistungen — Übersicht der 6 Leistungen, gruppiert wie das Mega-Menü.
 * Karten und Gruppen kommen aus derselben Datenquelle wie Nav und Template
 * (`lib/leistungen.ts` → `lib/nav.ts`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Leistungen.Overview' })
  return {
    title: `${t('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    alternates: pageAlternates(locale, '/leistungen'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LeistungenOverview />
}
