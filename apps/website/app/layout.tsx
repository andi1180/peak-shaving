import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// Inter selbst gehostet via next/font (DESIGN.md: Performance + DSGVO).
// Fallback-Stack aus DESIGN.md; als CSS-Variable --font-sans für das Tailwind-Theme.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

// Mono nur optional (rohe kW/kWh-Detailwerte); als --font-mono bereitgestellt.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  fallback: ['ui-monospace', 'monospace'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Peak Shaving Kalkulator',
  description:
    'Lastspitzen erkennen, Batterie physikalisch simulieren, Wirtschaftlichkeit belastbar rechnen.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
