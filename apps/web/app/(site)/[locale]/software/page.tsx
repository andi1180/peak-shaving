import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import {
  SoftwareOverviewPage,
  softwareOverviewMetadata,
} from '@/components/software/software-pages'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return softwareOverviewMetadata(locale)
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <SoftwareOverviewPage />
}
