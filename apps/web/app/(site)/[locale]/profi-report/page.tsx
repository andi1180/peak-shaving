import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ProfiReportPage } from '@/components/profi-report/profi-report-page'
import { PROFI_REPORT_HREF } from '@/lib/profi-report/links'
import { robotsFor } from '@/lib/routes'
import { pageAlternates } from '@/lib/seo'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'ProfiReport' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    alternates: pageAlternates(locale, PROFI_REPORT_HREF),
    robots: robotsFor(PROFI_REPORT_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ProfiReportPage />
}
