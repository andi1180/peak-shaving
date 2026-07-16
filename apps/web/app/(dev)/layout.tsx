import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import '../globals.css'

/*
 * Root-Layout der ENTWICKLER-Routen (/styleguide).
 *
 * Warum ein eigenes Root-Layout: der Styleguide steht bewusst AUSSERHALB der
 * Sprach-Struktur (er ist ein Werkzeug, kein Seiteninhalt). Next erlaubt genau
 * dafür mehrere Root-Layouts über Route-Groups — `(dev)` und `(site)` tauchen
 * in keiner URL auf, `/styleguide` bleibt `/styleguide`.
 * Ohne diese Trennung müsste `<html lang>` global hart auf „de" stehen, was
 * die zweite Sprache später zum Umbau machen würde (§8.7).
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function DevLayout({ children }: { children: ReactNode }) {
  /*
   * Der Styleguide liegt außerhalb der Sprach-Struktur, rendert aber die ECHTEN
   * Primitives — und die sind locale-bewusst (components/ui/link.tsx nutzt den
   * next-intl-Link). Ohne intl-Kontext wirft das zur Laufzeit. Statt den
   * Primitive für den Styleguide zu verbiegen, bekommt die Dev-Route hier den
   * Kontext der Default-Locale. So zeigt der Styleguide, was die Seite wirklich
   * ausliefert.
   */
  setRequestLocale(routing.defaultLocale)

  return (
    <html lang={routing.defaultLocale} className={inter.variable}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
