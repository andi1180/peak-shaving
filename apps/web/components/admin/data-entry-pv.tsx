'use client'

/**
 * Die PV-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE FRAGE, UND SIE WIRD GESPEICHERT — anders als bei der Batterie-Station
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * „Haben Sie bereits eine PV-Anlage?" ist hier KEINE Weiche in `useState`, sondern die Angabe
 * selbst. Der Unterschied zur Batterie-Station ist kein Versehen: dort steht hinter jedem Zweig
 * etwas, das erhoben wird (die Kenndaten bzw. der Speichervorschlag), und die Frage darüber ist
 * bloss der Weg dorthin. Hier gibt es hinter dem Nein-Zweig nichts zu erheben — bliebe die Antwort
 * im lokalen Zustand, wäre sie nach jedem Neuladen weg, und die Station stellte dieselbe Frage
 * erneut, obwohl sie längst beantwortet ist.
 *
 * ── ⚠ DER ZUSTAND KOMMT AUSSCHLIESSLICH AUS DEM ENTWURF, NICHT AUS LOKALEM `useState` ─────────
 * `readPvDraft(meteringPoint.draft).hasPv` ist die EINZIGE Quelle. Ein lokaler Zustand daneben
 * (etwa als optimistische Vorwegnahme) könnte von dem abweichen, was wirklich gespeichert ist —
 * genau dann, wenn der Schreibvorgang scheitert: die Oberfläche zeigte einen beantworteten Zweig,
 * und im Entwurf stünde nichts. Was hier zu sehen ist, IST der gespeicherte Stand; das kostet den
 * Roundtrip bis zum `revalidatePath` der Action, und dafür gibt es den Ladezustand am Knopf.
 *
 * ── ⚠ DIE FRAGE VERSCHWINDET, SOBALD SIE BEANTWORTET IST — UND DIESER KOPF HAT DAS GEGENTEIL
 * BEHAUPTET ──────────────────────────────────────────────────────────────────────────────────
 * Er lautete: „DIE FRAGE BLEIBT STEHEN, AUCH WENN SIE BEANTWORTET IST … es gibt für diese Angabe
 * KEINEN Entfernen-Weg. Wer versehentlich ‚Ja' trifft, muss ‚Nein' nachlegen können — eine Frage,
 * die nach der ersten Antwort verschwindet, wäre eine Sackgasse."
 *
 * Die Begründung war richtig und ist mit `deleteMeteringPointPvAction` entfallen: Wer versehentlich
 * „Ja" trifft, löscht jetzt und antwortet neu. Der Satz ist ERSETZT statt stehen gelassen — ein
 * Kommentar, der eine Regel behauptet, die es nicht mehr gibt, ist teurer als keiner.
 *
 * ⚠ Die stehengebliebene Frage war nicht neutral: sie las sich wie eine offene Aufgabe, und ein
 * zweiter Klick auf „Ja" hätte alles überschrieben, was darunter bereits erfasst war. An ihrer
 * Stelle steht jetzt eine Zeile, die die gespeicherte Antwort NENNT, und darunter der Löschweg.
 *
 * ── ⚠ DIESER KOPF HAT BIS ZUM ERZEUGUNGSPROFIL EIN ZWEITES MAL DAS GEGENTEIL BEHAUPTET ───────
 * Er lautete einmal: „Kein Upload eines Erzeugungsprofils, kein PVGIS-Abruf (B22), kein Extraktor
 * und kein Modellaufruf." Davon stimmt heute nichts mehr — der Ja-Zweig nimmt eine Erzeugungsdatei
 * entgegen, liest Anlagendaten aus Freitext und Datenblatt (Modellaufruf) und schätzt bei Bedarf
 * über PVGIS. Auch dieser Satz ist ersetzt, aus demselben Grund.
 *
 * ── ⚠ WAS DIESE STATION WEITERHIN NICHT TUT ──────────────────────────────────────────────────
 * Es gibt KEINEN Weg, EINE EINZELNE Modulfläche oder NUR das Erzeugungsprofil zu entfernen. Der
 * Löschweg nimmt die PV-Angabe des Zählpunkts als GANZES zurück (Antwort, Flächen, Profil) — das
 * ist der Weg für „das war falsch", nicht für „diese eine Zeile war falsch". Beides sind eigene,
 * kleinere Aufträge; bis dahin ist der Ausweg für ein falsches Profil eine zweite Datei (sie
 * überschreibt die Angaben) und für eine falsche Fläche das Löschen und erneute Erfassen.
 *
 * ⚠ Ebenfalls unverändert: die hochgeladene DATEI bleibt beim Löschen in der Dokumentenliste des
 * Projekts stehen — entfernt wird der Verweis, nicht das Dokument (Begründung an der Action). Die
 * Rückfrage sagt das im Klartext, statt eine Löschung zu behaupten, die nicht stattfindet.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import {
  deleteMeteringPointPvAction,
  generatePvProfileAction,
  saveMeteringPointPvChoiceAction,
  saveProjectPostalCodeAction,
  uploadMeteringPointPvProfileAction,
} from '@/lib/admin/data-entry-actions'
import { formatDateTime, formatKwh, formatPercent } from '@/lib/admin/format'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { readPvArraysDraft } from '@/lib/admin/pv-array-draft'
import { PV_PRESENT_KEY, readPvDraft } from '@/lib/admin/pv-draft'
import { splitPvArrayDesigns } from '@/lib/admin/pv-estimate'
import {
  hasPvProfile,
  readPvProfileDraft,
  type PvProfileDraftSummary,
} from '@/lib/admin/pv-profile-draft'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'
import { COMPANY } from '@/lib/nav'
import { AdminError, AdminField, AdminSuccess } from './ui'
import { DataEntryPvArray } from './data-entry-pv-array'

const FIELD_ID = 'dateneingabe-pv-erzeugung-datei'

/**
 * Die Rückfrage vor dem Löschen.
 *
 * ⚠ SIE IST EINE RÜCKFRAGE AN EINEN MENSCHEN, KEINE PRÜFUNG — dieselbe Einordnung wie beim
 * Lastgang-Rückweg und bei der Batterie-Station: die Berechtigung entscheidet die Datenbank, hier
 * wird ein unbeabsichtigter Klick abgefangen.
 *
 * ⚠ SIE NENNT AUSDRÜCKLICH MEHR ALS DIE JA/NEIN-ANTWORT. Wer den Knopf unter „Vermerkt: PV-Anlage
 * vorhanden" sieht, erwartet, dass genau dieser Vermerk verschwindet — gelöscht werden aber auch
 * die erfassten Modulflächen und ein hochgeladenes oder geschätztes Erzeugungsprofil. Diese zwei
 * Folgen ungenannt zu lassen wäre der teuerste Satz, den dieser Dialog nicht sagt: die Arbeit
 * mehrerer Minuten hinge an einem Klick, der nach einer einzeiligen Korrektur aussieht.
 *
 * Genannt wird ausserdem der Zählpunkt (auf einer Seite mit mehreren sieht ein „wirklich löschen?"
 * ohne Nummer für alle gleich aus) und dass die Frage danach erneut erscheint — ohne diesen Satz
 * liest sich das Löschen wie eine Sackgasse, und genau das Gegenteil ist der Zweck dieses Wegs.
 *
 * ⚠ DIE DATEI SELBST WIRD NICHT GELÖSCHT, und das steht ebenfalls dort: sie bleibt in der
 * Dokumentenliste des Projekts (s. `deleteMeteringPointPvAction`). Ein Dialog, der eine Löschung
 * aus der Ablage BEHAUPTET, die nicht stattfindet, wäre schlimmer als einer, der schweigt.
 */
function deleteConfirmText(number: number): string {
  return (
    `PV-Angaben für Zählpunkt ${number} wirklich löschen?\n\n` +
    'Entfernt werden die Antwort auf „Haben Sie bereits eine PV-Anlage?", alle erfassten ' +
    'Modulflächen und ein hochgeladenes oder geschätztes Erzeugungsprofil. Eine hochgeladene ' +
    'Datei bleibt in der Dokumentenliste des Projekts. Die Frage erscheint danach erneut — Sie ' +
    'können sie neu beantworten.'
  )
}

export function DataEntryPv({
  projectId,
  meteringPoint,
  meteringPointNumber,
  maxBytes,
  designMaxBytes,
  customerLabel,
  postalCode,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
  /** Die wirksame Grössengrenze, aus der Server-Komponente hereingereicht (eine Konstante, ein Ort). */
  maxBytes: number
  /**
   * Die Grössengrenze des DATENBLATTS der Anlagendaten — eine ANDERE Zahl als `maxBytes` darüber.
   *
   * ⚠ Zwei Grenzen, weil es zwei Dateien mit zwei Wegen sind: das ERZEUGUNGSPROFIL wird ausgelesen
   * UND im Projekt abgelegt (dort gilt die kleinere von Ablage- und Lesegrenze), das DATENBLATT
   * wird ausschliesslich ausgelesen und ausdrücklich NICHT abgelegt (s. `scanPvDesignAction`) — die
   * Grenze der Ablage gälte dort für einen Weg, den es nicht gibt. Beide Zahlen liegen in
   * `packages/extractors` bzw. `shared` und müssen deshalb Props sein, nicht Importe.
   */
  designMaxBytes: number
  /**
   * Der Projektname für den Betreff der PV-Anfrage.
   *
   * ⚠ Als Prop und nicht hier nachgeschlagen: die Station bekommt den Zählpunkt, nicht das Projekt
   * — und ein zweiter Leser für denselben Namen wäre eine zweite Stelle, an der er abweichen kann.
   */
  customerLabel: string
  /**
   * Die PLZ des Projekts, oder `null`, solange keine eingetragen ist.
   *
   * ⚠ PROJEKTWEIT, nicht je Zählpunkt — sie steht auf `platform.projects`. Sie erscheint hier,
   * weil der PVGIS-Generator sie braucht und dies die Station ist, an der über die PV-Anlage
   * gesprochen wird; sie gehört aber NICHT zu `meteringPoint` und ist deshalb nicht an
   * `meteringPointNumber` geknüpft.
   */
  postalCode: string | null
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
}) {
  const [state, action, isSaving] = useActionState(
    saveMeteringPointPvChoiceAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ ZWEITER Zustand, absichtlich HIER und nicht im Upload-Formular — dieselbe Lehre wie bei der
   * Lastgang-Station (und ursprünglich aus B16-4b): ein erfolgreicher Upload wechselt den Ja-Zweig
   * in die Zusammenfassung, und ein `useActionState` IM Formular verschwände mitsamt seiner
   * Meldung. Die Erfolgsmeldung erschiene dann nie.
   */
  const [uploadState, uploadAction, isUploading] = useActionState(
    uploadMeteringPointPvProfileAction,
    ADMIN_INITIAL_STATE,
  )

  /*
   * ⚠ DRITTER Zustand, und er gehört einer ANDEREN Ebene: die PLZ hängt am PROJEKT, nicht am
   * Zählpunkt. Eigener `useActionState` statt eines geteilten — eine Meldung zum Standort
   * überschriebe sonst die eines laufenden Uploads und umgekehrt (dieselbe Lehre wie beim
   * Entfernen-Weg der Rechnung-Station).
   */
  const [postalState, postalAction, isSavingPostal] = useActionState(
    saveProjectPostalCodeAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * Rein lokale Weiche „ich will die gespeicherte PLZ ändern" — sie ist keine Angabe über das
   * Projekt und hat deshalb bewusst keine Spalte (dieselbe Überlegung wie bei der Ja/Nein-Frage
   * der Lastgang-Station). Nach erfolgreichem Speichern schliesst sie sich selbst: der Server
   * liefert den neuen Wert, das Formular hätte danach nichts mehr zu tun.
   */
  /*
   * ⚠ VIERTER Zustand, und wieder ein eigener. Ein Fehlschlag der Schätzung (etwa eine
   * unvollständig erfasste Fläche) überschriebe sonst die Meldung eines laufenden Uploads —
   * dieselbe Lehre wie beim Entfernen-Weg der Rechnung-Station. Er sitzt ausserdem auf
   * KOMPONENTEN-Ebene und nicht im Formular: ein erfolgreicher Lauf ersetzt den Knopf durch die
   * Zusammenfassung, und ein `useActionState` im Formular verschwände mitsamt seiner Meldung.
   */
  const [estimateState, estimateAction, isEstimating] = useActionState(
    generatePvProfileAction,
    ADMIN_INITIAL_STATE,
  )

  /*
   * ⚠ FÜNFTER Zustand, und er gehört wie die vier davor auf KOMPONENTEN-Ebene: ein erfolgreiches
   * Löschen ersetzt die Zusammenfassung samt Löschknopf durch die Frage — ein `useActionState` IM
   * Löschformular verschwände mitsamt seiner Meldung, und die Bestätigung erschiene nie. Eigener
   * Zustand statt eines geteilten, aus demselben Grund wie oben: ein Fehlschlag beim Löschen
   * überschriebe sonst die Meldung eines laufenden Uploads und umgekehrt.
   */
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteMeteringPointPvAction,
    ADMIN_INITIAL_STATE,
  )

  const [isEditingPostal, setIsEditingPostal] = React.useState(false)
  React.useEffect(() => {
    if (postalState.success) setIsEditingPostal(false)
  }, [postalState.success])

  const { hasPv } = readPvDraft(meteringPoint.draft)
  const pvProfile = readPvProfileDraft(meteringPoint.draft)
  const uploadError = uploadState.fieldErrors?.file

  /*
   * ⚠ DIE ANBIETBARKEIT WIRD HIER NUR SO WEIT BEANTWORTET, WIE ES OHNE DIE DATEI GEHT.
   *
   * Ob der Lastgang eine GEMESSENE Einspeisung enthält, lässt sich nur an seinen einzelnen
   * Messwerten erkennen — und die liegen in der Datei, nicht im Entwurf. Diese Komponente rendert
   * auf dem Server, könnte sie also öffnen; sie tut es bewusst nicht: eine bis zu 20 MB grosse
   * Datei bei JEDEM Seitenaufbau zu lesen, nur um einen Knopf zu zeigen oder zu verstecken, wäre
   * ein hoher Preis für eine Anzeige. Die Prüfung läuft deshalb in der Action, und der Knopf kann
   * in eine begründete Ablehnung führen (§2.4) — das ist der bewusst in Kauf genommene Rest.
   *
   * Was hier geprüft wird, sind die Vorbedingungen, die der Entwurf selbst beantwortet: Standort,
   * Flächen, Lastgang-Zeitraum. Sie fehlen sichtbar auf DIESER Seite, und ein Knopf, der nur
   * darauf hinweisen kann, ist keine Hilfe.
   */
  const pvArrays = readPvArraysDraft(meteringPoint.draft)
  const { designs, incompleteNumbers } = splitPvArrayDesigns(pvArrays)
  const hasLoadPeriod = meteringPoint.coveredFrom !== null && meteringPoint.coveredTo !== null
  const hasPostalCode = postalCode !== null && postalCode.trim() !== ''
  const canEstimate =
    hasLoadPeriod && hasPostalCode && designs.length > 0 && incompleteNumbers.length === 0

  React.useEffect(() => {
    if (uploadError) document.getElementById(FIELD_ID)?.focus()
  }, [uploadError])

  return (
    <div className="flex flex-col gap-6">
      {/*
        ⚠ DIE ERFOLGSMELDUNGEN HÄNGEN AM ZUSTAND DES ENTWURFS, NICHT NUR AM LETZTEN LAUF.

        Antworten und Löschen sind gegenläufig, und beide `useActionState` behalten ihren Stand
        über den jeweils anderen Lauf hinweg. Ohne die Bedingung stünden nach einem Löschen
        „Vermerkt: Es gibt bereits eine PV-Anlage." und „PV-Angaben vollständig gelöscht."
        untereinander — zwei Meldungen, die einander widersprechen, und der Leser müsste raten,
        welche gilt.

        Die Regel ist deshalb der ZUSTAND: die Meldung über die Antwort erscheint, solange eine
        Antwort gespeichert ist; die Meldung über das Löschen, solange keine gespeichert ist.
        FEHLERmeldungen stehen unbedingt da — sie handeln von einem Versuch, nicht vom Ergebnis.
        Wortgleich zur Batterie-Station.
      */}
      {hasPv !== null && state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {hasPv === null && deleteState.success && (
        <AdminSuccess>{deleteState.success}</AdminSuccess>
      )}
      {deleteState.formError && <AdminError>{deleteState.formError}</AdminError>}

      {/*
        ⚠ DIE FRAGE ERSCHEINT NUR, SOLANGE SIE UNBEANTWORTET IST — und der Löschweg darunter ist
        die Voraussetzung dafür.

        Bis hierher blieb sie stehen, mit genau einer Begründung (s. Kopf): es gab keinen
        Entfernen-Weg, sie war also die einzige Möglichkeit, in den anderen Zweig zu kommen. Den
        gibt es jetzt, und damit entfällt der Grund. Eine beantwortete Frage weiter zu stellen ist
        nicht neutral — sie liest sich wie eine offene Aufgabe und lädt zu einem zweiten Klick ein,
        der stillschweigend alles überschreibt, was darunter erfasst wurde.
      */}
      {/*
        ⚠ ZWEI KNÖPFE IN EINEM FORMULAR, unterschieden über `name`/`value` des Absendeknopfes —
        kein `<select>` und keine Ankreuzmöglichkeit. Die Frage hat genau zwei Antworten, und beide
        sind eine ANGABE: „nein, keine PV-Anlage" muss von „dazu wurde nichts gefragt"
        unterscheidbar bleiben. Eine Ankreuzmöglichkeit könnte das nicht — nicht angehakt hiesse
        beides zugleich.

        ⚠ KEIN `aria-pressed` MEHR, und das ist die Folge des Absatzes darüber: der Block rendert
        ausschliesslich bei `hasPv === null`, beide Knöpfe wären also dauerhaft „nicht gedrückt".
        Ein Umschalt-Zustand, der nie eintreten kann, sagt einem Screenreader etwas Falsches —
        welche Antwort gilt, steht ab jetzt in der Zeile darunter, nicht in einem Knopf.
      */}
      {hasPv === null && (
        <form action={action} noValidate>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

          <p className="max-w-prose text-body text-ink">
            Haben Sie bereits eine PV-Anlage für Zählpunkt {meteringPointNumber}?
          </p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Gemeint ist eine bereits errichtete oder fest bestellte Anlage — unabhängig davon, ob ihre
            Erzeugung gemessen vorliegt.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              name={PV_PRESENT_KEY}
              value="ja"
              variant="secondary"
              size="md"
              disabled={isSaving}
            >
              {isSaving && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              Ja
            </Button>
            <Button
              type="submit"
              name={PV_PRESENT_KEY}
              value="nein"
              variant="secondary"
              size="md"
              disabled={isSaving}
            >
              Nein
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isSaving ? 'Wird gespeichert …' : ''}
            </span>
          </div>
        </form>
      )}

      {/*
        ⚠ DIE ANTWORT SELBST IST DIE ZUSAMMENFASSUNG — anders als bei der Batterie-Station.

        Dort steht hinter jedem Zweig etwas, das erhoben wird, und die Zusammenfassung zeigt DAS.
        Hier ist die Antwort die Angabe (s. Kopf): „keine PV-Anlage" hat keine Kenndaten, über die
        sich eine Zusammenfassung bilden liesse, und muss trotzdem als beantwortet erkennbar sein.
        Deshalb eine Zeile für BEIDE Antworten, nicht nur für „Ja".
      */}
      {hasPv !== null && (
        <div className="flex flex-col gap-3">
          <p className="max-w-prose text-body text-ink">
            <span className="font-medium">
              {hasPv ? 'Vermerkt: PV-Anlage vorhanden' : 'Vermerkt: keine PV-Anlage vorhanden'}
            </span>{' '}
            <span className="text-text-muted">(Zählpunkt {meteringPointNumber})</span>
          </p>

          {/*
            ⚠ DER LÖSCHWEG STEHT DIREKT UNTER DER ANTWORT, nicht am Fuss der ganzen Station: bei
            „Ja" folgt darunter der gesamte Ja-Zweig (Upload, Modulflächen, Standort, Schätzung),
            und ein Knopf hinter alledem wäre von den Aktionen dieses Zweigs nicht mehr zu
            unterscheiden. Er gehört zu der Zeile, die er zurücknimmt.

            `ghost`, weil er der Ausweg für den falsch beantworteten Zählpunkt ist und kein Schritt,
            den die Station nahelegt — dieselbe Einordnung wie beim Lastgang-Rückweg.
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
              {isDeleting ? 'Wird gelöscht …' : 'PV-Angaben löschen'}
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isDeleting ? 'Wird gelöscht …' : ''}
            </span>
          </form>
        </div>
      )}

      {hasPv === true && (
        <div className="flex flex-col gap-4 border-t border-line pt-6">
          {uploadState.success && <AdminSuccess>{uploadState.success}</AdminSuccess>}
          {uploadState.formError && <AdminError>{uploadState.formError}</AdminError>}

          {hasPvProfile(pvProfile) ? (
            <PvProfileSummary profile={pvProfile} number={meteringPointNumber} />
          ) : (
            <PvProfileUploadForm
              projectId={projectId}
              meteringPointId={meteringPoint.id}
              meteringPointNumber={meteringPointNumber}
              maxBytes={maxBytes}
              action={uploadAction}
              isPending={isUploading}
              error={uploadError}
            />
          )}

          {/*
            ⚠ DIE ANLAGENDATEN ERSCHEINEN NUR, SOLANGE KEIN ERZEUGUNGSPROFIL VORLIEGT.

            Ein hochgeladenes Profil IST die Erzeugung dieser Anlage, viertelstündlich und gemessen.
            Nennleistung, Ausrichtung und Neigung sind die Grundlage, aus der sich eine Erzeugung
            SCHÄTZEN liesse — daneben gestellt wären sie eine zweite, schwächere Aussage über
            dieselbe Sache, und welche von beiden die Rechnung nimmt, wäre für den Ablesenden nicht
            mehr erkennbar. Wer trotzdem beides erfassen will, entfernt zuerst das Profil.
          */}
          {!hasPvProfile(pvProfile) && (
            <>
              <DataEntryPvArray
                projectId={projectId}
                meteringPoint={meteringPoint}
                meteringPointNumber={meteringPointNumber}
                maxBytes={designMaxBytes}
              />

              <ProjectPostalCode
                projectId={projectId}
                postalCode={postalCode}
                action={postalAction}
                state={postalState}
                isPending={isSavingPostal}
                isEditing={isEditingPostal}
                onEdit={() => setIsEditingPostal(true)}
              />

              {/*
                ⚠ DER SCHÄTZ-KNOPF STEHT ZULETZT, und das ist keine Anordnungsfrage: er setzt
                Flächen UND Standort voraus, und beide werden direkt darüber erfasst. Weiter oben
                stünde er über seinen eigenen Vorbedingungen und wäre im Regelfall — beim ersten
                Betreten der Station — ein unbenutzbarer Knopf.
              */}
              <PvEstimateForm
                projectId={projectId}
                meteringPointId={meteringPoint.id}
                meteringPointNumber={meteringPointNumber}
                action={estimateAction}
                state={estimateState}
                isPending={isEstimating}
                canEstimate={canEstimate}
                arrayCount={designs.length}
                incompleteNumbers={incompleteNumbers}
                hasArrays={pvArrays.length > 0}
                hasPostalCode={hasPostalCode}
                hasLoadPeriod={hasLoadPeriod}
              />
            </>
          )}
        </div>
      )}

      {hasPv === false && (
        <div className="border-t border-line pt-6">
          <p className="max-w-prose text-body text-ink">COOLiN plant und errichtet PV-Anlagen.</p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Ohne eigene Erzeugung rechnet die Analyse ausschliesslich mit dem Netzbezug. Ist eine
            PV-Anlage für dieses Projekt ein Thema, lässt sich die Anfrage von hier aus anstossen:{' '}
            {/*
              Die Adresse kommt aus `COMPANY` (`lib/nav.ts`) — dem EINEN Fundort der Kontaktdaten.
              Eine hier getippte Zweitfassung zeigte nach einem Postfachwechsel still ins alte
              Postfach.
            */}
            <a
              href={`mailto:${COMPANY.email}?subject=${encodeURIComponent(
                `PV-Planung — Projekt ${customerLabel}`,
              )}`}
              className="text-accent underline decoration-accent-border underline-offset-2 hover:decoration-accent"
            >
              {COMPANY.email}
            </a>{' '}
            — der Link öffnet Ihr E-Mail-Programm mit vorbereitetem Betreff. Er speichert nichts und
            ändert nichts an der Analyse.
          </p>
        </div>
      )}

      {/*
        ⚠ DER WEG NACH VORN GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE — dieselbe Regel wie bei den
        drei Stationen davor: wer den Zustand kennt, rendert ihn. Die Seite unterdrückt ihren
        generischen „Weiter"-Link für diese Station; stünde er daneben, gäbe es zwei Wege nach vorn.

        Er erscheint auch ohne Antwort, nur zurückhaltender: die Station ist keine Sackgasse, und
        ein Zählpunkt, zu dem gerade niemand etwas über eine PV-Anlage sagen kann, muss passierbar
        bleiben. Die PROMINENZ folgt dem Zustand.
      */}
      {nextHref !== null && (
        <div>
          <Button asChild variant={hasPv === null ? 'secondary' : 'primary'} size="md">
            <Link href={nextHref}>Weiter</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Das Dateifeld für die Erzeugungsreihe.
 *
 * ⚠ KEIN `accept`-FILTER — dasselbe Prinzip und derselbe Grund wie beim Lastgang: der Dateidialog
 * versteckte damit Dateien, die der Leser sehr wohl lesen kann (ein Wechselrichter-Portal liefert
 * CSV, XLSX, gelegentlich mit abweichender Endung). Was lesbar ist, entscheidet der Leser und lehnt
 * eine unbrauchbare Datei mit einem Satz ab; ein Dialog, der sie gar nicht erst anbietet, erzeugt
 * eine Fehlersuche ohne Fehlermeldung.
 *
 * ⚠ Die MB-Zahl kommt aus `maxBytes` und wird NICHT abgetippt: der Wizard nimmt die kleinere von
 * zwei Grenzen (die der Ablage, 20 MB), und eine Meldung, die 25 MB verspricht, schickte den Nutzer
 * in einen Fehlschlag, den sie selbst angekündigt hat.
 */
function PvProfileUploadForm({
  projectId,
  meteringPointId,
  meteringPointNumber,
  maxBytes,
  action,
  isPending,
  error,
}: {
  projectId: string
  meteringPointId: string
  meteringPointNumber: number
  maxBytes: number
  action: (formData: FormData) => void
  isPending: boolean
  error?: string
}) {
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="meteringPointId" value={meteringPointId} />

      <div>
        <p className="max-w-prose text-body text-ink">
          Liegt die Erzeugung dieser Anlage als Datei vor (Viertelstunden- oder Stundenwerte)?
        </p>
        <p className="mt-2 max-w-prose text-small text-text-muted">
          Wechselrichter-Portale stellen sie als CSV- oder XLSX-Datei bereit. Ohne Datei geht es
          ebenfalls weiter — dieser Schritt ist nicht Voraussetzung für die übrigen Angaben.
        </p>
      </div>

      <div className="max-w-xl">
        <Label htmlFor={FIELD_ID}>Erzeugungsprofil für Zählpunkt {meteringPointNumber}</Label>
        <div className="mt-1.5">
          <input
            id={FIELD_ID}
            name="file"
            type="file"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={`${FIELD_ID}-hint`}
            className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
          />
        </div>
        <FieldHint id={`${FIELD_ID}-hint`} tone={error ? 'error' : 'muted'}>
          {error ??
            `CSV oder XLSX, bis ${Math.floor(maxBytes / (1024 * 1024))} MB. Die Datei wird eingelesen; gespeichert werden Zeitraum, Intervall und Lücken — keine Messwerte.`}
        </FieldHint>
      </div>

      <div>
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird eingelesen …' : 'Datei einlesen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird eingelesen …' : ''}
        </span>
      </div>
    </form>
  )
}

/**
 * Was aus der Erzeugungsdatei gelesen wurde — Zeitraum, Intervall, Lücken. KEINE Messwerte.
 *
 * ⚠ `coveredTo` IST DIE OBERE KANTE EINES HALBOFFENEN BEREICHS, nicht der letzte Messwert —
 * wortgleiche Konvention wie beim Lastgang (letzter Zeitstempel + Intervall). Ein Jahresprofil endet
 * damit am 1. Jänner des FOLGEjahres um 00:00; für einen Menschen sieht das aus, als reiche es ins
 * nächste Jahr hinein. Die Beschriftung sagt deshalb ausdrücklich „Ende des letzten Intervalls",
 * statt den Wert um ein Intervall zu verkleinern: das wäre eine zweite Zahl über dieselbe Reihe, und
 * sie stünde in keinem Feld des Entwurfs.
 *
 * ⚠ Die Angaben kommen aus dem ENTWURF, nicht aus dem Rückgabewert der Action — dieselbe Regel wie
 * bei der Lastgang-Station: aus der Action-Antwort gezeigt stünde die Station nach einem Neuladen
 * ohne Zusammenfassung da, obwohl gespeichert ist.
 */
function PvProfileSummary({
  profile,
  number,
}: {
  profile: PvProfileDraftSummary
  number: number
}) {
  /*
   * ⚠ DIE HERKUNFT KOMMT AUS `source`, NICHT AUS DER ANWESENHEIT DER KENNZAHLEN. Beides ergäbe
   * heute dasselbe (`readPvProfileDraft` liefert `estimate` nur für `'generated'`), aber die
   * Aussage ist eine andere: `source` sagt, WOHER die Reihe stammt, `estimate` ist eine Folge
   * davon. Über das Vorhandensein der Zahlen entschieden, hiesse ein künftiger Entwurf ohne
   * Kennzahlen still „hochgeladen" — dieselbe Verwechslung, die `profileSource` auf der
   * Lastgang-Seite behoben hat (dort war `hasLoadProfile` an der Dokument-Kennung festgemacht).
   */
  const isGenerated = profile.source === 'generated'

  return (
    <div>
      <p className="text-small font-medium text-ink">
        {isGenerated
          ? `Erzeugungsprofil für Zählpunkt ${number} ist geschätzt.`
          : `Erzeugungsprofil für Zählpunkt ${number} ist eingelesen.`}
      </p>

      <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
        <dt className="text-caption text-text-muted">Zeitraum (Beginn)</dt>
        <dd className="text-small tabular-nums text-ink">{formatDateTime(profile.coveredFrom)}</dd>

        <dt className="text-caption text-text-muted">Zeitraum (Ende des letzten Intervalls)</dt>
        <dd className="text-small tabular-nums text-ink">{formatDateTime(profile.coveredTo)}</dd>

        <dt className="text-caption text-text-muted">Intervall</dt>
        <dd className="text-small tabular-nums text-ink">
          {profile.intervalMinutes === null ? '—' : `${profile.intervalMinutes} Minuten`}
        </dd>

        {/*
          ⚠ ERTRAG UND STREUUNG STEHEN NEBENEINANDER ODER GAR NICHT. Eine geschätzte Jahreszahl
          ohne ihre Streuung liest sich wie eine gemessene — genau der Grund, aus dem
          `PvProfileEstimate` ein Block ist und nicht vier flache Felder.
        */}
        {profile.estimate && (
          <>
            <dt className="text-caption text-text-muted">Jahresertrag (geschätzt)</dt>
            <dd className="text-small tabular-nums text-ink">
              {formatKwh(profile.estimate.annualKwh)} ± {formatPercent(profile.estimate.spreadPercent)}
            </dd>

            <dt className="text-caption text-text-muted">Wetterjahre</dt>
            <dd className="text-small tabular-nums text-ink">
              {profile.estimate.weatherYears.from}–{profile.estimate.weatherYears.to}
            </dd>
          </>
        )}

        {/*
          ⚠ BEI EINER GESCHÄTZTEN REIHE WIRD DIE LÜCKEN-ZEILE GAR NICHT GERENDERT. „keine" wäre
          dort ein Befund über eine Messung, die nie stattgefunden hat — dieselbe Entscheidung wie
          in der Zusammenfassung des erzeugten Standardlastprofils.
        */}
        {!isGenerated && (
          <>
            <dt className="text-caption text-text-muted">Lücken</dt>
            <dd className="text-small tabular-nums text-ink">
              {profile.gaps.length === 0 ? 'keine' : `${profile.gaps.length}`}
            </dd>
          </>
        )}
      </dl>

      {profile.gaps.length > 0 && (
        <div className="mt-4">
          <p className="text-caption text-text-muted">Zeitbereiche ohne Messwerte</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {profile.gaps.map((gap) => (
              <li key={`${gap.from}-${gap.to}`} className="text-small tabular-nums text-ink">
                {formatDateTime(gap.from)} – {formatDateTime(gap.to)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isGenerated ? (
        <>
          <p className="mt-4 max-w-prose text-small text-text-muted">
            Diese Erzeugung ist <strong className="font-medium text-ink">geschätzt</strong>, nicht
            gemessen: gerechnet aus den erfassten Modulflächen am Standort des Projekts, gemittelt
            über zehn Wetterjahre. Sie ist im Entwurf als Annahme gekennzeichnet und bleibt es bis
            in den Report.
          </p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Die „±"-Angabe ist die Schwankung zwischen bestem und schlechtestem Wetterjahr. Über sie
            hinaus fällt eine gemittelte Kurve etwas günstiger aus als jedes einzelne Jahr, weil sie
            glatter ist — die Schätzung ist damit leicht optimistisch.
          </p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Liegt später eine gemessene Reihe vor, ersetzt ein Upload diese Angaben.
          </p>
        </>
      ) : (
        <>
          <p className="mt-4 max-w-prose text-small text-text-muted">
            Gespeichert sind ausschliesslich diese Angaben über die Reihe — keine Messwerte. Die
            Datei selbst liegt in der Dokumentenliste des Projekts.
          </p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Ein Entfernen gibt es in diesem Schritt noch nicht. Wurde die falsche Datei eingelesen,
            hilft ein erneuter Upload — er ersetzt die Angaben.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Der Standort des PROJEKTS — die Grundlage, aus der sich die Erzeugung einer Anlage schätzen
 * liesse (PVGIS; eigener, folgender Auftrag).
 *
 * ⚠ ZWEI ZUSTÄNDE, KEIN DRITTER: ist keine PLZ hinterlegt, steht hier ein Eingabefeld; ist eine
 * hinterlegt, steht sie als Angabe da und lässt sich über „Ändern" wieder öffnen. Ein dauerhaft
 * sichtbares, vorbelegtes Feld wäre die dritte Möglichkeit und die schlechteste: eine geprüfte
 * Angabe sähe aus wie ein Entwurf, den noch jemand bestätigen muss.
 */
function ProjectPostalCode({
  projectId,
  postalCode,
  action,
  state,
  isPending,
  isEditing,
  onEdit,
}: {
  projectId: string
  postalCode: string | null
  action: (formData: FormData) => void
  state: AdminState
  isPending: boolean
  isEditing: boolean
  onEdit: () => void
}) {
  const showForm = postalCode === null || isEditing

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-6">
      <h3 className="text-small font-semibold text-ink">Standort</h3>

      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      {state.formError && <AdminError>{state.formError}</AdminError>}

      {showForm ? (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={projectId} />

          <div className="max-w-xs">
            <AdminField
              id="dateneingabe-projekt-plz"
              name="postalCode"
              label="Postleitzahl"
              inputMode="numeric"
              maxLength={4}
              defaultValue={postalCode ?? ''}
              error={state.fieldErrors?.postalCode}
              hint="Vier Ziffern, österreichisch — z. B. 1100. Sie gilt für das ganze Projekt."
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Standort speichern
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isPending ? 'Wird gespeichert …' : ''}
            </span>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-body text-ink">
            Postleitzahl: <span className="font-medium tabular-nums">{postalCode}</span>
          </p>
          <button
            type="button"
            onClick={onEdit}
            className="text-small text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            Ändern
          </button>
        </div>
      )}

      <FieldHint>
        Aus der Postleitzahl entsteht später die Erzeugungsschätzung für eine geplante Anlage. Ein
        hochgeladenes Erzeugungsprofil schlägt sie in jedem Fall — es ist gemessen.
      </FieldHint>
    </div>
  )
}

/**
 * Der Anstoss der PVGIS-Schätzung — ein Knopf, und daneben der Grund, wenn er nicht benutzbar ist.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN GESPERRTER KNOPF OHNE GRUND IST SCHLECHTER ALS KEIN KNOPF
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Schätzung hat drei Vorbedingungen, die alle auf ANDEREN Schritten liegen (Lastgang,
 * Modulflächen, Standort). Wer hier vor einem stumpfen Knopf steht, sucht den Fehler bei sich.
 * Deshalb steht unter dem Knopf in jedem Sperrfall genau der Satz, der sagt, was fehlt und wo es
 * nachzutragen ist — und es sind mehrere Sätze gleichzeitig möglich, weil beim ersten Betreten der
 * Station regelmässig alle drei Angaben fehlen.
 *
 * ⚠ DER KNOPF WIRD GESPERRT, NICHT VERSTECKT. Ein versteckter Knopf sähe aus, als gäbe es den Weg
 * gar nicht — und die Station böte dann für einen Kunden ohne gemessene Erzeugung überhaupt keine
 * Fortsetzung an. Sichtbar und begründet gesperrt ist er zugleich der Hinweis, dass es ihn gibt.
 *
 * ⚠ UNVOLLSTÄNDIGE FLÄCHEN SPERREN, sie werden nicht übersprungen — dieselbe Regel wie in der
 * Action, und aus demselben Grund: eine Schätzung über die übrigen Flächen ergäbe einen zu
 * niedrigen Ertrag, dem man das nicht ansieht. Die beiden Orte lesen dafür DIESELBE Funktion
 * (`splitPvArrayDesigns`); zweimal ausgeschrieben böte die Oberfläche einen Weg an, der nur
 * scheitern kann.
 *
 * ⚠ KEINE RÜCKFRAGE VOR DEM KLICK. Der Vorgang legt nichts an, was sich nicht durch einen zweiten
 * Lauf oder einen Upload ersetzen liesse, und er vernichtet nichts — anders als beim Entfernen
 * eines Lastgangs gibt es hier nichts zu bestätigen. Was er kostet, ist Wartezeit, und die steht
 * als Hinweis am Knopf.
 */
function PvEstimateForm({
  projectId,
  meteringPointId,
  meteringPointNumber,
  action,
  state,
  isPending,
  canEstimate,
  arrayCount,
  incompleteNumbers,
  hasArrays,
  hasPostalCode,
  hasLoadPeriod,
}: {
  projectId: string
  meteringPointId: string
  meteringPointNumber: number
  action: (formData: FormData) => void
  state: AdminState
  isPending: boolean
  canEstimate: boolean
  /** Die Zahl der VOLLSTÄNDIG erfassten Flächen — sie gehen in den Abruf. */
  arrayCount: number
  /** 1-basierte Nummern der unvollständigen Flächen, wie sie in der Zusammenfassung stehen. */
  incompleteNumbers: number[]
  hasArrays: boolean
  hasPostalCode: boolean
  hasLoadPeriod: boolean
}) {
  return (
    <div className="border-t border-line pt-6">
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      {state.formError && <AdminError>{state.formError}</AdminError>}

      <p className="max-w-prose text-body text-ink">
        Keine gemessene Erzeugungsreihe? Dann lässt sie sich schätzen.
      </p>
      <p className="mt-2 max-w-prose text-small text-text-muted">
        Aus den erfassten Modulflächen und dem Standort des Projekts wird über den europäischen
        Erzeugungs-Dienst PVGIS eine Erzeugung gerechnet, gemittelt über zehn Wetterjahre. Das
        Ergebnis ist eine <strong className="font-medium text-ink">Annahme</strong> und wird auch so
        gespeichert — es ersetzt keine gemessene Reihe.
      </p>

      <form action={action} noValidate className="mt-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="meteringPointId" value={meteringPointId} />

        <Button type="submit" variant="secondary" size="md" disabled={!canEstimate || isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          Erzeugung schätzen
        </Button>

        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Die Erzeugung wird geschätzt …' : ''}
        </span>
      </form>

      {canEstimate ? (
        <p className="mt-2 max-w-prose text-caption text-text-muted">
          Gerechnet wird mit{' '}
          {arrayCount === 1 ? 'einer Modulfläche' : `${arrayCount} Modulflächen`} für den Zeitraum
          des Lastgangs von Zählpunkt {meteringPointNumber}. Der Abruf dauert einige Sekunden je
          Fläche.
        </p>
      ) : (
        <ul className="mt-2 flex max-w-prose flex-col gap-1">
          {!hasLoadPeriod && (
            <li className="text-caption text-text-muted">
              Es fehlt der Lastgang dieses Zählpunkts — die geschätzte Erzeugung deckt genau dessen
              Zeitraum ab.
            </li>
          )}
          {!hasArrays && (
            <li className="text-caption text-text-muted">
              Es ist noch keine Modulfläche erfasst (Nennleistung, Ausrichtung, Neigung).
            </li>
          )}
          {incompleteNumbers.length > 0 && (
            <li className="text-caption text-text-muted">
              {incompleteNumbers.length === 1
                ? `Fläche ${incompleteNumbers[0]} ist unvollständig erfasst.`
                : `Die Flächen ${incompleteNumbers.join(', ')} sind unvollständig erfasst.`}{' '}
              Es wird alles oder nichts gerechnet: eine Schätzung über die übrigen Flächen ergäbe
              einen zu niedrigen Ertrag, dem man das nicht ansieht.
            </li>
          )}
          {!hasPostalCode && (
            <li className="text-caption text-text-muted">
              Es fehlt die Postleitzahl des Projekts — sie steht direkt darüber.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
