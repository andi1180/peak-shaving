import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
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
  'w-full rounded-md border border-line-input bg-surface px-3 text-body text-text',
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

/**
 * Passwort-Eingabe mit „anzeigen/verbergen"-Toggle (Auge-Icon, lucide-react —
 * Muster wie `how-it-works.tsx`: schlicht, einfarbig, `strokeWidth=1.75`).
 *
 * Erweitert das `Input`-Primitive, statt eine Wrapper-Komponente je Formular
 * zu bauen: Registrierung/Anmeldung/Passwort-neu teilen bereits `AuthField`
 * (`components/auth/form-parts.tsx`) als einzigen Feld-Renderer — die
 * Toggle-Logik gehört daher genau einmal hierher, nicht dreifach dorthin, wo
 * sie gebraucht wird. Ein eigener Button (kein `<span onClick>`): nur so
 * bleibt er per Tastatur fokussierbar und für Screenreader ein Kontrollelement.
 * `showLabel`/`hideLabel` kommen als Props (übersetzter Text) statt hart im
 * Primitive zu stehen — `components/ui` selbst bleibt sprachneutral.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    showLabel: string
    hideLabel: string
  }
>(({ className, showLabel, hideLabel, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        className={cn(
          'absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-muted',
          'outline-none hover:text-ink',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          'rounded-md',
        )}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
    </div>
  )
})
PasswordInput.displayName = 'PasswordInput'

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

/**
 * Checkbox — bewusst das NATIVE <input type="checkbox">, kein nachgebautes
 * Control (gleiche Abwägung wie beim Select oben).
 *
 * `accent-accent` färbt den Haken über die CSS-Eigenschaft `accent-color` in
 * unseren Teal-Token. Das ist der Grund, warum hier kein Radix nötig ist: Der
 * einzige Grund, eine Checkbox nachzubauen, war früher ihre Unstylebarkeit —
 * `accent-color` löst genau das, und behält Tastatur, Screenreader und das
 * Zusammenspiel mit <label> ab Werk.
 *
 * `h-4 w-4` + `mt-0.5`: Die Box sitzt auf der ersten Textzeile ihres Labels, nicht
 * mittig zu einem mehrzeiligen Satz.
 */
const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-accent',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'focus-visible:ring-offset-surface',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Checkbox.displayName = 'Checkbox'

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-small font-medium text-ink', className)} {...props} />
  ),
)
Label.displayName = 'Label'

/**
 * Feld-Hilfstext bzw. Fehlermeldung unter einem Eingabefeld.
 *
 * `id` ist das Gegenstück zu `aria-describedby` am Feld — ohne die Verknüpfung
 * liest ein Screenreader den Hinweis nie im Zusammenhang mit dem Feld vor, und
 * der Hinweis wäre nur für Sehende da.
 */
function FieldHint({
  children,
  id,
  tone = 'muted',
}: {
  children: React.ReactNode
  id?: string
  tone?: 'muted' | 'error'
}) {
  return (
    <p id={id} className={cn('text-caption', tone === 'error' ? 'text-negative' : 'text-text-muted')}>
      {children}
    </p>
  )
}

export { Input, PasswordInput, Textarea, Select, Checkbox, Label, FieldHint }
