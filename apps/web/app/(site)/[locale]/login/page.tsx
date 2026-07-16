import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { pageAlternates } from '@/lib/seo'
import { robotsFor } from '@/lib/routes'
import { LOGIN_HREF } from '@/lib/nav'

/**
 * Platzhalter-Route (/login) — Gerüst, Inhalt folgt in einem späteren Schritt.
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
    title: `${t('login')} — COOLiN ENERGY`,
    alternates: pageAlternates(locale, LOGIN_HREF),
    robots: robotsFor(LOGIN_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <PagePlaceholder titleKey="login" />
}
