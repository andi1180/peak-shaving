import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Peak Shaving Portal',
  description: 'Eingeloggte Multi-Tenant-App (Auth & RLS folgen).',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
