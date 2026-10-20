'use client'

import * as React from 'react'
import { Link } from '@/i18n/navigation'
import { track } from '@/lib/analytics/events'
import { SCHNELLRECHNER_HREF } from '@/lib/nav'

/** „Ersparnis berechnen" in Header und Hero — zählt den Klick (`cta_ersparnis_click`). */
export function CtaErsparnisLink({
  position,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Link>, 'href'> & { position: 'header' | 'hero' }) {
  return (
    <Link
      {...props}
      href={SCHNELLRECHNER_HREF}
      onClick={(event) => {
        track('cta_ersparnis_click', { position })
        onClick?.(event)
      }}
    />
  )
}
