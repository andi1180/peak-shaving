'use client'

/**
 * Die DATENBLATT-Quelle der Batterie-Station (B24, Teil 1).
 *
 * Ein hochgeladenes PDF wird ausgelesen; „Auslesen" trägt die gefundenen Kennzahlen in die
 * gemeinsamen Kenndaten-Felder ein. Die Übernahme selbst geschieht NICHT hier, sondern im
 * Elternteil (`data-entry-battery.tsx`): dort liegt der `fields`-Zustand, den auch die Felder und
 * „Speichern" brauchen, und es soll genau EINEN Ort geben, der hineinschreibt.
 *
 * ⚠ DIESE QUELLE HAT ALS EINZIGE KEIN LOKALES EINGABE-STATE, und sie kann keines haben: eine
 * Dateiauswahl lässt sich in React nicht kontrollieren (ein `value` auf `<input type="file">` ist
 * verboten). Das Feld wird nach jeder Action geleert — hier ohne Schaden: was aus dem Datenblatt zu
 * holen war, steht dann in den vier Feldern darunter, und ein zweiter Scan derselben Datei wäre ein
 * zweiter abrechenbarer Aufruf.
 *
 * ⚠ `state`/`action`/`isScanning` KOMMEN ALS PROPS, das `useActionState` liegt im Elternteil. Der
 * Umschalter rendert die nicht gewählte Quelle GAR NICHT (s. Kopf der Station) — ein Hook hier
 * verlöre bei jedem Quellenwechsel seinen Stand, und damit sowohl die Fehlermeldung als auch die
 * Statuszeile („X von 4 Angaben übernommen"), die heute beides überdauern.
 */

import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import type { AdminState } from '@/lib/admin/schema'

const SPEC_ID = 'dateneingabe-batterie-datenblatt'

export function DataEntryBatterySpec({
  state,
  action,
  isScanning,
  isSaving,
  maxBytes,
}: {
  state: AdminState
  action: (payload: FormData) => void
  isScanning: boolean
  /** Während gespeichert wird, darf nicht zusätzlich ausgelesen werden. */
  isSaving: boolean
  /**
   * Die Grössengrenze des Datenblatts, durch die Station hereingereicht.
   *
   * ⚠ SIE MUSS EIN PROP SEIN, aus demselben Grund wie bei der Rechnungs-Station:
   * `MAX_BATTERY_SPEC_FILE_BYTES` liegt in `packages/extractors`, und dessen Barrel ist
   * `server-only` — hier importiert bräche er den Client-Build. Die Zahl selbst ist harmlos, nur
   * ihr Fundort nicht.
   */
  maxBytes: number
}) {
  const scanned = state.values?.extraction === 'ok' ? state.values : null

  return (
    <>
      <div className="max-w-2xl">
        <Label htmlFor={SPEC_ID}>Datenblatt des Speichers (optional)</Label>
        <div className="mt-1.5">
          {/*
            `accept` ist eine Bedienhilfe des Browsers, keine Sperre — die Action prüft
            den Medientyp selbst. PDF ist hier die einzige Form, die das Auslesen annimmt
            (die API erwartet einen `document`-Block mit genau diesem Typ); ein
            Dateidialog, der ein Foto anbietet, führt zuverlässig in eine Ablehnung, die
            er selbst verursacht hat.
          */}
          <input
            id={SPEC_ID}
            name="batterySpec"
            type="file"
            accept="application/pdf"
            aria-invalid={state.fieldErrors?.batterySpec ? true : undefined}
            aria-describedby={`${SPEC_ID}-hint`}
            className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
          />
        </div>
        <FieldHint id={`${SPEC_ID}-hint`} tone={state.fieldErrors?.batterySpec ? 'error' : 'muted'}>
          {state.fieldErrors?.batterySpec ??
            `PDF bis ${Math.floor(maxBytes / (1024 * 1024))} MB. „Auslesen" trägt die ` +
              'gefundenen Kennzahlen unten ein. Das Datenblatt wird dafür an Anthropic ' +
              'übertragen und dort nicht gespeichert; im Projekt abgelegt wird es ' +
              'ebenfalls nicht. Die Felder lassen sich auch ohne diesen Schritt von ' +
              'Hand ausfüllen.'}
        </FieldHint>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          formAction={action}
          variant="secondary"
          size="md"
          disabled={isScanning || isSaving}
        >
          {isScanning ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {isScanning ? 'Wird ausgelesen …' : 'Auslesen'}
        </Button>
        <span role="status" aria-live="polite" className="text-small text-text-muted">
          {isScanning
            ? 'Wird ausgelesen …'
            : scanned
              ? (scanned.label ? `„${scanned.label}" — ` : '') +
                `${scanned.found} von 4 Angaben aus dem Datenblatt übernommen. Was es ` +
                'nicht nennt, bleibt leer; alle Felder sind frei änderbar.'
              : ''}
        </span>
      </div>
    </>
  )
}
