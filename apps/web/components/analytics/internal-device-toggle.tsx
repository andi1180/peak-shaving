'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { isInternalDevice, setInternalDevice } from '@/lib/analytics/internal-device'

type Status = 'unknown' | 'internal' | 'external' | 'unavailable'

export function InternalDeviceToggle() {
  // Erst nach dem Einhängen lesbar — der Server kennt den Speicher des Geräts nicht.
  const [status, setStatus] = React.useState<Status>('unknown')

  React.useEffect(() => {
    setStatus(isInternalDevice() ? 'internal' : 'external')
  }, [])

  function apply(internal: boolean) {
    if (!setInternalDevice(internal)) {
      setStatus('unavailable')
      return
    }
    setStatus(isInternalDevice() ? 'internal' : 'external')
  }

  return (
    <div className="space-y-6">
      <p className="text-body text-ink" role="status">
        {status === 'unknown' && 'Status wird gelesen …'}
        {status === 'internal' &&
          'Dieses Gerät ist als intern markiert. Es sendet keine Messdaten.'}
        {status === 'external' && 'Dieses Gerät ist nicht markiert. Es wird normal gemessen.'}
        {status === 'unavailable' &&
          'Der Browser-Speicher ist hier nicht verfügbar (z. B. privates Fenster) — die Markierung lässt sich nicht setzen.'}
      </p>
      <div className="flex flex-col gap-3">
        <Button type="button" variant="primary" size="lg" onClick={() => apply(true)}>
          Dieses Gerät als intern markieren
        </Button>
        <Button type="button" variant="secondary" size="lg" onClick={() => apply(false)}>
          Markierung aufheben
        </Button>
      </div>
      <p className="text-caption text-text-muted">
        Die Markierung gilt für diesen Browser auf diesem Gerät. Sie wirkt ab dem nächsten
        Seitenaufruf; diese Seite selbst wird nie gemessen.
      </p>
    </div>
  )
}
