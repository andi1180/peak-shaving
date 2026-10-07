import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Geteilte Zahlen-Eingabe (§5 Tarif-Schritt UND §6.2 Annahmen-Panel) — Einheit rechts im Feld,
// Fehler/Hinweis darunter, tolerant gegenüber deutscher Dezimalschreibweise (s. lib/form-utils.ts).
export function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  error,
  hint,
  help,
  step = 'any',
}: {
  id: string
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  error?: string
  hint?: string | null
  /** Dauerhafter Erklärtext (neutral), im Unterschied zum Plausibilitäts-`hint` (Warnfarbe). */
  help?: string
  step?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-16"
          aria-invalid={error ? true : undefined}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">
          {unit}
        </span>
      </div>
      {error && <span className="text-xs text-negative">{error}</span>}
      {help && <span className="text-xs text-text-muted">{help}</span>}
      {!error && hint && <span className="text-xs text-warning">{hint}</span>}
    </div>
  )
}
