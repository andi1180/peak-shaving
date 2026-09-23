'use client'

/**
 * Das Formular des Abschnitts „Batteriespeicher" (K1) — einmal zum Anlegen, einmal zum Bearbeiten.
 *
 * ── DIESELBEN FELDER FÜR BEIDE WEGE, UND ZWAR ABSICHTLICH ─────────────────────────────────────
 * `admin_create_battery` und `admin_update_battery` nehmen dieselben 18 Angaben entgegen, und der
 * einzige Unterschied ist die Kennung. Zwei getrennte Feldlisten liefen beim ersten neuen Feld
 * auseinander — und die Abweichung sähe man keiner der beiden Seiten an.
 *
 * ── ⚠ WAS BEIM BEARBEITEN ANDERS IST: EIN LEERES FELD LÖSCHT ──────────────────────────────────
 * `admin_update_battery` schreibt die Zeile vollständig neu; was leer abgeschickt wird, ist danach
 * `null`. Das ist die richtige Lesart für ein Formular, das jedes Feld mitschickt (eine falsche
 * Zahl liesse sich sonst nie wieder entfernen) — aber es muss dastehen, und deshalb steht es im
 * Formular und nicht nur in einem Kommentar.
 *
 * ── DIE FREIGABE IST HIER NICHT ───────────────────────────────────────────────────────────────
 * `active` ist in keinem der beiden Wrapper ein Parameter. Freigeben ist ein eigener Schritt mit
 * eigener Prüfung (`admin_set_battery_active`), und genau deshalb kann kein Speichern ein Gerät
 * versehentlich in den Rechner bringen.
 */
import * as React from 'react'
import { useActionState, useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createBatteryAction, updateBatteryAction } from '@/lib/admin/battery-catalog-actions'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'
import {
  BATTERY_CONTROL_TYPES,
  BATTERY_CONTROL_TYPE_LABELS,
  BATTERY_KATEGORIEN,
  BATTERY_KATEGORIE_LABELS,
  BATTERY_RTE_SOURCES,
  BATTERY_RTE_SOURCE_LABELS,
  BATTERY_SELECT_UNSET,
  type BatteryCatalogRow,
} from '@/lib/admin/battery-catalog'
import { costComponentOptionLabel, type CostComponentRow } from '@/lib/admin/cost-components'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from './ui'

/** Zahl → Feldinhalt. Mit Komma, weil Datenblätter und Angebote deutschsprachig sind. */
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value).replace('.', ',')
}

function bool(value: boolean | null | undefined): string {
  return value === null || value === undefined ? '' : value ? 'true' : 'false'
}

/*
 * ⚠ HIER STAND BIS ZUM 23.09.2026 EIN WERT-ABHÄNGIGER `key` AN JEDEM AUSWAHLFELD (`selectKey`).
 * Er ist entfallen, weil `AdminSelect` den Fehler jetzt selbst behebt — ein `<select>` fällt beim
 * Formular-Reset nach einer Action sonst auf den Stand des SEITENAUFBAUS zurück, und `leer` heisst
 * in `admin_update_battery` LÖSCHEN. Begründung und Messung: `components/admin/ui.tsx`,
 * `useSelectValueOnFormReset`. Der Nachweis bleibt scharf: `e2e/battery-catalog-rte-source.mjs`.
 */

/**
 * Was in den Feldern steht: die zurückgemeldeten Eingaben, sonst die gespeicherte Zeile, sonst
 * leer.
 *
 * ⚠ Die Reihenfolge ist wichtig. Nach einer beanstandeten Eingabe muss das Getippte stehenbleiben —
 * sonst tippt jemand achtzehn Felder ein zweites Mal, weil eine Zahl ein Komma zu viel hatte.
 */
function defaults(state: AdminState, battery?: BatteryCatalogRow): Record<string, string> {
  const stored: Record<string, string> = battery
    ? {
        kategorie: battery.kategorie,
        hersteller: battery.hersteller,
        bezeichnung: battery.bezeichnung,
        memodoId: battery.memodo_id === null ? '' : String(battery.memodo_id),
        usableCapacityKwh: num(battery.usable_capacity_kwh),
        maxPowerKw: num(battery.max_power_kw),
        roundTripEfficiency: num(battery.round_trip_efficiency),
        rteSource: battery.rte_source ?? '',
        listPriceNet: num(battery.list_price_net),
        inverterIncluded: bool(battery.inverter_included),
        extraInverterCostNet: num(battery.extra_inverter_cost_net),
        requiresFoundation: bool(battery.requires_foundation),
        foundationComponentId: battery.foundation_component_id ?? '',
        installationComponentId: battery.installation_component_id ?? '',
        priceAsOf: battery.price_as_of ?? '',
        sourceUrl: battery.source_url ?? '',
        datasheetUrl: battery.datasheet_url ?? '',
        controlType: battery.control_type ?? '',
        notes: battery.notes ?? '',
      }
    : {}

  return { ...stored, ...(state.values ?? {}) }
}

function BatteryFields({
  formId,
  state,
  values,
  components,
}: {
  formId: string
  state: AdminState
  values: Record<string, string>
  /** Alle Kostenbausteine — die Auswahlfelder trennen sie selbst nach Art. */
  components: CostComponentRow[]
}) {
  const err = (name: string) => state.fieldErrors?.[name]
  const foundationComponents = components.filter((c) => c.art === 'fundament')
  const installationComponents = components.filter((c) => c.art === 'installation')

  return (
    <>
      {/* ── Identität ─────────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${formId}-kategorie`}
          name="kategorie"
          label="Kategorie"
          defaultValue={values.kategorie ?? BATTERY_SELECT_UNSET}
          error={err('kategorie')}
          hint="Heim oder Gewerbe — der Rechner wählt daraus, welche Geräte für einen Kunden überhaupt in Frage kommen."
        >
          <option value={BATTERY_SELECT_UNSET}>— bitte wählen —</option>
          {BATTERY_KATEGORIEN.map((k) => (
            <option key={k} value={k}>
              {BATTERY_KATEGORIE_LABELS[k]}
            </option>
          ))}
        </AdminSelect>
        <AdminField
          id={`${formId}-memodoId`}
          name="memodoId"
          label="Memodo-Nummer (optional)"
          inputMode="numeric"
          defaultValue={values.memodoId}
          error={err('memodoId')}
          hint="Die Kennung beim Grosshändler. Über sie findet ein späterer Import dieselbe Zeile wieder, statt sie doppelt anzulegen."
        />
        <AdminField
          id={`${formId}-hersteller`}
          name="hersteller"
          label="Hersteller"
          defaultValue={values.hersteller}
          error={err('hersteller')}
          required
        />
        <AdminField
          id={`${formId}-bezeichnung`}
          name="bezeichnung"
          label="Bezeichnung"
          defaultValue={values.bezeichnung}
          error={err('bezeichnung')}
          required
        />
      </div>

      {/* ── Kenndaten ─────────────────────────────────────────────────────────────────────────── */}
      <fieldset className="border-t border-line pt-5">
        <legend className="sr-only">Kenndaten</legend>
        <p className="mb-4 max-w-prose text-small text-text-muted">
          Diese drei Werte liest die Simulation. Ohne sie lässt sich das Gerät nicht freigeben — mit
          falschen Werten rechnet es still falsch.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <AdminField
            id={`${formId}-usableCapacityKwh`}
            name="usableCapacityKwh"
            label="Nutzbare Kapazität (kWh)"
            inputMode="numeric"
            defaultValue={values.usableCapacityKwh}
            error={err('usableCapacityKwh')}
            hint="Bereits um die Entladetiefe bereinigt — nicht die Brutto-Kapazität des Datenblatts."
          />
          <AdminField
            id={`${formId}-maxPowerKw`}
            name="maxPowerKw"
            label="Maximale Leistung (kW)"
            inputMode="numeric"
            defaultValue={values.maxPowerKw}
            error={err('maxPowerKw')}
            hint="Ein Wert für beide Richtungen: die Engine kennt kein getrenntes Lade- und Entladelimit."
          />
          <AdminField
            id={`${formId}-roundTripEfficiency`}
            name="roundTripEfficiency"
            label="Wirkungsgrad (0–1)"
            inputMode="numeric"
            defaultValue={values.roundTripEfficiency}
            error={err('roundTripEfficiency')}
            hint="Round-Trip, also Laden und Entladen zusammen. 0,9 heisst 90 % — nicht 90 eintragen."
          />
          <AdminSelect
            id={`${formId}-rteSource`}
            name="rteSource"
            label="Wirkungsgrad-Quelle"
            defaultValue={values.rteSource ?? BATTERY_SELECT_UNSET}
            error={err('rteSource')}
            hint="Zum Freigeben Pflicht, sobald ein Wirkungsgrad dasteht. „Datenblatt“ nur, wenn der Hersteller einen System- bzw. AC-Round-Trip nennt — ein Wechselrichter-Spitzenwirkungsgrad ist keiner."
          >
            <option value={BATTERY_SELECT_UNSET}>— nicht angegeben —</option>
            {BATTERY_RTE_SOURCES.map((r) => (
              <option key={r} value={r}>
                {BATTERY_RTE_SOURCE_LABELS[r]}
              </option>
            ))}
          </AdminSelect>
        </div>
      </fieldset>

      {/* ── Preise ────────────────────────────────────────────────────────────────────────────── */}
      <fieldset className="border-t border-line pt-5">
        <legend className="sr-only">Preise</legend>
        <p className="mb-4 max-w-prose text-small text-text-muted">
          Alle Beträge NETTO. Es gibt bewusst kein Brutto-Feld — brutto ist netto mal 1,2 und damit
          eine Frage der Anzeige, keine zweite Angabe.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField
            id={`${formId}-listPriceNet`}
            name="listPriceNet"
            label="Listenpreis netto (EUR)"
            inputMode="numeric"
            defaultValue={values.listPriceNet}
            error={err('listPriceNet')}
            hint="Der Gesamtpreis des Geräts, nicht je kWh. Den €/kWh-Wert der Engine bildet der Rechner selbst."
          />
          <AdminField
            id={`${formId}-priceAsOf`}
            name="priceAsOf"
            label="Preisstand"
            type="date"
            defaultValue={values.priceAsOf}
            error={err('priceAsOf')}
            hint="Wann dieser Preis so galt. Der Report weist die Herkunft heute als Lücke aus — das hier schliesst sie."
          />
          <AdminSelect
            id={`${formId}-inverterIncluded`}
            name="inverterIncluded"
            label="Wechselrichter enthalten?"
            defaultValue={values.inverterIncluded ?? BATTERY_SELECT_UNSET}
            error={err('inverterIncluded')}
            hint="Antwort „nein“ macht den Aufpreis unten zur Pflicht — ohne ihn wäre die Investition zu niedrig."
          >
            <option value={BATTERY_SELECT_UNSET}>— noch nicht bekannt —</option>
            <option value="true">ja, enthalten</option>
            <option value="false">nein, separat</option>
          </AdminSelect>
          <AdminField
            id={`${formId}-extraInverterCostNet`}
            name="extraInverterCostNet"
            label="Aufpreis Wechselrichter netto (EUR)"
            inputMode="numeric"
            defaultValue={values.extraInverterCostNet}
            error={err('extraInverterCostNet')}
          />
          <AdminSelect
            id={`${formId}-requiresFoundation`}
            name="requiresFoundation"
            label="Fundament nötig?"
            defaultValue={values.requiresFoundation ?? BATTERY_SELECT_UNSET}
            error={err('requiresFoundation')}
            hint="Antwort „ja“ macht einen Fundament-Baustein MIT Preis zur Pflicht für die Freigabe."
          >
            <option value={BATTERY_SELECT_UNSET}>— noch nicht bekannt —</option>
            <option value="false">nein</option>
            <option value="true">ja</option>
          </AdminSelect>
          <AdminSelect
            id={`${formId}-foundationComponentId`}
            name="foundationComponentId"
            label="Fundament-Baustein"
            defaultValue={values.foundationComponentId ?? BATTERY_SELECT_UNSET}
            error={err('foundationComponentId')}
            hint="Der Preis steht im Baustein, nicht am Gerät — dieselbe Bodenplatte trägt mehrere Schränke."
          >
            <option value={BATTERY_SELECT_UNSET}>— keiner —</option>
            {foundationComponents.map((c) => (
              <option key={c.id} value={c.id}>
                {costComponentOptionLabel(c)}
              </option>
            ))}
          </AdminSelect>
          <AdminSelect
            id={`${formId}-installationComponentId`}
            name="installationComponentId"
            label="Installations-Baustein (optional)"
            defaultValue={values.installationComponentId ?? BATTERY_SELECT_UNSET}
            error={err('installationComponentId')}
            hint="Angabe für die Angebotslegung. Die Engine hat dafür kein Feld und rechnet sie NICHT mit."
          >
            <option value={BATTERY_SELECT_UNSET}>— keiner —</option>
            {installationComponents.map((c) => (
              <option key={c.id} value={c.id}>
                {costComponentOptionLabel(c)}
              </option>
            ))}
          </AdminSelect>
        </div>
      </fieldset>

      {/* ── Belege und Sonstiges ──────────────────────────────────────────────────────────────── */}
      <fieldset className="border-t border-line pt-5">
        <legend className="sr-only">Belege</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField
            id={`${formId}-sourceUrl`}
            name="sourceUrl"
            label="Quellenbeleg (optional)"
            defaultValue={values.sourceUrl}
            error={err('sourceUrl')}
            hint="Woher Preis und Kenndaten stammen. Muss keine Adresse sein — „Angebot vom 12.09.2026“ ist auch ein Beleg."
          />
          <AdminField
            id={`${formId}-datasheetUrl`}
            name="datasheetUrl"
            label="Datenblatt (optional)"
            defaultValue={values.datasheetUrl}
            error={err('datasheetUrl')}
          />
          <AdminSelect
            id={`${formId}-controlType`}
            name="controlType"
            label="Steuerungsart (optional)"
            defaultValue={values.controlType ?? BATTERY_SELECT_UNSET}
            error={err('controlType')}
            hint="Metadatum — die Engine liest es heute nicht. Bleibt es leer, gilt: Heim statisch, Gewerbe dynamisch."
          >
            <option value={BATTERY_SELECT_UNSET}>— nicht angegeben —</option>
            {BATTERY_CONTROL_TYPES.map((c) => (
              <option key={c} value={c}>
                {BATTERY_CONTROL_TYPE_LABELS[c]}
              </option>
            ))}
          </AdminSelect>
          <AdminField
            id={`${formId}-notes`}
            name="notes"
            label="Notiz (optional)"
            defaultValue={values.notes}
            error={err('notes')}
          />
        </div>
      </fieldset>
    </>
  )
}

// ── Anlegen ──────────────────────────────────────────────────────────────────────────────────────

export function CreateBatteryForm({ components }: { components: CostComponentRow[] }) {
  const [state, formAction, isPending] = useActionState(createBatteryAction, ADMIN_INITIAL_STATE)
  const formId = useId()
  const values = defaults(state)

  /*
   * Nach dem Anlegen wird das Formular ERSETZT, nicht stehengelassen — dieselbe Entscheidung wie
   * bei den beiden Tarif-Formularen: ein zweiter Klick legte sonst ein zweites, gleichlautendes
   * Gerät an, und der Katalog trüge es doppelt.
   */
  if (state.success) {
    return (
      <div className="flex flex-col gap-4">
        <AdminSuccess>{state.success}</AdminSuccess>
        <p className="text-small text-text-muted">
          Für ein weiteres Gerät bitte die Seite neu laden. Das angelegte steht in der Liste
          darunter — dort lässt es sich vervollständigen und freigeben.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && <AdminError>{state.formError}</AdminError>}
      <BatteryFields formId={formId} state={state} values={values} components={components} />
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Wird angelegt …
            </>
          ) : (
            'Gerät anlegen'
          )}
        </Button>
        <p className="mt-2 text-caption text-text-muted">
          Ein neues Gerät ist immer erst ein Entwurf. Der Rechner sieht es nicht, bevor es
          ausdrücklich freigegeben wurde.
        </p>
      </div>
    </form>
  )
}

// ── Bearbeiten ───────────────────────────────────────────────────────────────────────────────────

export function EditBatteryForm({
  battery,
  components,
}: {
  battery: BatteryCatalogRow
  components: CostComponentRow[]
}) {
  const [state, formAction, isPending] = useActionState(updateBatteryAction, ADMIN_INITIAL_STATE)
  const formId = useId()
  const values = defaults(state, battery)

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="id" value={battery.id} />
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      <BatteryFields formId={formId} state={state} values={values} components={components} />
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Wird gespeichert …
            </>
          ) : (
            'Änderungen speichern'
          )}
        </Button>
        <p className="mt-2 max-w-prose text-caption text-text-muted">
          Ein geleertes Feld wird beim Speichern gelöscht — dieses Formular schickt jedes Feld mit,
          leer heisst hier also „gilt nicht mehr" und nicht „unverändert lassen".
          {battery.active && (
            <>
              {' '}
              Dieses Gerät ist freigegeben: Ein Pflichtwert lässt sich ihm nicht nehmen, solange es
              im Rechner steht.
            </>
          )}
        </p>
      </div>
    </form>
  )
}
