'use client'

/**
 * Die FREITEXT-Quelle der PV-Anlagendaten-Erfassung (B24, Teil 1).
 *
 * Angepasst von `data-entry-battery-text.tsx` — dieselbe Begründung gilt wortgleich: die
 * Übernahme geschieht NICHT hier, sondern im Elternteil; der Freitext ist kontrolliert
 * (zwei Actions auf einem Formular setzen unkontrollierte Felder sonst zurück, PR #200);
 * `state`/`action`/`isReading` kommen als Props, das `useActionState` liegt oben.
 */

import * as React from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label, Textarea } from '@/components/ui/input'
import type { AdminState } from '@/lib/admin/schema'

const TEXT_ID = 'dateneingabe-pv-anlage-text'

/**
 * ⚠ Gespiegelt aus `MAX_PV_ARRAY_TEXT_CHARS` (packages/extractors/src/pv-array-text/limits.ts),
 * dort am 13.09.2026 mit 400 gemessen. Eigene Kopie, weil jenes Modul `server-only` ist und diese
 * Komponente im Browser läuft — dieselbe Client/server-only-Grenze wie bei der Batterie.
 */
const TEXT_MAX_CHARS = 400

export function DataEntryPvArrayText({
  state,
  action,
  isReading,
  isSaving,
}: {
  state: AdminState
  action: (payload: FormData) => void
  isReading: boolean
  isSaving: boolean
}) {
  const [text, setText] = React.useState('')

  const extracted = state.values?.extraction === 'ok' ? state.values : null

  return (
    <>
      <div className="max-w-2xl">
        <Label htmlFor={TEXT_ID}>Beschreibung der Anlage (optional)</Label>
        <div className="mt-1.5">
          <Textarea
            id={TEXT_ID}
            name="pvArrayText"
            rows={3}
            maxLength={TEXT_MAX_CHARS}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="z. B. 9,8 kWp, Richtung Südost, Dachneigung rund 30°"
            aria-invalid={state.fieldErrors?.pvArrayText ? true : undefined}
            aria-describedby={`${TEXT_ID}-hint`}
          />
        </div>
        <FieldHint id={`${TEXT_ID}-hint`} tone={state.fieldErrors?.pvArrayText ? 'error' : 'muted'}>
          {state.fieldErrors?.pvArrayText ??
            'In eigenen Worten — „Auslesen" trägt die genannten Zahlen unten ein. Der Satz wird ' +
              'dafür an Anthropic übertragen und dort nicht gespeichert. Die Felder lassen sich ' +
              'auch ohne diesen Schritt von Hand ausfüllen.'}
        </FieldHint>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
              ? `${extracted.found} von 3 Angaben aus dem Satz übernommen. Was er nicht nennt, ` +
                'bleibt leer; alle Felder sind frei änderbar.'
              : ''}
        </span>
      </div>
    </>
  )
}
