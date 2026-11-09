import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { SoftwareModulePage, softwareModuleMetadata } from '@/components/software/software-pages'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return softwareModuleMetadata(locale, 'ladesteuerung')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <SoftwareModulePage moduleKey="ladesteuerung" />
}
