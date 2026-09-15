'use client'

/**
 * Die Batterie-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE FRAGE, ZWEI ZWEIGE — UND DIE FRAGE VERSCHWINDET, SOBALD SIE BEANTWORTET IST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * „Haben Sie bereits einen Batteriespeicher?" ist eine WEICHE innerhalb der Station und lebt wie
 * bei der Lastgang-Station in `useState` — es gibt dafür keine Spalte, und dieser Schritt legt
 * auch keine an.
 *
 * ⚠ DIESE ZUSAGE STAND HIER BIS ZUM LÖSCHWEG WÖRTLICH ANDERSHERUM, und der Wechsel ist kein
 * Sinneswandel, sondern die Folge einer weggefallenen Voraussetzung. Die Begründung lautete: Die
 * Antwort landet als Feld im ENTWURF, es gibt keinen Entfernen-Weg, und wer sich vertippt hat,
 * muss sie neu geben können — die Frage MUSSTE also stehen bleiben, weil sie der einzige Rückweg
 * war. Der Preis dafür war hoch: den anderen Zweig erneut zu speichern nahm den ersten nicht
 * zurück, beide Antworten standen danach nebeneinander im Entwurf.
 *
 * Seit es „Batterie-Angaben löschen" gibt (am Fuss der Zusammenfassung), ist der Rückweg
 * ausdrücklich — und die Frage erscheint nur noch, solange NICHTS erfasst ist. Ist etwas erfasst,
 * stehen Zusammenfassung und Löschknopf an ihrer Stelle. Der Lastgang-Station steht sie damit
 * näher als zuvor, aber aus einem eigenen Grund: dort ersetzt ein Rückweg eine Datei, hier
 * mehrere Felder EINES Entwurfs.
 *
 * ⚠ DIE BEIDEN ZWEIGE HÄNGEN AN DERSELBEN BEDINGUNG, nicht nur die Frage — `answer` lebt in
 * `useState` und überlebt jeden Schreibvorgang.
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
 * ── ⚠ DREI QUELLEN, EIN FORMULAR, EIN „SPEICHERN" ────────────────────────────────────────────
 * Jede Quelle liegt als eigene Datei daneben (`data-entry-battery-{text,spec,lookup}.tsx`) und
 * rendert NUR ihre eigene Eingabe samt Knopf und Statuszeile. Was sie NICHT besitzen: die drei
 * `useActionState`, die Fehlermeldungen und den `fields`-Zustand.
 *
 * ⚠ DIE DREI `useActionState` BLEIBEN HIER UND WERDEN ALS PROPS HEREINGEREICHT — genau EIN
 * Aufrufer je Action. In die Kind-Komponenten verschoben verlören sie bei jedem Quellenwechsel
 * ihren Stand (die nicht gewählte Quelle wird gar nicht gerendert, s. unten), und mit ihm die
 * Fehlermeldung, die Statuszeile und die Quellen-Liste der Recherche — die heute alle drei
 * überdauern. Der Zustand muss also dort liegen, wo er den Wechsel übersteht.
 *
 * Seit B24 gibt es im Ja-Zweig drei Wege zu denselben vier Feldern: den Satz in eigenen Worten, ein
 * hochgeladenes DATENBLATT und die RECHERCHE nach Marke und Typ. Sie stehen als Umschalter
 * nebeneinander und münden ausdrücklich in DIESELBEN Eingabefelder und denselben Absendeknopf —
 * die vier Werte haben in allen drei Extraktoren denselben Namen (per `satisfies` gebunden,
 * `packages/shared/src/battery-lookup.ts`), und `battery-draft.ts` musste dafür keine Zeile
 * ändern.
 *
 * ⚠ DIE NICHT AKTIVE QUELLE WIRD GAR NICHT GERENDERT, nicht bloss versteckt. Ein verborgenes
 * Dateifeld gäbe es weiterhin, und der nächste Umbau schickte seinen Inhalt mit — dann liefe ein
 * Klick auf „Auslesen" gegen ein Datenblatt, das niemand mehr im Blick hat, oder umgekehrt. Die
 * getippten TEXTE überleben den Wechsel trotzdem: sie leben in `useState`, nicht im DOM.
 *
 * ── ⚠ DIE RECHERCHE IST DIE EINZIGE QUELLE OHNE VORGELEGTEN BELEG ────────────────────────────
 * Satz und Datenblatt kommen vom Kunden; die Recherche holt sich ihre Quelle selbst. Was sie
 * vorschlägt, kann der Eintragende deshalb weder aus dem Gespräch noch vom Papier gegenprüfen —
 * einzig an den QUELLEN, die daneben stehen. Sie sind kein Beiwerk, sondern der Grund, warum
 * dieser Weg überhaupt vor dem „Speichern" verantwortbar ist, und werden als anklickbare Links
 * gezeigt. (Dass eine genannte Quelle auch wirklich in einem Suchergebnis stand, prüft der
 * Extraktor selbst — `packages/shared/src/battery-lookup.ts`.)
 *
 * ── ⚠ WAS DIESE STATION NICHT TUT ────────────────────────────────────────────────────────────
 * Sie ordnet die genannte Kapazität KEINEM Katalog-Gerät zu (Delta 17 Teil 2, 01.09.2026: die
 * bestehende Anlage wird mit ihren exakten Werten gerechnet). Und sie zeigt keine Investition und
 * keine Amortisation: die Anlage ist bezahlt.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  BATTERY_VALUE_FIELDS,
  batteryDraftIsEmpty,
  readBatteryDraft,
  type BatteryDraftSummary,
} from '@/lib/admin/battery-draft'
import {
  deleteMeteringPointBatteryAction,
  extractBatteryTextFromAction,
  lookupBatterySpecByModelAction,
  saveMeteringPointBatteryAction,
  saveMeteringPointBatteryChoiceAction,
  scanBatterySpecAction,
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { AdminError, AdminField, AdminSuccess } from './ui'
import { DataEntryBatteryLookup } from './data-entry-battery-lookup'
import { DataEntryBatterySpec } from './data-entry-battery-spec'
import { DataEntryBatteryText } from './data-entry-battery-text'

/**
 * Die Rückfrage vor dem Löschen.
 *
 * ⚠ SIE IST EINE RÜCKFRAGE AN EINEN MENSCHEN, KEINE PRÜFUNG — dieselbe Einordnung wie beim
 * Lastgang-Rückweg: die Berechtigung entscheidet die Datenbank, hier wird ein unbeabsichtigter
 * Klick abgefangen.
 *
 * Sie nennt den Zählpunkt (auf einer Seite mit mehreren sieht ein „wirklich löschen?" ohne Nummer
 * für alle gleich aus) und BEIDE Folgen: was verschwindet, und dass die Ja/Nein-Frage danach
 * wiederkommt. Der zweite Satz ist nicht Höflichkeit — ohne ihn liest sich das Löschen wie eine
 * Sackgasse, und genau das Gegenteil ist der Zweck dieses Wegs.
 */
function deleteConfirmText(number: number): string {
  return (
    `Batterie-Angaben für Zählpunkt ${number} wirklich löschen?\n\n` +
    'Alle erfassten Kenndaten werden aus dem Entwurf entfernt, ebenso die Antworten auf „Haben Sie ' +
    'bereits einen Batteriespeicher?" und „Soll die Analyse einen Speichervorschlag enthalten?". ' +
    'Die Frage erscheint danach erneut — Sie können sie neu beantworten.'
  )
}

/** Die Weiche der Station. `null` = noch nicht beantwortet. */
type Answer = 'ja' | 'nein' | null

/** Die drei Quellen, aus denen die vier Kenndaten kommen können. */
type Source = 'text' | 'datenblatt' | 'recherche'

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
   * ⚠ EIN DRITTES EIGENES `useActionState`, aus denselben zwei Gründen wie beim Datenblatt-Weg:
   * eine geteilte Meldung überschriebe die des anderen Wegs, und die Übernahme unten hängt an der
   * OBJEKTIDENTITÄT des Ergebnisses — mit einem geteilten Zustand liesse sich nicht mehr sagen,
   * WELCHER Lauf gerade ein neues Objekt geliefert hat.
   */
  const [lookupState, lookupAction, isLookingUp] = useActionState(
    lookupBatterySpecByModelAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ EIN EIGENES `useActionState` FÜR DEN LÖSCHWEG, aus demselben Grund wie bei den drei
   * Quellen — und hier zusätzlich aus einem vierten: er steht in einem Block, der nach seinem
   * eigenen Erfolg VERSCHWINDET (die Zusammenfassung ist dann leer). Gemeinsam mit dem Speichern
   * geführt nähme der Löschweg dessen Erfolgsmeldung mit, und umgekehrt überschriebe ein
   * gescheitertes Löschen die Meldung eines eben gelungenen Speicherns. Die Meldungen stehen
   * deshalb GANZ OBEN, ausserhalb beider Blöcke (s. unten).
   */
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteMeteringPointBatteryAction,
    ADMIN_INITIAL_STATE,
  )

  /*
   * ⚠ DIE EINGABEFELDER DER DREI QUELLEN LEBEN IN IHREN KIND-DATEIEN, nicht hier — hier steht nur,
   * WELCHE Quelle gerade sichtbar ist. Dass sie kontrolliert sein MÜSSEN (drei Actions auf einem
   * Formular setzen unkontrollierte Felder nach JEDER von ihnen zurück, auch nach denen, die bloss
   * lesen), ist dort an ihrem Fundort begründet.
   *
   * ⚠ DIE GETIPPTEN TEXTE ÜBERLEBEN EINEN QUELLENWECHSEL NICHT, und das ist unverändert so: die
   * nicht gewählte Quelle wird gar nicht gerendert (s. Kopf), ihr `useState` verschwindet mit ihr.
   */
  const [source, setSource] = React.useState<Source>('text')
  const [fields, setFields] = React.useState<Record<string, string>>({})

  /**
   * Die vier Felder aus einem Leseergebnis füllen — für ALLE DREI Quellen dieselbe Zuweisung.
   *
   * ⚠ DIES IST DER EINZIGE ORT, DER IN `fields` SCHREIBT. Die drei Quellen-Komponenten rendern
   * nur ihre eigene Eingabe und melden nichts zurück; was aus einem Leseergebnis wird,
   * entscheidet die Station. Zwei schreibende Stellen liefen beim nächsten Umbau auseinander.
   *
   * Alle vier auf einmal, auch die nicht gelesenen (alle drei Actions schicken für sie einen
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
  const researched = lookupState.values?.extraction === 'ok' ? lookupState.values : null

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

  React.useEffect(() => {
    if (researched) applyExtraction(researched)
  }, [researched, applyExtraction])

  /*
   * ⚠ NACH EINEM ERFOLGREICHEN LÖSCHEN MUSS DIE WEICHE ZURÜCK — sonst wäre der Zustand in sich
   * widersprüchlich: `revalidatePath` macht `hasSummary` wieder falsch, die Frage erscheint also
   * erneut, aber `answer` stünde weiter auf dem zuletzt gewählten Zweig. Darunter hinge ein
   * ausgefülltes Formular an einem Entwurf, aus dem gerade alles entfernt wurde — die vier Zahlen
   * darin gehören zu Angaben, die es nicht mehr gibt. `fields` wird aus demselben Grund geleert.
   *
   * ⚠ AN DER OBJEKTIDENTITÄT VON `deleteState`, nicht an `hasSummary`: `useActionState` liefert je
   * Lauf ein neues Objekt und bei jedem anderen Rerender dasselbe. An `hasSummary` gehängt feuerte
   * der Effekt AUCH dann, wenn die Zusammenfassung aus einem ganz anderen Grund leer wird, und
   * setzte eine gerade getroffene Auswahl zurück. Dieselbe Technik wie bei den drei Übernahmen.
   */
  React.useEffect(() => {
    if (deleteState.success) {
      setAnswer(null)
      setFields({})
    }
  }, [deleteState])

  const summary = readBatteryDraft(meteringPoint.draft)
  const hasSummary = !batteryDraftIsEmpty(summary)

  return (
    <div className="flex flex-col gap-6">
      {/*
        Die Meldungen aller drei Actions stehen HIER, oberhalb von allem: der Ja-Zweig verschwindet
        nicht nach dem Speichern (die Frage bleibt stehen, s. Kopf), aber die Weiche kann gewechselt
        werden — eine Meldung im Zweig nähme sich damit selbst weg.
      */}
      {/*
        ⚠ DIE ERFOLGSMELDUNGEN HÄNGEN AM ZUSTAND DES ENTWURFS, NICHT NUR AM LETZTEN LAUF.

        Speichern und Löschen sind gegenläufig, und beide `useActionState` behalten ihren Stand
        über den jeweils anderen Lauf hinweg. Ohne die Bedingung stünden nach einem Löschen
        „3 Angaben wurden übernommen" und „Batterie-Angaben gelöscht." untereinander — zwei
        Meldungen, die einander widersprechen, und der Leser müsste raten, welche gilt.

        Die Regel ist deshalb der ZUSTAND: Meldungen über Erfasstes erscheinen, solange etwas
        erfasst ist; die Meldung über das Löschen, solange nichts erfasst ist. FEHLERmeldungen
        stehen unbedingt da — sie handeln von einem Versuch, nicht vom Ergebnis.
      */}
      {hasSummary && choiceState.success && <AdminSuccess>{choiceState.success}</AdminSuccess>}
      {choiceState.formError && <AdminError>{choiceState.formError}</AdminError>}
      {hasSummary && saveState.success && <AdminSuccess>{saveState.success}</AdminSuccess>}
      {saveState.formError && <AdminError>{saveState.formError}</AdminError>}
      {!hasSummary && deleteState.success && <AdminSuccess>{deleteState.success}</AdminSuccess>}
      {deleteState.formError && <AdminError>{deleteState.formError}</AdminError>}
      {readState.formError && <AdminError>{readState.formError}</AdminError>}
      {specState.formError && <AdminError>{specState.formError}</AdminError>}
      {lookupState.formError && <AdminError>{lookupState.formError}</AdminError>}

      {hasSummary && (
        <div className="flex flex-col gap-3">
          <BatterySummary number={meteringPointNumber} summary={summary} />

          {/*
            ⚠ DER LÖSCHWEG STEHT AM FUSS DER ZUSAMMENFASSUNG, nicht daneben und nicht darüber:
            Wer ihn drückt, soll vorher gelesen haben, WAS verschwindet. `ghost`, weil er der
            Ausweg für den falsch beantworteten Zählpunkt ist und kein Schritt, den die Station
            nahelegt — dieselbe Einordnung wie beim Lastgang-Rückweg.
          */}
          <form
            action={deleteAction}
            noValidate
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              if (!window.confirm(deleteConfirmText(meteringPointNumber))) e.preventDefault()
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
            <Button type="submit" variant="ghost" size="md" disabled={isDeleting}>
              {isDeleting && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {isDeleting ? 'Wird gelöscht …' : 'Batterie-Angaben löschen'}
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isDeleting ? 'Wird gelöscht …' : ''}
            </span>
          </form>
        </div>
      )}

      {/*
        ⚠ DIE FRAGE ERSCHEINT NUR, SOLANGE NICHTS ERFASST IST — und das ist die Änderung, für die
        der Löschweg daneben die Voraussetzung ist.

        Bis hierher stand sie IMMER da, mit ausdrücklicher Begründung: sie war der einzige Weg
        zurück. Wer sich vertippt oder die Antwort gewechselt hatte, konnte sie nur dadurch
        korrigieren, dass er den anderen Zweig erneut speicherte — mit der Folge, dass beide
        Antworten nebeneinander im Entwurf standen. Mit dem Löschknopf gibt es den Rückweg
        ausdrücklich, und die Frage kann verschwinden, sobald sie beantwortet ist.

        ⚠ BEIDE ZWEIGE HÄNGEN EBENFALLS DARAN, nicht nur die Frage: `answer` lebt in `useState`
        und überlebt einen Schreibvorgang. Ohne die Bedingung stünde nach dem Speichern weiterhin
        das ausgefüllte Formular unter der frischen Zusammenfassung — zweimal dieselben Werte, und
        der zweite Platz wäre der, an dem man sie versehentlich ändert.
      */}
      {!hasSummary && (
        <div>
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
      )}

      {!hasSummary && answer === 'nein' && (
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

      {!hasSummary && answer === 'ja' && (
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
              Sichtbarkeitsfrage. `type="button"`: die drei Knöpfe stehen im Speichern-Formular und
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
              <Button
                type="button"
                variant={source === 'recherche' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={source === 'recherche'}
                onClick={() => setSource('recherche')}
              >
                Marke/Typ suchen
              </Button>
            </div>

            {source === 'text' && (
              <DataEntryBatteryText
                state={readState}
                action={readAction}
                isReading={isReading}
                isSaving={isSaving}
              />
            )}

            {source === 'datenblatt' && (
              <DataEntryBatterySpec
                state={specState}
                action={specAction}
                isScanning={isScanning}
                isSaving={isSaving}
                maxBytes={maxBytes}
              />
            )}

            {source === 'recherche' && (
              <DataEntryBatteryLookup
                state={lookupState}
                action={lookupAction}
                isLookingUp={isLookingUp}
                isSaving={isSaving}
              />
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
