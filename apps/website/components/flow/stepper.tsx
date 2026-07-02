import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

const STEPS = ['Lastgang', 'Tarif & Ziel', 'Analyse', 'Ergebnis']

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium tabular-nums',
                done && 'border-accent bg-accent text-accent-foreground',
                active && 'border-accent text-accent',
                !done && !active && 'border-border text-text-muted',
              )}
            >
              {done ? <Check className="h-4 w-4" /> : n}
            </span>
            <span
              className={cn(
                'hidden text-sm sm:inline',
                active ? 'font-medium text-ink' : 'text-text-muted',
              )}
            >
              {label}
            </span>
            {n < STEPS.length && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
