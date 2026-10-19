'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  clearInvoicePeriodOverrideAction,
  setInvoicePeriodOverrideAction,
} from '@/lib/admin/data-entry-actions-rechnung-period'
import type { InvoiceFieldChoiceResult } from '@/lib/admin/invoice-field-choices'
import {
  formatIsoDay,
  invoicePeriodFlagText,
  type InvoicePeriodFlag,
} from '@/lib/admin/invoice-period-flags'
import { Pill } from './ui'

/** Zeitraum einer gelesenen Rechnung, wie die Station ihn zeigt. */
export type InvoicePeriodRowData = {
  documentId: string
  filename: string
  read: { from: string | null; to: string | null }
  effective: { from: string | null; to: string | null }
  overridden: boolean
  flags: readonly InvoicePeriodFlag[]
}

export type InvoicePeriodActions = {
  set: (
    projectId: string,
    meteringPointId: string,
    documentId: string,
    from: string,
    to: string,
  ) => Promise<InvoiceFieldChoiceResult>
  clear: (
    projectId: string,
    meteringPointId: string,
    documentId: string,
  ) => Promise<InvoiceFieldChoiceResult>
}

const SERVER_ACTIONS: InvoicePeriodActions = {
  set: setInvoicePeriodOverrideAction,
  clear: clearInvoicePeriodOverrideAction,
}

const CRASH_TEXT = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'

function periodText(period: { from: string | null; to: string | null }): string {
  if (period.from === null || period.to === null) return 'kein Zeitraum'
  return `${formatIsoDay(period.from)}–${formatIsoDay(period.to)}`
}

export function InvoicePeriodView({
  data,
  editing,
  pending,
  error,
  onEdit,
  onCancel,
  onSave,
  onClear,
}: {
  data: InvoicePeriodRowData
  editing: boolean
  pending: boolean
  error: string | null
  onEdit: () => void
  onCancel: () => void
  onSave: (from: string, to: string) => void
  onClear: () => void
}) {
  const fromId = `zeitraum-von-${data.documentId}`
  const toId = `zeitraum-bis-${data.documentId}`
  return (
    <div className="flex w-full flex-col gap-1 pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular-nums">Zeitraum: {periodText(data.effective)}</span>
        {data.overridden && <span>korrigiert (gelesen: {periodText(data.read)})</span>}
        {data.flags.map((flag) => (
          <Pill
            key={flag.kind === 'overlap' ? `overlap-${flag.documentId}` : flag.kind}
            tone="warning"
          >
            {invoicePeriodFlagText(flag)}
          </Pill>
        ))}
        {!editing && (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onEdit}>
            Zeitraum korrigieren
            <span className="sr-only"> — {data.filename}</span>
          </Button>
        )}
        {!editing && data.overridden && (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClear}>
            Korrektur entfernen
            <span className="sr-only"> — {data.filename}</span>
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onSave(String(form.get('from') ?? ''), String(form.get('to') ?? ''))
          }}
        >
          <label htmlFor={fromId} className="flex flex-col gap-0.5 text-caption">
            von
            <input
              id={fromId}
              name="from"
              type="date"
              required
              defaultValue={data.effective.from ?? ''}
              className="rounded-md border border-line bg-surface px-2 py-1 text-small text-ink"
            />
          </label>
          <label htmlFor={toId} className="flex flex-col gap-0.5 text-caption">
            bis
            <input
              id={toId}
              name="to"
              type="date"
              required
              defaultValue={data.effective.to ?? ''}
              className="rounded-md border border-line bg-surface px-2 py-1 text-small text-ink"
            />
          </label>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            Speichern
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
            Abbrechen
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-small text-warning">
          {error}
        </p>
      )}
    </div>
  )
}

export function InvoicePeriod({
  projectId,
  meteringPointId,
  data,
  onChanged,
  actions = SERVER_ACTIONS,
}: {
  projectId: string
  meteringPointId: string
  data: InvoicePeriodRowData
  /** Nach einer gespeicherten Änderung: Konfliktliste und Anzeige neu laden. */
  onChanged: () => void
  actions?: InvoicePeriodActions
}) {
  const [editing, setEditing] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const run = async (call: () => Promise<InvoiceFieldChoiceResult>) => {
    setPending(true)
    setError(null)
    try {
      const result = await call()
      if (result.ok) {
        setEditing(false)
        onChanged()
      } else setError(result.error)
    } catch (cause) {
      console.error('[admin/dateneingabe] Rechnungszeitraum:', cause)
      setError(CRASH_TEXT)
    }
    setPending(false)
  }

  return (
    <InvoicePeriodView
      data={data}
      editing={editing}
      pending={pending}
      error={error}
      onEdit={() => {
        setError(null)
        setEditing(true)
      }}
      onCancel={() => {
        setError(null)
        setEditing(false)
      }}
      onSave={(from, to) =>
        void run(() => actions.set(projectId, meteringPointId, data.documentId, from, to))
      }
      onClear={() => void run(() => actions.clear(projectId, meteringPointId, data.documentId))}
    />
  )
}
