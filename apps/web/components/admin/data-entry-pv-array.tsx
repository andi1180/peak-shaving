'use client'

/**
 * Die Anlagendaten einer BESTEHENDEN PV-Anlage (B24, Teil 1).
 *
 * Sie hängt im Ja-Zweig der PV-Station und erscheint dort nur, solange KEIN Erzeugungsprofil
 * hochgeladen ist — die Begründung dafür steht an der Einhängestelle (`data-entry-pv.tsx`):
 * ein gemessenes Profil IST die Erzeugung, drei geschätzte Kenndaten daneben wären eine zweite,
 * schwächere Aussage über dieselbe Sache.
 *
 * ⚠ DIE DREI `useActionState` BLEIBEN HIER UND WERDEN ALS PROPS HEREINGEREICHT — genau EIN
 * Formular trägt drei Actions (zweimal lesen, einmal speichern), und nur diese Komponente sieht
 * alle drei. Wortgleiche Aufteilung wie in der Batterie-Station; die dortigen zwei Auflagen
 * gelten hier unverändert:
 *
 *   (a) Die EINGABEFELDER der beiden Quellen müssen KONTROLLIERT sein. React setzt unkontrollierte
 *       Felder nach JEDER abgeschlossenen Action auf diesem Formular zurück — auch nach denen, die
 *       bloss lesen (PR #200). Das ist an ihrem jeweiligen Fundort begründet, nicht hier.
 *   (b) Die NICHT gewählte Quelle wird GAR NICHT gerendert, nicht bloss ausgeblendet. Beide Wege
 *       senden DASSELBE Formular ab (`formAction` am jeweiligen Knopf); ein verstecktes Dateifeld
 *       reiste bei einem Klick auf „Auslesen" des Freitext-Wegs mit, und ein verstecktes Textfeld
 *       beim Datenblatt-Weg — die Action bekäme eine Eingabe, die niemand gemacht hat.
 *
 * ⚠ ES GIBT KEINEN „WEITER"-KNOPF. Den rendert die PV-Station, und zwar genau einmal; zwei Wege
 * nach vorn auf derselben Seite wären zwei Antworten auf dieselbe Frage.
 */

import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  extractPvArrayTextAction,
  saveMeteringPointPvArrayAction,
  scanPvDesignAction,
} from '@/lib/admin/data-entry-actions'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import {
  compassDirectionLabel,
  PV_ARRAY_DIRECTION_FORM_FIELD,
  PV_ARRAY_NUMBER_FIELDS,
  pvArrayDraftIsEmpty,
  readPvArrayDraft,
  type PvArrayDraftSummary,
} from '@/lib/admin/pv-array-draft'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { COMPASS_DIRECTIONS } from 'shared'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from './ui'
import { DataEntryPvArrayText } from './data-entry-pv-array-text'
import { DataEntryPvArrayUpload } from './data-entry-pv-array-upload'

/** Die zwei Quellen, aus denen die drei Kenndaten kommen können. */
type Source = 'text' | 'datenblatt'

export function DataEntryPvArray({
  projectId,
  meteringPoint,
  meteringPointNumber,
  maxBytes,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
  /**
   * Die Grössengrenze des Datenblatts, aus der Server-Komponente hereingereicht.
   *
   * ⚠ SIE MUSS EIN PROP SEIN, aus demselben Grund wie bei der Batterie-Station:
   * `MAX_PV_DESIGN_FILE_BYTES` liegt in `packages/extractors`, und dessen Barrel ist `server-only`
   * — hier importiert bräche er den Client-Build. Die Zahl selbst ist harmlos, nur ihr Fundort.
   */
  maxBytes: number
}) {
  const [saveState, saveAction, isSaving] = useActionState(
    saveMeteringPointPvArrayAction,
    ADMIN_INITIAL_STATE,
  )
  const [readState, readAction, isReading] = useActionState(
    extractPvArrayTextAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ EIN EIGENES `useActionState` FÜR DEN DATENBLATT-WEG, nicht das des Freitexts mitbenutzt.
   *
   * Gemeinsam geführt überschriebe die Meldung des einen Wegs die des anderen — und schlimmer:
   * die Übernahme unten hängt an der OBJEKTIDENTITÄT des Ergebnisses, und mit einem geteilten
   * Zustand liesse sich nicht mehr sagen, WELCHER Lauf gerade ein neues Objekt geliefert hat.
   */
  const [scanState, scanAction, isScanning] = useActionState(scanPvDesignAction, ADMIN_INITIAL_STATE)

  const [source, setSource] = React.useState<Source>('text')
  const [fields, setFields] = React.useState<Record<string, string>>({})

  /**
   * Die drei Felder aus einem Leseergebnis füllen — für BEIDE Quellen dieselbe Zuweisung.
   *
   * ⚠ DIES IST DER EINZIGE ORT, DER IN `fields` SCHREIBT. Die zwei Quellen-Komponenten rendern nur
   * ihre eigene Eingabe und melden nichts zurück; was aus einem Leseergebnis wird, entscheidet die
   * Station. Zwei schreibende Stellen liefen beim nächsten Umbau auseinander.
   *
   * Alle drei auf einmal, auch die nicht gelesenen (beide Actions schicken für sie einen
   * Leerstring). Was hier steht, ist die Aussage GENAU DIESER Quelle; ein Wert aus einer früheren
   * Ablesung daneben wäre von einem frischen nicht zu unterscheiden.
   */
  const applyExtraction = React.useCallback((values: Record<string, string>) => {
    const next: Record<string, string> = {}
    for (const entry of PV_ARRAY_NUMBER_FIELDS) next[entry.form] = values[entry.form] ?? ''
    next[PV_ARRAY_DIRECTION_FORM_FIELD] = values[PV_ARRAY_DIRECTION_FORM_FIELD] ?? ''
    setFields(next)
  }, [])

  const extracted = readState.values?.extraction === 'ok' ? readState.values : null
  const scanned = scanState.values?.extraction === 'ok' ? scanState.values : null

  /*
   * ⚠ ZWEI EFFEKTE, NICHT EINER MIT WEICHE. Jeder hängt an der Objektidentität SEINES Ergebnisses:
   * `useActionState` liefert bei jedem Lauf ein neues Objekt, bei jedem anderen Rerender dasselbe —
   * ein getippter Wert wird dadurch nicht beim nächsten Tastendruck wieder überschrieben. Ein
   * zusammengelegter Effekt mit `extracted ?? scanned` feuerte dagegen auch dann, wenn der ANDERE
   * Weg gelaufen ist, und schriebe ein altes Ergebnis über ein frisches.
   */
  React.useEffect(() => {
    if (extracted) applyExtraction(extracted)
  }, [extracted, applyExtraction])

  React.useEffect(() => {
    if (scanned) applyExtraction(scanned)
  }, [scanned, applyExtraction])

  const summary = readPvArrayDraft(meteringPoint.draft)
  const hasSummary = !pvArrayDraftIsEmpty(summary)

  return (
    <div className="flex flex-col gap-6 border-t border-line pt-6">
      {saveState.success && <AdminSuccess>{saveState.success}</AdminSuccess>}
      {saveState.formError && <AdminError>{saveState.formError}</AdminError>}
      {readState.formError && <AdminError>{readState.formError}</AdminError>}
      {scanState.formError && <AdminError>{scanState.formError}</AdminError>}

      {hasSummary && <PvArraySummary number={meteringPointNumber} summary={summary} />}

      <form action={saveAction} noValidate className="flex flex-col gap-6">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

        <div className="flex flex-col gap-3">
          {/*
            `type="button"`: die zwei Knöpfe stehen im Speichern-Formular und dürfen es nicht
            absenden. Warum die nicht gewählte Quelle gar nicht gerendert wird, steht im Kopf.
          */}
          <div role="group" aria-label="Quelle der Anlagendaten" className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={source === 'text' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={source === 'text'}
              onClick={() => setSource('text')}
            >
              Freitext beschreiben
            </Button>
            <Button
              type="button"
              variant={source === 'datenblatt' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={source === 'datenblatt'}
              onClick={() => setSource('datenblatt')}
            >
              Datenblatt hochladen
            </Button>
          </div>

          {source === 'text' && (
            <DataEntryPvArrayText
              state={readState}
              action={readAction}
              isReading={isReading}
              isSaving={isSaving}
            />
          )}

          {source === 'datenblatt' && (
            <DataEntryPvArrayUpload
              state={scanState}
              action={scanAction}
              isScanning={isScanning}
              isSaving={isSaving}
              maxBytes={maxBytes}
            />
          )}
        </div>

        <fieldset className="flex flex-col gap-4 border-t border-line pt-6">
          <legend className="text-small font-medium text-ink">Anlagendaten</legend>
          <p className="max-w-2xl text-small text-text-muted">
            Alle Felder sind freiwillig. Was leer bleibt, wird nicht gespeichert — ein bereits
            erfasster Wert bleibt dann unverändert stehen.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {PV_ARRAY_NUMBER_FIELDS.map((entry) => (
              <AdminField
                key={entry.form}
                id={`dateneingabe-pv-anlage-${entry.form}`}
                name={entry.form}
                label={`${entry.label} (${entry.unit})`}
                inputMode="numeric"
                value={fields[entry.form] ?? ''}
                onValueChange={(value) =>
                  setFields((current) => ({ ...current, [entry.form]: value }))
                }
                error={saveState.fieldErrors?.[entry.form]}
                hint={entry.hint}
              />
            ))}

            {/*
              ⚠ KONTROLLIERT (`value`), nicht bloss `defaultValue` — dieselbe Auflage wie bei den
              Zahlenfeldern und aus demselben Grund (PR #200): ein „Auslesen" auf diesem Formular
              setzte eine unkontrollierte Auswahl sonst zurück, und zwar auch dann, wenn genau sie
              gerade abgelesen wurde.

              Der leere Eintrag ist eine echte Antwort: „nicht angegeben". Die Action nimmt ihn
              entgegen und lässt den bisherigen Stand unberührt (sie schreibt nur, was dasteht).
            */}
            <AdminSelect
              id={`dateneingabe-pv-anlage-${PV_ARRAY_DIRECTION_FORM_FIELD}`}
              name={PV_ARRAY_DIRECTION_FORM_FIELD}
              label="Ausrichtung"
              value={fields[PV_ARRAY_DIRECTION_FORM_FIELD] ?? ''}
              onValueChange={(value) =>
                setFields((current) => ({ ...current, [PV_ARRAY_DIRECTION_FORM_FIELD]: value }))
              }
              error={saveState.fieldErrors?.[PV_ARRAY_DIRECTION_FORM_FIELD]}
              hint="Wohin die Module zeigen — nicht die Firstrichtung des Daches."
            >
              <option value="">— nicht angegeben —</option>
              {COMPASS_DIRECTIONS.map((direction) => (
                <option key={direction.key} value={direction.key}>
                  {direction.label}
                </option>
              ))}
            </AdminSelect>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSaving || isReading || isScanning}
          >
            {isSaving && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            {isSaving ? 'Wird gespeichert …' : 'Angaben übernehmen'}
          </Button>
          <span role="status" aria-live="polite" className="sr-only">
            {isSaving ? 'Wird gespeichert …' : ''}
          </span>
        </div>
      </form>
    </div>
  )
}

/**
 * Was zur PV-Anlage dieses Zählpunkts erfasst ist.
 *
 * ⚠ SIE RECHNET NICHTS AUS — kein Jahresertrag, keine Ersparnis. Aus Nennleistung, Ausrichtung und
 * Neigung liesse sich eine Erzeugungsmenge schätzen; sie stünde hier neben abgelesenen Angaben und
 * wäre von ihnen nicht zu unterscheiden. Die Schätzung ist Sache der Rechnung, nicht der Erfassung.
 */
function PvArraySummary({ number, summary }: { number: number; summary: PvArrayDraftSummary }) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-4">
      <p className="text-small font-medium text-ink">Erfasst für Zählpunkt {number}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {summary.values.map((entry) => (
          <Row
            key={entry.field}
            label={entry.label}
            /*
              ⚠ Deutsche Schreibweise, damit die Anzeige nicht von der Eingabe abweicht: das
              Formular nimmt „9,8" entgegen, und „9.8" daneben sähe nach einer anderen Zahl aus.
            */
            value={`${entry.value.toLocaleString('de-AT', { maximumFractionDigits: 2 })} ${entry.unit}`}
          />
        ))}
        {summary.direction !== null && (
          <Row label="Ausrichtung" value={compassDirectionLabel(summary.direction)} />
        )}
      </dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 sm:block">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-small tabular-nums text-ink sm:mt-0.5">{value}</dd>
    </div>
  )
}
