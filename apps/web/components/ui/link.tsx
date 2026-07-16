import * as React from 'react'
import NextLink from 'next/link'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
 * Text-Link. Unterstreichung ist im Fließtext PFLICHT, nicht Geschmack:
 * Farbe allein darf nicht die einzige Unterscheidung sein (WCAG 1.4.1, §9.4).
 * `standalone` (Link außerhalb eines Textblocks, z. B. eine „Mehr erfahren"-Zeile)
 * darf die Unterstreichung bis zum Hover zurückhalten — dort ist die Rolle des
 * Elements schon aus der Position klar.
 */
const linkVariants = cva(
  cn(
    'rounded-sm underline-offset-[3px] transition-colors',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  ),
  {
    variants: {
      variant: {
        inline: 'text-accent underline decoration-accent',
        standalone: 'font-medium text-accent no-underline hover:underline',
        quiet: 'text-text-muted underline decoration-line-strong hover:text-ink',
      },
    },
    defaultVariants: { variant: 'inline' },
  },
)

type LinkProps = React.ComponentPropsWithoutRef<typeof NextLink> & VariantProps<typeof linkVariants>

function Link({ className, variant, ...props }: LinkProps) {
  return <NextLink className={cn(linkVariants({ variant }), className)} {...props} />
}

export { Link, linkVariants }
