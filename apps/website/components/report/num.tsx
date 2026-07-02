import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// Pflicht (DESIGN.md/§6.1): alle Finanz-/Lastwerte tabellarisch, damit Ziffern in Spalten stehen.
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{children}</span>
}
