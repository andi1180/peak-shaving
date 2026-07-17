import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { BranchePage, brancheMetadata } from '@/components/branche/branche-page'

/**
 * /branchen/bau-baunebengewerbe — gerendert vom GEMEINSAMEN Branchen-Template
 * (`components/branche/branche-page.tsx`). Diese Datei trägt bewusst nur den
 * Schlüssel: Layout kommt aus dem Template, Struktur aus `lib/branchen.ts`,
 * Texte aus `messages/de.json` (`Branchen.Pages.bau`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return brancheMetadata(locale, 'bau')
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <BranchePage brancheKey="bau" />
}
