'use client'

/**
 * Anlegen und Bearbeiten eines Kostenbausteins (K1b).
 *
 * Ein eigenes Formular statt zweier Felder im Geräteformular, weil der Baustein EINMAL existiert
 * und von vielen Geräten benutzt wird — ihn dort zu pflegen hiesse, denselben Preis an neun
 * Stellen zu tippen.
 */
import * as React from 'react'
import { useActionState, useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  createCostComponentAction,
  updateCostComponentAction,
} from '@/lib/admin/cost-components-actions'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'
import {
  COST_COMPONENT_ARTEN,
  COST_COMPONENT_ART_LABELS,
  costComponentPriceLocked,
  type CostComponentRow,
} from '@/lib/admin/cost-components'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from './ui'

function defaults(state: AdminState, row?: CostComponentRow): Record<string, string> {
  if (state.values) return state.values
  if (!row) return {}
  return {
    art: row.art,
    bezeichnung: row.bezeichnung,
    beschreibung: row.beschreibung ?? '',
    priceNet: row.price_net === null ? '' : String(row.price_net),
    priceAsOf: row.price_as_of ?? '',
    leistungKw: row.leistung_kw === null ? '' : String(row.leistung_kw),
    notes: row.notes ?? '',
  }
}

function Fields({
  formId,
  state,
  values,
  row,
}: {
  formId: string
  state: AdminState
  values: Record<string, string>
  row?: CostComponentRow
}) {
  const err = (name: string) => state.fieldErrors?.[name]
  const locked = row ? costComponentPriceLocked(row) : false

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${formId}-art`}
          name="art"
          label="Art"
          defaultValue={values.art ?? 'fundament'}
          error={err('art')}
          hint={
            row && row.used_by_count > 0
              ? 'Nicht änderbar, solange Geräte diesen Baustein nutzen.'
              : undefined
          }
        >
          {COST_COMPONENT_ARTEN.map((a) => (
            <option key={a} value={a}>
              {COST_COMPONENT_ART_LABELS[a]}
            </option>
          ))}
        </AdminSelect>
        <AdminField
          id={`${formId}-bezeichnung`}
          name="bezeichnung"
          label="Bezeichnung"
          required
          defaultValue={values.bezeichnung}
          error={err('bezeichnung')}
        />
      </div>

      <AdminField
        id={`${formId}-beschreibung`}
        name="beschreibung"
        label="Beschreibung (Einsatzbereich, Gewichts-/Grössenklasse)"

        defaultValue={values.beschreibung}
        error={err('beschreibung')}
        hint="Wofür dieser Baustein gilt — die Abgrenzung zwischen zwei Klassen ist ein Satz, keine Zahl."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${formId}-priceNet`}
          name="priceNet"
          label="Preis netto (EUR)"
          inputMode="numeric"
          defaultValue={values.priceNet}
          error={err('priceNet')}
          hint={
            locked
              ? 'Kann nicht geleert werden, solange freigegebene Geräte diesen Baustein nutzen.'
              : 'Leer heisst „noch nicht bepreist" — nicht „kostenlos". 0 ist eine Aussage und erlaubt.'
          }
        />
        <AdminField
          id={`${formId}-priceAsOf`}
          name="priceAsOf"
          label="Preisstand"
          type="date"
          defaultValue={values.priceAsOf}
          error={err('priceAsOf')}
        />
      </div>

      {/* Immer sichtbar statt an die Art gekoppelt: ein Formular-Reset nach der Action setzt das
          Art-Feld zurück, eine davon abhängige Sichtbarkeit liefe dann auseinander. */}
      <AdminField
        id={`${formId}-leistungKw`}
        name="leistungKw"
        label="Nennleistung (kW)"
        inputMode="numeric"
        defaultValue={values.leistungKw}
        error={err('leistungKw')}
        hint="Nur bei Art Wechselrichter, dort Pflicht — begrenzt die Lade-/Entladeleistung des Speichers. Bei Fundament und Installation wird der Wert nicht gespeichert."
      />

      <AdminField
        id={`${formId}-notes`}
        name="notes"
        label="Notizen"

        defaultValue={values.notes}
        error={err('notes')}
      />
    </>
  )
}

export function CreateCostComponentForm() {
  const [state, formAction, isPending] = useActionState(
    createCostComponentAction,
    ADMIN_INITIAL_STATE,
  )
  const formId = useId()
  const values = defaults(state)

  // Nach dem Anlegen wird das Formular ERSETZT, wie im Geräteformular: ein zweiter Klick legte
  // sonst einen zweiten, gleichlautenden Baustein an.
  if (state.success) return <AdminSuccess>{state.success}</AdminSuccess>

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && <AdminError>{state.formError}</AdminError>}
      <Fields formId={formId} state={state} values={values} />
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          Baustein anlegen
        </Button>
      </div>
    </form>
  )
}

export function EditCostComponentForm({ component }: { component: CostComponentRow }) {
  const [state, formAction, isPending] = useActionState(
    updateCostComponentAction,
    ADMIN_INITIAL_STATE,
  )
  const formId = useId()
  const values = defaults(state, component)

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="id" value={component.id} />
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      <Fields formId={formId} state={state} values={values} row={component} />
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          Speichern
        </Button>
      </div>
    </form>
  )
}
