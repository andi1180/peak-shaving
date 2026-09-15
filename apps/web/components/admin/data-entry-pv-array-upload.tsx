'use client'

/**
 * Die DATENBLATT-Quelle der PV-Anlagendaten-Erfassung (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE IST EIN EIGENSTÄNDIGER WEG GEWORDEN — NICHT MEHR EINE VORBELEGUNG DES HAND-FORMULARS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bis hierher trug der Scan seine Ablesung in die drei Felder des Speichern-Formulars ein, und die
 * gemeinsame Form bedingte, dass davon genau EINE Fläche übrig blieb. Ein Exposé führt aber
 * regelmässig mehrere (das bekannte Prüfdokument zwei, mit 4,25 und 5,95 kWp), der Generator (B22)
 * rechnet PRO Fläche und summiert — mit nur einer übernommenen Fläche fiele die geschätzte
 * Erzeugung systematisch zu niedrig aus, und zwar still: keine Zahl im Report sähe deswegen falsch
 * aus.
 *
 * Deshalb steht hier jetzt eine LESE-VORSCHAU mit einer Zeile je gefundener Fläche und einem
 * eigenen Übernehmen-Knopf. Diese Komponente hält ihre beiden `useActionState` selbst; sie reicht
 * nichts mehr in das Formular des Hand-Wegs hinein und bekommt von dort nichts als die zwei
 * Kennungen und die Grössengrenze.
 *
 * ── ⚠ ZWEI FORMULARE, NICHT EINES ─────────────────────────────────────────────────────────────
 * Lesen und Übernehmen sind getrennte `<form>`. Gemeinsam geführt reiste die PDF (bis 6 MB) bei
 * JEDEM Klick auf „Übernehmen" ein zweites Mal über die Leitung, und die Ankreuzfelder reisten bei
 * jedem erneuten „Auslesen" mit — die Action bekäme eine Auswahl zu Kandidaten, die es dann gar
 * nicht mehr gibt.
 *
 * ── ⚠ DIE ANKREUZFELDER SIND KONTROLLIERT ────────────────────────────────────────────────────
 * React setzt unkontrollierte Felder nach JEDER abgeschlossenen Action auf ihrem Formular zurück
 * (PR #200). Unkontrolliert stünden nach einer erfolgreichen Übernahme wieder alle Häkchen — und
 * der naheliegende zweite Klick legte dieselben Flächen ein zweites Mal an. Die Auswahl lebt
 * deshalb im Zustand: eine neue Ablesung hakt alles an, eine erfolgreiche Übernahme alles ab.
 *
 * ── ⚠ HIER WIRD NICHTS BEARBEITET ────────────────────────────────────────────────────────────
 * Die Vorschau zeigt, was gelesen wurde — als Text, nicht als Eingabefeld. Wer eine Fläche für
 * falsch hält, nimmt das Häkchen weg; wer einen Wert korrigieren will, trägt die Fläche über den
 * Freitext-Weg oder von Hand ein (beide unverändert). Ein editierbarer Wert neben einer abgelesenen
 * Zahl wäre von ihr nicht mehr zu unterscheiden — und genau das ist die Trennlinie, an der dieser
 * ganze Bauabschnitt hängt.
 */

import * as React from 'react'
import { useActionState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import {
  addPvArraysFromScanAction,
  scanPvDesignAction,
} from '@/lib/admin/data-entry-actions'
import {
  PV_ARRAY_DIRECTION_FORM_FIELD,
  PV_ARRAY_NUMBER_FIELDS,
  compassDirectionLabel,
  isCompassDirection,
} from '@/lib/admin/pv-array-draft'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminSuccess } from './ui'

const DESIGN_ID = 'dateneingabe-pv-anlage-datenblatt'

/** Nichts ausgewählt. Modulweit, damit der Effekt unten keine neue Menge je Render erzeugt. */
const NOTHING_SELECTED: ReadonlySet<number> = new Set()

/** Eine gelesene Fläche, so wie die Vorschau sie zeigt — reine Anzeigewerte, keine Eingabe. */
type Candidate = {
  index: number
  /** Roh, wie die Action sie geschrieben hat: deutsches Dezimalkomma, Leerstring = nicht gelesen. */
  values: Record<string, string>
  degreeNote: string | null
  steepSlope: boolean
}

export function DataEntryPvArrayUpload({
  projectId,
  meteringPointId,
  maxBytes,
}: {
  projectId: string
  meteringPointId: string
  /** ⚠ Muss ein Prop sein — `MAX_PV_DESIGN_FILE_BYTES` liegt in `packages/extractors` (server-only). */
  maxBytes: number
}) {
  const [scanState, scanAction, isScanning] = useActionState(scanPvDesignAction, ADMIN_INITIAL_STATE)
  const [addState, addAction, isAdding] = useActionState(
    addPvArraysFromScanAction,
    ADMIN_INITIAL_STATE,
  )

  const scanned = scanState.values?.extraction === 'ok' ? scanState.values : null
  const candidates = React.useMemo(() => readCandidates(scanned), [scanned])

  const [selected, setSelected] = React.useState<ReadonlySet<number>>(NOTHING_SELECTED)
  const [appliedForThisScan, setAppliedForThisScan] = React.useState(false)

  /*
   * ⚠ EINE NEUE ABLESUNG HAKT ALLES AN. Abhängig von der OBJEKTIDENTITÄT des Ergebnisses, nicht von
   * seinem Inhalt: `useActionState` liefert bei jedem Lauf ein neues Objekt und bei jedem anderen
   * Rerender dasselbe — ein weggenommenes Häkchen wird dadurch nicht beim nächsten Rerender wieder
   * gesetzt. Am Inhalt gehängt feuerte der Effekt bei zwei gleichlautenden Ablesungen nicht erneut.
   */
  React.useEffect(() => {
    if (!scanned) return
    setSelected(new Set(readCandidates(scanned).map((candidate) => candidate.index)))
    setAppliedForThisScan(false)
  }, [scanned])

  /*
   * ⚠ NACH DER ÜBERNAHME VERSCHWINDET DIE VORSCHAU — und nichts ist mehr angehakt.
   *
   * Beides zusammen, nicht nur eines: das Abwählen allein liesse die Liste als leere Hülle stehen.
   * Warum die Liste weichen muss, steht an der Bedingung, die sie rendert. Der Zustand wird
   * trotzdem zurückgesetzt, weil die Ankreuzfelder kontrolliert sind — sonst begönne eine spätere
   * Ablesung mit Häkchen aus einem vergangenen Lauf.
   */
  const addSucceeded = addState.success ? addState : null
  React.useEffect(() => {
    if (addSucceeded) {
      setSelected(NOTHING_SELECTED)
      setAppliedForThisScan(true)
    }
  }, [addSucceeded])

  const arrayCount = Number(scanned?.arrayCount ?? '0')
  const hidden = scanned?.truncated === '1' ? arrayCount - candidates.length : 0

  return (
    <div className="flex flex-col gap-6">
      {addState.success && <AdminSuccess>{addState.success}</AdminSuccess>}
      {addState.formError && <AdminError>{addState.formError}</AdminError>}
      {scanState.formError && <AdminError>{scanState.formError}</AdminError>}

      <form action={scanAction} noValidate className="flex flex-col gap-4">
        <div className="max-w-2xl">
          <Label htmlFor={DESIGN_ID}>Auslegung der Anlage (optional)</Label>
          <div className="mt-1.5">
            <input
              id={DESIGN_ID}
              name="pvDesign"
              type="file"
              accept="application/pdf"
              aria-invalid={scanState.fieldErrors?.pvDesign ? true : undefined}
              aria-describedby={`${DESIGN_ID}-hint`}
              className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
            />
          </div>
          <FieldHint
            id={`${DESIGN_ID}-hint`}
            tone={scanState.fieldErrors?.pvDesign ? 'error' : 'muted'}
          >
            {scanState.fieldErrors?.pvDesign ??
              `PDF bis ${Math.floor(maxBytes / (1024 * 1024))} MB. „Auslesen" zeigt die ` +
                'gefundenen Modulflächen zur Auswahl; übernommen wird erst mit dem zweiten Klick. ' +
                'Das Dokument wird dafür an Anthropic übertragen und dort nicht gespeichert; im ' +
                'Projekt abgelegt wird es ebenfalls nicht. Die Felder unten lassen sich auch ohne ' +
                'diesen Schritt von Hand ausfüllen.'}
          </FieldHint>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" size="md" disabled={isScanning || isAdding}>
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
              : candidates.length === 0
                ? ''
                : candidates.length === 1
                  ? 'Eine Modulfläche gelesen.'
                  : `${candidates.length} Modulflächen gelesen.`}
          </span>
        </div>
      </form>

      {/*
        ⚠ DIE VORSCHAU IST NACH EINER ÜBERNAHME WEG — das nimmt die frühere Entscheidung „die
        Liste bleibt stehen" bewusst zurück. Sie sollte eine zunächst abgewählte Fläche ohne eine
        zweite (abrechenbare) Ablesung derselben Datei erreichbar halten. In der echten Nutzung war
        die doppelte Anzeige teurer als dieser Komfort: die eben übernommenen Flächen stehen ja
        bereits in der gespeicherten Liste darunter, und daneben eine zweite, gleich aussehende
        Aufzählung liess offen, welche davon nun gilt. Wer weitere Flächen aus demselben Dokument
        braucht, liest erneut aus.
      */}
      {candidates.length > 0 && !appliedForThisScan && (
        <form action={addAction} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPointId} />
          <input type="hidden" name="candidateCount" value={String(candidates.length)} />

          <div className="rounded-lg border border-line bg-surface-sunken p-4">
            <p className="text-small font-medium text-ink">Gefundene Modulflächen</p>
            <p className="mt-1 max-w-prose text-caption text-text-muted">
              Was angehakt ist, wird der Liste hinzugefügt. Werte lassen sich hier nicht ändern —
              eine Fläche mit falschen Angaben abwählen und unten von Hand eintragen.
            </p>

            {/*
              ⚠ SCHLÜSSEL IST DER INDEX, und er ist hier kein Zufall: er IST die Kennung, unter der
              die Action die Werte wiederfindet (`0.peakPowerKwp` &c.). Die Liste einer Ablesung
              wird nie umsortiert; eine neue Ablesung ersetzt sie vollständig.
            */}
            <ul className="mt-3 flex flex-col gap-3">
              {candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.index}
                  candidate={candidate}
                  checked={selected.has(candidate.index)}
                  disabled={isAdding}
                  onToggle={(next) =>
                    setSelected((current) => {
                      const updated = new Set(current)
                      if (next) updated.add(candidate.index)
                      else updated.delete(candidate.index)
                      return updated
                    })
                  }
                />
              ))}
            </ul>

            {hidden > 0 && (
              <p className="mt-3 max-w-prose text-caption text-text-muted">
                Das Dokument nennt {arrayCount} Modulflächen —{' '}
                {hidden === 1
                  ? 'eine weitere wurde nicht angezeigt'
                  : `${hidden} weitere wurden nicht angezeigt`}
                . Bitte tragen Sie sie bei Bedarf von Hand ein.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isAdding || isScanning || selected.size === 0}
            >
              {isAdding && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {isAdding ? 'Wird übernommen …' : 'Ausgewählte Flächen übernehmen'}
            </Button>
            <span role="status" aria-live="polite" className="text-small text-text-muted">
              {isAdding
                ? 'Wird übernommen …'
                : selected.size === 0
                  ? 'Nichts ausgewählt.'
                  : selected.size === 1
                    ? 'Eine Fläche ausgewählt.'
                    : `${selected.size} Flächen ausgewählt.`}
            </span>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * Eine Zeile der Vorschau.
 *
 * ⚠ DIE VERSTECKTEN FELDER STEHEN NEBEN DEM ANKREUZFELD UND WERDEN IMMER MITGESENDET — auch bei
 * abgewählten Flächen. Das ist gewollt: die Action entscheidet an `include-<i>`, und die Indizes
 * bleiben dadurch lückenlos. Sie nur für angehakte Zeilen zu rendern verschöbe die Zuordnung
 * zwischen Häkchen und Werten in dem Moment, in dem jemand eine mittlere Fläche abwählt.
 */
function CandidateRow({
  candidate,
  checked,
  disabled,
  onToggle,
}: {
  candidate: Candidate
  checked: boolean
  disabled: boolean
  onToggle: (next: boolean) => void
}) {
  const id = `${DESIGN_ID}-kandidat-${candidate.index}`
  const direction = candidate.values[PV_ARRAY_DIRECTION_FORM_FIELD] ?? ''

  return (
    <li className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          name={`include-${candidate.index}`}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onToggle(event.currentTarget.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--color-accent)]"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-caption font-medium text-ink">
            Fläche {candidate.index + 1}
          </label>
          <dl className="mt-1.5 grid gap-x-6 gap-y-2 sm:grid-cols-3">
            {PV_ARRAY_NUMBER_FIELDS.map((entry) => {
              const value = candidate.values[entry.form] ?? ''
              return (
                <Row
                  key={entry.form}
                  label={entry.label}
                  // ⚠ „—" statt eines leeren Feldes: „nicht gelesen" ist eine Auskunft, keine Lücke.
                  value={value === '' ? '—' : `${value} ${entry.unit}`}
                />
              )
            })}
            <Row
              label="Ausrichtung"
              value={isCompassDirection(direction) ? compassDirectionLabel(direction) : '—'}
            />
          </dl>

          {candidate.steepSlope && (
            <p className="mt-2 max-w-prose text-caption text-text-muted">
              Ungewöhnlich steile Neigung — bitte prüfen, ob sie zutrifft.
            </p>
          )}

          {candidate.degreeNote && (
            <div className="mt-2 max-w-2xl rounded-md border border-warning-border bg-warning-subtle p-3">
              <p className="text-caption text-text">{candidate.degreeNote}</p>
            </div>
          )}
        </div>
      </div>

      {PV_ARRAY_NUMBER_FIELDS.map((entry) => (
        <input
          key={entry.form}
          type="hidden"
          name={`${candidate.index}.${entry.form}`}
          value={candidate.values[entry.form] ?? ''}
        />
      ))}
      <input
        type="hidden"
        name={`${candidate.index}.${PV_ARRAY_DIRECTION_FORM_FIELD}`}
        value={direction}
      />
    </li>
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

/**
 * Die flache `values`-Antwort der Action wieder in Zeilen zerlegen.
 *
 * ⚠ `AdminState.values` ist eine `Record<string, string>` — mehrere Flächen passen dort nur
 * nebeneinander, wenn jede ihren Index als Präfix trägt (`0.peakPowerKwp`). Hier steht die eine
 * Stelle, die das rückgängig macht; die Action ist die eine Stelle, die es anlegt.
 */
function readCandidates(values: Record<string, string> | null | undefined): Candidate[] {
  if (!values) return []
  const count = Number(values.candidateCount ?? '0')
  if (!Number.isInteger(count) || count < 1) return []

  const out: Candidate[] = []
  for (let index = 0; index < count; index += 1) {
    const row: Record<string, string> = {}
    for (const entry of PV_ARRAY_NUMBER_FIELDS) row[entry.form] = values[`${index}.${entry.form}`] ?? ''
    row[PV_ARRAY_DIRECTION_FORM_FIELD] = values[`${index}.${PV_ARRAY_DIRECTION_FORM_FIELD}`] ?? ''
    out.push({
      index,
      values: row,
      degreeNote: values[`${index}.degreeNote`] ?? null,
      steepSlope: values[`${index}.steepSlope`] === '1',
    })
  }
  return out
}
