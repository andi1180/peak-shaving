import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { ArticlePage, articleMetadata } from '@/components/wissen/article-page'
import { articlesFor, findArticle } from '@/lib/wissen'

/**
 * /wissen/<slug> — ein Wissen-Artikel.
 *
 * HIER IST `[slug]` KORREKT, anders als bei Leistungen/Branchen (die statische
 * Ordner haben): Wissen ist eine Collection. Ein Ordner je Artikel wäre eine
 * Code-Änderung pro Redaktionsentscheidung — genau das, was §10.1 mit dem
 * Autoren-UI abschaffen will. Struktur/Metadaten: `lib/wissen.ts`, Layout:
 * `components/wissen/article-page.tsx`, Text: `content/wissen/<slug>.<locale>.mdx`.
 */

/**
 * Alle Artikel aller Locales vorab bauen — die Seiten sind damit statisch
 * vorgerendert (kein MDX-Compiler im Request-Pfad, §6.4 Core Web Vitals).
 *
 * Läuft über `routing.locales` und NICHT über die Dateinamen: Ein Artikel, der
 * nur auf Deutsch existiert, darf keine `/en/...`-Route erzeugen — und ein
 * `.fr.mdx`, das jemand ablegt, ohne die Locale in `i18n/routing.ts`
 * einzutragen, darf keine Route erzeugen, die die Middleware gar nicht kennt.
 */
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    articlesFor(locale).map((article) => ({ locale, slug: article.slug })),
  )
}

/**
 * `false` — ein Slug, der nicht gebaut wurde, ist ein 404 und kein
 * Render-on-demand. Die Artikel liegen im Repo; einen unbekannten Slug könnte
 * der Server ohnehin nicht auflösen, und `blocking` würde ihn nur langsamer
 * ablehnen.
 */
export const dynamicParams = false

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  const article = findArticle(locale, slug)
  if (!article) return {}
  return articleMetadata(article)
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const article = findArticle(locale, slug)
  if (!article) notFound()

  return <ArticlePage article={article} locale={locale} />
}
