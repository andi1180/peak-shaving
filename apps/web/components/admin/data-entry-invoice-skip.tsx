'use client'

/**
 * „Ohne Rechnung fortfahren" — der dritte Weg der Rechnung-Station, jetzt mit Netzanschluss.
 *
 * Ohne Rechnung fehlen die Lieferantenpreise, nicht der Anschluss: Netzbetreiber und Netzebene
 * sind auch dann angebbar, und mit ihnen sind Netzentgelt und Abgaben berechenbar. Der Block ist
 * freiwillig; die Rückfrage vor dem Vermerk steht auf der Seite statt in einem `window.confirm`.
 */
import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { AdminState } from '@/lib/admin/schema'
import {
  DataEntryGridConnectionFields,
  EMPTY_GRID_CONNECTION,
  GRID_CONNECTION_NOT_SET_LABEL,
  type GridConnection,
} from './data-entry-grid-connection'

export const SKIP_INVOICE_PROMPT =
  'Ohne Rechnungsdaten fortfahren? Die Analyse rechnet dann ohne Kostenvergleich ' +
  '— nur auf Basis des Lastgangs und der Batterie-/Tarifoptimierung.'

export function DataEntryInvoiceSkip({
  projectId,
  meteringPointId,
  initial,
  skipAction,
  skipState,
  isSkipping,
  onCancel,
}: {
  projectId: string
  meteringPointId: string
  /** Der bereits erfasste Netzanschluss (`readManualTariffDraft`). */
  initial: GridConnection
  skipAction: (formData: FormData) => void
  skipState: AdminState
  isSkipping: boolean
  onCancel: () => void
}) {
  const [connection, setConnection] = React.useState<GridConnection>(initial)
  const [confirming, setConfirming] = React.useState(false)

  return (
    <form action={skipAction} noValidate className="flex flex-col gap-4" data-testid="invoice-skip">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="meteringPointId" value={meteringPointId} />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-small font-medium text-ink">Netzanschluss (freiwillig)</legend>
        <p className="max-w-2xl text-small text-text-muted">
          Auch ohne Rechnung lassen sich Netzentgelt und Abgaben berechnen — die Netzebene ist eine
          Eigenschaft des Anschlusses, nicht der Rechnung. Wer sie nicht kennt, wählt „
          {GRID_CONNECTION_NOT_SET_LABEL}".
        </p>
        <DataEntryGridConnectionFields
          idPrefix="skip"
          value={connection}
          onChange={(next) => {
            setConnection(next)
            setConfirming(false)
          }}
          fieldError={(key) => skipState.fieldErrors?.[key]}
        />
      </fieldset>

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-line p-4">
          <p className="max-w-prose text-small text-ink">{SKIP_INVOICE_PROMPT}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="md" disabled={isSkipping}>
              {isSkipping && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              Ohne Rechnung fortfahren
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={isSkipping}
              onClick={() => setConfirming(false)}
            >
              Zurück
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isSkipping ? 'Wird vermerkt …' : ''}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" size="md" onClick={() => setConfirming(true)}>
            Weiter
          </Button>
          {/* Leere Felder sind keine Angabe — ein bereits erfasster Anschluss bleibt dabei stehen. */}
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => {
              setConnection(EMPTY_GRID_CONNECTION)
              setConfirming(true)
            }}
          >
            {GRID_CONNECTION_NOT_SET_LABEL}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      )}
    </form>
  )
}
