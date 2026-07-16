import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Container + Section: das Spacing-Raster an genau EINER Stelle.
 * Abstände zwischen Geschwistern kommen aus dem Layout (gap/space-y), nicht aus
 * Einzel-Margins — sonst kollabieren oder verdoppeln sie sich unbemerkt.
 */

/** Seitenbreite + horizontale Ränder. Einzige Stelle, die die Seitenbreite kennt. */
function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-container px-4 sm:px-6', className)} {...props} />
}

/**
 * Vertikaler Rhythmus einer Seitensektion. `tone` wählt den Grund:
 * default = Off-White-Seite, alt = abgesetzte Fläche, navy = tragende Ankerfläche.
 */
function Section({
  className,
  tone = 'default',
  ...props
}: React.HTMLAttributes<HTMLElement> & { tone?: 'default' | 'alt' | 'navy' }) {
  return (
    <section
      className={cn(
        'py-12 sm:py-16',
        tone === 'alt' && 'bg-surface-alt',
        tone === 'navy' && 'bg-navy text-navy-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** Kleines Großbuchstaben-Label über einer Überschrift. */
function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-label uppercase text-accent', className)} {...props} />
}

/**
 * Zahlen-Wrapper. `tabular-nums` ist bei Finanz-/Lastwerten Pflicht (§7.4) —
 * sonst springen Ziffern in Spalten und Beträge lassen sich nicht vergleichen.
 */
function Num({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('tabular-nums', className)} {...props} />
}

export { Container, Section, Eyebrow, Num }
