'use client'

/**
 * Die RECHERCHE-Quelle der Batterie-Station (B24, Teil 1).
 *
 * Marke und Typ werden genannt, „Suchen" holt die Kennzahlen aus dem Netz und trägt sie in die
 * gemeinsamen Kenndaten-Felder ein. Die Übernahme selbst geschieht NICHT hier, sondern im
 * Elternteil (`data-entry-battery.tsx`): dort liegt der `fields`-Zustand, den auch die Felder und
 * „Speichern" brauchen, und es soll genau EINEN Ort geben, der hineinschreibt.
 *
 * ⚠ DIE EINZIGE QUELLE OHNE VORGELEGTEN BELEG. Satz und Datenblatt kommen vom Kunden; die
 * Recherche holt sich ihre Quelle selbst. Was sie vorschlägt, kann der Eintragende deshalb weder
 * aus dem Gespräch noch vom Papier gegenprüfen — einzig an den QUELLEN, die daneben stehen. Sie
 * sind kein Beiwerk, sondern der Grund, warum dieser Weg überhaupt vor dem „Speichern"
 * verantwortbar ist, und werden als anklickbare Links gezeigt. (Dass eine genannte Quelle auch
 * wirklich in einem Suchergebnis stand, prüft der Extraktor selbst —
 * `packages/shared/src/battery-lookup.ts`.)
 *
 * ⚠ HERSTELLER UND MODELL SIND KONTROLLIERT und leben in DIESER Komponente. Es sind vier Actions
 * auf einem Formular, und React setzt unkontrollierte Felder nach JEDER davon zurück: ohne
 * `value`/`onChange` löschte ein Klick auf „Suchen" genau die Angaben, aus denen die Suche gebildet
 * wird (der gemessene Defekt der Rechnungs-Station, PR #200).
 *
 * ⚠ `state`/`action`/`isLookingUp` KOMMEN ALS PROPS, das `useActionState` liegt im Elternteil. Der
 * Umschalter rendert die nicht gewählte Quelle GAR NICHT (s. Kopf der Station) — ein Hook hier
 * verlöre bei jedem Quellenwechsel seinen Stand, und damit die Fehlermeldung, die Statuszeile UND
 * die Quellen-Liste, die heute alle drei überdauern.
 */

import * as React from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { AdminState } from '@/lib/admin/schema'
import { AdminField } from './ui'

const MAKE_ID = 'dateneingabe-batterie-hersteller'
const MODEL_ID = 'dateneingabe-batterie-modell'

/**
 * Die Obergrenze von Hersteller und Typ in Zeichen.
 *
 * ⚠ ABGESCHRIEBEN UND NICHT IMPORTIERT — derselbe Grund wie beim Freitext:
 * `MAX_BATTERY_LOOKUP_INPUT_CHARS` liegt in `packages/extractors`, und dessen Barrel ist
 * `server-only`; hier importiert bräche er den Client-Build. Es ist hier nur das `maxlength` eines
 * Textfelds, also eine Bedienhilfe des Browsers — die WIRKSAME Grenze steht in der Server Action,
 * und sie WEIST AB statt zu kürzen (eine halbierte Typbezeichnung wäre eine andere Bezeichnung).
 */
const LOOKUP_MAX_CHARS = 120

export function DataEntryBatteryLookup({
  state,
  action,
  isLookingUp,
  isSaving,
}: {
  state: AdminState
  action: (payload: FormData) => void
  isLookingUp: boolean
  /** Während gespeichert wird, darf nicht zusätzlich gesucht werden. */
  isSaving: boolean
}) {
  const [manufacturer, setManufacturer] = React.useState('')
  const [model, setModel] = React.useState('')

  const researched = state.values?.extraction === 'ok' ? state.values : null

  /*
   * Die geprüften Quellen kommen als EINE Zeile zurück (`AdminState.values` ist flach) und werden
   * hier am Leerzeichen wieder aufgeteilt — eine URL enthält keines. Die Liste ist bereits im
   * Extraktor geprüft und begrenzt; hier wird nichts mehr gefiltert.
   */
  const sourceUrls = researched?.sourceUrls ? researched.sourceUrls.split(' ').filter(Boolean) : []

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={MAKE_ID}
          name="batteryManufacturer"
          label="Hersteller"
          maxLength={LOOKUP_MAX_CHARS}
          value={manufacturer}
          onValueChange={setManufacturer}
          error={state.fieldErrors?.batteryManufacturer}
        />
        <AdminField
          id={MODEL_ID}
          name="batteryModel"
          label="Modell / Typ"
          maxLength={LOOKUP_MAX_CHARS}
          value={model}
          onValueChange={setModel}
          error={state.fieldErrors?.batteryModel}
          hint="Die Bezeichnung vom Typenschild, kein ganzer Satz."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          formAction={action}
          variant="secondary"
          size="md"
          disabled={isLookingUp || isSaving}
        >
          {isLookingUp ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {isLookingUp ? 'Wird gesucht …' : 'Suchen'}
        </Button>
        <span role="status" aria-live="polite" className="text-small text-text-muted">
          {isLookingUp
            ? 'Wird gesucht …'
            : researched
              ? (researched.label ? `„${researched.label}" — ` : '') +
                `${researched.found} von 4 Angaben gefunden. Was nicht belegt war, ` +
                'bleibt leer; alle Felder sind frei änderbar.'
              : ''}
        </span>
      </div>

      {sourceUrls.length > 0 && (
        <div className="max-w-2xl rounded-md border border-line bg-surface-sunken p-3">
          <p className="text-caption text-text-muted">Gefunden auf:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {sourceUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-small text-accent underline decoration-accent underline-offset-[3px]"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
