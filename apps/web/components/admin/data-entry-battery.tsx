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
 * ── ⚠ WAS DIESE STATION NICHT TUT ────────────────────────────────────────────────────────────
 * Sie ordnet die genannte Kapazität KEINEM Katalog-Gerät zu (Delta 17 Teil 2, 01.09.2026: die
 * bestehende Anlage wird mit ihren exakten Werten gerechnet). Sie nimmt KEIN Datenblatt entgegen
 * und recherchiert KEINE Marke — beides ist ein eigener Auftrag. Und sie zeigt keine Investition
 * und keine Amortisation: die Anlage ist bezahlt.
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
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { AdminError, AdminField, AdminSuccess } from './ui'

/** Die Weiche der Station. `null` = noch nicht beantwortet. */
type Answer = 'ja' | 'nein' | null

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

export function DataEntryBattery({
  projectId,
  meteringPoint,
  meteringPointNumber,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
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
   * ⚠ ALLE FÜNF EINGABEN SIND KONTROLLIERT — s. Kopf. Zwei Actions auf einem Formular setzen
   * unkontrollierte Felder nach JEDER von beiden zurück, auch nach der, die bloss liest.
   */
  const [text, setText] = React.useState('')
  const [fields, setFields] = React.useState<Record<string, string>>({})

  const extracted = readState.values?.extraction === 'ok' ? readState.values : null

  React.useEffect(() => {
    if (!extracted) return
    /*
     * Alle vier auf einmal — auch die nicht gelesenen (die Action schickt für sie einen
     * Leerstring). Was hier steht, ist die Aussage GENAU DIESES Satzes; ein Wert aus einer früheren
     * Ablesung daneben wäre von einem frischen nicht zu unterscheiden.
     *
     * Hängt an der Objektidentität des Ergebnisses: `useActionState` liefert bei jedem Lauf ein
     * neues Objekt, bei jedem anderen Rerender dasselbe — ein getippter Wert wird dadurch nicht
     * beim nächsten Tastendruck wieder überschrieben.
     */
    const next: Record<string, string> = {}
    for (const entry of BATTERY_VALUE_FIELDS) next[entry.form] = extracted[entry.form] ?? ''
    setFields(next)
  }, [extracted])

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
