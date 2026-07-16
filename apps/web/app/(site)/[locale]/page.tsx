import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Hero } from '@/components/home/hero'
import { PeakShavingBlock } from '@/components/home/peak-shaving-block'
import { Portfolio } from '@/components/home/portfolio'
import { BranchenTeaser } from '@/components/home/branchen-teaser'
import { WissenTeaser } from '@/components/home/wissen-teaser'
import { Vorgehen } from '@/components/home/vorgehen'
import { KontaktCta } from '@/components/home/kontakt-cta'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Home' })
  const tHero = await getTranslations({ locale, namespace: 'Home.Hero' })
  return {
    title: `${tHero('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
  }
}

/**
 * Startseite (/) — Reihenfolge = Hierarchie (Pflichtenheft §4.4).
 *
 * Hero → Peak-Shaving-Block → Leistungsportfolio → Branchen → Wissen →
 * Vorgehen → Kontakt-CTA. Jede Sektion ist eine eigene Komponente unter
 * `components/home/`; der Inhalt jeder einzelnen ist dort dokumentiert
 * (inkl. Quelle des Textes im Bestandscontent).
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <>
      <Hero />
      <PeakShavingBlock />
      <Portfolio />
      <BranchenTeaser />
      <WissenTeaser />
      <Vorgehen />
      <KontaktCta />
    </>
  )
}
