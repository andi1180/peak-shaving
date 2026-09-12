'use client'

/**
 * Die Batterie-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE FRAGE, ZWEI ZWEIGE — UND DIE FRAGE BLEIBT STEHEN, AUCH WENN SIE BEANTWORTET IST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * „Haben Sie bereits einen Batteriespeicher?" ist eine WEICHE innerhalb der Station und lebt wie
 * bei der Lastgang-Station in `useState` — es gibt dafür keine Spalte, und dieser Schritt legt
 * auch keine an.
 *
 * ⚠ ANDERS ALS BEIM LASTGANG VERSCHWINDET SIE NICHT, wenn schon etwas gespeichert ist. Dort trägt
 * ein Zählpunkt genau EINEN Lastgang, und für den Rückweg gibt es einen eigenen, ausdrücklichen
 * Knopf. Hier landet die Antwort als Feld im ENTWURF, und es gibt keinen Entfernen-Weg: Wer sich
 * vertippt hat oder die Antwort wechselt, muss sie neu geben können. Die Frage steht deshalb
 * immer da, und was bereits erfasst ist, steht als Zusammenfassung DARÜBER.
 *
 * ── ⚠ DIE ZUSAMMENFASSUNG KOMMT AUS DER DATENBANK, NICHT AUS DEM RÜCKGABEWERT DER ACTION ──────
 * Wortgleich zu den beiden Stationen davor und aus demselben Grund: nach einem Neuladen stünde sie
 * sonst leer da, obwohl gespeichert ist. Gezeigt wird die Auswertung des ENTWURFS
 * (`meteringPoint.draft`), den die Seite über `readMeteringPointList` liest — genau deshalb rufen
 * beide Schreib-Actions `revalidatePath`.
 *
 * ── ⚠ EIN FORMULAR, ZWEI ACTIONS — UND DESHALB VIER KONTROLLIERTE FELDER ──────────────────────
 * Der Ja-Zweig trägt „Auslesen" und „Speichern" auf DEMSELBEN Formular (verschachtelte Formulare
 * gibt es in HTML nicht, und beide Wege brauchen dieselben vier Felder). React setzt
 * UNKONTROLLIERTE Formularfelder nach JEDER abgeschlossenen Action auf diesem Formular zurück,
 * nicht nur nach der gemeinten — bei der Rechnungs-Station war das ein gemessener Defekt (PR #200):
 * der Vorschlagen-Knopf löschte die Angaben, aus denen der Vorschlag gebildet wurde.
 *
 * Die vier Zahlenfelder UND der Freitext sind deshalb von Anfang an kontrolliert (`value` +
 * `onValueChange`, der `AdminField`-Prop aus B16-4a). Wer hier ein weiteres Feld ergänzt, das
 * BEIDE Wege brauchen, denkt das mit.
 *
 * ── ⚠ ZWEI QUELLEN, EIN FORMULAR, EIN „SPEICHERN" ────────────────────────────────────────────
 * Seit B24 gibt es im Ja-Zweig zwei Wege zu denselben vier Feldern: den Satz in eigenen Worten und
 * ein hochgeladenes DATENBLATT. Sie stehen als Umschalter nebeneinander und münden ausdrücklich in
 * DIESELBEN Eingabefelder und denselben Absendeknopf — die vier Werte haben in beiden Extraktoren
 * denselben Namen (per `satisfies` gebunden, `packages/shared/src/battery-spec-scan.ts`), und
 * `battery-draft.ts` musste dafür keine Zeile ändern.
 *
 * ⚠ DIE NICHT AKTIVE QUELLE WIRD GAR NICHT GERENDERT, nicht bloss versteckt. Ein verborgenes
 * Dateifeld gäbe es weiterhin, und der nächste Umbau schickte seinen Inhalt mit — dann liefe ein
 * Klick auf „Auslesen" gegen ein Datenblatt, das niemand mehr im Blick hat, oder umgekehrt. Der
 * getippte SATZ überlebt den Wechsel trotzdem: er lebt in `useState`, nicht im DOM.
 *
 * ── ⚠ WAS DIESE STATION NICHT TUT ────────────────────────────────────────────────────────────
 * Sie ordnet die genannte Kapazität KEINEM Katalog-Gerät zu (Delta 17 Teil 2, 01.09.2026: die
 * bestehende Anlage wird mit ihren exakten Werten gerechnet). Sie recherchiert KEINE Marke — kein
 * Werkzeug-Aufruf, kein Web-Zugang; was gelesen wird, steht im vorgelegten Dokument (eigener
 * Auftrag). Und sie zeigt keine Investition und keine Amortisation: die Anlage ist bezahlt.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label, Textarea } from '@/components/ui/input'
import {
  BATTERY_VALUE_FIELDS,
  batteryDraftIsEmpty,
  readBatteryDraft,
  type BatteryDraftSummary,
} from '@/lib/admin/battery-draft'
import {
  extractBatteryTextFromAction,
  saveMeteringPointBatteryAction,
  saveMeteringPointBatteryChoiceAction,
  scanBatterySpecAction,
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { AdminError, AdminField, AdminSuccess } from './ui'

/** Die Weiche der Station. `null` = noch nicht beantwortet. */
type Answer = 'ja' | 'nein' | null

const TEXT_ID = 'dateneingabe-batterie-text'
const SPEC_ID = 'dateneingabe-batterie-datenblatt'

/** Die zwei Quellen, aus denen die vier Kenndaten kommen können. */
type Source = 'text' | 'datenblatt'

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

export function DataEntryBattery({
  projectId,
  meteringPoint,
  meteringPointNumber,
  maxBytes,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
  /**
   * Die Grössengrenze des Datenblatts, aus der Server-Komponente hereingereicht.
   *
   * ⚠ SIE MUSS EIN PROP SEIN, aus demselben Grund wie bei der Rechnungs-Station:
   * `MAX_BATTERY_SPEC_FILE_BYTES` liegt in `packages/extractors`, und dessen Barrel ist
   * `server-only` — hier importiert bräche er den Client-Build. Die Zahl selbst ist harmlos, nur
   * ihr Fundort nicht.
   *
   * ⚠ Bis zum Datenblatt-Weg hatte diese Station bewusst KEINE solche Prop („sie nimmt gar keine
   * Datei entgegen"); das gilt seit B24 nicht mehr, und der entsprechende Wächter in
   * `data-entry-ui.test.ts` ist mit dieser Begründung umgestellt worden.
   */
  maxBytes: number
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
}) {
  const [answer, setAnswer] = React.useState<Answer>(null)

  const [choiceState, choiceAction, isSavingChoice] = useActionState(
    saveMeteringPointBatteryChoiceAction,
    ADMIN_INITIAL_STATE,
  )
  const [saveState, saveAction, isSaving] = useActionState(
    saveMeteringPointBatteryAction,
    ADMIN_INITIAL_STATE,
  )
  const [readState, readAction, isReading] = useActionState(
    extractBatteryTextFromAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ EIN EIGENES `useActionState` FÜR DEN DATENBLATT-WEG, nicht das des Freitexts mitbenutzt.
   *
   * Gemeinsam geführt überschriebe die Meldung des einen Wegs die des anderen — und schlimmer:
   * die Übernahme unten hängt an der OBJEKTIDENTITÄT des Ergebnisses, und mit einem geteilten
   * Zustand liesse sich nicht mehr sagen, WELCHER Lauf gerade ein neues Objekt geliefert hat.
   * (Dieselbe Aufteilung wie bei Upload und Entfernen der Rechnungs-Station.)
   */
  const [specState, specAction, isScanning] = useActionState(
    scanBatterySpecAction,
    ADMIN_INITIAL_STATE,
  )

  /*
   * ⚠ ALLE FÜNF EINGABEN SIND KONTROLLIERT — s. Kopf. Drei Actions auf einem Formular setzen
   * unkontrollierte Felder nach JEDER von ihnen zurück, auch nach denen, die bloss lesen.
   *
   * ⚠ DAS DATEIFELD IST DIE EINE AUSNAHME, UND ES KANN KEINE ANDERE SEIN: eine Dateiauswahl lässt
   * sich in React nicht kontrollieren (ein `value` auf `<input type="file">` ist verboten). Es wird
   * nach jeder Action geleert — hier ohne Schaden: was aus dem Datenblatt zu holen war, steht dann
   * in den vier Feldern darunter, und ein zweiter Scan derselben Datei wäre ein zweiter
   * abrechenbarer Aufruf.
   */
  const [source, setSource] = React.useState<Source>('text')
  const [text, setText] = React.useState('')
  const [fields, setFields] = React.useState<Record<string, string>>({})

  /**
   * Die vier Felder aus einem Leseergebnis füllen — für BEIDE Quellen dieselbe Zuweisung.
   *
   * Alle vier auf einmal, auch die nicht gelesenen (beide Actions schicken für sie einen
   * Leerstring). Was hier steht, ist die Aussage GENAU DIESER Quelle; ein Wert aus einer früheren
   * Ablesung daneben wäre von einem frischen nicht zu unterscheiden.
   */
  const applyExtraction = React.useCallback((values: Record<string, string>) => {
    const next: Record<string, string> = {}
    for (const entry of BATTERY_VALUE_FIELDS) next[entry.form] = values[entry.form] ?? ''
    setFields(next)
  }, [])

  const extracted = readState.values?.extraction === 'ok' ? readState.values : null
  const scanned = specState.values?.extraction === 'ok' ? specState.values : null

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

  const summary = readBatteryDraft(meteringPoint.draft)
  const hasSummary = !batteryDraftIsEmpty(summary)

  return (
    <div className="flex flex-col gap-6">
      {/*
        Die Meldungen aller drei Actions stehen HIER, oberhalb von allem: der Ja-Zweig verschwindet
        nicht nach dem Speichern (die Frage bleibt stehen, s. Kopf), aber die Weiche kann gewechselt
        werden — eine Meldung im Zweig nähme sich damit selbst weg.
      */}
      {choiceState.success && <AdminSuccess>{choiceState.success}</AdminSuccess>}
      {choiceState.formError && <AdminError>{choiceState.formError}</AdminError>}
      {saveState.success && <AdminSuccess>{saveState.success}</AdminSuccess>}
      {saveState.formError && <AdminError>{saveState.formError}</AdminError>}
      {readState.formError && <AdminError>{readState.formError}</AdminError>}
      {specState.formError && <AdminError>{specState.formError}</AdminError>}

      {hasSummary && <BatterySummary number={meteringPointNumber} summary={summary} />}

      <div className={hasSummary ? 'border-t border-line pt-6' : undefined}>
        <p className="max-w-prose text-body text-ink">
          Haben Sie bereits einen Batteriespeicher für Zählpunkt {meteringPointNumber}?
        </p>
        <p className="mt-2 max-w-prose text-small text-text-muted">
          Gemeint ist eine bereits installierte oder fest bestellte Anlage. Sie wird mit ihren
          eigenen Kenndaten gerechnet — nicht mit einem Gerät aus unserem Katalog.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            variant={answer === 'ja' ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setAnswer('ja')}
            aria-pressed={answer === 'ja'}
          >
            Ja
          </Button>
          <Button
            type="button"
            variant={answer === 'nein' ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setAnswer('nein')}
            aria-pressed={answer === 'nein'}
          >
            Nein
          </Button>
        </div>
      </div>

      {answer === 'nein' && (
        /*
          ⚠ ZWEI KNÖPFE IN EINEM FORMULAR, unterschieden über `name`/`value` des Absendeknopfes —
          kein `<select>` und keine Ankreuzmöglichkeit. Die Frage hat genau zwei Antworten, und
          beide sind eine ANGABE: „nein, ausdrücklich kein Vorschlag" muss von „dazu wurde nichts
          gefragt" unterscheidbar bleiben. Eine Ankreuzmöglichkeit könnte das nicht — nicht
          angehakt hiesse beides zugleich.
        */
        <form action={choiceAction} noValidate className="flex flex-col gap-4 border-t border-line pt-6">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

          <div>
            <p className="max-w-prose text-body text-ink">
              Soll die Analyse einen Speichervorschlag enthalten?
            </p>
            <p className="mt-2 max-w-prose text-small text-text-muted">
              „Ja" heisst: Wir rechnen den Katalog durch und empfehlen ein passendes Gerät. „Nein"
              heisst: Die Analyse bleibt bei der Auswertung des Lastgangs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              name="wantsRecommendation"
              value="ja"
              variant="primary"
              size="md"
              disabled={isSavingChoice}
            >
              {isSavingChoice && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              Ja, Speicher vorschlagen
            </Button>
            <Button
              type="submit"
              name="wantsRecommendation"
              value="nein"
              variant="secondary"
              size="md"
              disabled={isSavingChoice}
            >
              Nein, kein Vorschlag
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isSavingChoice ? 'Wird gespeichert …' : ''}
            </span>
          </div>
        </form>
      )}

      {answer === 'ja' && (
        <form action={saveAction} noValidate className="flex flex-col gap-6 border-t border-line pt-6">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

          <div className="flex flex-col gap-3">
            {/*
              ⚠ DIE NICHT GEWÄHLTE QUELLE WIRD GAR NICHT GERENDERT, nicht bloss ausgeblendet.
              Beide Wege schicken DASSELBE Formular ab (`formAction` am jeweiligen Knopf); ein
              verstecktes Dateifeld reiste bei einem Klick auf „Auslesen" des Freitext-Wegs
              trotzdem mit, und ein verstecktes Textfeld beim Datenblatt-Weg — die Action bekäme
              eine Eingabe, die niemand gemacht hat. Der Umschalter ist deshalb eine Weiche, keine
              Sichtbarkeitsfrage. `type="button"`: die zwei Knöpfe stehen im Speichern-Formular und
              dürfen es nicht absenden.
            */}
            <div role="group" aria-label="Quelle der Kenndaten" className="flex flex-wrap gap-2">
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

            {source === 'text' ? (
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
                    aria-invalid={readState.fieldErrors?.batteryText ? true : undefined}
                    aria-describedby={`${TEXT_ID}-hint`}
                  />
                </div>
                <FieldHint
                  id={`${TEXT_ID}-hint`}
                  tone={readState.fieldErrors?.batteryText ? 'error' : 'muted'}
                >
                  {readState.fieldErrors?.batteryText ??
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
                  formAction={readAction}
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
            ) : (
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
                      aria-invalid={specState.fieldErrors?.batterySpec ? true : undefined}
                      aria-describedby={`${SPEC_ID}-hint`}
                      className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
                    />
                  </div>
                  <FieldHint
                    id={`${SPEC_ID}-hint`}
                    tone={specState.fieldErrors?.batterySpec ? 'error' : 'muted'}
                  >
                    {specState.fieldErrors?.batterySpec ??
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
                    formAction={specAction}
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
            )}
          </div>

          <fieldset className="flex flex-col gap-4 border-t border-line pt-6">
            <legend className="text-small font-medium text-ink">Kenndaten</legend>
            <p className="max-w-2xl text-small text-text-muted">
              Alle Felder sind freiwillig. Was leer bleibt, wird nicht gespeichert — ein bereits
              erfasster Wert bleibt dann unverändert stehen.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {BATTERY_VALUE_FIELDS.map((entry) => (
                <AdminField
                  key={entry.form}
                  id={`dateneingabe-batterie-${entry.form}`}
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
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="md" disabled={isSaving || isReading}>
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
      )}

      {/*
        ⚠ DER WEG NACH VORN GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE — dieselbe Regel wie bei den
        beiden Stationen davor: wer den Zustand kennt, rendert ihn. Die Seite unterdrückt ihren
        generischen „Weiter"-Link für diese Station; stünde er daneben, gäbe es zwei Wege nach vorn.

        Er erscheint auch ohne Antwort, nur zurückhaltender: die Station ist keine Sackgasse, und
        ein Zählpunkt, zu dem gerade niemand etwas über eine Batterie sagen kann, muss passierbar
        bleiben. Die PROMINENZ folgt dem Zustand.
      */}
      {nextHref !== null && (
        <div>
          <Button asChild variant={hasSummary ? 'primary' : 'secondary'} size="md">
            <Link href={nextHref}>Weiter</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Was zur Batterie dieses Zählpunkts erfasst ist.
 *
 * ⚠ SIE ZEIGT KEINE INVESTITION UND KEINE AMORTISATION, auch wenn ein Preis erfasst ist: die
 * Anlage ist bezahlt (Sunk Cost), und eine Amortisationsrechnung darüber beantwortete eine
 * Kaufentscheidung, die längst gefallen ist (Delta 17 Teil 2). Der Preis steht als abgelesene
 * Angabe da, nicht als Rechengrösse.
 */
function BatterySummary({ number, summary }: { number: number; summary: BatteryDraftSummary }) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-4">
      <p className="text-small font-medium text-ink">Erfasst für Zählpunkt {number}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {summary.hasBattery === true && (
          <Row label="Bestehender Speicher" value="vorhanden" />
        )}
        {summary.values.map((entry) => (
          <Row
            key={entry.field}
            label={entry.label}
            /*
              ⚠ Deutsche Schreibweise, damit die Anzeige nicht von der Eingabe abweicht: das
              Formular nimmt „19,2" entgegen, und „19.2" daneben sähe nach einer anderen Zahl aus.
            */
            value={`${entry.value.toLocaleString('de-AT', { maximumFractionDigits: 2 })} ${entry.unit}`}
          />
        ))}
        {summary.wantsRecommendation !== null && (
          <Row
            label="Speichervorschlag"
            value={summary.wantsRecommendation ? 'gewünscht' : 'ausdrücklich nicht gewünscht'}
          />
        )}
      </dl>

      {summary.hasBattery === true && summary.values.length === 0 && (
        <p className="mt-3 max-w-prose text-small text-text-muted">
          Kenndaten sind noch keine erfasst. Ohne Kapazität und Leistung lässt sich die Anlage nicht
          rechnen — beides lässt sich hier nachtragen.
        </p>
      )}
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
