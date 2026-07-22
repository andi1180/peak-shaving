import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { DatenschutzPage } from '@/components/legal/datenschutz-page'
import { pageAlternates } from '@/lib/seo'

/**
 * /datenschutz (Pflichtenheft §9.2, OP#3) — echte Inhaltsseite, ersetzt den
 * bisherigen `PagePlaceholder`. Die Seite war nie `noindex`; hier ändert sich
 * nur der Inhalt.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Pages' })
  return {
    title: `${t('datenschutz')} — COOLiN ENERGY`,
    alternates: pageAlternates(locale, '/datenschutz'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DatenschutzPage />
}
