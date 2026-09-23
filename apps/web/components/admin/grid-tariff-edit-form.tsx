'use client'

import { useActionState, useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { updateGridTariffAction } from '@/lib/admin/grid-tariffs-actions'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'
import {
  GRUNDPREIS_UNITS,
  GRUNDPREIS_UNIT_LABELS,
  MESSPREIS_UNITS,
  MESSPREIS_UNIT_LABELS,
  PRICE_BASES,
  PRICE_BASIS_LABELS,
  shortTime,
  type GridTariffRateWindowRow,
  type GridTariffRow,
} from '@/lib/admin/grid-tariffs'
import { AdminError, AdminField, AdminPanel, AdminSelect, AdminSuccess } from './ui'

type WindowRow = { key: number; init: GridTariffRateWindowRow | null }

/**
 * „Bearbeiten" an einer Tarifzeile. Alle Werte außer der Kombination (Betreiber, Netzebene,
 * Variante) sind änderbar; ein Grund ist Pflicht und landet mit alt/neu im Änderungsprotokoll.
 */
export function EditGridTariffSection({
  row,
  windows,
}: {
  row: GridTariffRow
  windows: GridTariffRateWindowRow[]
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState(updateGridTariffAction, ADMIN_INITIAL_STATE)
  const formId = `edit-${row.id}`

  /*
   * Nach einem gespeicherten Stand liefert die Seite neue Werte; der Schlüssel hängt die Felder dann
   * neu ein, BEVOR React das Formular nach der Action zurücksetzt — sonst fielen Auswahlfelder auf
   * den Stand des Seitenaufbaus zurück und der nächste Speichern-Klick schickte ihn mit.
   */
  const dataKey = JSON.stringify([row, windows.map(({ id: _id, grid_tariff_id: _t, ...w }) => w)])

  if (!open) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Bearbeiten
        </Button>
      </div>
    )
  }

  return (
    <form
      action={formAction}
      noValidate
      data-testid="grid-tariff-edit"
      className="mt-4 flex flex-col gap-4 border-t border-line pt-3"
    >
      <input type="hidden" name="tariffId" value={row.id} />
      <input type="hidden" name="operatorId" value={row.operator_id} />
      <input type="hidden" name="netzebene" value={String(row.netzebene)} />
      {row.metering_variant && (
        <input type="hidden" name="meteringVariant" value={row.metering_variant} />
      )}

      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <EditFields key={dataKey} formId={formId} row={row} windows={windows} state={state} />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird gespeichert …' : 'Änderung speichern'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Schliessen
        </Button>
      </div>
    </form>
  )
}

function EditFields({
  formId,
  row,
  windows,
  state,
}: {
  formId: string
  row: GridTariffRow
  windows: GridTariffRateWindowRow[]
  state: AdminState
}) {
  const nextKey = useRef(windows.length)
  const [rows, setRows] = useState<WindowRow[]>(() => windows.map((w, i) => ({ key: i, init: w })))
  const values = state.values
  const errors = state.fieldErrors
  const val = (name: string, fallback: string | number | null | undefined): string =>
    values?.[name] ?? (fallback == null ? '' : String(fallback))

  const grundpreisUnit = val('grundpreisUnit', row.grundpreis_unit)
  const messpreisUnit = val('messpreisUnit', row.messpreis_unit)
  const priceBasis = val('priceBasis', row.price_basis)

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${formId}-operatorName`}
          name="operatorName"
          label="Anzeigename Netzbetreiber"
          defaultValue={val('operatorName', row.operator_name)}
          error={errors?.operatorName}
          required
        />
        <div />
        <AdminField
          id={`${formId}-grundpreisAmount`}
          name="grundpreisAmount"
          label="Grundpreis"
          inputMode="numeric"
          defaultValue={val('grundpreisAmount', row.grundpreis_amount)}
          error={errors?.grundpreisAmount}
          required
        />
        <AdminSelect
          key={`grundpreisUnit:${grundpreisUnit}`}
          id={`${formId}-grundpreisUnit`}
          name="grundpreisUnit"
          label="Einheit Grundpreis"
          defaultValue={grundpreisUnit}
          error={errors?.grundpreisUnit}
        >
          {GRUNDPREIS_UNITS.map((u) => (
            <option key={u} value={u}>
              {GRUNDPREIS_UNIT_LABELS[u]}
            </option>
          ))}
        </AdminSelect>
        <AdminField
          id={`${formId}-messpreisAmount`}
          name="messpreisAmount"
          label="Messpreis (optional)"
          inputMode="numeric"
          defaultValue={val('messpreisAmount', row.messpreis_amount)}
          error={errors?.messpreisAmount}
        />
        <AdminSelect
          key={`messpreisUnit:${messpreisUnit}`}
          id={`${formId}-messpreisUnit`}
          name="messpreisUnit"
          label="Einheit Messpreis"
          defaultValue={messpreisUnit}
          error={errors?.messpreisUnit}
        >
          <option value="">— kein Messpreis —</option>
          {MESSPREIS_UNITS.map((u) => (
            <option key={u} value={u}>
              {MESSPREIS_UNIT_LABELS[u]}
            </option>
          ))}
        </AdminSelect>
        <AdminField
          id={`${formId}-netzverlustCtPerKwh`}
          name="netzverlustCtPerKwh"
          label="Netzverlust (ct/kWh)"
          inputMode="numeric"
          defaultValue={val('netzverlustCtPerKwh', row.netzverlust_ct_per_kwh)}
          error={errors?.netzverlustCtPerKwh}
          required
        />
        <AdminSelect
          key={`priceBasis:${priceBasis}`}
          id={`${formId}-priceBasis`}
          name="priceBasis"
          label="Preisbasis"
          defaultValue={priceBasis}
          error={errors?.priceBasis}
        >
          {PRICE_BASES.map((b) => (
            <option key={b} value={b}>
              {PRICE_BASIS_LABELS[b]}
            </option>
          ))}
        </AdminSelect>
        <AdminField
          id={`${formId}-validFrom`}
          name="validFrom"
          label="Gültig ab (JJJJ-MM-TT)"
          defaultValue={val('validFrom', row.valid_from)}
          error={errors?.validFrom}
          required
        />
        <AdminField
          id={`${formId}-validUntil`}
          name="validUntil"
          label="Gültig bis (leer = offen)"
          defaultValue={val('validUntil', row.valid_until)}
          error={errors?.validUntil}
        />
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((r, index) => {
          const p = `w${index}_`
          const w = r.init
          return (
            <li key={r.key}>
              <AdminPanel>
                <div className="flex items-center justify-between">
                  <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
                    Zeitfenster {index + 1}
                  </p>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                      className="inline-flex items-center gap-1 text-caption text-text-muted underline hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Entfernen
                    </button>
                  )}
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ['label', 'Bezeichnung', w?.label, true],
                      ['ctPerKwh', 'Arbeitspreis (ct/kWh)', w?.ct_per_kwh, true],
                      ['timeFrom', 'Uhrzeit von', w ? shortTime(w.time_from) : null, true],
                      ['timeTo', 'Uhrzeit bis', w ? shortTime(w.time_to) : null, true],
                      ['monthDayFrom', 'Saison von (MM-TT, optional)', w?.month_day_from, false],
                      ['monthDayTo', 'Saison bis (MM-TT, optional)', w?.month_day_to, false],
                    ] as const
                  ).map(([leaf, label, init, required]) => (
                    <AdminField
                      key={leaf}
                      id={`${formId}-${p}${leaf}`}
                      name={`${p}${leaf}`}
                      label={label}
                      defaultValue={val(`${p}${leaf}`, init)}
                      error={errors?.[`${p}${leaf}`]}
                      required={required}
                    />
                  ))}
                  <div className="sm:col-span-2">
                    <AdminField
                      id={`${formId}-${p}note`}
                      name={`${p}note`}
                      label="Notiz (optional)"
                      defaultValue={val(`${p}note`, w?.note)}
                      error={errors?.[`${p}note`]}
                    />
                  </div>
                </div>
              </AdminPanel>
            </li>
          )
        })}
      </ul>
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((all) => [...all, { key: nextKey.current++, init: null }])}
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Zeitfenster hinzufügen
        </Button>
      </div>

      <AdminField
        id={`${formId}-reason`}
        name="reason"
        label="Grund der Änderung"
        placeholder="z. B. Tippfehler beim Netzverlust laut Preisblatt S. 2"
        // Nach einem Speichern leer: jede Änderung braucht ihren eigenen Grund.
        defaultValue={state.success ? '' : (values?.reason ?? '')}
        error={errors?.reason}
        required
      />
    </>
  )
}
