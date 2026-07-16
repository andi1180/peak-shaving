import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { pageAlternates } from '@/lib/seo'

/** Platzhalter-Route (/impressum) — Gerüst, Inhalt folgt in einem späteren Schritt. */
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
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <PagePlaceholder titleKey="impressum" />
}
