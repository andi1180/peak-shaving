import { FileBarChart, FileUp, Loader, SlidersHorizontal } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

// Die 4 Schritte aus §5. Copy provisorisch.
const steps = [
  {
    icon: FileUp,
    title: 'Lastgang hochladen', // [MARTIN: Copy]
    body: 'CSV oder Excel vom Netzbetreiber. Alles läuft in Ihrem Browser — kein Upload.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Tarif & Ziel',
    body: 'Werte aus Ihrer Netzrechnung eintragen. Sinnvolle Vorbelegung, alles editierbar.',
  },
  {
    icon: Loader,
    title: 'Analyse läuft',
    body: 'Die Batterie wird physikalisch über das ganze Jahr simuliert — ohne Wartebalken-Frust.',
  },
  {
    icon: FileBarChart,
    title: 'Ergebnis',
    body: 'Ersparnis, Empfehlung und Amortisation — nachvollziehbar bis zur Formel.',
  },
]

export function HowItWorks() {
  return (
    <section id="so-funktionierts" className="border-t border-border bg-surface-alt">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold text-ink">So funktioniert&apos;s</h2>
        <p className="mt-2 max-w-2xl text-text-muted">
          {/* [MARTIN: Copy] */}
          In vier Schritten von Ihrem Lastgang zur belastbaren Speicherempfehlung.
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full bg-surface">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-subtle text-accent">
                      <step.icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-semibold text-text-muted tabular-nums">
                      Schritt {i + 1}
                    </span>
                  </div>
                  <h3 className="font-semibold text-ink">{step.title}</h3>
                  <p className="text-sm text-text-muted">{step.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
