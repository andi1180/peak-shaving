import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import '../../globals.css'

// Inter selbst gehostet via next/font (Pflichtenheft §7.4: Performance + DSGVO).
// next/font lädt die Dateien zur BUILD-Zeit und liefert sie aus der eigenen
// Domain aus — im Browser entsteht KEIN Request an Google.
// Es gibt bewusst nur DIESE eine Schrift (Entscheidung: Inter-only).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  description: 'Website in Aufbau.',
}

/** Alle Locales vorab bauen — statisch, ohne Request. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  // Ohne setRequestLocale fällt statisches Rendering auf dynamisch zurück.
  setRequestLocale(locale)

  return (
    <html lang={locale} className={inter.variable}>
      {/* flex-col + mt-auto am Footer: der Footer sitzt auch auf kurzen Seiten unten. */}
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
