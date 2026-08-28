'use client'

/**
 * Das Anlageformular für einen Netzbetreiber-Tarifstand (B21-2b).
 *
 * Muster wie `components/admin/partner-forms.tsx`: echtes `<form action={formAction}>`,
 * `useActionState` für Ladezustand und Fehler, Fokus springt ins erste fehlerhafte Feld, Eingaben
 * bleiben nach einer Ablehnung stehen.
 *
 * ── ES GIBT NUR „NEU ANLEGEN" ───────────────────────────────────────────────────────────────────
 * Kein Bearbeiten, kein Löschen — weder hier noch in der Datenbank. Ein Tarifstand ist eine Aussage
 * über einen Zeitraum, und eine 2026 archivierte Analyse (B14) muss 2028 noch sagen können, welcher
 * Stand ihr zugrunde lag. Ein neues Preisblatt ist deshalb ein NEUER Stand; die bisher offene Zeile
 * schliesst die Datenbank in derselben Transaktion.
 *
 * ── DER WIEDERHOLBARE ABSCHNITT BRAUCHT JAVASCRIPT, DER REST NICHT ──────────────────────────────
 * Hinzufügen und Entfernen von Zeitfenstern läuft über React-Zustand. Das erste Fenster steht
 * deshalb schon im server-gerenderten Formular: ohne JavaScript lässt sich damit immer noch ein
 * vollständiger Tarifstand mit einem Zeitfenster anlegen, statt vor einem leeren Abschnitt zu
 * stehen.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createGridTariffAction } from '@/lib/admin/grid-tariffs-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import {
  DEFAULT_GRUNDPREIS_UNIT,
  DEFAULT_PRICE_BASIS,
  GRUNDPREIS_UNITS,
  GRUNDPREIS_UNIT_LABELS,
  METERING_VARIANTS,
  METERING_VARIANT_LABELS,
  NETZEBENEN,
  OPERATOR_OTHER,
  PRICE_BASES,
  PRICE_BASIS_LABELS,
  RATE_WINDOW_LABEL_SUGGESTIONS,
  hasMeteringVariant,
  type OperatorOption,
} from '@/lib/admin/grid-tariffs'
import { AdminError, AdminField, AdminPanel, AdminSelect, AdminSuccess } from './ui'

const ID = 'gt'

/** Reihenfolge, in der nach dem ersten Fehler fokussiert wird — von oben nach unten im Formular. */
const FIELD_ORDER = [
  'operatorId',
  'operatorName',
  'netzebene',
  'meteringVariant',
  'grundpreisAmount',
  'grundpreisUnit',
  'netzverlustCtPerKwh',
  'priceBasis',
  'validFrom',
] as const

export function CreateGridTariffForm({ operators }: { operators: readonly OperatorOption[] }) {
  const [state, formAction, isPending] = useActionState(createGridTariffAction, ADMIN_INITIAL_STATE)

  const [operatorId, setOperatorId] = React.useState<string>(operators[0]?.id ?? OPERATOR_OTHER)
  const [netzebene, setNetzebene] = React.useState<number>(NETZEBENEN[0])

  /*
   * Stabile Schlüssel statt des Array-Index: Beim Entfernen einer Zeile würde React sonst die
   * FOLGENDEN Zeilen wiederverwenden — die (unkontrollierten) Eingaben blieben stehen und wanderten
   * sichtbar eine Zeile nach oben. Der Zähler startet bei 1 und ist damit auch beim Vorrendern
   * gleich (kein `Math.random`, kein Hydration-Unterschied).
   */
  const nextKey = React.useRef(1)
  const [windowKeys, setWindowKeys] = React.useState<number[]>([0])

  const fieldErrors = state.fieldErrors
  React.useEffect(() => {
    if (!fieldErrors) return
    const first =
      FIELD_ORDER.find((name) => fieldErrors[name]) ??
      Object.keys(fieldErrors).find((name) => name.startsWith('w'))
    if (first) document.getElementById(`${ID}-${first}`)?.focus()
  }, [fieldErrors])

  const known = operators.find((o) => o.id === operatorId)
  const showVariant = hasMeteringVariant(netzebene)

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      {/* ── Netzbetreiber ─────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${ID}-operatorSelect`}
          name="operatorSelect"
          label="Netzbetreiber"
          defaultValue={operatorId}
          onValueChange={setOperatorId}
          hint="Bereits eingetragene Betreiber stehen zur Auswahl. Ein neuer wird EINMAL von Hand erfasst und ist danach hier zu finden."
        >
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value={OPERATOR_OTHER}>Anderer Netzbetreiber …</option>
        </AdminSelect>

        {known ? (
          <>
            {/*
              Die Kennung ist die Identität der Tarifzeile und darf nicht aus dem Anzeigenamen
              zurückgerechnet werden. Sie fährt deshalb als verstecktes Feld mit — das Auswahlfeld
              selbst heisst bewusst anders, damit es sie nicht überschreibt.
            */}
            <input type="hidden" name="operatorId" value={known.id} />
            <input type="hidden" name="operatorName" value={known.name} />
            <div className="self-end pb-1 text-caption text-text-muted">
              Kennung <span className="font-medium text-text">{known.id}</span>
            </div>
          </>
        ) : (
          <>
            <AdminField
              id={`${ID}-operatorId`}
              name="operatorId"
              label="Kennung (neu)"
              placeholder="linz_netz"
              error={state.fieldErrors?.operatorId}
              hint="Kleinbuchstaben, Ziffern, Unterstriche — wie wiener_netze. Sie identifiziert den Betreiber dauerhaft."
              defaultValue={state.values?.operatorId}
              required
            />
            <AdminField
              id={`${ID}-operatorName`}
              name="operatorName"
              label="Anzeigename (neu)"
              placeholder="Linz Netz GmbH"
              error={state.fieldErrors?.operatorName}
              defaultValue={state.values?.operatorName}
              required
            />
          </>
        )}
      </div>

      {/* ── Netzebene und Messvariante ────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${ID}-netzebene`}
          name="netzebene"
          label="Netzebene"
          defaultValue={String(netzebene)}
          error={state.fieldErrors?.netzebene}
          onValueChange={(v) => setNetzebene(Number(v))}
        >
          {NETZEBENEN.map((n) => (
            <option key={n} value={n}>
              Netzebene {n}
            </option>
          ))}
        </AdminSelect>

        {/*
          Die Variante gibt es NUR auf den Netzebenen, die sie anbieten (Delta 5). Auf allen anderen
          wird das Feld gar nicht gerendert — ein deaktiviertes Feld sendet seinen Wert nicht, ein
          verstecktes täte es doch, und in der Spalte stünde dann eine Variante, wo `null` hingehört.
          Genau darauf beruht der `unique nulls not distinct`-Constraint aus B21-1.
        */}
        {showVariant ? (
          <AdminSelect
            id={`${ID}-meteringVariant`}
            name="meteringVariant"
            label="Leistungsmessungs-Variante"
            defaultValue={METERING_VARIANTS[0]}
            error={state.fieldErrors?.meteringVariant}
          >
            {METERING_VARIANTS.map((v) => (
              <option key={v} value={v}>
                {METERING_VARIANT_LABELS[v]}
              </option>
            ))}
          </AdminSelect>
        ) : (
          <p className="self-end pb-2 text-caption text-text-muted">
            Netzebene {netzebene} kennt keine Leistungsmessungs-Variante — das Feld entfällt.
          </p>
        )}
      </div>

      {/* ── Preise ────────────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${ID}-grundpreisAmount`}
          name="grundpreisAmount"
          label="Grundpreis"
          inputMode="numeric"
          placeholder="38.52"
          error={state.fieldErrors?.grundpreisAmount}
          defaultValue={state.values?.grundpreisAmount}
          required
        />
        <AdminSelect
          id={`${ID}-grundpreisUnit`}
          name="grundpreisUnit"
          label="Einheit des Grundpreises"
          defaultValue={DEFAULT_GRUNDPREIS_UNIT}
          error={state.fieldErrors?.grundpreisUnit}
          hint="Die Einheit entscheidet die Bedeutung: nur EUR/kW·Jahr ist ein Leistungspreis. Eine Jahrespauschale heisst Leistungspreis 0 — also keine Spitzenkappung."
        >
          {GRUNDPREIS_UNITS.map((u) => (
            <option key={u} value={u}>
              {GRUNDPREIS_UNIT_LABELS[u]}
            </option>
          ))}
        </AdminSelect>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${ID}-netzverlustCtPerKwh`}
          name="netzverlustCtPerKwh"
          label="Netzverlustentgelt (ct/kWh)"
          inputMode="numeric"
          placeholder="0.62"
          error={state.fieldErrors?.netzverlustCtPerKwh}
          defaultValue={state.values?.netzverlustCtPerKwh}
          required
        />
        <AdminSelect
          id={`${ID}-priceBasis`}
          name="priceBasis"
          label="Preisbasis"
          defaultValue={DEFAULT_PRICE_BASIS}
          error={state.fieldErrors?.priceBasis}
          hint="Netzentgelte stehen laut Tarifblatt netto. Ohne diese Angabe wäre ein Vergleich zwischen zwei Quellen stillschweigend um 20 % falsch."
        >
          {PRICE_BASES.map((b) => (
            <option key={b} value={b}>
              {PRICE_BASIS_LABELS[b]}
            </option>
          ))}
        </AdminSelect>
      </div>

      <AdminField
        id={`${ID}-validFrom`}
        name="validFrom"
        label="Gültig ab"
        type="date"
        error={state.fieldErrors?.validFrom}
        defaultValue={state.values?.validFrom}
        hint="Ein bereits offener Stand derselben Kombination wird automatisch am Vortag beendet. Der Tag muss NACH dessen Beginn liegen."
        required
      />

      {/* ── Zeitfenster ───────────────────────────────────────────────────────────────────────── */}
      <div className="border-t border-line pt-5">
        <h4 className="text-small font-semibold text-ink">Zeitfenster</h4>
        <p className="mt-1 max-w-prose text-caption text-text-muted">
          Die zeitabhängige Arbeitspreis-Seite des Netzentgelts. Mindestens eines ist nötig; SNAP,
          Winter und künftige Saisontypen sind reguläre Fenster derselben Form. Saison leer lassen
          heisst ganzjährig.
        </p>

        <ul className="mt-4 flex flex-col gap-4">
          {windowKeys.map((key, index) => (
            <li key={key}>
              <AdminPanel className="bg-surface-sunken">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
                    Fenster {index + 1}
                  </p>
                  {windowKeys.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setWindowKeys((keys) => keys.filter((k) => k !== key))}
                      className="inline-flex items-center gap-1 rounded-sm text-caption text-text-muted underline decoration-line underline-offset-[3px] outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Entfernen
                    </button>
                  )}
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <AdminField
                    id={`${ID}-w${index}_label`}
                    name={`w${index}_label`}
                    label="Bezeichnung"
                    placeholder={RATE_WINDOW_LABEL_SUGGESTIONS.join(' · ')}
                    error={state.fieldErrors?.[`w${index}_label`]}
                    required
                  />
                  <AdminField
                    id={`${ID}-w${index}_ctPerKwh`}
                    name={`w${index}_ctPerKwh`}
                    label="Arbeitspreis (ct/kWh)"
                    inputMode="numeric"
                    placeholder="4.14"
                    error={state.fieldErrors?.[`w${index}_ctPerKwh`]}
                    required
                  />
                  <AdminField
                    id={`${ID}-w${index}_timeFrom`}
                    name={`w${index}_timeFrom`}
                    label="Uhrzeit von"
                    placeholder="00:00"
                    error={state.fieldErrors?.[`w${index}_timeFrom`]}
                    required
                  />
                  <AdminField
                    id={`${ID}-w${index}_timeTo`}
                    name={`w${index}_timeTo`}
                    label="Uhrzeit bis"
                    placeholder="24:00"
                    error={state.fieldErrors?.[`w${index}_timeTo`]}
                    hint="Tagesende ist 24:00 — deshalb ein Textfeld und kein Zeitwähler."
                    required
                  />
                  <AdminField
                    id={`${ID}-w${index}_monthDayFrom`}
                    name={`w${index}_monthDayFrom`}
                    label="Saison von (MM-TT, optional)"
                    placeholder="04-01"
                    error={state.fieldErrors?.[`w${index}_monthDayFrom`]}
                  />
                  <AdminField
                    id={`${ID}-w${index}_monthDayTo`}
                    name={`w${index}_monthDayTo`}
                    label="Saison bis (MM-TT, optional)"
                    placeholder="09-30"
                    error={state.fieldErrors?.[`w${index}_monthDayTo`]}
                  />
                </div>
              </AdminPanel>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setWindowKeys((keys) => [...keys, nextKey.current++])}
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Zeitfenster hinzufügen
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line pt-5">
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird angelegt …' : 'Tarifstand anlegen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird angelegt …' : ''}
        </span>
      </div>
    </form>
  )
}
