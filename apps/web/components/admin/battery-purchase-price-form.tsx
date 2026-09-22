'use client'

/**
 * Der Einkaufspreis eines Katalog-Geräts (K1) — ein EIGENES Formular, weil der Wert in einer
 * anderen Tabelle und einem anderen Schema liegt.
 *
 * ── ⚠ WARUM ER NICHT IM KATALOG-FORMULAR STEHT ───────────────────────────────────────────────
 * `platform.battery_purchase_prices` hat für KEINE Rolle ein Tabellenrecht und ist über die Data
 * API gar nicht erreichbar. Aus Listen- und Einkaufspreis ergibt sich die Marge, und der
 * öffentliche Rechner liest den Katalog im Browser des Kunden — eine Spalte in
 * `public.battery_catalog` führe über ein `select *` mit, auch wenn keine Oberfläche sie rendert.
 *
 * ── EIN LEERES PREISFELD ENTFERNT DEN EINTRAG ─────────────────────────────────────────────────
 * Ein eigener Löschknopf wäre ein zweiter Weg für denselben Vorgang. Bei einem Datensatz aus genau
 * zwei Angaben gibt es für „kein Preis" keine zweite Lesart — der Wrapper deutet es genauso.
 */
import { useActionState, useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setBatteryPurchasePriceAction } from '@/lib/admin/battery-catalog-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { BatteryCatalogRow } from '@/lib/admin/battery-catalog'
import { AdminError, AdminField, AdminSuccess } from './ui'

export function BatteryPurchasePriceForm({ battery }: { battery: BatteryCatalogRow }) {
  const [state, formAction, isPending] = useActionState(
    setBatteryPurchasePriceAction,
    ADMIN_INITIAL_STATE,
  )
  const formId = useId()

  const price =
    state.values?.purchasePriceNet ??
    (battery.purchase_price_net === null
      ? ''
      : String(battery.purchase_price_net).replace('.', ','))
  const asOf = state.values?.purchasePriceAsOf ?? battery.purchase_price_as_of ?? ''

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={battery.id} />
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${formId}-purchasePriceNet`}
          name="purchasePriceNet"
          label="Einkaufspreis netto (EUR)"
          inputMode="numeric"
          defaultValue={price}
          error={state.fieldErrors?.purchasePriceNet}
          hint="Leer lassen und speichern entfernt den hinterlegten Einkaufspreis."
        />
        <AdminField
          id={`${formId}-purchasePriceAsOf`}
          name="purchasePriceAsOf"
          label="Stand"
          type="date"
          defaultValue={asOf}
          error={state.fieldErrors?.purchasePriceAsOf}
          hint="Pflicht, sobald ein Preis dasteht — ohne Datum ist er in einem Jahr nicht mehr beurteilbar."
        />
      </div>

      <div>
        <Button type="submit" variant="secondary" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Wird gespeichert …
            </>
          ) : (
            'Einkaufspreis speichern'
          )}
        </Button>
        <p className="mt-2 max-w-prose text-caption text-text-muted">
          Diese Zahl verlässt den Admin-Bereich nicht. Sie steht in einem Schema, das über die
          öffentliche Schnittstelle gar nicht erreichbar ist, und der Rechner bekommt sie nie zu
          sehen.
        </p>
      </div>
    </form>
  )
}
