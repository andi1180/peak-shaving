'use client'

/**
 * Die Anlagendaten einer BESTEHENDEN PV-Anlage (B24, Teil 1).
 *
 * Sie hängt im Ja-Zweig der PV-Station und erscheint dort nur, solange KEIN Erzeugungsprofil
 * hochgeladen ist — die Begründung dafür steht an der Einhängestelle (`data-entry-pv.tsx`):
 * ein gemessenes Profil IST die Erzeugung, drei geschätzte Kenndaten daneben wären eine zweite,
 * schwächere Aussage über dieselbe Sache.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE ZWEI QUELLEN SIND SEIT DIESEM SCHRITT NICHT MEHR GLEICH GEBAUT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der FREITEXT-Weg beschreibt genau EINE Fläche und belegt deshalb weiterhin die drei Felder des
 * Speichern-Formulars vor — seine Action liest, dieser hier speichert. Das DATENBLATT führt
 * regelmässig MEHRERE Flächen; sie in dieselben drei Felder zu drängen hiesse, alle bis auf eine
 * wegzuwerfen (genau der Zustand bis zum vorigen Schritt, und er kostete still Erzeugung). Der
 * Datenblatt-Weg ist deshalb eine eigenständige Komponente mit eigener Vorschau, eigener Auswahl
 * und eigenem Schreibweg (`addPvArraysFromScanAction`); von hier bekommt er nur die zwei Kennungen
 * und die Grössengrenze.
 *
 * ⚠ ER LIEGT DESHALB AUSSERHALB DES SPEICHERN-FORMULARS. Er trägt eigene `<form>`, und Formulare
 * lassen sich nicht schachteln — im Speichern-Formular gerendert wäre sein Markup ungültig, und der
 * Browser zöge seine Knöpfe stillschweigend an das äussere Formular.
 *
 * ⚠ DIE ZWEI `useActionState` DES HAND-WEGS BLEIBEN HIER UND WERDEN ALS PROPS HEREINGEREICHT —
 * genau EIN Formular trägt sie beide (einmal lesen, einmal speichern), und nur diese Komponente
 * sieht beide. Wortgleiche Aufteilung wie in der Batterie-Station; die dortigen zwei Auflagen
 * gelten für diesen Weg unverändert:
 *
 *   (a) Die EINGABEFELDER müssen KONTROLLIERT sein. React setzt unkontrollierte Felder nach JEDER
 *       abgeschlossenen Action auf diesem Formular zurück — auch nach denen, die bloss lesen
 *       (PR #200). Das ist an ihrem jeweiligen Fundort begründet, nicht hier.
 *   (b) Die NICHT gewählte Quelle wird GAR NICHT gerendert, nicht bloss ausgeblendet. Ein
 *       verstecktes Textfeld reiste sonst bei jedem Klick auf diesem Formular mit, und die Action
 *       bekäme eine Eingabe, die niemand gemacht hat.
 *
 * ⚠ ES GIBT KEINEN „WEITER"-KNOPF. Den rendert die PV-Station, und zwar genau einmal; zwei Wege
 * nach vorn auf derselben Seite wären zwei Antworten auf dieselbe Frage.
 */

import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  deleteMeteringPointPvArrayAction,
  extractPvArrayTextAction,
  saveMeteringPointPvArrayAction,
} from '@/lib/admin/data-entry-actions'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import {
  compassDirectionLabel,
  PV_ARRAY_DIRECTION_FORM_FIELD,
  PV_ARRAY_NUMBER_FIELDS,
  pvArraysDraftIsEmpty,
  readPvArraysDraft,
  type PvArrayEntry,
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
  const [source, setSource] = React.useState<Source>('text')
  const [fields, setFields] = React.useState<Record<string, string>>({})

  /**
   * Die drei Felder aus dem Leseergebnis des FREITEXT-Wegs füllen.
   *
   * ⚠ DIES IST DER EINZIGE ORT, DER IN `fields` SCHREIBT. Die Freitext-Komponente rendert nur ihre
   * eigene Eingabe und meldet nichts zurück; was aus einem Leseergebnis wird, entscheidet die
   * Station. Zwei schreibende Stellen liefen beim nächsten Umbau auseinander.
   *
   * ⚠ DER DATENBLATT-WEG SCHREIBT HIER NICHT MEHR HINEIN — er hat seit diesem Schritt eine eigene
   * Vorschau und einen eigenen Schreibweg (s. Kopf). Täte er es weiterhin, bliebe von mehreren
   * gelesenen Flächen genau eine übrig.
   *
   * Alle drei auf einmal, auch die nicht gelesenen (die Action schickt für sie einen Leerstring).
   * Was hier steht, ist die Aussage GENAU DIESER Ablesung; ein Wert aus einer früheren daneben
   * wäre von einem frischen nicht zu unterscheiden.
   */
  const applyExtraction = React.useCallback((values: Record<string, string>) => {
    const next: Record<string, string> = {}
    for (const entry of PV_ARRAY_NUMBER_FIELDS) next[entry.form] = values[entry.form] ?? ''
    next[PV_ARRAY_DIRECTION_FORM_FIELD] = values[PV_ARRAY_DIRECTION_FORM_FIELD] ?? ''
    setFields(next)
  }, [])

  const extracted = readState.values?.extraction === 'ok' ? readState.values : null

  /*
   * ⚠ ABHÄNGIG VON DER OBJEKTIDENTITÄT des Ergebnisses, nicht von seinem Inhalt: `useActionState`
   * liefert bei jedem Lauf ein neues Objekt, bei jedem anderen Rerender dasselbe — ein getippter
   * Wert wird dadurch nicht beim nächsten Tastendruck wieder überschrieben.
   */
  React.useEffect(() => {
    if (extracted) applyExtraction(extracted)
  }, [extracted, applyExtraction])

  /*
   * ⚠ NACH DEM ANHÄNGEN WIRD DAS FORMULAR GELEERT — anders als im vorigen, skalaren Stand, wo der
   * gespeicherte Stand stehen blieb und sich beim nächsten Klick selbst überschrieb. Jetzt legt
   * jeder Klick eine WEITERE Fläche an: blieben die Werte stehen, wäre der naheliegende zweite
   * Klick ein versehentliches Duplikat derselben Fläche — und in der Zusammenfassung sähe es aus
   * wie zwei echte.
   *
   * ⚠ ABHÄNGIG VON DER OBJEKTIDENTITÄT des Ergebnisses, nicht vom Meldungstext: `useActionState`
   * liefert bei jedem Lauf ein neues Objekt und bei jedem anderen Rerender dasselbe. Am Text
   * gehängt feuerte der Effekt bei zwei gleichlautenden Erfolgen nicht erneut — und die Meldung
   * lautet nur deshalb je Lauf anders, weil die Zahl der Flächen steigt; darauf darf sich das
   * Leeren nicht verlassen.
   */
  const saved = saveState.success ? saveState : null
  React.useEffect(() => {
    if (saved) setFields({})
  }, [saved])

  const arrays = readPvArraysDraft(meteringPoint.draft)
  const hasArrays = !pvArraysDraftIsEmpty(arrays)

  return (
    <div className="flex flex-col gap-6 border-t border-line pt-6">
      {saveState.success && <AdminSuccess>{saveState.success}</AdminSuccess>}
      {saveState.formError && <AdminError>{saveState.formError}</AdminError>}
      {readState.formError && <AdminError>{readState.formError}</AdminError>}

      {hasArrays && (
        <PvArraySummary
          number={meteringPointNumber}
          arrays={arrays}
          projectId={projectId}
          meteringPointId={meteringPoint.id}
        />
      )}

      {/*
        ⚠ DIE UMSCHALTUNG STEHT AUSSERHALB DES SPEICHERN-FORMULARS, weil einer ihrer zwei Zweige
        es ebenfalls tut: der Datenblatt-Weg trägt eigene `<form>`, und Formulare lassen sich nicht
        schachteln. Der Freitext-Weg dagegen MUSS drinnen bleiben — sein Knopf trägt ein
        `formAction` und gehört damit zum Speichern-Formular. Warum die nicht gewählte Quelle gar
        nicht gerendert wird, steht im Kopf.

        `type="button"` an den zwei Knöpfen bleibt: sie stehen zwar nicht mehr im Formular, aber
        die Vorgabe eines Knopfes ist `submit` — im nächsten Umbau stünden sie sonst wieder darin
        und schickten es bei jedem Wechsel der Quelle ab.
      */}
      <div className="flex flex-col gap-3">
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

        {source === 'datenblatt' && (
          <DataEntryPvArrayUpload
            projectId={projectId}
            meteringPointId={meteringPoint.id}
            maxBytes={maxBytes}
          />
        )}
      </div>

      <form action={saveAction} noValidate className="flex flex-col gap-6">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

        {source === 'text' && (
          <DataEntryPvArrayText
            state={readState}
            action={readAction}
            isReading={isReading}
            isSaving={isSaving}
          />
        )}

        <fieldset className="flex flex-col gap-4 border-t border-line pt-6">
          <legend className="text-small font-medium text-ink">Eine Modulfläche</legend>
          {/*
            ⚠ DER TEXT SAGT DAS ANHÄNGEN IM KLARTEXT. Vorher hiess es hier „ein bereits erfasster
            Wert bleibt unverändert stehen" — das beschrieb den Skalar-Stand und wäre jetzt eine
            Falschauskunft: es entsteht ein NEUER Eintrag, und ein leeres Feld fehlt genau dieser
            Fläche. Wer mehrere Flächen hat, trägt sie nacheinander ein.
          */}
          <p className="max-w-2xl text-small text-text-muted">
            Hat die Anlage mehrere Flächen (etwa Ost und West), tragen Sie sie nacheinander ein —
            jeder Klick auf „Fläche hinzufügen" legt eine weitere an. Was leer bleibt, fehlt dieser
            einen Fläche; die bereits erfassten bleiben unberührt.
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
            disabled={isSaving || isReading}
          >
            {isSaving && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            {isSaving ? 'Wird gespeichert …' : 'Fläche hinzufügen'}
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
function PvArraySummary({
  number,
  arrays,
  projectId,
  meteringPointId,
}: {
  number: number
  arrays: readonly PvArrayEntry[]
  projectId: string
  meteringPointId: string
}) {
  /*
   * ⚠ GENAU EIN `useActionState` FÜR ALLE ZEILEN — nicht eines je Fläche, und das ist keine
   * Sparsamkeit, sondern der Schutz vor einem stillen Datenverlust: `update_metering_point_draft`
   * ERSETZT den Entwurf. Zwei gleichzeitig laufende Löschungen läsen BEIDE denselben Stand, und
   * der zweite Schreibvorgang nähme die Entfernung des ersten zurück — beide Klicks meldeten
   * Erfolg, und eine Fläche stünde wieder da. Das geteilte `isDeleting` sperrt deshalb ALLE
   * Knöpfe, solange einer läuft (dieselbe Lehre wie beim Entfernen einer Rechnung).
   *
   * ⚠ ER LIEGT HIER UND NICHT IM FORMULAR: mit der letzten Fläche verschwindet diese
   * Zusammenfassung — und mit ihr jede Meldung, die IN ihr hängt. Für den Erfolg ist das
   * verschmerzlich (das Verschwinden IST die Rückmeldung), für den FEHLER nicht: dort bleibt die
   * Zusammenfassung stehen, weil sich nichts geändert hat, und die Meldung mit ihr.
   */
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteMeteringPointPvArrayAction,
    ADMIN_INITIAL_STATE,
  )

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-sunken p-4">
      {deleteState.formError && <AdminError>{deleteState.formError}</AdminError>}
      {deleteState.success && <AdminSuccess>{deleteState.success}</AdminSuccess>}

      <p className="text-small font-medium text-ink">
        {arrays.length === 1
          ? `Eine Modulfläche für Zählpunkt ${number} erfasst.`
          : `${arrays.length} Modulflächen für Zählpunkt ${number} erfasst.`}
      </p>

      {/*
        ⚠ JEDE FLÄCHE EINZELN, NICHT ZU EINER ZAHL ZUSAMMENGEZOGEN. „10,2 kWp" über zwei
        verschieden ausgerichtete Flächen wäre eine gerechnete Zahl, die so nirgends erhoben wurde
        — und die Tagesform der Summe ist eine andere als die der gemittelten Fläche. Der Generator
        rechnet PRO Fläche; hier steht, womit er rechnen wird.

        ⚠ SCHLÜSSEL IST DER INDEX, und seit dem Löschweg ist die frühere Begründung („die Liste
        wächst ausschliesslich am Ende") FALSCH: eine mittlere Fläche lässt sich entfernen, die
        folgenden rücken dabei nach. Tragfähig ist er aus einem anderen Grund — diese Zeilen haben
        KEINEN eigenen Zustand: sie sind reine Anzeige, und das einzige Formular darin trägt seine
        Werte als versteckte Felder aus den Props. Was React beim Nachrücken „wiederverwendet",
        wird im selben Render vollständig aus den neuen Props gefüllt. Der Fall der
        Rechnung-Station (dort ist der Schlüssel die Dokument-Kennung) unterscheidet sich genau
        darin: eine Zeile mit eigenem Zustand — ein Eingabefeld, ein eigener Action-Zustand — nähme
        ihn beim Nachrücken auf eine FREMDE Fläche mit. Wer hier je einen solchen Zustand ergänzt,
        braucht vorher eine eigene Kennung je Eintrag; der Entwurf trägt heute keine.

        ⚠ DASS DIE FOLGENDEN INDIZES NACHRÜCKEN, IST BEABSICHTIGT und kein Fehler — dieselbe
        Erwartung wie bei jeder Array-Filterung. „Fläche 2" ist eine Position in dieser Liste,
        keine Kennung der Anlage.
      */}
      <ol className="flex flex-col gap-3">
        {arrays.map((array, index) => (
          <li key={index} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <p className="text-caption font-medium text-ink">Fläche {index + 1}</p>

              {/*
                ⚠ EIN EIGENES `<form>` JE ZEILE, alle auf DIESELBE Action — nur so kann der Knopf
                seinen Index als verstecktes Feld mitschicken. Sie liegen ausserhalb des
                Speichern-Formulars (die Zusammenfassung steht darüber); geschachtelt wären sie
                ungültiges Markup, und der Browser zöge ihre Knöpfe an das äussere Formular.
              */}
              <form
                action={deleteAction}
                /*
                  ⚠ DIE RÜCKFRAGE IST EINE FRAGE AN EINEN MENSCHEN, KEINE PRÜFUNG. Wer darf,
                  entscheidet die Datenbank; hier geht es allein darum, dass ein Klick daneben
                  nicht unbemerkt eine erfasste Angabe entfernt. Sie nennt die POSITION, weil genau
                  die auf dem Knopf steht — eine Kennung trägt der Eintrag nicht.
                */
                onSubmit={(event) => {
                  if (!window.confirm(`Modulfläche ${index + 1} löschen?`)) event.preventDefault()
                }}
              >
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="meteringPointId" value={meteringPointId} />
                <input type="hidden" name="arrayIndex" value={index} />
                <Button type="submit" variant="ghost" size="sm" disabled={isDeleting}>
                  {isDeleting && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Löschen
                </Button>
              </form>
            </div>
            <dl className="mt-1.5 grid gap-x-6 gap-y-2 sm:grid-cols-3">
              {PV_ARRAY_NUMBER_FIELDS.map((entry) => {
                const value = array[entry.form]
                if (value === null) return null
                return (
                  <Row
                    key={entry.form}
                    label={entry.label}
                    /*
                      ⚠ Deutsche Schreibweise, damit die Anzeige nicht von der Eingabe abweicht: das
                      Formular nimmt „9,8" entgegen, und „9.8" daneben sähe nach einer anderen Zahl
                      aus.
                    */
                    value={`${value.toLocaleString('de-AT', { maximumFractionDigits: 2 })} ${entry.unit}`}
                  />
                )
              })}
              {array.direction !== null && (
                <Row label="Ausrichtung" value={compassDirectionLabel(array.direction)} />
              )}
            </dl>
          </li>
        ))}
      </ol>
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
