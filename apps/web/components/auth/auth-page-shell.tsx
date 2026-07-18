import type { ReactNode } from 'react'
import { Container } from '@/components/ui/layout'

/**
 * Ruhiges, fokussiertes Layout für die Auth-Formularseiten (T4-2): zentrierte Karte, schmale
 * Spalte. Server-Komponente (nur Layout, kein Client-State). Nutzt die vorhandenen
 * Design-Primitiven/-Tokens (Container, Karte wie im übrigen apps/web).
 */
export function AuthPageShell({
  title,
  lead,
  children,
}: {
  title: string
  lead?: string
  children: ReactNode
}) {
  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-h2 text-ink">{title}</h1>
        {lead && <p className="mt-3 text-body text-text-muted">{lead}</p>}
        <div className="mt-8 rounded-lg border border-line bg-surface p-6 sm:p-8">{children}</div>
      </div>
    </Container>
  )
}
