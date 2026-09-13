'use client'

/**
 * Die DATENBLATT-Quelle der PV-Anlagendaten-Erfassung (B24, Teil 1).
 *
 * Angepasst von `data-entry-battery-spec.tsx`. Zusätzlich zu den drei Kenndaten liefert
 * `scanPvDesignAction` bis zu drei weitere Anzeigewerte, die KEIN Formularfeld füllen:
 * `degreeNote` (Widerspruch zwischen gedruckter Gradzahl und genannter Richtung),
 * `steepSlope` (ungewöhnlich steile Neigung, kein Fehler) und `arrayCount` (das Dokument
 * nennt mehr als eine Fläche — übernommen ist nur die erste). Alle drei werden sichtbar
 * gemacht, nicht verschwiegen — dieselbe Regel wie überall in diesem Bauabschnitt: eine
 * Auskunft, die der Ablesende nicht bekommt, ist eine Auskunft, die er nicht prüfen kann.
 */

import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import type { AdminState } from '@/lib/admin/schema'

const DESIGN_ID = 'dateneingabe-pv-anlage-datenblatt'

export function DataEntryPvArrayUpload({
  state,
  action,
  isScanning,
  isSaving,
  maxBytes,
}: {
  state: AdminState
  action: (payload: FormData) => void
  isScanning: boolean
  isSaving: boolean
  /** ⚠ Muss ein Prop sein — `MAX_PV_DESIGN_FILE_BYTES` liegt in `packages/extractors` (server-only). */
  maxBytes: number
}) {
  const scanned = state.values?.extraction === 'ok' ? state.values : null
  const arrayCount = scanned?.arrayCount ? Number(scanned.arrayCount) : 0

  return (
    <>
      <div className="max-w-2xl">
        <Label htmlFor={DESIGN_ID}>Auslegung der Anlage (optional)</Label>
        <div className="mt-1.5">
          <input
            id={DESIGN_ID}
            name="pvDesign"
            type="file"
            accept="application/pdf"
            aria-invalid={state.fieldErrors?.pvDesign ? true : undefined}
            aria-describedby={`${DESIGN_ID}-hint`}
            className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
          />
        </div>
        <FieldHint id={`${DESIGN_ID}-hint`} tone={state.fieldErrors?.pvDesign ? 'error' : 'muted'}>
          {state.fieldErrors?.pvDesign ??
            `PDF bis ${Math.floor(maxBytes / (1024 * 1024))} MB. „Auslesen" trägt die ` +
              'gefundenen Angaben unten ein. Das Dokument wird dafür an Anthropic übertragen ' +
              'und dort nicht gespeichert; im Projekt abgelegt wird es ebenfalls nicht. Die ' +
              'Felder lassen sich auch ohne diesen Schritt von Hand ausfüllen.'}
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
              ? `${scanned.found} von 3 Angaben aus dem Datenblatt übernommen. Was es nicht ` +
                'nennt, bleibt leer; alle Felder sind frei änderbar.'
              : ''}
        </span>
      </div>

      {scanned && arrayCount > 1 && (
        <p className="max-w-prose text-small text-text-muted">
          Das Dokument nennt {arrayCount} Modulflächen — übernommen ist nur die erste.
        </p>
      )}

      {scanned?.steepSlope && (
        <p className="max-w-prose text-small text-text-muted">
          Ungewöhnlich steile Neigung — bitte prüfen, ob sie zutrifft.
        </p>
      )}

      {scanned?.degreeNote && (
        <div className="max-w-2xl rounded-md border border-warning-border bg-warning-subtle p-3">
          <p className="text-small text-text">{scanned.degreeNote}</p>
        </div>
      )}
    </>
  )
}
