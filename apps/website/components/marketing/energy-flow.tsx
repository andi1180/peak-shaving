import { BatteryCharging, Factory, Sun, Zap } from 'lucide-react'

// Energiefluss Sonne → Batterie → Verbraucher → Netz (§6.1 / DESIGN.md).
// Sparsam animiert, rein CSS; respektiert prefers-reduced-motion (motion-reduce:animate-none).
const nodes = [
  { icon: Sun, label: 'Sonne' }, // [MARTIN: Copy]
  { icon: BatteryCharging, label: 'Batterie' },
  { icon: Factory, label: 'Verbraucher' },
  { icon: Zap, label: 'Netz' },
]

function Wire() {
  return (
    <div className="relative hidden h-0.5 flex-1 self-center bg-border sm:block" aria-hidden>
      <span className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)] animate-flow-right motion-reduce:hidden" />
    </div>
  )
}

export function EnergyFlow() {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface-alt p-6 sm:flex-row sm:justify-between"
      role="img"
      aria-label="Energiefluss von der Sonne über die Batterie zum Verbraucher und zum Netz"
    >
      {nodes.map((node, i) => (
        <div key={node.label} className="flex items-center gap-4 sm:contents">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-subtle text-accent animate-flow-pulse motion-reduce:animate-none">
              <node.icon className="h-6 w-6" />
            </div>
            <span className="text-xs font-medium text-text-muted">{node.label}</span>
          </div>
          {i < nodes.length - 1 && <Wire />}
        </div>
      ))}
    </div>
  )
}
