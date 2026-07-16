import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
 * Badge. Die semantischen Varianten (positive/negative/warning) sind laut
 * DESIGN.md für ZAHLEN MIT BEDEUTUNG reserviert (Ersparnis/Kosten/Warnung) —
 * NICHT als Dekor für Kategorien o. Ä. Für neutrale Auszeichnungen: `neutral`.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 text-caption font-medium',
  {
    variants: {
      variant: {
        neutral: 'border-line bg-surface-alt text-text-muted',
        accent: 'border-transparent bg-accent-subtle text-accent',
        navy: 'border-transparent bg-navy text-navy-foreground',
        positive: 'border-transparent bg-positive-subtle text-positive tabular-nums',
        negative: 'border-transparent bg-negative-subtle text-negative tabular-nums',
        warning: 'border-transparent bg-warning-subtle text-warning tabular-nums',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
