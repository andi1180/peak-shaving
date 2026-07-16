import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Eingabe-Primitives (Input / Textarea / Select / Label).
 *
 * Select ist bewusst das NATIVE <select>: shadcn/uis Radix-Select wäre eine
 * zusätzliche Abhängigkeit für einen Baustein, den bisher kein Formular braucht —
 * nativ ist barrierefrei ab Werk und auf Mobile das bessere Muster. Sobald ein
 * echtes Formular Mehrfachauswahl/Suche braucht, kann Radix nachgezogen werden
 * (die Tokens bleiben dieselben). Siehe DESIGN.md „Bausteine".
 *
 * `text-body` (16px) auf allen Feldern ist Absicht: iOS zoomt bei < 16px beim
 * Fokus in das Feld hinein.
 */
const fieldBase = cn(
  'w-full rounded-md border border-line-strong bg-surface px-3 text-body text-text',
  'placeholder:text-text-muted',
  'outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring',
  'focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted',
  'aria-[invalid=true]:border-negative aria-[invalid=true]:focus-visible:ring-negative',
)

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(fieldBase, 'h-10', className)} {...props} />
  ),
)
Input.displayName = 'Input'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(fieldBase, 'py-2', className)} {...props} />
))
Textarea.displayName = 'Textarea'

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'h-10 pr-8', className)} {...props} />
  ),
)
Select.displayName = 'Select'

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-small font-medium text-ink', className)} {...props} />
  ),
)
Label.displayName = 'Label'

/** Feld-Hilfstext bzw. Fehlermeldung unter einem Eingabefeld. */
function FieldHint({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}) {
  return (
    <p className={cn('text-caption', tone === 'error' ? 'text-negative' : 'text-text-muted')}>
      {children}
    </p>
  )
}

export { Input, Textarea, Select, Label, FieldHint }
