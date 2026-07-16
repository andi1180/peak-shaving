import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { pageAlternates } from '@/lib/seo'
import { robotsFor } from '@/lib/routes'

/**
 * Platzhalter-Route (/ueber-uns) — Gerüst, Inhalt folgt in einem späteren Schritt.
 * NOINDEX seit 13c — Begründung/Zurückstellen: `apps/web/app/(site)/[locale]/produkte/page.tsx`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Pages' })
  return {
    title: `${t('ueberUns')} — COOLiN ENERGY`,
    alternates: pageAlternates(locale, '/ueber-uns'),
    robots: robotsFor('/ueber-uns'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <PagePlaceholder titleKey="ueberUns" />
}
