'use client'

import * as React from 'react'
import { Link } from '@/i18n/navigation'
import { track, type AnalyticsEvents } from '@/lib/analytics/events'

type ProfiReportClick = AnalyticsEvents['cta_profi_report_click']

/** Link zum Profi-Report im Seiteninhalt — zählt den Klick (`cta_profi_report_click`). */
export function CtaProfiReportLink({
  position,
  variant,
  onClick,
  ...props
}: React.ComponentProps<typeof Link> & ProfiReportClick) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        track('cta_profi_report_click', { position, variant })
        onClick?.(event)
      }}
    />
  )
}
