'use client'

/**
 * Der Netzanschluss eines Zählpunkts — Netzbetreiber, Netzebene, Messvariante.
 *
 * Ein Block für beide Einstiege der Rechnung-Station (Handeingabe und „ohne Rechnung
 * fortfahren"): die Netzebene ist eine Eigenschaft des Anschlusses, nicht der Rechnung, und
 * Netzentgelt und Abgaben sind auch ohne Rechnung berechenbar.
 *
 * ⚠ KONTROLLIERT VOM AUFRUFER: React setzt unkontrollierte Felder nach JEDER Action auf dem
 * umgebenden Formular zurück, auch nach einer bloss nachschlagenden.
 */
import {
  INVOICE_MERGE_FIELD_LABELS,
  METERING_VARIANTS,
  METERING_VARIANT_LABELS,
  NETZEBENEN,
  hasMeteringVariant,
  netzebeneLabel,
  type Country,
  type GridOperatorOption,
} from 'shared'

import { AdminSelect } from './ui'

export type GridConnection = {
  operatorId: string
  netzebene: string
  meteringVariant: string
}

export const EMPTY_GRID_CONNECTION: GridConnection = {
  operatorId: '',
  netzebene: '',
  meteringVariant: '',
}

/** Wortlaut wie im öffentlichen Rechner (`step-tariff.tsx`). */
export const GRID_CONNECTION_NOT_SET_LABEL = 'Nicht angeben'

export function DataEntryGridConnectionFields({
  idPrefix,
  country,
  operators,
  value,
  onChange,
  fieldError,
}: {
  /** Feld-IDs `${idPrefix}-operator` usw. */
  idPrefix: string
  /** Projektland — bestimmt die Ebenen-Beschriftung; gespeichert wird weiterhin „NE n". */
  country: Country
  /** Betreiber des Projektlandes (`gridOperatorOptionsFor`), serverseitig gebildet. */
  operators: readonly GridOperatorOption[]
  value: GridConnection
  onChange: (next: GridConnection) => void
  fieldError?: (key: string) => string | undefined
}) {
  /*
   * Nur NE 7 hat eine Messvariante. Auf NE 3–6 wird das Feld gar nicht gerendert (in der Spalte
   * gehört dort `null`, B21-1); der Wert bleibt im Zustand für eine Rückkehr auf NE 7.
   */
  const variantApplies = value.netzebene !== '' && hasMeteringVariant(Number(value.netzebene))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${idPrefix}-operator`}
          name="operatorId"
          label="Netzbetreiber"
          error={fieldError?.('operatorId')}
          value={value.operatorId}
          onValueChange={(operatorId) => onChange({ ...value, operatorId })}
        >
          <option value="">{GRID_CONNECTION_NOT_SET_LABEL}</option>
          {operators.map((operator) => (
            <option key={operator.id} value={operator.id}>
              {operator.label}
            </option>
          ))}
        </AdminSelect>

        <AdminSelect
          id={`${idPrefix}-netzebene`}
          name="netzebene"
          label={INVOICE_MERGE_FIELD_LABELS.netzebene}
          error={fieldError?.('netzebene')}
          value={value.netzebene}
          onValueChange={(netzebene) => onChange({ ...value, netzebene })}
        >
          <option value="">{GRID_CONNECTION_NOT_SET_LABEL}</option>
          {NETZEBENEN.map((level) => (
            <option key={level} value={String(level)}>
              {netzebeneLabel(country, level)}
            </option>
          ))}
        </AdminSelect>
      </div>

      {variantApplies && (
        <div className="sm:max-w-sm">
          <AdminSelect
            id={`${idPrefix}-metering-variant`}
            name="meteringVariant"
            label={INVOICE_MERGE_FIELD_LABELS.meteringVariant}
            error={fieldError?.('meteringVariant')}
            hint="Auf Netzebene 7 hängt der Leistungspreis daran."
            value={value.meteringVariant}
            onValueChange={(meteringVariant) => onChange({ ...value, meteringVariant })}
          >
            <option value="">{GRID_CONNECTION_NOT_SET_LABEL}</option>
            {METERING_VARIANTS.map((variant) => (
              <option key={variant} value={variant}>
                {METERING_VARIANT_LABELS[variant]}
              </option>
            ))}
          </AdminSelect>
        </div>
      )}
    </div>
  )
}
