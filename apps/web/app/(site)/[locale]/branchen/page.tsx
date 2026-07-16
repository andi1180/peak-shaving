import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BranchenOverview } from '@/components/branche/branchen-overview'

/**
 * /branchen — Übersicht der 4 Start-Branchen, der interne Link-Hub.
 * Karten und Reihenfolge kommen aus derselben Datenquelle wie Nav und Template
 * (`lib/branchen.ts` → `lib/nav.ts`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Branchen.Overview' })
  return {
    title: `${t('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <BranchenOverview />
}
