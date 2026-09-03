'use client'

/**
 * „Früheren Stand ergänzen" — trägt einen HISTORISCHEN Tarifstand VOR dem ältesten vorhandenen
 * derselben Kombination nach (B21-2e).
 *
 * ── ⚠ WORIN SICH DIESES FORMULAR VOM ANLEGEN UNTERSCHEIDET ────────────────────────────────────
 * `CreateGridTariffForm` hängt nach VORNE an: der neue Stand wird der aktuelle, die bisher offene
 * Zeile wird am Vortag beendet. Hier ist es spiegelbildlich, und daraus folgen drei Dinge, die
 * sichtbar sein müssen:
 *
 *   1. Der neue Stand wird NICHT der aktuelle. Er bekommt ein Ende, das sich aus der bestehenden
 *      ältesten Zeile ergibt — also aus der einzigen Angabe des Vorgangs, die der Eintragende nicht
 *      selbst getippt hat.
 *   2. Die Kombination ist FEST. Sie kommt aus der Karte, in der dieses Formular steht.
 *   3. Es lässt sich danach nicht mehr bearbeiten — nur der ganze Stand löschen (protokolliert,
 *      B21-2c).
 *
 * ── DIE KOMBINATION IST KEIN AUSWAHLFELD, UND DAS IST KEINE BEQUEMLICHKEIT ─────────────────────
 * Netzbetreiber, Netzebene und Messvariante stehen als fester Text plus verstecktes Feld — dieselbe
 * Entscheidung und dieselbe Begründung wie bei einem scan-vorbelegten Anlageformular (B21-2b Teil A):
 * Dieses Formular wurde AUS einer bestimmten Kombination heraus geöffnet, und sein ganzer Guard
 * („liegt der Tag vor dem ältesten Stand?") bezieht sich auf GENAU DIESE. Ein Dropdown änderte nur
 * die Beschriftung und liesse den Bezugspunkt stehen — heraus käme ein Stand unter einem Namen, zu
 * dem er nicht gehört, und er wäre nicht mehr korrigierbar.
 *
 * ── DIE BESTÄTIGUNG NENNT DIE UNUMKEHRBARKEIT, WEIL SIE HIER ANDERS IST ───────────────────────
 * Beim Anlegen ist der Rückweg das Löschen des gerade angelegten Stands. Hier ebenfalls — aber der
 * Vorgang sieht harmloser aus, weil er nichts ablöst und in der Liste ganz unten landet. Die
 * Ankreuzmöglichkeit sagt deshalb im Klartext, was danach nicht mehr geht (Muster
 * `AddRateWindowForm`, B21-2d).
 *
 * ⚠ Die Bestätigung ist eine Rückfrage an einen Menschen, KEINE Prüfung: Der Server kann nur
 * nachrechnen, welcher Zeitraum entstünde, nicht ob jemand den Satz gelesen hat.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/input'
import { backfillGridTariffAction } from '@/lib/admin/grid-tariffs-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import {
  DEFAULT_GRUNDPREIS_UNIT,
  DEFAULT_PRICE_BASIS,
  GRUNDPREIS_UNITS,
  GRUNDPREIS_UNIT_LABELS,
  PRICE_BASES,
  PRICE_BASIS_LABELS,
  backfillRangeText,
  combinationLabel,
  previousDay,
  type GridTariffRow,
} from '@/lib/admin/grid-tariffs'
import {
  AdminError,
  AdminField,
  AdminFixedValue,
  AdminPanel,
  AdminSelect,
  AdminSuccess,
  formatDate,
} from './ui'
import { AMOUNT_PLACEHOLDER, RateWindowFields } from './grid-tariff-form'

/** Eine Fensterzeile: stabiler Schlüssel statt Array-Index (Begründung wie im Anlageformular). */
type WindowRow = { key: number }

/** Reihenfolge des Fokussprungs nach einem Feldfehler — von oben nach unten im Formular. */
const FIELD_ORDER = [
  'validFrom',
  'grundpreisAmount',
  'grundpreisUnit',
  'netzverlustCtPerKwh',
  'priceBasis',
] as const

/** Die Vorsilbe der Feldnamen einer Fensterzeile — identisch zum Anlageformular. */
function windowPrefix(index: number): string {
  return `w${index}_`
}

/** Was nach dem Nachtragen an der Stelle des Formulars steht. */
function BackfilledStand({
  values,
  oldestValidFrom,
}: {
  values: Record<string, string>
  oldestValidFrom: string
}) {
  const from = values.validFrom ?? ''
  const until = previousDay(oldestValidFrom)

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-small text-text">
      <p>
        <span className="font-medium text-ink">
          {from ? formatDate(from) : '—'}
          {until ? ` bis ${formatDate(until)}` : ''}
        </span>
        <span className="text-text-muted"> · Grundpreis </span>
        <span className="tabular-nums">{values.grundpreisAmount || '—'}</span>
        <span className="text-text-muted"> · Netzverlust </span>
        <span className="tabular-nums">{values.netzverlustCtPerKwh || '—'} ct/kWh</span>
      </p>
      <p className="mt-2 text-caption text-text-muted">
        {/*
          Dieselbe Überlegung wie bei `CreatedGridTariff` und `AddedRateWindow`: Ein zweiter Klick
          legte einen ZWEITEN Stand an — und der liefe dann auf `not_before_oldest`, also auf einen
          FEHLER wegen der Zeile, die derselbe Klick eben erzeugt hat.
        */}
        Dieser Stand ist nachgetragen und lässt sich nicht mehr bearbeiten. Für einen weiteren bitte
        die Seite neu laden.
      </p>
    </div>
  )
}

export function BackfillGridTariffForm({ oldest }: { oldest: GridTariffRow }) {
  const [state, formAction, isPending] = useActionState(
    backfillGridTariffAction,
    ADMIN_INITIAL_STATE,
  )
  const [validFrom, setValidFrom] = React.useState('')
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [windowRows, setWindowRows] = React.useState<WindowRow[]>([{ key: 0 }])
  const nextKey = React.useRef(1)

  /*
   * ⚠ Die Kennung der ältesten Zeile IST die Vorsilbe jeder DOM-Kennung dieses Formulars. Auf der
   * Seite steht je Kombination eines davon; eine feste Vorsilbe erzeugte doppelte `id`-Attribute,
   * die `<label for>`-Zuordnung wäre mehrdeutig und der Fokussprung nach einem Feldfehler landete im
   * FALSCHEN Formular. Dieselbe Lehre wie `formId` im Anlage- und `arw-` im Ergänzen-Formular.
   */
  const formId = `bf-${oldest.id}`

  const fieldErrors = state.fieldErrors
  React.useEffect(() => {
    if (!fieldErrors) return
    const first =
      FIELD_ORDER.find((name) => fieldErrors[name]) ??
      Object.keys(fieldErrors).find((name) => name.startsWith('w'))
    if (first) document.getElementById(`${formId}-${first}`)?.focus()
  }, [fieldErrors, formId])

  const variant = oldest.metering_variant

  if (state.success) {
    return (
      <div className="mt-3">
        <AdminSuccess>{state.success}</AdminSuccess>
        <BackfilledStand values={state.values ?? {}} oldestValidFrom={oldest.valid_from} />
      </div>
    )
  }

  /*
   * Der Zeitraum wird erst gebildet, wenn ein vollständiges Datum dasteht — aus „2026-0" entstünde
   * sonst ein Satz über einen Stand, den niemand abschickt (dieselbe Regel wie bei der
   * Kollisionswarnung in B21-2d: eine Auskunft über den FERTIGEN Eintrag, keine Tipp-Begleitung).
   */
  const range = validFrom.trim() === '' ? null : backfillRangeText(validFrom, oldest.valid_from)
  const blocked = range === null || !acknowledged

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-5" noValidate>
      {/*
        Die Kombination reist als verstecktes Feld mit — `readGridTariffForm` liest weiterhin genau
        diese Namen, Schema und Server Action bleiben unangetastet.
      */}
      <input type="hidden" name="operatorId" value={oldest.operator_id} />
      <input type="hidden" name="netzebene" value={String(oldest.netzebene)} />
      {variant !== null && <input type="hidden" name="meteringVariant" value={variant} />}

      {state.formError && <AdminError>{state.formError}</AdminError>}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFixedValue
          id={`${formId}-kombination`}
          label="Kombination"
          value={combinationLabel(oldest)}
          error={state.fieldErrors?.netzebene ?? state.fieldErrors?.meteringVariant}
          hint={
            'Festgelegt durch die Karte, in der dieses Formular steht — ein früherer Stand gehört ' +
            'immer zu genau dieser Kombination.'
          }
        />
        <AdminField
          id={`${formId}-validFrom`}
          name="validFrom"
          label="Gültig ab"
          type="date"
          error={state.fieldErrors?.validFrom}
          value={validFrom}
          onValueChange={setValidFrom}
          hint={`Muss VOR dem ${formatDate(oldest.valid_from)} liegen — dem Beginn des bisher ältesten Stands.`}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${formId}-grundpreisAmount`}
          name="grundpreisAmount"
          label="Grundpreis"
          inputMode="numeric"
          placeholder={AMOUNT_PLACEHOLDER}
          error={state.fieldErrors?.grundpreisAmount}
          defaultValue={state.values?.grundpreisAmount}
          required
        />
        <AdminSelect
          id={`${formId}-grundpreisUnit`}
          name="grundpreisUnit"
          label="Einheit des Grundpreises"
          defaultValue={state.values?.grundpreisUnit ?? DEFAULT_GRUNDPREIS_UNIT}
          error={state.fieldErrors?.grundpreisUnit}
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
          id={`${formId}-netzverlustCtPerKwh`}
          name="netzverlustCtPerKwh"
          label="Netzverlustentgelt (ct/kWh)"
          inputMode="numeric"
          placeholder={AMOUNT_PLACEHOLDER}
          error={state.fieldErrors?.netzverlustCtPerKwh}
          defaultValue={state.values?.netzverlustCtPerKwh}
          required
        />
        <AdminSelect
          id={`${formId}-priceBasis`}
          name="priceBasis"
          label="Preisbasis"
          defaultValue={state.values?.priceBasis ?? DEFAULT_PRICE_BASIS}
          error={state.fieldErrors?.priceBasis}
        >
          {PRICE_BASES.map((b) => (
            <option key={b} value={b}>
              {PRICE_BASIS_LABELS[b]}
            </option>
          ))}
        </AdminSelect>
      </div>

      {/* ── Zeitfenster ─────────────────────────────────────────────────────────────────────────── */}
      <div className="border-t border-line pt-4">
        <h5 className="text-small font-semibold text-ink">Zeitfenster</h5>
        <p className="mt-1 max-w-prose text-caption text-text-muted">
          Die Sätze des damaligen Preisblatts. Mindestens eines ist nötig; Saison leer lassen heisst
          ganzjährig.
        </p>

        <ul className="mt-3 flex flex-col gap-4">
          {windowRows.map((row, index) => (
            <li key={row.key}>
              <AdminPanel className="bg-surface-sunken">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
                    Fenster {index + 1}
                  </p>
                  {windowRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setWindowRows((rows) => rows.filter((r) => r.key !== row.key))}
                      className="inline-flex items-center gap-1 rounded-sm text-caption text-text-muted underline decoration-line underline-offset-[3px] outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Entfernen
                    </button>
                  )}
                </div>

                <RateWindowFields
                  formId={formId}
                  namePrefix={windowPrefix(index)}
                  fieldErrors={state.fieldErrors}
                  prefill={null}
                />
              </AdminPanel>
            </li>
          ))}
        </ul>

        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setWindowRows((rows) => [...rows, { key: nextKey.current++ }])}
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Zeitfenster hinzufügen
          </Button>
        </div>
      </div>

      {/*
        Bernstein und nicht Rot: Es ist kein Fehler, sondern eine Folge, die benannt gehört —
        dieselbe Farbwahl wie bei der Verdrängungswarnung in B21-2d.
      */}
      {range !== null && (
        <div
          role="alert"
          className="rounded-md border border-warning-border bg-warning-subtle px-3 py-3 text-small text-text"
        >
          <p className="font-medium text-ink">{range}</p>
          <label
            htmlFor={`${formId}-acknowledge`}
            className="mt-3 flex cursor-pointer items-start gap-2 text-caption text-text"
          >
            <Checkbox
              id={`${formId}-acknowledge`}
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
              className="mt-0.5"
            />
            <span>
              Ich habe gelesen, welchen Zeitraum dieser Stand abdeckt — und dass er sich danach
              nicht mehr bearbeiten lässt, sondern nur durch das Löschen des ganzen Tarifstands
              entfernt werden kann (protokolliert).
            </span>
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={isPending || blocked}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird nachgetragen …' : 'Früheren Stand nachtragen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird nachgetragen …' : ''}
        </span>
      </div>
    </form>
  )
}

/**
 * Der Umschalter, unter dem das Formular sitzt — an der ÄLTESTEN Zeile einer Kombination.
 *
 * `<details>` und kein Zustand, aus demselben Grund wie bei „Zeitfenster ergänzen": Der Weg wird
 * selten gebraucht, und aufgeklappt an jeder Karte nähme er der Liste ihre Lesbarkeit.
 */
export function BackfillGridTariffSection({ oldest }: { oldest: GridTariffRow }) {
  const until = previousDay(oldest.valid_from)

  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-caption font-medium text-text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">
        Früheren Stand ergänzen
      </summary>
      <p className="mt-2 max-w-prose text-caption text-text-muted">
        Trägt einen historischen Tarifstand VOR diesem hier nach — für einen Lastgang, der weiter
        zurückreicht als die bisher erfassten Preisblätter. Der neue Stand endet automatisch
        {until ? ` am ${formatDate(until)}` : ' am Tag vor diesem Stand'} und wird dadurch NICHT zum
        aktuellen. Eine Lücke mitten in der Historie lässt sich auf diesem Weg nicht füllen: Der Tag
        muss vor dem {formatDate(oldest.valid_from)} liegen.
      </p>
      <BackfillGridTariffForm oldest={oldest} />
    </details>
  )
}
