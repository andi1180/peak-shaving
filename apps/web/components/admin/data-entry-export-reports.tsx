'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import {
  removeMeteringPointExportReportsAction,
  uploadMeteringPointExportReportsAction,
} from '@/lib/admin/data-entry-actions'
import type { StoredExportReports } from '@/lib/admin/export-reports'
import { formatDateTime, formatKwh } from '@/lib/admin/format'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminSuccess } from './ui'

const FIELD_ID = 'dateneingabe-anlagenbericht-dateien'

const REMOVE_CONFIRM =
  'Die Anlagenberichte von diesem Zählpunkt entfernen? Die Dateien bleiben in der Dokumentenliste des Projekts.'

/**
 * Optionaler Abschnitt unter dem Lastgang: stündliche Anlagenberichte (Einspeisung). Ein neuer
 * Upload ersetzt den Satz vollständig. Die Meldungen hängen an der Komponente, weil ein Erfolg
 * zwischen Formular und Zusammenfassung wechselt.
 */
export function DataEntryExportReports({
  projectId,
  meteringPointId,
  stored,
}: {
  projectId: string
  meteringPointId: string
  stored: StoredExportReports | null
}) {
  const [state, uploadAction, isPending] = useActionState(
    uploadMeteringPointExportReportsAction,
    ADMIN_INITIAL_STATE,
  )
  const [removeState, removeAction, isRemoving] = useActionState(
    removeMeteringPointExportReportsAction,
    ADMIN_INITIAL_STATE,
  )
  const error = state.fieldErrors?.files

  React.useEffect(() => {
    if (error) document.getElementById(FIELD_ID)?.focus()
  }, [error])

  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6" aria-labelledby={`${FIELD_ID}-title`}>
      <div>
        <h3 id={`${FIELD_ID}-title`} className="text-h4 font-semibold text-ink">
          Einspeisung ergänzen (optional)
        </h3>
        <p className="mt-1 max-w-prose text-small text-text-muted">
          Stündliche Anlagenberichte des Wechselrichter-Portals (xlsx, mehrere Monatsdateien). Die
          Einspeisung wird den Viertelstunden ohne Netzbezug zugeordnet.
        </p>
      </div>

      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {removeState.success && <AdminSuccess>{removeState.success}</AdminSuccess>}
      {removeState.formError && <AdminError>{removeState.formError}</AdminError>}

      {stored && <ExportReportsSummary stored={stored} />}

      <form action={uploadAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="meteringPointId" value={meteringPointId} />
        <div className="max-w-xl">
          <Label htmlFor={FIELD_ID}>{stored ? 'Berichte ersetzen' : 'Anlagenberichte'}</Label>
          <div className="mt-1.5">
            <input
              id={FIELD_ID}
              name="files"
              type="file"
              multiple
              aria-invalid={error ? true : undefined}
              aria-describedby={`${FIELD_ID}-hint`}
              className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
            />
          </div>
          <FieldHint id={`${FIELD_ID}-hint`} tone={error ? 'error' : 'muted'}>
            {error ??
              (stored
                ? 'Ein neuer Upload ersetzt alle bisherigen Berichte dieses Zählpunkts.'
                : 'Mehrfachauswahl möglich. Gespeichert werden die Dateien und eine Zusammenfassung.')}
          </FieldHint>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant={stored ? 'secondary' : 'primary'} size="md" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
            {isPending ? 'Wird eingelesen …' : 'Berichte einlesen'}
          </Button>
          <span role="status" aria-live="polite" className="sr-only">
            {isPending ? 'Wird eingelesen …' : ''}
          </span>
        </div>
      </form>

      {stored && (
        <form
          action={removeAction}
          onSubmit={(e) => {
            if (!window.confirm(REMOVE_CONFIRM)) e.preventDefault()
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPointId} />
          <Button type="submit" variant="ghost" size="md" disabled={isRemoving}>
            {isRemoving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
            {isRemoving ? 'Wird entfernt …' : 'Entfernen'}
          </Button>
        </form>
      )}
    </section>
  )
}

function ExportReportsSummary({ stored }: { stored: StoredExportReports }) {
  const { summary, documents } = stored
  const rows: [string, string][] = [
    ['Zeitraum', `${formatDateTime(summary.from)} – ${formatDateTime(summary.to)} (Ende der letzten Stunde)`],
    ['Stunden mit Werten', String(summary.hours)],
    ['Einspeisung gesamt', formatKwh(summary.exportKwh)],
    ['Bezug gesamt', formatKwh(summary.importKwh)],
    ['Fehlende Stunden', String(summary.missingHours)],
    ['Doppelte Stunden', String(summary.duplicateHours)],
    ['Mehrdeutige Stunden (Zeitumstellung)', String(summary.ambiguousHours)],
  ]
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-text-muted">{label}</dt>
            <dd className="text-ink tabular-nums">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="mt-4 text-small text-text-muted">
        {documents.length === 1 ? 'Eine Datei:' : `${documents.length} Dateien:`}
      </p>
      <ul className="mt-1 list-disc pl-5 text-small text-ink">
        {documents.map((doc) => (
          <li key={doc.documentId}>{doc.filename}</li>
        ))}
      </ul>
    </div>
  )
}
