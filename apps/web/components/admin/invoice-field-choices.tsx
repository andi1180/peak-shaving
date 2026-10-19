'use client'

/**
 * Auswahlblock für widersprüchliche Rechnungsfelder in der Rechnungs-Station.
 *
 * Geschrieben wird ausschliesslich über „Übernehmen" bzw. „Wahl aufheben" — die Vorauswahl
 * markiert nur. Ein eigener Wert wird bewusst NICHT hier eingegeben, sondern im Tarif-Schritt.
 */
import * as React from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import type { InvoiceMergeFieldKey } from 'shared'

import { Button } from '@/components/ui/button'
import {
  chooseInvoiceFieldValueAction,
  clearInvoiceFieldChoiceAction,
  getInvoiceFieldConflictsAction,
} from '@/lib/admin/data-entry-actions-rechnung-choices'
import type { InvoiceFieldConflict } from '@/lib/admin/invoice-field-choices'
import type { TieredDemandInfo } from '@/lib/admin/invoice-tiered-demand'
import {
  applyMarkedChoice,
  chosenDescription,
  chosenOption,
  formatFieldValue,
  initialSelection,
  liftChoice,
  optionKey,
  optionText,
  orderedOptions,
  partText,
  tieredInvoiceValueText,
  tieredStandText,
  type InvoiceFieldChoiceActions,
} from './invoice-field-choices-model'
import { AdminError } from './ui'

const SERVER_ACTIONS: InvoiceFieldChoiceActions = {
  getConflicts: getInvoiceFieldConflictsAction,
  choose: chooseInvoiceFieldValueAction,
  clear: clearInvoiceFieldChoiceAction,
}

const LOAD_CRASH_TEXT = 'Die widersprüchlichen Werte konnten gerade nicht geladen werden.'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; conflicts: InvoiceFieldConflict[]; tieredDemandInfo?: TieredDemandInfo }
  | { status: 'error'; message: string }

type RowHandlers = {
  onApply: (field: InvoiceMergeFieldKey, markedKey: string | null) => Promise<string | null>
  onLift: (field: InvoiceMergeFieldKey) => Promise<string | null>
}

export function InvoiceFieldChoices({
  projectId,
  meteringPointId,
  tariffHref,
  reloadKey,
  actions = SERVER_ACTIONS,
}: {
  projectId: string
  meteringPointId: string
  /** Der Tarif-Schritt dieses Zählpunkts — dort wird ein eigener Wert eingetragen. */
  tariffHref: string
  /** Ändert die Station nach Abschluss, Entfernen und Preisbasis-Wechsel — dann wird neu geladen. */
  reloadKey: number
  actions?: InvoiceFieldChoiceActions
}) {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const [ownReloads, reload] = React.useReducer((n: number) => n + 1, 0)

  React.useEffect(() => {
    let current = true
    actions
      .getConflicts(projectId, meteringPointId)
      .then((result) => {
        if (!current) return
        setState(
          result.ok
            ? {
                status: 'ready',
                conflicts: result.conflicts,
                tieredDemandInfo: result.tieredDemandInfo,
              }
            : { status: 'error', message: result.error },
        )
      })
      .catch((cause: unknown) => {
        console.error('[admin/dateneingabe] Rechnungswahl laden:', cause)
        if (current) setState({ status: 'error', message: LOAD_CRASH_TEXT })
      })
    return () => {
      current = false
    }
  }, [actions, projectId, meteringPointId, reloadKey, ownReloads])

  const handlers: RowHandlers = {
    onApply: (field, markedKey) =>
      applyMarkedChoice({ actions, projectId, meteringPointId, field, reload }, markedKey),
    onLift: (field) => liftChoice({ actions, projectId, meteringPointId, field, reload }),
  }

  if (state.status === 'loading') return null
  if (state.status === 'error') {
    return (
      <ChoicesFrame>
        <AdminError>{state.message}</AdminError>
      </ChoicesFrame>
    )
  }
  return (
    <InvoiceFieldChoicesView
      conflicts={state.conflicts}
      tieredDemandInfo={state.tieredDemandInfo}
      tariffHref={tariffHref}
      {...handlers}
    />
  )
}

/** Reine Darstellung — ohne Konfliktfelder und ohne Stufen-Hinweis kein Block. */
export function InvoiceFieldChoicesView({
  conflicts,
  tieredDemandInfo,
  tariffHref,
  onApply,
  onLift,
}: {
  conflicts: readonly InvoiceFieldConflict[]
  tieredDemandInfo?: TieredDemandInfo
  tariffHref: string
} & RowHandlers) {
  if (conflicts.length === 0 && tieredDemandInfo === undefined) return null
  return (
    <>
      {tieredDemandInfo !== undefined && <TieredDemandHint info={tieredDemandInfo} />}
      {conflicts.length > 0 && (
        <ConflictList
          conflicts={conflicts}
          tariffHref={tariffHref}
          onApply={onApply}
          onLift={onLift}
        />
      )}
    </>
  )
}

/** Nur zur Ansicht: bei Stufen ist der Rechnungswert wirkungslos, es gibt nichts zu wählen. */
function TieredDemandHint({ info }: { info: TieredDemandInfo }) {
  return (
    <div className="mt-5 max-w-prose rounded-md border border-line bg-surface-alt p-3">
      <p className="text-small font-medium text-ink">
        Leistungspreis mit Benutzungsdauer-Stufen – gerechnet wird mit den Stufen aus dem
        Netzentgelt-Katalog.
      </p>
      {info.tiers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-small tabular-nums text-ink">
          {info.tiers.map((stand) => (
            <li key={stand.validFrom}>{tieredStandText(stand)}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-caption text-text-muted">
        Die Rechnungswerte dienen nur zur Kontrolle:
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-caption tabular-nums text-text-muted">
        {info.invoiceValues.map((value) => (
          <li key={value.documentId}>{tieredInvoiceValueText(value)}</li>
        ))}
      </ul>
    </div>
  )
}

function ConflictList({
  conflicts,
  tariffHref,
  onApply,
  onLift,
}: { conflicts: readonly InvoiceFieldConflict[]; tariffHref: string } & RowHandlers) {
  return (
    <ChoicesFrame>
      <ul className="mt-4 flex flex-col gap-4">
        {conflicts.map((conflict) => (
          <ConflictRow
            key={conflict.field}
            conflict={conflict}
            tariffHref={tariffHref}
            onApply={onApply}
            onLift={onLift}
          />
        ))}
      </ul>
    </ChoicesFrame>
  )
}

function ChoicesFrame({ children }: { children: React.ReactNode }) {
  return (
    /* Bernstein, nicht rot: ein Befund, der eine Entscheidung verlangt, kein Fehler. */
    <div className="mt-5 max-w-prose rounded-md border border-warning-border bg-warning-subtle p-3">
      <p className="text-small font-medium text-ink">Widersprüchliche Werte – bitte wählen</p>
      <p className="mt-2 max-w-prose text-caption text-text-muted">
        Widersprüchliche Werte werden nicht übernommen. Das Feld bleibt leer, bis Sie einen Wert
        wählen oder eintragen.
      </p>
      {children}
    </div>
  )
}

function ConflictRow({
  conflict,
  tariffHref,
  onApply,
  onLift,
}: { conflict: InvoiceFieldConflict; tariffHref: string } & RowHandlers) {
  const { field } = conflict
  const chosen = chosenOption(conflict)
  const [marked, setMarked] = React.useState<string | null>(() => initialSelection(conflict))
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const runAction = async (action: () => Promise<string | null>) => {
    setPending(true)
    setError(null)
    const message = await action()
    setPending(false)
    setError(message)
  }

  return (
    <li className="border-t border-warning-border pt-3 first:border-t-0 first:pt-0">
      <p className="text-small font-medium text-ink">{conflict.label}</p>

      {chosen !== null ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <p className="text-small tabular-nums text-ink">
            Gewählt: {formatFieldValue(field, chosen.value)}
            <span className="text-text-muted"> — {chosenDescription(chosen)}</span>
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => runAction(() => onLift(field))}
          >
            {pending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            Wahl aufheben
          </Button>
        </div>
      ) : (
        <fieldset className="mt-2" disabled={pending}>
          <legend className="sr-only">Wert für {conflict.label} wählen</legend>
          <div className="flex flex-col gap-2">
            {conflict.weightedUnavailableReason !== undefined && (
              <p className="text-caption text-text-muted">{conflict.weightedUnavailableReason}</p>
            )}
            {orderedOptions(conflict).map((option) => {
              const key = optionKey(option)
              const id = `rechnungswahl-${field}-${key}`
              return (
                <div key={key}>
                  <label
                    htmlFor={id}
                    className="flex items-baseline gap-2 text-small tabular-nums text-ink"
                  >
                    <input
                      id={id}
                      type="radio"
                      name={`rechnungswahl-${field}`}
                      value={key}
                      checked={marked === key}
                      onChange={() => setMarked(key)}
                      className="accent-accent"
                    />
                    <span>{optionText(field, option)}</span>
                  </label>
                  {option.kind === 'weighted' && option.parts.length > 0 && (
                    <details className="ml-6 mt-1 text-caption text-text-muted">
                      <summary className="cursor-pointer">Zusammensetzung</summary>
                      <ul className="mt-1 flex flex-col gap-0.5 tabular-nums">
                        {option.parts.map((part) => (
                          <li key={part.documentId}>{partText(field, part)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || marked === null}
              onClick={() => runAction(() => onApply(field, marked))}
            >
              {pending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              Übernehmen
            </Button>
            <Link
              href={tariffHref}
              className="text-small text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              Eigenen Wert im Tarif-Schritt eintragen
            </Link>
          </div>
        </fieldset>
      )}

      {error !== null && (
        <div className="mt-2">
          <AdminError>{error}</AdminError>
        </div>
      )}
    </li>
  )
}
