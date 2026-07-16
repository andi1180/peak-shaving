import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { pageAlternates } from '@/lib/seo'
import { robotsFor } from '@/lib/routes'

/**
 * Platzhalter-Route (/produkte) — Gerüst, Inhalt folgt in einem späteren Schritt.
 *
 * NOINDEX SEIT 13c (§6.4-Nacharbeit): `PagePlaceholder` ist kein Inhalt, den
 * man Google anbieten sollte — die Entscheidung steht als `indexable: false`
 * in `lib/routes.ts` (`PLACEHOLDER_HREFS`), hier wird sie nur über `robotsFor`
 * abgeholt, damit sie nicht ein zweites Mal getroffen werden kann. Bekommt die
 * Seite echten Inhalt, entfällt der Eintrag dort — dieser Aufruf bleibt
 * unverändert und liefert dann automatisch kein `robots`-Tag mehr.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Pages' })
  return {
    title: `${t('produkte')} — COOLiN ENERGY`,
    alternates: pageAlternates(locale, '/produkte'),
    robots: robotsFor('/produkte'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <PagePlaceholder titleKey="produkte" />
}
