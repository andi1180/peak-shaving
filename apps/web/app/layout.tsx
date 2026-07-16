import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter, Source_Serif_4 } from 'next/font/google'
import './globals.css'

// Inter selbst gehostet via next/font (Pflichtenheft §7.4: Performance + DSGVO).
// next/font lädt die Dateien zur BUILD-Zeit und liefert sie aus der eigenen Domain
// aus — im Browser entsteht KEIN Request an Google (kein Font-CDN zur Laufzeit).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

// OPTIONALE Display-Alternative für Überschriften — Entscheidung offen, siehe
// DESIGN.md „Offene Auswahlpunkte". Wird NUR über die Tailwind-Klasse `font-display`
// verwendet (z. B. auf /styleguide zum Vergleich); Inter-only bleibt der Default.
// Nur die zwei tatsächlich genutzten Schnitte, damit die Option nichts kostet,
// solange sie ungenutzt ist. Fällt die Entscheidung auf „Inter-only", wird dieser
// Block ersatzlos entfernt.
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
  fallback: ['Georgia', 'serif'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  description: 'Website in Aufbau.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
