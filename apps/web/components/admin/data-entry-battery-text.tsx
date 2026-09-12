'use client'

/**
 * Die FREITEXT-Quelle der Batterie-Station (B24, Teil 1).
 *
 * Der Kunde beschreibt seinen Speicher in eigenen Worten; „Auslesen" trägt die genannten Zahlen in
 * die gemeinsamen Kenndaten-Felder ein. Die Übernahme selbst geschieht NICHT hier, sondern im
 * Elternteil (`data-entry-battery.tsx`): dort liegt der `fields`-Zustand, den auch die Felder und
 * „Speichern" brauchen, und es soll genau EINEN Ort geben, der hineinschreibt.
 *
 * ⚠ DER FREITEXT IST KONTROLLIERT (`value`/`onChange`) und lebt in DIESER Komponente. Drei Actions
 * auf demselben Formular setzen UNKONTROLLIERTE Felder nach JEDER von ihnen zurück, auch nach
 * denen, die bloss lesen — bei der Rechnungs-Station war das ein gemessener Defekt (PR #200): der
 * Vorschlagen-Knopf löschte die Angaben, aus denen der Vorschlag gebildet wurde.
 *
 * ⚠ `state`/`action`/`isReading` KOMMEN ALS PROPS, das `useActionState` liegt im Elternteil. Der
 * Umschalter rendert die nicht gewählte Quelle GAR NICHT (s. Kopf der Station) — ein Hook hier
 * verlöre bei jedem Quellenwechsel seinen Stand, und damit sowohl die Fehlermeldung als auch die
 * Statuszeile („X von 4 Angaben übernommen"), die heute beides überdauern.
 */

import * as React from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label, Textarea } from '@/components/ui/input'
import type { AdminState } from '@/lib/admin/schema'

const TEXT_ID = 'dateneingabe-batterie-text'

/**
 * Die Obergrenze des Freitexts in Zeichen.
 *
 * ⚠ ABGESCHRIEBEN UND NICHT IMPORTIERT — und das ist kein Versehen: `MAX_BATTERY_TEXT_CHARS` liegt
 * in `packages/extractors`, und dessen Barrel ist `server-only`; hier importiert bräche er den
 * Client-Build (dieselbe Lage wie `MAX_INVOICE_FILE_BYTES` bei der Rechnungs-Station, die den Wert
 * deshalb als Prop bekommt). Es ist hier nur das `maxlength` eines Textfelds, also eine Bedienhilfe
 * des Browsers — die WIRKSAME Grenze steht in der Server Action, die den Text vor jedem externen
 * Kontakt kürzt. Laufen die beiden auseinander, wird bloss serverseitig gekürzt statt schon beim
 * Tippen.
 */
const TEXT_MAX_CHARS = 400

export function DataEntryBatteryText({
  state,
  action,
  isReading,
  isSaving,
}: {
  state: AdminState
  action: (payload: FormData) => void
  isReading: boolean
  /** Während gespeichert wird, darf nicht zusätzlich ausgelesen werden. */
  isSaving: boolean
}) {
  const [text, setText] = React.useState('')

  const extracted = state.values?.extraction === 'ok' ? state.values : null

  return (
    <>
      <div className="max-w-2xl">
        <Label htmlFor={TEXT_ID}>Beschreibung des Speichers (optional)</Label>
        <div className="mt-1.5">
          <Textarea
            id={TEXT_ID}
            name="batteryText"
            rows={3}
            maxLength={TEXT_MAX_CHARS}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="z. B. Sungrow, 19,2 kWh nutzbar, 10,6 kW, Wirkungsgrad rund 90 %"
            aria-invalid={state.fieldErrors?.batteryText ? true : undefined}
            aria-describedby={`${TEXT_ID}-hint`}
          />
        </div>
        <FieldHint id={`${TEXT_ID}-hint`} tone={state.fieldErrors?.batteryText ? 'error' : 'muted'}>
          {state.fieldErrors?.batteryText ??
            'In eigenen Worten — „Auslesen" trägt die genannten Zahlen unten ein. Der Satz wird ' +
              'dafür an Anthropic übertragen und dort nicht gespeichert. Die Felder lassen sich ' +
              'auch ohne diesen Schritt von Hand ausfüllen.'}
        </FieldHint>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/*
          `formAction` schickt DIESES Formular an die Lese-Action — kein Speichern, kein
          Schreibvorgang. `type="submit"` ist dafür nötig; ein Knopf ohne Absendetyp löst gar
          nichts aus.
        */}
        <Button
          type="submit"
          formAction={action}
          variant="secondary"
          size="md"
          disabled={isReading || isSaving}
        >
          {isReading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {isReading ? 'Wird ausgelesen …' : 'Auslesen'}
        </Button>
        <span role="status" aria-live="polite" className="text-small text-text-muted">
          {isReading
            ? 'Wird ausgelesen …'
            : extracted
              ? `${extracted.found} von 4 Angaben aus dem Satz übernommen. Was er nicht nennt, ` +
                'bleibt leer; alle Felder sind frei änderbar.'
              : ''}
        </span>
      </div>
    </>
  )
}
