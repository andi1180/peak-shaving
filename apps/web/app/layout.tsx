import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'

// Inter selbst gehostet via next/font (Pflichtenheft §7.4: Performance + DSGVO,
// keine externen Google-Fonts-Requests). Als Basis-Font über --font-sans an das
// Tailwind-Theme gereicht. `tabular-nums` steht als Tailwind-Core-Utility bereit.
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
