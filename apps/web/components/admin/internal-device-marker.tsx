'use client'

import * as React from 'react'
import { setInternalDevice } from '@/lib/analytics/internal-device'

/** Wer den Admin-Bereich mit gültiger Sitzung öffnet, ist intern: dieses Gerät misst danach nicht mehr. */
export function InternalDeviceMarker() {
  React.useEffect(() => {
    setInternalDevice(true)
  }, [])
  return null
}
