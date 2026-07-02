import Link from 'next/link'
import { Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Zap className="h-5 w-5" />
          </span>
          {/* [MARTIN: Copy] Produktmarke final (§8 OP#6) */}
          Peak Shaving Kalkulator
        </Link>
        <Button asChild size="sm">
          <Link href="/rechner">Analyse starten</Link>
        </Button>
      </div>
    </header>
  )
}
