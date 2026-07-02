import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EnergyFlow } from './energy-flow'

// Mobile-first, warm, darf animieren (§6.1, Vorbild Tibber/Octopus).
export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-12 pt-12 sm:px-6 sm:pb-20 sm:pt-20">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-accent-subtle px-3 py-1 text-sm font-medium text-accent">
            <ShieldCheck className="h-4 w-4" />
            {/* [MARTIN: Copy] */}
            Ihre Verbrauchsdaten bleiben im Browser
          </span>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
            {/* [MARTIN: Copy] Headline / Value Proposition */}
            Was kostet Sie Ihre teuerste Lastspitze — und welche Batterie spart sie weg?
          </h1>
          <p className="max-w-xl text-lg text-text-muted">
            {/* [MARTIN: Copy] */}
            Laden Sie Ihren Lastgang hoch und sehen Sie in Minuten, wie viel Peak Shaving,
            Eigenverbrauch und tarifbewusstes Laden bei Ihnen bringen — transparent gerechnet, keine
            Black Box.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/rechner">
                Analyse starten
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#so-funktionierts">So funktioniert&apos;s</Link>
            </Button>
          </div>
        </div>
        <EnergyFlow />
      </div>
    </section>
  )
}
