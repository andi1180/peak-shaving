'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, XCircle } from 'lucide-react'
import type { ColumnMapping, ColumnRole, Detection, Unit, ValueColumnInfo } from 'engine'

import { Num } from '@/components/report/num'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// §3.2: dem Nutzer die erkannte Struktur zeigen und bestätigen/korrigieren lassen — laienverständlich
// (Zielgruppe Bäcker/Installateur), keine Entwickler-Fehlermeldung. Rollen sind MEHRFACH pro Kategorie
// wählbar: mehrere Verbrauchs- UND mehrere Einspeise-Spalten werden jeweils summiert (Contract aus
// dem Engine-Prompt: options.columns.consumptionCols/feedInCols).

const ROLE_OPTIONS: { role: ColumnRole; label: string }[] = [
  { role: 'consumption', label: 'Verbrauch' },
  { role: 'feed_in', label: 'Einspeisung' },
  { role: 'ignore', label: 'Ignorieren' },
]

// Lange Zählpunktbezeichnung (AT + 31 Stellen) kompakt, aber mit unterscheidendem Ende sichtbar.
function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 4)}…${id.slice(-6)}` : id
}

function RoleToggle({
  value,
  label,
  onChange,
}: {
  value: ColumnRole
  label: string
  onChange: (role: ColumnRole) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1"
    >
      {ROLE_OPTIONS.map((opt) => {
        const active = value === opt.role
        return (
          <button
            key={opt.role}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.role)}
            className={cn(
              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-text-muted hover:bg-surface-alt hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function MappingPanel({
  detection,
  valueColumns,
  error,
  onConfirm,
  onCancel,
}: {
  detection: Detection
  valueColumns: ValueColumnInfo[]
  error: string | null
  onConfirm: (columns: ColumnMapping, unit: Unit | undefined) => void
  onCancel: () => void
}) {
  // Vorbelegung nach Rollen-Vorschlag (EEG-Spalten stehen bereits auf `ignore`).
  const [roles, setRoles] = useState<Record<number, ColumnRole>>(() =>
    Object.fromEntries(valueColumns.map((c) => [c.index, c.suggestedRole])),
  )

  const consumptionCols = useMemo(
    () => valueColumns.filter((c) => roles[c.index] === 'consumption').map((c) => c.index),
    [valueColumns, roles],
  )
  const feedInCols = useMemo(
    () => valueColumns.filter((c) => roles[c.index] === 'feed_in').map((c) => c.index),
    [valueColumns, roles],
  )
  const hasConsumption = consumptionCols.length > 0
  const splitTimestamp = detection.columns.timeColumn != null

  function handleConfirm() {
    const columns: ColumnMapping = { timestamp: detection.columns.timestamp }
    if (detection.columns.timeColumn != null) columns.timeColumn = detection.columns.timeColumn
    columns.consumptionCols = consumptionCols
    if (feedInCols.length > 0) columns.feedInCols = feedInCols
    // Vom Parser bereits erkannte Einheit durchreichen; nur wenn unklar, den Parser erneut raten lassen.
    const unit = detection.unit !== 'unknown' ? detection.unit : undefined
    onConfirm(columns, unit)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold text-ink">Datenspalten bestätigen</h3>
        <p className="text-sm leading-relaxed text-text-muted">
          Ihre Datei enthält mehrere Messwert-Spalten. Bitte prüfen Sie kurz, welche Ihren{' '}
          <span className="font-medium text-ink">Strombezug (Verbrauch)</span> und welche Ihre{' '}
          <span className="font-medium text-ink">Einspeisung</span> ins Netz zeigen. Wir haben eine
          Zuordnung vorgeschlagen — meist passt sie schon. Mehrere Zähler am selben Standort werden
          automatisch zusammengezählt.
        </p>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
        {splitTimestamp
          ? 'Datum und Uhrzeit wurden automatisch erkannt.'
          : 'Zeitstempel automatisch erkannt.'}
      </p>

      <ul className="flex flex-col gap-2">
        {valueColumns.map((col) => (
          <li key={col.index} className="rounded-lg border border-border bg-surface-alt p-3">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span
                  className="line-clamp-2 text-sm font-medium text-ink"
                  title={col.header}
                >
                  {col.header}
                </span>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                  {col.meteringPointId && (
                    <span className="font-mono tabular-nums" title={col.meteringPointId}>
                      {shortId(col.meteringPointId)}
                    </span>
                  )}
                  {col.meteringPointId && <span aria-hidden>·</span>}
                  <span>{col.unit === 'unknown' ? 'Einheit unklar' : col.unit}</span>
                  {col.eegAccounting && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-warning">Energiegemeinschaft-Verrechnung</span>
                    </>
                  )}
                </div>
              </div>
              <RoleToggle
                label={`Rolle für Spalte ${col.header}`}
                value={roles[col.index] ?? 'ignore'}
                onChange={(role) => setRoles((prev) => ({ ...prev, [col.index]: role }))}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-text-muted">
        Ausgewählt: <Num>{consumptionCols.length}</Num>× Verbrauch
        {feedInCols.length > 0 && (
          <>
            {' · '}
            <Num>{feedInCols.length}</Num>× Einspeisung
          </>
        )}
        {consumptionCols.length > 1 && ' (werden summiert)'}
      </p>

      {!hasConsumption && (
        <p className="text-xs text-warning">
          Bitte wählen Sie mindestens eine Spalte als „Verbrauch“ — sonst gibt es keinen Netzbezug zu
          berechnen.
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Zuordnung hat nicht funktioniert</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={onCancel}>
          Andere Datei
        </Button>
        <Button disabled={!hasConsumption} onClick={handleConfirm}>
          Übernehmen und weiter
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
