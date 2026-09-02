'use client'

/**
 * „Zeitfenster ergänzen" — hängt EIN Fenster an einen bestehenden, OFFENEN Tarifstand (B21-2d).
 *
 * ── ⚠ WORIN SICH DIESES FORMULAR VOM ANLEGEN UNTERSCHEIDET ────────────────────────────────────
 * Beim Anlegen entsteht eine Tarifzeile aus dem Nichts; hier wird eine BESTEHENDE ergänzt, für die
 * womöglich längst gerechnet wurde. Zwei Folgen, die beide sichtbar sein müssen:
 *
 *   1. Ein neues Fenster kann ein bestehendes VERDRÄNGEN, ohne dass irgendetwas gelöscht wird —
 *      die Auswahlregel nimmt die engere Abdeckung, das alte Fenster steht danach unverändert in
 *      der Liste und gilt trotzdem nicht mehr (`shared/tariff-window-collision.ts`).
 *   2. Es lässt sich nicht mehr einzeln entfernen. Es gibt kein `delete` auf
 *      `grid_tariff_rate_windows`, für keine Rolle; rückgängig macht das nur das Löschen des
 *      GANZEN Tarifstands (protokolliert, B21-2c).
 *
 * ── DIE WARNUNG SPERRT NICHT, SIE VERLANGT EINE BESTÄTIGUNG ────────────────────────────────────
 * Eine Verdrängung ist oft genau das Gewollte: Ein Preisblatt-Nachtrag, der ein Hochlastfenster
 * ergänzt, verdrängt zwangsläufig das ganztägige Grundfenster in diesen Stunden. Die Eingabe zu
 * sperren hiesse, den Regelfall zu verbieten. Was fehlte, war die Auskunft, WELCHER Satz WO durch
 * WELCHEN ersetzt wird — und die ist vor dem Klick nötig, nicht danach.
 *
 * ⚠ Die Bestätigung ist eine Rückfrage an einen Menschen, KEINE Zugangs- oder Datenprüfung. Der
 * Server prüft sie bewusst nicht: er könnte nur nachrechnen, welche Fenster verdrängt WÜRDEN, nicht
 * ob jemand die Warnung gelesen hat. Dieselbe Haltung wie beim `confirm` des `ActionButton`.
 *
 * ── DIE KOLLISION WIRD AUS DEM LEBENDEN FORMULAR GERECHNET, OHNE KONTROLLIERTE FELDER ──────────
 * `RateWindowFields` ist bewusst UNKONTROLLIERT (`defaultValue`) — das Anlageformular hängt daran,
 * und ein Umbau auf kontrollierte Felder wäre eine Verhaltensänderung an einer Stelle, die dieser
 * Schritt nicht anfassen soll. Gelesen wird deshalb über `new FormData(form)` bei jeder Eingabe im
 * `<form>`: React lässt `change`-Ereignisse von Eingabefeldern bis dorthin aufsteigen.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/input'
import { addRateWindowAction } from '@/lib/admin/grid-tariffs-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import {
  describeWindowCollision,
  draftCollisions,
  seasonLabel,
  shortTime,
  type GridTariffRateWindowRow,
} from '@/lib/admin/grid-tariffs'
import { AdminError, AdminSuccess } from './ui'
import { RateWindowFields } from './grid-tariff-form'

/** Der Startwert, solange nichts getippt ist — deckungsgleich mit den leeren Feldern. */
const EMPTY_DRAFT = {
  label: '',
  monthDayFrom: '',
  monthDayTo: '',
  timeFrom: '',
  timeTo: '',
  ctPerKwh: '',
}

/** Reihenfolge des Fokussprungs nach einem Feldfehler — von oben nach unten im Formular. */
const FIELD_ORDER = [
  'label',
  'ctPerKwh',
  'timeFrom',
  'timeTo',
  'monthDayFrom',
  'monthDayTo',
  'note',
] as const

/** Was nach dem Hinzufügen an der Stelle des Formulars steht. */
function AddedRateWindow({ values }: { values: Record<string, string> }) {
  const from = values.monthDayFrom?.trim()
  const to = values.monthDayTo?.trim()
  const note = values.note?.trim()

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-small text-text">
      <p>
        <span className="font-medium text-ink">{values.label || '—'}</span>
        <span className="text-text-muted"> · </span>
        <span className="tabular-nums">{values.ctPerKwh || '—'} ct/kWh</span>
        <span className="text-text-muted"> · </span>
        <span className="tabular-nums">
          {values.timeFrom || '—'}–{values.timeTo || '—'}
        </span>
        <span className="text-text-muted"> · {seasonLabel(from || null, to || null)}</span>
      </p>
      {note && <p className="mt-1 text-caption text-text-muted">Notiz: {note}</p>}
      <p className="mt-2 text-caption text-text-muted">
        {/*
          Dieselbe Überlegung wie bei `CreatedGridTariff` (B21-2b): Das Formular verschwindet nach
          dem Erfolg, weil ein zweiter Klick ein ZWEITES, gleichlautendes Fenster anlegte — und das
          liesse sich einzeln nicht mehr entfernen.
        */}
        Dieses Zeitfenster ist angelegt und lässt sich nicht mehr einzeln entfernen. Für ein
        weiteres bitte die Seite neu laden.
      </p>
    </div>
  )
}

export function AddRateWindowForm({
  tariffId,
  existingWindows,
}: {
  tariffId: string
  /** Die Fenster, die HEUTE an dieser Tarifzeile hängen — der Bezugspunkt der Kollisionsprüfung. */
  existingWindows: readonly GridTariffRateWindowRow[]
}) {
  const [state, formAction, isPending] = useActionState(addRateWindowAction, ADMIN_INITIAL_STATE)
  const [draft, setDraft] = React.useState(EMPTY_DRAFT)
  const [acknowledged, setAcknowledged] = React.useState(false)

  /*
   * ⚠ Die Kennung der Tarifzeile IST die Vorsilbe jeder DOM-Kennung dieses Formulars. Auf der Seite
   * stehen bis zu einem Dutzend dieser Formulare untereinander (eines je offenem Stand); eine feste
   * Vorsilbe erzeugte doppelte `id`-Attribute, die `<label for>`-Zuordnung wäre mehrdeutig und der
   * Fokussprung nach einem Feldfehler landete im FALSCHEN Formular. Dieselbe Lehre wie `formId` im
   * Anlageformular.
   */
  const formId = `arw-${tariffId}`

  const fieldErrors = state.fieldErrors
  React.useEffect(() => {
    if (!fieldErrors) return
    const first = FIELD_ORDER.find((name) => fieldErrors[name])
    if (first) document.getElementById(`${formId}-${first}`)?.focus()
  }, [fieldErrors, formId])

  const collisions = React.useMemo(
    () => draftCollisions(draft, existingWindows),
    [draft, existingWindows],
  )

  /*
   * Bei jeder Eingabe im Formular den aktuellen Stand ablesen. `new FormData` liest die echten
   * DOM-Werte — es gibt damit keinen zweiten Zustand, der von den Feldern abweichen könnte.
   */
  const readDraft = (event: React.FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget)
    const str = (name: string): string => String(data.get(name) ?? '')
    setDraft({
      label: str('label'),
      monthDayFrom: str('monthDayFrom'),
      monthDayTo: str('monthDayTo'),
      timeFrom: str('timeFrom'),
      timeTo: str('timeTo'),
      ctPerKwh: str('ctPerKwh'),
    })
  }

  if (state.success) {
    return (
      <div className="mt-3">
        <AdminSuccess>{state.success}</AdminSuccess>
        <AddedRateWindow values={state.values ?? {}} />
      </div>
    )
  }

  const blocked = collisions.length > 0 && !acknowledged

  return (
    <form action={formAction} onChange={readDraft} className="mt-3 flex flex-col gap-4" noValidate>
      <input type="hidden" name="tariffId" value={tariffId} />

      {state.formError && <AdminError>{state.formError}</AdminError>}

      <RateWindowFields
        formId={formId}
        namePrefix=""
        fieldErrors={state.fieldErrors}
        prefill={null}
      />

      {collisions.length > 0 && (
        /*
          Bernstein und nicht Rot: Es ist kein Fehler, sondern eine Folge, die benannt gehört —
          dieselbe Farbwahl wie bei der „aWATTar wäre teurer"-Warnung im Rechner.
        */
        <div
          role="alert"
          className="rounded-md border border-warning-border bg-warning-subtle px-3 py-3 text-small text-text"
        >
          <p className="font-medium text-ink">
            {collisions.length === 1
              ? 'Dieses Fenster ersetzt einen bestehenden Satz:'
              : `Dieses Fenster ersetzt bestehende Sätze in ${collisions.length} Zeiträumen:`}
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {collisions.map((collision, index) => (
              <li key={index}>{describeWindowCollision(collision)}</li>
            ))}
          </ul>
          <p className="mt-2 text-caption text-text-muted">
            Das verdrängte Fenster bleibt in der Liste stehen und wird dort trotzdem nicht mehr
            angewandt — es gilt jeweils das Fenster mit der engeren Abdeckung.
          </p>

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
              Ich habe gelesen, welche Sätze dadurch ersetzt werden — und dass sich ein
              hinzugefügtes Zeitfenster nicht mehr einzeln entfernen lässt, sondern nur durch das
              Löschen des ganzen Tarifstands (protokolliert).
            </span>
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={isPending || blocked}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird hinzugefügt …' : 'Zeitfenster hinzufügen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird hinzugefügt …' : ''}
        </span>
      </div>
    </form>
  )
}

/**
 * Der Umschalter, unter dem das Formular sitzt.
 *
 * `<details>` und kein Zustand: Der Weg wird selten gebraucht, und aufgeklappt an jedem offenen
 * Stand nähme er der Liste ihre Lesbarkeit. Ohne JavaScript klappt er trotzdem auf — das Formular
 * darin braucht es (für die Kollisionsprüfung), der Umschalter nicht.
 */
export function AddRateWindowSection({
  tariffId,
  existingWindows,
}: {
  tariffId: string
  existingWindows: readonly GridTariffRateWindowRow[]
}) {
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-caption font-medium text-text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">
        Zeitfenster ergänzen
      </summary>
      <p className="mt-2 max-w-prose text-caption text-text-muted">
        Hängt ein weiteres Zeitfenster an diesen Stand — für einen Preisblatt-Nachtrag oder ein beim
        Abtippen übersehenes Fenster. Es lässt sich danach nicht mehr einzeln entfernen; rückgängig
        macht das nur das Löschen des ganzen Tarifstands (protokolliert).
        {existingWindows.length > 0 && (
          <>
            {' '}
            Bestehend:{' '}
            {existingWindows
              .map(
                (w) =>
                  `${w.label} (${shortTime(w.time_from)}–${shortTime(w.time_to)}, ${seasonLabel(
                    w.month_day_from,
                    w.month_day_to,
                  )})`,
              )
              .join(' · ')}
            .
          </>
        )}
      </p>
      <AddRateWindowForm tariffId={tariffId} existingWindows={existingWindows} />
    </details>
  )
}
