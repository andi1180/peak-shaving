import { BarChart3 } from 'lucide-react'

// Leerer, beschrifteter Container. Echte Recharts kommen in U2 — hier nur der Slot.
export function ChartPlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm font-medium text-ink">{title}</figcaption>
      <div className="flex min-h-44 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-alt p-6 text-center">
        <BarChart3 className="h-6 w-6 text-text-muted" aria-hidden />
        <span className="text-xs text-text-muted">{hint}</span>
        <span className="text-xs font-medium text-text-muted">[Chart folgt in U2]</span>
      </div>
    </figure>
  )
}
