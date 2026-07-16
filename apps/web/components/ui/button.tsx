import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
 * shadcn/ui-Button-Struktur, Werte an unsere Tokens gebunden (DESIGN.md).
 * BEWUSST: flache Flächen, KEIN Gradient, KEIN Schlagschatten (Pflichtenheft §7.2).
 * Hierarchie: primary = Teal-Akzent (der EINE Akzent, sparsam einsetzen),
 * secondary = Navy-Kontur (Anker), ghost = textnah.
 */
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'text-small font-semibold transition-colors',
    // Fokus ist Pflicht und sichtbar (WCAG 2.1 AA, §9.4) — Ring statt Outline,
    // damit er der Button-Rundung folgt.
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'focus-visible:ring-offset-surface',
    'disabled:pointer-events-none disabled:opacity-50',
  ),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-foreground hover:bg-accent-hover',
        secondary: 'border border-line-strong bg-surface text-navy hover:bg-surface-alt',
        ghost: 'text-navy hover:bg-surface-sunken',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

export { Button, buttonVariants }
