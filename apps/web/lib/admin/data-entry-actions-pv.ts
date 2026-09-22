'use server'

import { revalidatePath } from 'next/cache'
import {
  MAX_PV_ARRAY_TEXT_CHARS,
  MAX_PV_DESIGN_FILE_BYTES,
  checkPvGeneratorEligibility,
  extractPvArrayText,
  extractPvDesign,
  generateEstimatedPvSeries,
  readPvProfile,
  type PvGeneratorEligibilityOutcome,
} from 'extractors'
import {
  MAX_PROJECT_DOCUMENT_BYTES,
  pvDesignArrayPrefill,
  lookupPostalCodeCentroid,
  type CompassDirection,
  type PvDesignArrayPrefill,
  type PvStage,
} from 'shared'
import { readProjectDocument, uploadProjectDocument } from '@/lib/project-documents/documents'
import { setDraftField } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import { readMeteringPointList } from './metering-points'
import {
  PV_ARRAY_DIRECTION_FORM_FIELD,
  PV_ARRAY_NUMBER_FIELDS,
  compassDirectionLabel,
  formatPvArrayNumber,
  isCompassDirection,
  parsePvArrayNumber,
  pvArraysDraftIsEmpty,
  readPvArraysDraft,
  withPvArrays,
  type PvArrayEntry,
} from './pv-array-draft'
import { formatKwh, formatPercent } from './format'
import { PV_DRAFT_KEYS, PV_PRESENT_KEY, PV_STAGE_KEY } from './pv-draft'
import { combinePvArrayYields, splitPvArrayDesigns } from './pv-estimate'
import {
  hasPvProfile,
  pvGeneratedProfileDraftValues,
  pvProfileDraftValues,
  readPvProfileDraft,
  withPvProfileGaps,
} from './pv-profile-draft'
import { projectDataEntryHref, readAdminProject } from './projects'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'
import {
  FORBIDDEN,
  GENERIC,
  PDF_MEDIA_TYPE,
  UNKNOWN_PROJECT,
  UUID,
  clearMeteringPointDraftFields,
  formatMegabytes,
  isForbidden,
  readProjectId,
  statusOf,
  writeMeteringPointDraftFields,
} from './data-entry-actions-shared'

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * B24, Teil 1 — die PV-STATION: eine Frage, ein Feld, ein Schreibvorgang
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * „Haben Sie bereits eine PV-Anlage?" — und mehr tut dieser Schritt nicht. Was im Ja-Zweig folgt
 * (welches Erzeugungsprofil vorliegt, ob es gemessen oder geschätzt werden muss), ist ein eigener
 * Bauabschnitt; es gibt hier keinen Upload, keinen PVGIS-Aufruf und keinen Extraktor.
 *
 * ⚠ BEIDE ANTWORTEN WERDEN GESPEICHERT, und das ist der Unterschied zur Batterie-Station. Dort
 * ist die Ja/Nein-Frage eine reine WEICHE in `useState` und erreicht keine Action; gespeichert
 * wird, was die Zweige DAHINTER erheben. Hier gibt es dahinter (noch) nichts zu erheben — die
 * Antwort selbst IST die Angabe. Als blosse Weiche geführt wäre sie nach jedem Neuladen weg, und
 * die Station stellte dieselbe Frage erneut, obwohl sie beantwortet ist.
 *
 * ⚠ DESHALB IST `false` EIN ECHTER WERT UND KEIN FEHLENDER SCHLÜSSEL. „Nein, keine PV-Anlage" ist
 * eine Aussage über den Betrieb und muss von „dazu wurde nichts gefragt" unterscheidbar bleiben —
 * derselbe Grund wie bei `wantsBatteryRecommendation`.
 *
 * KEIN `redirect`: der Zustand soll sichtbar bleiben (Regel dieser Datei, s. Kopf) — der Weg nach
 * vorn ist der „Weiter"-Knopf, den die Station selbst rendert.
 *
 * KEIN NEUER WRAPPER, KEINE MIGRATION: sie kommt mit denselben zweien aus wie die Batterie-Station
 * (`list_metering_points`, `update_metering_point_draft`) und löst keinen abrechenbaren Aufruf aus.
 */
export async function saveMeteringPointPvChoiceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ DREI ANTWORTEN, NICHT ZWEI — und die dritte ist der Grund dieses Umbaus (22.09.2026)
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Die Frage lautete „Haben Sie bereits eine PV-Anlage?" und nannte im Hinweistext ausdrücklich
   * auch die „fest bestellte" Anlage. Für den Rechenlauf sind das gegensätzliche Fälle: die
   * errichtete steckt im Lastgang schon als gesenkter Bezug, die bestellte nicht. Dieselbe Antwort
   * löste damit die falsche Behandlung des jeweils anderen Falls aus — Begründung in voller Länge
   * bei `PV_UPLOAD_DRAFT_KEYS.stage` (`shared`).
   *
   * ⚠ `'ja'` BLEIBT GÜLTIG und bedeutet `existing`. Ein Zählpunkt, der vor dieser Änderung
   * beantwortet wurde, trägt keine Stufe und wird genauso gelesen (`DEFAULT_PV_STAGE`); die alte
   * Antwort behält also ihre Bedeutung, statt still umgedeutet zu werden.
   */
  const answer = String(formData.get(PV_PRESENT_KEY) ?? '')
  if (answer !== 'ja' && answer !== 'geplant' && answer !== 'nein') {
    // Erreichbar nur an den drei Knöpfen vorbei — die schicken feste Werte.
    return { formError: GENERIC }
  }
  const has = answer !== 'nein'
  const stage: PvStage = answer === 'geplant' ? 'planned' : 'existing'

  /*
   * ⚠ BEIDE FELDER IN EINEM SCHREIBVORGANG. Getrennt geschrieben gäbe es einen Zustand, in dem
   * `hasPv: true` ohne Stufe dasteht — und der wird als `existing` gelesen. Ein abgebrochener
   * zweiter Schreibvorgang machte aus einer geplanten Anlage also still eine bestehende.
   */
  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    has
      ? [
          { field: PV_PRESENT_KEY, value: true },
          { field: PV_STAGE_KEY, value: stage },
        ]
      : [{ field: PV_PRESENT_KEY, value: false }],
    'PV-Anlage',
  )
  if (failure) return failure

  if (!has) return { success: 'Vermerkt: Es gibt keine PV-Anlage.' }
  return {
    success:
      stage === 'existing'
        ? 'Vermerkt: Die PV-Anlage ist bereits in Betrieb — ihre Erzeugung steckt im Lastgang.'
        : 'Vermerkt: Die PV-Anlage ist geplant — ihre Wirkung wird für die Analyse geschätzt.',
  }
}

/**
 * Der Rückweg: ALLE PV-Angaben eines Zählpunkts entfernen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM ES DIESEN WEG ÜBERHAUPT GIBT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Kopf von `data-entry-pv.tsx` benennt den Zustand, den es aufzulösen gilt, im Klartext: „Wer
 * nachträglich von Ja auf Nein wechselt, sieht die eingelesenen Angaben nicht mehr — im Entwurf
 * stehen sie trotzdem weiter." Genau dieser Weg IST der dort angekündigte Entfernen-Weg. Damit
 * entfällt zugleich der Grund, aus dem die Ja/Nein-Frage bisher auch nach ihrer Beantwortung
 * stehenblieb: sie war die einzige verbliebene Möglichkeit, in den anderen Zweig zu kommen.
 *
 * ── ⚠ ALLE PV-SCHLÜSSEL, NICHT NUR `hasPv` ────────────────────────────────────────────────────
 * Gelöscht wird `PV_DRAFT_KEYS` (aus `pv-draft.ts` abgeleitet — hier steht bewusst keine zweite
 * Liste): die Antwort auf die Frage, die Modulflächen UND alle zehn Schlüssel des
 * Erzeugungsprofils. Nur `hasPv` zu entfernen wäre der teuerste Halbschritt: der Zählpunkt trüge
 * danach einen Zeitraum, ein Intervall, eine geschätzte Jahreserzeugung samt Streuung und eine
 * Liste von Modulflächen — zu einer Anlage, von der er selbst nicht mehr behauptet, dass es sie
 * gibt. Die Station stellte ihre Frage erneut, und jede Angabe darunter wäre für jeden späteren
 * Leser eine Aussage ohne Gegenstand. Gelöscht heisst: die Station ist wieder unbeantwortet.
 *
 * ── ⚠ DIE HOCHGELADENE DATEI BLEIBT IN DER ABLAGE ─────────────────────────────────────────────
 * Entfernt wird der VERWEIS (`pvSourceDocumentId`), nicht das Dokument. Dieselbe Entscheidung und
 * dieselbe Begründung wie beim Entfernen einer einzelnen Rechnung: ein Löschweg für ein
 * Projekt-Dokument ist an den Zählpunkt gebunden und an den LASTGANG (`admin_delete_metering_point_document`
 * verlangt, dass kein Zählpunkt das Dokument mehr als Quelle führt) — ihn hier mitzuziehen hiesse,
 * einen zweiten, PV-eigenen Storage-Aufräumweg zu bauen, samt der Reihenfolge-Entscheidung
 * „erst die Datei, dann die Zeile" ein zweites Mal. Die Datei bleibt damit in der Dokumentenliste
 * des Projekts sichtbar; ein neuer Upload legt sie ohnehin neu an.
 *
 * ── ES GIBT KEIN PROTOKOLL ────────────────────────────────────────────────────────────────────
 * Wortgleich zur Batterie-Station: zurückgenommen wird eine Angabe zu EINEM Zählpunkt EINES
 * Projekts, die derselbe Mensch selbst eingetragen hat. Ein Abzug dafür wäre eine Spur, die
 * niemand liest.
 *
 * @returns Immer ein Zustand für das Formular — geschrieben wird über den geteilten Rahmen.
 */
export async function deleteMeteringPointPvAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const failure = await clearMeteringPointDraftFields(
    projectId,
    meteringPointId,
    PV_DRAFT_KEYS,
    'PV löschen',
  )
  if (failure) return failure

  return { success: 'PV-Angaben vollständig gelöscht.' }
}

// ── PV-Erzeugungsreihe ───────────────────────────────────────────────────────────────────────────
/**
 * Die WIRKSAME Grössengrenze für eine PV-Erzeugungsdatei in diesem Wizard.
 *
 * ⚠ ES SIND ZWEI ZAHLEN IM SPIEL, UND DIE KLEINERE GEWINNT — wortgleich zum Lastgang-Schritt:
 * `MAX_PV_PROFILE_FILE_BYTES` (25 MB, `packages/extractors`) begrenzt, was der LESER verarbeitet;
 * `MAX_PROJECT_DOCUMENT_BYTES` (20 MB, `packages/shared`) begrenzt, was die ABLAGE annimmt. Die
 * Datei wird abgelegt, bevor ihre Metadaten in den Entwurf gehen — wirksam ist damit immer die
 * Ablage-Grenze, und nur die darf dem Admin genannt werden: 22 MB liefen sonst durch die Prüfung,
 * würden 22 MB lang geparst und scheiterten erst danach am Upload.
 */
const MAX_PV_PROFILE_BYTES = MAX_PROJECT_DOCUMENT_BYTES

/** Für die Meldung am Feld — ganze Megabyte, weil die Grenze eine ganze Zahl ist. */
const MAX_PV_PROFILE_MB = Math.floor(MAX_PV_PROFILE_BYTES / (1024 * 1024))

/**
 * Liest eine PV-Erzeugungsdatei ein und schreibt die gelesenen Metadaten in den Entwurf des
 * Zählpunkts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIESELBE REIHENFOLGE WIE BEIM LASTGANG: ERST LESEN, DANN ABLEGEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. Grösse prüfen (rein, kein Netz)
 *   2. `readPvProfile` — DETERMINISTISCH, kein Modellaufruf, kein Nebeneffekt
 *   3. erst jetzt `uploadProjectDocument` (Bytes + Zeile in `platform.project_documents`)
 *   4. Entwurf FRISCH lesen, Lücken + Skalare hineinfalten, EINMAL schreiben
 *
 * Die naheliegende Reihenfolge wäre „hochladen, dann lesen". Sie ist hier falsch, und der Grund ist
 * derselbe wie beim Lastgang: **es gibt keinen Weg, ein eingetragenes Dokument wieder zu
 * entfernen** (kein Wrapper, kein Grant — TEIL 9 der Migration `20260910090000`; der Lastgang-Rückweg
 * ist ausdrücklich an den ZÄHLPUNKT gebunden und deckt diesen Fall nicht ab). Eine unlesbare Datei
 * hinterliesse damit dauerhaft eine Zeile in der Dokumentenliste, die zu nichts gehört. Gelesen
 * wird sie ohnehin vollständig im Speicher — das Ablegen davor spart nichts.
 *
 * ⚠ WAS ZWISCHEN SCHRITT 3 UND 4 SCHIEFGEHEN KANN, BLEIBT STEHEN: ein abgelegtes Dokument ohne
 * Zuordnung. Der bewusst in Kauf genommene Rest, dieselbe Klasse wie beim Lastgang und im Chat —
 * eine Datei zu viel im Projekt ist die harmlose Richtung.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE BENUTZT `writeMeteringPointDraftFields` NICHT, und das ist eine Entscheidung
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der geteilte Schreibweg faltet eine Liste SKALARER Felder (`DraftValue` = number|string|boolean).
 * Hier kommt eine LISTE dazu (die Lücken), und beides muss in EINEN Schreibvorgang: Zeitraum und
 * Lücken sind die Auswertung derselben Datei, und getrennt geschrieben gäbe es einen Zustand, in
 * dem die eine Angabe zu einer anderen Datei gehört als die andere. Dazu kommt die Meldung für
 * „Zählpunkt weg": nach einem erfolgten Upload muss sie sagen, dass die Datei abgelegt IST — der
 * allgemeine Satz des Helfers verschwiege genau das. Denselben Weg geht der Rechnungs-Upload
 * nebenan, aus denselben zwei Gründen.
 *
 * ⚠ SIE SCHREIBT KEIN `hasPv`. Die Frage „Gibt es eine PV-Anlage?" wird an genau EINER Stelle
 * beantwortet (`saveMeteringPointPvChoiceAction`), und der Upload erscheint ohnehin nur in deren
 * Ja-Zweig. Sie hier ein zweites Mal zu beantworten wäre ein zweites Signal für dieselbe Aussage —
 * und das erste, das beim nächsten Umbau dem anderen widerspricht.
 *
 * ⚠ ES WIRD NICHT UMGELEITET — Regel dieser Datei (s. Kopf): Zeitraum, Intervall und Lücken sind
 * das Einzige, woran ein Mensch erkennt, ob die richtige Datei hochgeladen wurde.
 */
export async function uploadMeteringPointPvProfileAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  // Kommt wie die Projekt-Kennung als verstecktes Feld aus unserer eigenen Seite.
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: 'Bitte eine Datei auswählen.' } }
  }
  if (file.size > MAX_PV_PROFILE_BYTES) {
    return {
      fieldErrors: {
        file:
          `Diese Datei ist zu gross (${formatMegabytes(file.size)} MB). ` +
          `Mehr als ${MAX_PV_PROFILE_MB} MB nimmt der Wizard nicht an. ` +
          `Es wurde nichts hochgeladen und nichts gespeichert.`,
      },
    }
  }

  const bytes = await file.arrayBuffer()

  // ── Schritt 2: lesen. Rein, deterministisch, ohne Nebeneffekt — s. Kopf.
  const outcome = readPvProfile(bytes, file.name)

  if (!outcome.ok) {
    /*
     * Unerreichbar, solange `MAX_PV_PROFILE_BYTES <= MAX_PV_PROFILE_FILE_BYTES` gilt (die Prüfung
     * oben greift vorher). Trotzdem behandelt statt ignoriert: die zwei Konstanten liegen in zwei
     * Paketen, und wer die eine hebt, soll hier keine unbeantwortete Antwort vorfinden.
     */
    return {
      fieldErrors: {
        file:
          `Diese Datei ist zu gross. Mehr als ${MAX_PV_PROFILE_MB} MB nimmt der Wizard nicht an. ` +
          `Es wurde nichts hochgeladen und nichts gespeichert.`,
      },
    }
  }

  const scan = outcome.scan
  if (!scan.ok) {
    /*
     * Der Leser hat die Datei abgelehnt — leer, kein erkennbarer Zeitstempel, keine Wert-Spalte,
     * falsches Intervall. Seine Meldung ist deutsch und fertig formuliert; sie hier durch einen
     * eigenen Satz zu ersetzen nähme dem Admin genau die Auskunft, die sagt, WAS an der Datei
     * nicht stimmt.
     */
    return {
      fieldErrors: {
        file: `${scan.error.message} Es wurde nichts hochgeladen und nichts gespeichert.`,
      },
    }
  }

  // ── Schritt 3: ablegen. Die Eigentumsfrage beantwortet dabei die DATENBANK (`get_project`).
  const upload = await uploadProjectDocument(projectId, {
    name: file.name,
    /*
     * ⚠ `content_type` ist eine ANGABE des Browsers, kein Beweis — und für CSV meldet er
     * regelmässig `application/vnd.ms-excel`. Der Leser oben hat deshalb am DATEINAMEN entschieden,
     * nicht hieran. Ein leerer Typ kommt real vor und würde von `uploadProjectDocument` als
     * `invalid_file` abgewiesen; derselbe neutrale Rückfall wie beim Lastgang.
     */
    type: file.type.trim() === '' ? 'application/octet-stream' : file.type,
    bytes,
  })

  if (!upload.ok) {
    if (upload.reason === 'not_found') return { formError: UNKNOWN_PROJECT }
    console.error('[admin/dateneingabe] uploadProjectDocument (PV-Profil):', upload.reason)
    return { formError: GENERIC }
  }

  /*
   * ── Schritt 4: Entwurf FRISCH lesen und EINMAL schreiben ────────────────────────────────────
   * `update_metering_point_draft` ERSETZT den Entwurf (bewusst — eine flache Verschmelzung könnte
   * einen Schlüssel nie wieder entfernen). Ein Stand aus der Zeit des Seitenaufbaus machte jede
   * Angabe rückgängig, die seither dazugekommen ist, etwa eine in einem zweiten Tab hochgeladene
   * Rechnung.
   */
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (PV-Profil):', listRes.error)
    return { formError: GENERIC }
  }

  const point = readMeteringPointList(listRes.data)?.find(
    (candidate) => candidate.id === meteringPointId,
  )
  if (!point) {
    return {
      formError:
        'Diesen Zählpunkt gibt es nicht (mehr). Die Datei ist im Projekt abgelegt, aber keinem ' +
        'Zählpunkt zugeordnet. Bitte laden Sie die Seite neu.',
    }
  }

  /*
   * Die Lücken als Seiteneintrag, die vier Skalare über `setDraftField` — beides in EINEM Objekt
   * und damit in EINEM Schreibvorgang (s. Kopf).
   *
   * `measured`: jede dieser Angaben ist aus der Datei GELESEN, nicht geschätzt. Eine Notiz gibt es
   * nicht — sie ist für Schätzungen da („geschätzt aus 3 Personen"), und eine Ablesung braucht
   * keine Begründung.
   */
  let nextDraft = withPvProfileGaps(point.draft, scan.gaps)
  const now = new Date()
  for (const { field, value } of pvProfileDraftValues(scan, upload.documentId)) {
    nextDraft = setDraftField(nextDraft, field, value, 'measured', undefined, now)
  }

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Entwurf-Schreibwegen: zur Laufzeit dasselbe.
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (PV-Profil):', draftRes.error)
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (PV-Profil):', draftRes.data)
    return { formError: GENERIC }
  }

  // ⚠ Ohne das bliebe die Zusammenfassung unsichtbar — s. die Begründung beim Lastgang-Upload.
  revalidatePath(projectDataEntryHref(projectId))

  return { success: 'Erzeugungsprofil eingelesen und gespeichert.' }
}

// ── PV-Anlagendaten ──────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die ANLAGENDATEN einer vorhandenen PV-Anlage: Nennleistung, Ausrichtung, Neigung.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WOZU — UND WARUM ES NICHT DAS ERZEUGUNGSPROFIL ERSETZT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Ja-Zweig der PV-Station nimmt eine gemessene Erzeugungsreihe entgegen. Die gibt es aber nur,
 * wo ein Wechselrichter-Portal sie hergibt — der häufigere Fall ist: die Anlage existiert, eine
 * Zeitreihe existiert nicht. Dafür braucht das PVGIS-Verfahren (B22) genau drei Angaben neben dem
 * Standort: kWp, Ausrichtung, Neigung.
 *
 * ⚠ SIE ERSCHEINEN DESHALB NUR, SOLANGE KEIN EIGENES PROFIL VORLIEGT (`hasPvProfile`, s. die
 * Station). Wer gemessene Werte hat, braucht keine geschätzte Kurve — und zwei Erzeugungsquellen
 * nebeneinander wären zwei Wahrheiten über dieselbe Anlage.
 *
 * ⚠ ES WIRD IN DIESEM SCHRITT NICHTS GERECHNET: kein PVGIS-Abruf, keine erzeugte Kurve. Die drei
 * Angaben landen im Entwurf, mehr nicht. Der Generator ist ein eigener Bauabschnitt.
 *
 * ── DREI ACTIONS, UND NUR EINE DAVON SCHREIBT ─────────────────────────────────────────────────
 * `extractPvArrayTextAction` (ein Satz in eigenen Worten) und `scanPvDesignAction` (ein
 * PDF-Datenblatt) lesen und geben Formularwerte zurück; `saveMeteringPointPvArrayAction` schreibt.
 * Zwischen dem Gelesenen und dem Gespeicherten steht damit ein zweiter, eigener Klick — dasselbe
 * Muster wie bei der Batterie-Station und aus demselben Grund: der Vorschlag ist eine ANGEFORDERTE
 * Auskunft, was damit geschieht, entscheidet ein Mensch.
 *
 * ⚠ BEIDE LESE-WEGE LIEFERN DIESELBEN DREI FELDNAMEN (`peakPowerKwp`, `direction`, `slopeDeg`) —
 * per Typ aneinander gebunden in `pv-array-draft.ts`. Sie füllen deshalb dieselben Formularfelder
 * und übergeben an denselben „Speichern"-Knopf; es gibt genau EINEN Ort, an dem eine
 * PV-Anlagenangabe in den Entwurf gelangt.
 */

/** Warum ein Freitext nicht ausgelesen werden konnte — die Zustände des Extraktors, in einem Satz. */
const PV_ARRAY_TEXT_FAILURE_TEXT: Record<'not_configured' | 'api_error' | 'unreadable', string> = {
  not_configured:
    'Das Auslesen freier Angaben ist auf diesem Server nicht eingerichtet. Die drei Felder lassen sich trotzdem von Hand ausfüllen.',
  api_error:
    'Das Auslesen ist fehlgeschlagen. Bitte später noch einmal versuchen — oder die drei Felder von Hand ausfüllen.',
  unreadable:
    'Aus dieser Angabe liessen sich keine Anlagendaten lesen. Nötig sind die Nennleistung in kWp, die Himmelsrichtung als Wort und die Dachneigung in Grad.',
}

/**
 * Liest die drei Anlagendaten aus einem frei formulierten Satz und gibt sie als Formularwerte zurück.
 *
 * ⚠ SIE SCHREIBT NICHTS — s. Kopf dieses Abschnitts.
 *
 * ⚠ DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Eine Server Action ist über ihre Kennung
 * aufrufbar, und jeder Aufruf ist abrechenbar — die Kürzung auf `MAX_PV_ARRAY_TEXT_CHARS` und die
 * Leerprüfung sind deshalb eine echte Sperre, keine Bedienhilfe (das `maxlength` des Textfelds ist
 * eine Angabe des Browsers).
 */
export async function extractPvArrayTextAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const text = String(formData.get('pvArrayText') ?? '').trim()
  if (text === '') {
    return {
      fieldErrors: {
        pvArrayText: 'Bitte die Anlage kurz beschreiben — oder die Felder von Hand ausfüllen.',
      },
    }
  }

  const outcome = await extractPvArrayText(text.slice(0, MAX_PV_ARRAY_TEXT_CHARS))
  if (!outcome.ok) return { formError: PV_ARRAY_TEXT_FAILURE_TEXT[outcome.reason] }

  const values = pvArrayFormValues(outcome.extraction)
  /*
   * ⚠ TIEFENSTAFFELUNG, heute unerreichbar — und als solche benannt statt als Prüfung getarnt.
   * Der Extraktor meldet `unreadable`, sobald alle drei Felder leer sind, und es sind GENAU die
   * drei, die hier gezählt werden. Erreichbar würde der Zweig, sobald die Extraktion um ein Feld
   * wächst, das kein Formularfeld ist (bei der Batterie ist `hasExistingBattery` genau dieser
   * Fall). Dann leerte ein `ok` ohne Zahl die Felder und behauptete dabei, es habe etwas gelesen.
   */
  if (values.found === 0) return { formError: PV_ARRAY_TEXT_FAILURE_TEXT.unreadable }

  return { values: { ...values.fields, extraction: 'ok', found: String(values.found) } }
}

/**
 * Die drei Formularwerte aus einer gelesenen Fläche — für BEIDE Lese-Wege dieselbe Zuweisung.
 *
 * ⚠ ALLE DREI FELDER WERDEN GESETZT, auch die nicht gelesenen (als Leerstring). Ein nicht gelesenes
 * Feld stehen zu lassen hiesse, einen Wert aus einer FRÜHEREN Ablesung neben frischen stehen zu
 * haben, ohne dass man die beiden unterscheiden kann. Was hier erscheint, ist die Aussage GENAU
 * DIESER Quelle. Der Preis ist benannt und in der Oberfläche ausgeschrieben: eine von Hand
 * eingetippte Zahl verliert man mit einem zweiten Klick auf „Auslesen".
 *
 * ⚠ Der Parameter ist STRUKTURELL getypt und nicht auf eine der beiden Quellen festgelegt:
 * `PvArrayTextExtraction` und `PvDesignArrayPrefill` erfüllen beide diese Form — genau das ist der
 * Zuschnitt (ein Formular, zwei Quellen). Eine zweite Zuweisung daneben liefe beim nächsten Umbau
 * auseinander.
 */
function pvArrayFormValues(source: {
  peakPowerKwp: number | null
  direction: CompassDirection | null
  slopeDeg: number | null
}): { fields: Record<string, string>; found: number } {
  const fields: Record<string, string> = {}
  let found = 0

  for (const entry of PV_ARRAY_NUMBER_FIELDS) {
    const value = source[entry.form]
    if (value === null) {
      fields[entry.form] = ''
      continue
    }
    fields[entry.form] = formatPvArrayNumber(value)
    found += 1
  }

  fields[PV_ARRAY_DIRECTION_FORM_FIELD] = source.direction ?? ''
  if (source.direction !== null) found += 1

  return { fields, found }
}

/**
 * Wie viele Modulflächen aus EINEM Dokument höchstens zur Auswahl gestellt werden.
 *
 * ⚠ SIE IST LOKAL UND WIRD NICHT EXPORTIERT — diese Datei trägt `'use server'`, und dort darf
 * ausschliesslich Asynchrones exportiert werden. Ein Test kann die Zahl deshalb nicht importieren
 * und misst stattdessen das VERHALTEN (die Obergrenze greift, `truncated` wird gesetzt, ein
 * kleineres Dokument bleibt unbeschnitten) — s. `data-entry-actions.test.ts`.
 *
 * ⚠ DIESELBE ZAHL FÜHRT DER ÖFFENTLICHE RECHNER (`apps/website`, `MAX_ARRAYS`) — dort ebenfalls
 * lokal und nicht importierbar. Die zwei sind bewusst NICHT aneinander gebunden: die beiden Apps
 * importieren einander nirgends, und eine gemeinsame Konstante allein für diese Zahl wäre die erste
 * Abhängigkeit zwischen ihnen. Laufen sie je auseinander, kostet das eine Fläche mehr oder weniger
 * in der Auswahl — keine Zahl in einer Rechnung.
 *
 * Sechs, weil das die Grössenordnung eines realen Daches ist (Ost/West, Vorbau, Nebendach). Mehr
 * Flächen sind kein Fehler; sie werden nur nicht alle auf einmal angeboten, und dass es mehr waren,
 * steht im Klartext daneben.
 */
const MAX_PV_DESIGN_CANDIDATES = 6

/** Warum ein Datenblatt nicht gelesen werden konnte — die Zustände des Extraktors, in einem Satz. */
const PV_DESIGN_FAILURE_TEXT: Record<'not_configured' | 'api_error' | 'unreadable', string> = {
  not_configured:
    'Das Auslesen von Auslegungen ist auf diesem Server nicht eingerichtet. Die drei Felder lassen sich trotzdem von Hand ausfüllen.',
  api_error:
    'Das Auslesen ist fehlgeschlagen. Bitte später noch einmal versuchen — oder die drei Felder von Hand ausfüllen.',
  unreadable:
    'Auf diesem Dokument war keine Modulfläche zu finden — das kann an der Bildqualität liegen, aber auch daran, dass es keine PV-Auslegung ist.',
}

/**
 * Liest die Anlagendaten aus einem Auslegungsdokument (PV*SOL, PVsyst, Hersteller-Konfigurator).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HIER SITZT DIE TEUERSTE VERWECHSLUNG DES GANZEN ABSCHNITTS — UND SIE IST NICHT HIER GELÖST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PV*SOL zählt den Azimut vom NORDEN, PVGIS vom SÜDEN. „Ausrichtung Südosten 133 °" ist als
 * PVGIS-Wert −47; ungeprüft übernommen zeigt die Anlage nach Nordwesten, und die
 * Eigenverbrauchs-Ersparnis fällt gemessen um 56 % — bei einer Zahl, die völlig plausibel aussieht.
 *
 * Aufgelöst wird das NICHT in dieser Action, sondern in `pvDesignArrayPrefill`
 * (`packages/shared/src/pv-design-scan.ts`), und zwar nach einer Regel, die keine der beiden
 * Angaben bevorzugt: widersprechen sich gedruckte Gradzahl und genannte Himmelsrichtung, wird die
 * RICHTUNG vorbelegt (sie ist ein Wort und über alle Zählweisen hinweg eindeutig) und die ZAHL
 * nicht. Diese Action zeigt den Widerspruch dann im Klartext — mit beiden Werten, damit ein Mensch
 * entscheiden kann.
 *
 * ⚠ DIE GRADZAHL ERREICHT DEN ENTWURF NIE. Weder die passende noch die widersprüchliche: es gibt
 * für sie kein Entwurfs-Feld (s. Kopf von `pv-array-draft.ts`). Gespeichert wird ausschliesslich
 * die Himmelsrichtung.
 *
 * ── ⚠ SIE LIEFERT ALLE GEFUNDENEN FLÄCHEN, NICHT MEHR NUR DIE ERSTE ─────────────────────────
 * Ein Exposé führt regelmässig mehrere (das bekannte Prüfdokument zwei, mit 4,25 und 5,95 kWp).
 * Bis hierher wurde davon GENAU EINE angeboten — und die geschätzte Erzeugung fiele damit um jede
 * weitere Fläche zu niedrig aus, still: aus 10,2 kWp würden 4,25, und keine Zahl im Report sähe
 * deswegen falsch aus. Der Generator (B22) rechnet PRO Fläche und summiert; der Entwurf führt sie
 * seit dem vorigen Schritt als LISTE (`_pvArrays`). Was fehlte, war der Weg von einem Dokument mit
 * mehreren Flächen in diese Liste.
 *
 * ⚠ SIE WERDEN TROTZDEM NICHT ZUSAMMENGERECHNET. „10,2 kWp bei mittlerer Ausrichtung" wäre eine
 * gerechnete Zahl, die nirgends im Dokument steht — und bei zwei verschieden ausgerichteten
 * Flächen ist die Tagesform der Summe eine andere als die der gemittelten Fläche. Jede Fläche
 * bleibt ein eigener Kandidat und wird ein eigener Eintrag.
 *
 * ⚠ SIE ÜBERNIMMT NICHTS — auch jetzt nicht. Sie gibt Kandidaten zurück; welche davon in die Liste
 * wandern, entscheidet ein Mensch über Ankreuzfelder, und geschrieben wird ausschliesslich in
 * `addPvArraysFromScanAction`. Dieselbe Trennung wie vorher, nur mit einer Auswahl dazwischen.
 *
 * ⚠ HÖCHSTENS `MAX_PV_DESIGN_CANDIDATES` — und was darüber liegt, wird BENANNT (`truncated`).
 *
 * ── DIE PRÜFKETTE LÄUFT VOR JEDEM EXTERNEN KONTAKT ────────────────────────────────────────────
 * Leer, kein PDF, zu gross — alles drei ist rein und kostet nichts. Jeder Aufruf dahinter ist
 * abrechenbar; die Prüfungen sind eine echte Sperre und keine Bedienhilfe (das `accept` des
 * Dateifelds ist eine Angabe des Browsers).
 *
 * ── ⚠ DIE DATEI WIRD NICHT ABGELEGT ──────────────────────────────────────────────────────────
 * Dieselbe Entscheidung und dieselbe Begründung wie beim Batterie-Datenblatt: eine Auslegung ist ein
 * Planungsdokument, kein Beleg über den Verbrauch des Kunden. Gelesen wird es, gespeichert werden
 * die drei Angaben.
 */
export async function scanPvDesignAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const entry = formData.get('pvDesign')
  const file = entry instanceof File ? entry : null

  if (!file || file.size === 0) {
    return {
      fieldErrors: {
        pvDesign: 'Bitte eine Auslegung als PDF wählen — oder die Felder von Hand ausfüllen.',
      },
    }
  }
  /*
   * Der Medientyp kommt vom Browser und ist kein Beweis — die eigentliche Sperre ist, dass die API
   * den `document`-Block mit genau diesem Typ erwartet. Diese Prüfung fängt den ehrlichen Irrtum
   * ab, bevor er Geld kostet.
   */
  if (file.type !== PDF_MEDIA_TYPE) {
    return {
      fieldErrors: {
        pvDesign: 'Nur PDF — ein Foto oder Screenshot der Auslegung lässt sich nicht auslesen.',
      },
    }
  }
  if (file.size > MAX_PV_DESIGN_FILE_BYTES) {
    return {
      fieldErrors: {
        pvDesign:
          `Diese Datei ist zu gross (${formatMegabytes(file.size)} MB). Mehr als ` +
          `${Math.floor(MAX_PV_DESIGN_FILE_BYTES / (1024 * 1024))} MB nimmt der Scan nicht an.`,
      },
    }
  }

  const bytes = await file.arrayBuffer()
  const outcome = await extractPvDesign(Buffer.from(bytes).toString('base64'))
  if (!outcome.ok) return { formError: PV_DESIGN_FAILURE_TEXT[outcome.reason] }

  const all = outcome.extraction.arrays
  const candidates = all.slice(0, MAX_PV_DESIGN_CANDIDATES)
  /*
   * ⚠ TIEFENSTAFFELUNG: der Extraktor meldet `unreadable`, sobald die Liste leer ist
   * (`pvDesignExtractionIsEmpty` misst genau das). Der Zweig ist damit heute unerreichbar und steht
   * trotzdem — ohne ihn käme eine Antwort mit `candidateCount: '0'` heraus, und die Oberfläche
   * behauptete eine gelungene Ablesung ohne eine einzige Fläche.
   */
  if (candidates.length === 0) return { formError: PV_DESIGN_FAILURE_TEXT.unreadable }

  const fields: Record<string, string> = {
    extraction: 'ok',
    candidateCount: String(candidates.length),
    arrayCount: String(all.length),
  }
  let found = 0

  candidates.forEach((array, index) => {
    const prefill = pvDesignArrayPrefill(array, outcome.extraction.azimuthConvention)
    const values = pvArrayFormValues(prefill)
    found += values.found

    /*
     * ⚠ DER INDEX STEHT IM SCHLÜSSEL, UND ER TRENNT DURCH EINEN PUNKT. `AdminState.values` ist eine
     * flache `Record<string, string>` — mehrere Flächen passen dort nur nebeneinander, wenn jede
     * ihren eigenen Präfix trägt. Der Punkt macht eine Kollision mit den drei Kopf-Schlüsseln
     * (`extraction`, `candidateCount`, `arrayCount`, `truncated`) strukturell unmöglich.
     */
    for (const [key, value] of Object.entries(values.fields)) fields[`${index}.${key}`] = value

    const note = pvDesignDegreeNote(prefill)
    if (note !== null) fields[`${index}.degreeNote`] = note

    /*
     * Ungewöhnlich steile Neigung. Der Anlass ist gemessen und nicht erfunden: das bekannte
     * Prüfdokument nennt `Neigung 90 °` bei gleichzeitig `Einbausituation: Dachparallel`. Der
     * Widerspruch ist aus dem Dokument nicht auflösbar — der Wert wird angeboten (er kann echt
     * sein, eine Fassadenanlage) und sichtbar markiert. Er sperrt nichts.
     */
    if (prefill.steepSlope) fields[`${index}.steepSlope`] = '1'
  })

  /*
   * ⚠ DASS ES MEHR WAREN, WIRD GESAGT — nicht verschwiegen. Die Oberfläche bildet daraus einen Satz
   * mit der Zahl der NICHT gezeigten Flächen (`arrayCount` minus `candidateCount`); ein stilles
   * Abschneiden wäre genau der Fehler, gegen den dieser Abschnitt sonst überall gebaut ist — aus
   * zehn Flächen würden sechs, und keine Zahl im Report sähe deswegen falsch aus.
   */
  if (all.length > candidates.length) fields.truncated = '1'

  if (found === 0) {
    return {
      formError:
        'Aus diesem Dokument liessen sich zu keiner der gefundenen Flächen Anlagendaten ' +
        'übernehmen. Bitte Nennleistung, Ausrichtung und Neigung von Hand eintragen.',
    }
  }

  return { values: fields }
}

/**
 * Der Hinweis zur gedruckten Gradzahl — oder `null`, wenn es nichts zu sagen gibt.
 *
 * ⚠ ER WIRD HIER FORMULIERT UND NICHT VOM MODELL GELIEFERT — „kein Freitextfeld in der Rückgabe"
 * gilt in allen Anbindungen; eine Begründung des Modells über die eigene Sicherheit erschiene als
 * Auskunft des Rechners.
 *
 * Er nennt BEIDE Werte, weil ein Mensch nur damit entscheiden kann, welcher der richtige ist: die
 * gedruckte Zahl, was sie als Kompassrichtung bedeutete, und die Richtung, die das Dokument
 * daneben ausschreibt.
 *
 * ⚠ EIGENE FUNKTION, SEIT ES MEHRERE FLÄCHEN SIND: der Hinweis gilt JE FLÄCHE. Im Rumpf der
 * Schleife ausgeschrieben stünde er zwischen Feldzuweisung und Zählung und wäre als Ganzes nicht
 * mehr lesbar; der Wortlaut selbst ist unverändert.
 */
function pvDesignDegreeNote(prefill: PvDesignArrayPrefill): string | null {
  if (prefill.degreeConflict) {
    const { printedDeg, candidateCompassDeg, direction } = prefill.degreeConflict
    return (
      `Das Dokument nennt ${formatPvArrayNumber(printedDeg)}° und zugleich die Richtung ` +
      `„${compassDirectionLabel(direction)}". Gelesen als Kompassgrad wären ` +
      `${formatPvArrayNumber(candidateCompassDeg)}° — das passt nicht zusammen. Übernommen ist ` +
      'die Himmelsrichtung (sie ist eindeutig, eine Gradzahl hängt an der Zählweise des ' +
      'Programms); die Zahl wurde bewusst nicht übernommen. Bitte die Ausrichtung prüfen.'
    )
  }
  if (prefill.unverifiedDeg !== null) {
    return (
      `Das Dokument nennt ${formatPvArrayNumber(prefill.unverifiedDeg)}° als Ausrichtung, aber ` +
      'keine Himmelsrichtung dazu. Ob die Zahl vom Norden oder vom Süden gezählt ist, steht nicht ' +
      'darin — die beiden Lesarten liegen 180° auseinander. Sie wurde deshalb nicht übernommen; ' +
      'bitte die Himmelsrichtung selbst wählen.'
    )
  }
  return null
}

/**
 * Der Speichern-Weg: EINE — ggf. von Hand angepasste — Modulfläche ZUR LISTE HINZUFÜGEN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE HÄNGT AN, SIE ÜBERSCHREIBT NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bis hierher schrieb dieselbe Action drei Skalarfelder, und ein zweiter Klick nahm den ersten
 * zurück. Eine Anlage hat aber regelmässig mehrere Flächen (Ost/West, Vorbau), und der Generator
 * rechnet PRO Fläche und summiert — mit nur einer erfassten Fläche fiele die geschätzte Erzeugung
 * systematisch zu niedrig aus, ohne dass irgendeine Zahl deswegen falsch aussähe. Die Flächen
 * stehen deshalb als LISTE im Entwurf (`_pvArrays`, s. `pv-array-draft.ts`).
 *
 * ── DIE REIHENFOLGE ────────────────────────────────────────────────────────────────────────────
 *   1. alle gefüllten Felder prüfen (ein Fehler bricht VOR jedem Schreibvorgang ab — eine halb
 *      übernommene Fläche wäre der Zustand, den niemand nachvollziehen kann)
 *   2. Entwurf FRISCH lesen (`list_metering_points`) — `update_metering_point_draft` ERSETZT ihn,
 *      und ein Stand aus der Zeit des Seitenaufbaus machte jede Angabe rückgängig, die inzwischen
 *      dazugekommen ist (auch die Fläche, die ein zweiter Tab gerade angehängt hat)
 *   3. die neue Fläche ANHÄNGEN und EINMAL schreiben
 *
 * ── EIN LEERES FELD IST KEINE ANGABE, ABER ES VERHINDERT DIE FLÄCHE NICHT ─────────────────────
 * Es wird als `null` im Eintrag geführt: die Fläche gibt es, diese eine Angabe zu ihr fehlt. Das
 * ist etwas anderes als beim vorigen Skalar-Stand, wo ein leeres Feld einen bereits erfassten Wert
 * unberührt liess — hier entsteht ein NEUER Eintrag, es gibt für ihn nichts zu schonen.
 *
 * ⚠ OHNE EINE EINZIGE ANGABE WIRD NICHTS ANGEHÄNGT. Ein Eintrag aus drei `null` wäre keine Fläche,
 * sondern eine Zeile in der Zusammenfassung ohne jeden Inhalt — `readPvArraysDraft` überspränge ihn
 * ohnehin, und eine Erfolgsmeldung darüber wäre eine Zusage ohne Inhalt.
 *
 * ⚠ ES GIBT (NOCH) KEINEN WEG, EINE EINZELNE FLÄCHE WIEDER ZU ENTFERNEN — eigener Auftrag,
 * benannt statt verschwiegen. Bis dahin ist ein Fehlgriff nur über einen Eingriff am `jsonb`
 * zurückzunehmen.
 *
 * ⚠ ES WIRD NICHT UMGELEITET — Regel dieser Datei (s. Kopf): der übernommene Stand ist das
 * Einzige, woran ein Mensch erkennt, ob die richtigen Werte angekommen sind.
 */
export async function saveMeteringPointPvArrayAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const fieldErrors: Record<string, string> = {}
  const numbers: Partial<Record<'peakPowerKwp' | 'slopeDeg', number>> = {}
  let found = 0

  for (const entry of PV_ARRAY_NUMBER_FIELDS) {
    const parsed = parsePvArrayNumber(String(formData.get(entry.form) ?? ''), entry)
    if (parsed === undefined) continue
    if (parsed === null) {
      fieldErrors[entry.form] =
        entry.min === undefined
          ? `Bitte eine Zahl grösser als 0 und höchstens ${entry.max} eintragen, z. B. 9,8.`
          : `Bitte eine Zahl zwischen ${entry.min} und ${entry.max} eintragen, z. B. 30.`
      continue
    }
    numbers[entry.form] = parsed
    found += 1
  }

  /*
   * Die Himmelsrichtung. Ein leeres Feld heisst „keine Angabe" (die Auswahl trägt dafür einen
   * eigenen, leeren Eintrag) — ein UNBEKANNTER Wert dagegen kann nur an der Auswahl vorbei
   * entstehen und wird benannt, statt still verworfen zu werden.
   */
  let direction: CompassDirection | null = null
  const directionRaw = String(formData.get(PV_ARRAY_DIRECTION_FORM_FIELD) ?? '').trim()
  if (directionRaw !== '') {
    if (!isCompassDirection(directionRaw)) {
      fieldErrors[PV_ARRAY_DIRECTION_FORM_FIELD] = 'Diese Himmelsrichtung kennen wir nicht.'
    } else {
      direction = directionRaw
      found += 1
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  if (found === 0) {
    return {
      formError: 'Bitte mindestens eine Angabe eintragen.',
    }
  }

  const added: PvArrayEntry = {
    peakPowerKwp: numbers.peakPowerKwp ?? null,
    direction,
    slopeDeg: numbers.slopeDeg ?? null,
  }

  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (PV-Anlagendaten):', listRes.error)
    return { formError: GENERIC }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  const arrays = [...readPvArraysDraft(point.draft), added]

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Listen-Schreibwegen: zur Laufzeit dasselbe, TypeScript kann
    // es nur nicht wissen.
    p_draft: withPvArrays(point.draft, arrays) as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error(
      '[admin/dateneingabe] update_metering_point_draft (PV-Anlagendaten):',
      draftRes.error,
    )
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (PV-Anlagendaten):', draftRes.data)
    return { formError: GENERIC }
  }

  // ⚠ Ohne das bliebe die angehängte Fläche unsichtbar — s. die Begründung beim Lastgang-Upload.
  revalidatePath(projectDataEntryHref(projectId))

  return {
    success:
      arrays.length === 1
        ? 'Fläche hinzugefügt. Es ist jetzt eine Fläche erfasst.'
        : `Fläche hinzugefügt. Es sind jetzt ${arrays.length} Flächen erfasst.`,
  }
}

/**
 * Der Datenblatt-Weg: die AUSGEWÄHLTEN gelesenen Modulflächen GEMEINSAM zur Liste hinzufügen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE IST DAS GEGENSTÜCK ZU `scanPvDesignAction` — DIE LESENDE SEITE SCHREIBT NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Scan gibt Kandidaten zurück, diese Action schreibt sie. Zwischen beidem steht ein Mensch mit
 * Ankreuzfeldern: ein Exposé führt regelmässig Flächen, die zu dieser Anlage gar nicht gehören
 * (eine geplante Erweiterung, eine Variante, das Nachbargebäude im selben Projekt). Sie alle
 * ungefragt anzuhängen wäre dieselbe stille Verfälschung wie das frühere Abschneiden auf die erste
 * — nur mit umgekehrtem Vorzeichen.
 *
 * ── ⚠ DIE WERTE KOMMEN AUS DEM BROWSER UND WERDEN DESHALB ERNEUT GEPRÜFT ──────────────────────
 * Sie stammen zwar aus unserer eigenen Ablesung, reisen aber als versteckte Felder durch das
 * Formular — eine Server Action ist über ihre Kennung aufrufbar, und was hereinkommt, ist eine
 * BEHAUPTUNG. Geprüft wird mit denselben Helfern wie beim Hand-Weg (`parsePvArrayNumber`,
 * `isCompassDirection`), damit es für eine gespeicherte Fläche genau eine Gültigkeitsregel gibt.
 *
 * ⚠ EIN UNBRAUCHBARER WERT WIRD HIER ZU `null` UND NICHT ZU EINEM FELDFEHLER — bewusst anders als
 * im Hand-Weg. Dort tippt ein Mensch, kann die Meldung lesen und den Wert richtigstellen; hier
 * gehört das Feld zu einer Zeile, die er gar nicht bearbeiten kann. Ein Feldfehler auf einem
 * versteckten Eingabefeld wäre eine Aufforderung ohne Adressaten. Die Vorschau zeigt vor dem Klick
 * im Klartext, was übernommen wird; die Zusammenfassung danach, was angekommen ist.
 *
 * ⚠ EINE AUSGEWÄHLTE FLÄCHE OHNE EINE EINZIGE ANGABE WIRD ÜBERSPRUNGEN. Ein Eintrag aus drei `null`
 * wäre keine Fläche, sondern eine Zeile in der Zusammenfassung ohne jeden Inhalt — `readPvArraysDraft`
 * überspränge ihn ohnehin. Bleibt dadurch GAR NICHTS übrig, wird das gesagt und nicht als Erfolg
 * gemeldet.
 *
 * ── DIE REIHENFOLGE, WORTGLEICH ZUM HAND-WEG ─────────────────────────────────────────────────
 *   1. die Auswahl zu Einträgen machen (nichts Gültiges ⇒ Abbruch VOR jedem Schreibvorgang)
 *   2. Entwurf FRISCH lesen — `update_metering_point_draft` ERSETZT ihn, und ein Stand aus der Zeit
 *      des Seitenaufbaus machte jede Angabe rückgängig, die inzwischen dazugekommen ist
 *   3. ALLE gewählten Flächen ANHÄNGEN und EINMAL schreiben
 *
 * ⚠ EIN SCHREIBVORGANG FÜR ALLE, nicht einer je Fläche. Der Wrapper ERSETZT den Entwurf; bei
 * mehreren Aufrufen nacheinander liest jeder den Stand des vorigen, und bricht einer davon ab,
 * stünde die Hälfte der Flächen in der Liste und die andere nicht — ein Teilstand, den niemand
 * nachvollziehen kann.
 *
 * ⚠ ES WIRD NICHT UMGELEITET — Regel dieser Datei (s. Kopf): der übernommene Stand ist das Einzige,
 * woran ein Mensch erkennt, ob die richtigen Flächen angekommen sind.
 */
export async function addPvArraysFromScanAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  /*
   * Die Zahl der Kandidaten begrenzt die Schleife — sie kommt aus dem Formular und wird deshalb
   * gegen dieselbe Obergrenze gehalten, die der Scan setzt. Ohne die Schranke bestimmte eine
   * beliebige Zahl aus dem Browser, wie oft hier gelesen wird.
   */
  const count = Number(String(formData.get('candidateCount') ?? ''))
  if (!Number.isInteger(count) || count < 1 || count > MAX_PV_DESIGN_CANDIDATES) {
    return { formError: GENERIC }
  }

  let selected = 0
  const added: PvArrayEntry[] = []

  for (let index = 0; index < count; index += 1) {
    // Ein nicht angehaktes Ankreuzfeld sendet gar nichts — „nicht da" IST hier die Abwahl.
    if (String(formData.get(`include-${index}`) ?? '') !== 'on') continue
    selected += 1

    const numbers: Partial<Record<'peakPowerKwp' | 'slopeDeg', number>> = {}
    let found = 0

    for (const entry of PV_ARRAY_NUMBER_FIELDS) {
      const parsed = parsePvArrayNumber(
        String(formData.get(`${index}.${entry.form}`) ?? ''),
        entry,
      )
      // `undefined` = nicht gelesen, `null` = unbrauchbar — hier dasselbe: diese eine Angabe fehlt.
      if (parsed === undefined || parsed === null) continue
      numbers[entry.form] = parsed
      found += 1
    }

    const directionRaw = String(
      formData.get(`${index}.${PV_ARRAY_DIRECTION_FORM_FIELD}`) ?? '',
    ).trim()
    const direction = isCompassDirection(directionRaw) ? directionRaw : null
    if (direction !== null) found += 1

    if (found === 0) continue
    added.push({
      peakPowerKwp: numbers.peakPowerKwp ?? null,
      direction,
      slopeDeg: numbers.slopeDeg ?? null,
    })
  }

  if (selected === 0) return { formError: 'Bitte mindestens eine Fläche auswählen.' }
  if (added.length === 0) {
    return {
      formError:
        'Zu den gewählten Flächen liegt keine einzige Angabe vor — es wurde nichts hinzugefügt.',
    }
  }

  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (PV-Flächen aus Scan):', listRes.error)
    return { formError: GENERIC }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  const arrays = [...readPvArraysDraft(point.draft), ...added]

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Listen-Schreibwegen: zur Laufzeit dasselbe, TypeScript kann
    // es nur nicht wissen.
    p_draft: withPvArrays(point.draft, arrays) as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error(
      '[admin/dateneingabe] update_metering_point_draft (PV-Flächen aus Scan):',
      draftRes.error,
    )
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (PV-Flächen aus Scan):', draftRes.data)
    return { formError: GENERIC }
  }

  // ⚠ Ohne das blieben die angehängten Flächen unsichtbar — s. die Begründung beim Lastgang-Upload.
  revalidatePath(projectDataEntryHref(projectId))

  /*
   * ⚠ DIE MELDUNG NENNT BEIDE ZAHLEN. Wie viele hinzugekommen sind, ist die Antwort auf den Klick;
   * wie viele es jetzt sind, ist die Antwort auf „habe ich das schon einmal gemacht?". Eine der
   * beiden allein liesse ein versehentliches Duplikat unbemerkt.
   */
  const addedText =
    added.length === 1 ? 'Eine Fläche hinzugefügt.' : `${added.length} Flächen hinzugefügt.`
  const totalText =
    arrays.length === 1
      ? 'Es ist jetzt eine Fläche erfasst.'
      : `Es sind jetzt ${arrays.length} Flächen erfasst.`

  return { success: `${addedText} ${totalText}` }
}

/**
 * EINE Modulfläche wieder aus der Liste nehmen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE IST NICHT `clearMeteringPointDraftFields` — UND DAS IST DER GANZE GRUND FÜR DIESE ACTION
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Jener Helfer entfernt BENANNTE Schlüssel aus dem Entwurf (`delete next[field]`) und ist für die
 * skalaren Angaben gebaut — für „gibt es eine PV-Anlage?" oder die zehn Profil-Schlüssel. Eine
 * Modulfläche hat keinen eigenen Schlüssel: sie ist ein EINTRAG in der Liste unter `_pvArrays`, und
 * die lässt sich weder über `setDraftField` schreiben noch über `delete` kürzen (die Begründung
 * steht im Kopf von `withPvArrays`). Gekürzt wird deshalb die gelesene Liste, und der Entwurf
 * bekommt die gekürzte Fassung zurück — derselbe Rahmen wie bei den zwei anhängenden Wegen
 * darüber, nur mit `filter` statt `[...alt, neu]`.
 *
 * ── ⚠ ADRESSIERT WIRD ÜBER DEN INDEX, UND ZWAR ÜBER DEN DER GELESENEN LISTE ───────────────────
 * Ein Eintrag trägt keine eigene Kennung — es gibt nichts Stabileres, worüber der Browser die
 * gemeinte Zeile benennen könnte. Massgeblich ist deshalb die Position in `readPvArraysDraft()`,
 * NICHT die im rohen `jsonb`: der Leser überspringt Einträge ohne eine einzige Angabe, und die
 * Zusammenfassung zählt genau seine Ausgabe durch. Über den Rohbestand gezählt träfe der Klick bei
 * einem solchen Rest eine andere Fläche als die angezeigte.
 *
 * ⚠ DIE VERBLEIBENDE GRENZE IST BENANNT UND NICHT BEHOBEN: ein Index ist nur so gültig wie der
 * Stand, aus dem die Seite gebaut wurde. Hat ein zweiter Tab inzwischen eine Fläche entfernt, zeigt
 * derselbe Index auf eine andere — die Datenbank kann das nicht merken, weil die Zeile keine
 * Identität hat. Was dagegen steht: die Oberfläche sperrt während eines laufenden Vorgangs ALLE
 * Löschknöpfe (der realistische Fall — zwei Klicks hintereinander auf derselben Seite), und ein
 * Index oberhalb der Liste wird hier abgewiesen statt zu einem stillen Kürzen am Ende.
 *
 * ── DIE REIHENFOLGE, WORTGLEICH ZU DEN ANHÄNGENDEN WEGEN ─────────────────────────────────────
 *   1. Kennungen und Index der FORM nach prüfen (ohne die Datenbank zu fragen)
 *   2. Entwurf FRISCH lesen — `update_metering_point_draft` ERSETZT ihn; ein Stand aus der Zeit des
 *      Seitenaufbaus machte jede Angabe rückgängig, die seither dazugekommen ist
 *   3. Index gegen die TATSÄCHLICHE Listenlänge halten, dann EINMAL schreiben
 *
 * ⚠ DIE INDIZES DER FOLGENDEN FLÄCHEN VERSCHIEBEN SICH, und das ist beabsichtigt: „Fläche 2" ist
 * eine Position in einer Liste, keine Kennung — dieselbe Lesart wie bei der Zählpunkt-Nummer der
 * Station. Umsortiert oder aufgefüllt wird nichts.
 *
 * ── ES GIBT KEIN PROTOKOLL ────────────────────────────────────────────────────────────────────
 * Wortgleich zu den übrigen Löschwegen dieser Station: zurückgenommen wird eine Angabe zu EINEM
 * Zählpunkt EINES Projekts, die derselbe Mensch selbst eingetragen hat.
 */
export async function deleteMeteringPointPvArrayAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  /*
   * Der Index kommt als verstecktes Feld aus unserer eigenen Seite — eine Server Action ist über
   * ihre Kennung aufrufbar, was hereinkommt ist also eine BEHAUPTUNG.
   *
   * ⚠ GEPRÜFT WIRD DIE ZEICHENKETTE, NICHT DIE ZAHL. `Number('')` ist **0**, `Number(' ')` ebenso,
   * und beide laufen anschliessend fehlerfrei durch `Number.isInteger(x) && x >= 0` — ein
   * fehlendes oder leeres Feld löschte damit die ERSTE Fläche, ohne dass irgendetwas nach einem
   * Fehler aussähe. Dasselbe gilt für Schreibweisen, die hier niemand meint (`'1e0'`, `'0x1'`,
   * `' 1 '`): sie sind gültige Zahlen und keine gültigen Indizes. `^\d+$` lässt genau die Form
   * durch, die das versteckte Feld erzeugt — und das ausdrücklich VOR jedem Datenbankaufruf.
   *
   * Die Obergrenze kann hier noch nicht fallen: wie lang die Liste ist, weiss erst der frisch
   * gelesene Entwurf.
   */
  const rawIndex = String(formData.get('arrayIndex') ?? '')
  if (!/^\d+$/.test(rawIndex)) return { formError: GENERIC }
  const arrayIndex = Number(rawIndex)

  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (PV-Fläche löschen):', listRes.error)
    return { formError: GENERIC }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  const arrays = readPvArraysDraft(point.draft)
  /*
   * ⚠ ERST HIER KANN DIE OBERGRENZE FALLEN — und sie muss: ohne die Prüfung liefe `filter` über
   * eine Liste, in der der Index gar nicht vorkommt, entfernte NICHTS und meldete trotzdem Erfolg.
   * Eine gelöschte Fläche, die noch dasteht, ist die teurere der beiden Falschauskünfte.
   */
  if (arrayIndex >= arrays.length) return { formError: GENERIC }

  const remaining = arrays.filter((_, index) => index !== arrayIndex)

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Listen-Schreibwegen: zur Laufzeit dasselbe, TypeScript kann
    // es nur nicht wissen.
    p_draft: withPvArrays(point.draft, remaining) as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error(
      '[admin/dateneingabe] update_metering_point_draft (PV-Fläche löschen):',
      draftRes.error,
    )
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (PV-Fläche löschen):', draftRes.data)
    return { formError: GENERIC }
  }

  /*
   * ⚠ Ohne das stünde die gelöschte Fläche weiter in der Zusammenfassung — sie kommt aus der
   * DATENBANK, nicht aus dem Zustand des Formulars.
   */
  revalidatePath(projectDataEntryHref(projectId))

  return { success: 'Modulfläche gelöscht.' }
}

// ── Standort ─────────────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die PLZ des Projekts, Grundlage für den PVGIS-Generator (eigener, folgender
 * Auftrag). Projektweit, deshalb ein Wrapper auf `platform.projects` — Vorbild:
 * `setProjectSegmentAction`.
 *
 * ⚠ DIE SEMANTISCHE PRÜFUNG LIEGT HIER, NICHT IM WRAPPER: `lookupPostalCodeCentroid` ist eine
 * TypeScript-Funktion über einer generierten Tabelle, in SQL nicht verfügbar. Der Wrapper prüft nur
 * das Format (vier Ziffern); ob die PLZ eine ECHTE österreichische ist, entscheidet diese Action —
 * „wir raten keine Koordinate", dieselbe Haltung wie auf der Website.
 */
export async function saveProjectPostalCodeAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const raw = String(formData.get('postalCode') ?? '').trim()
  if (raw === '') {
    return { fieldErrors: { postalCode: 'Bitte eine Postleitzahl eintragen.' } }
  }

  const centroid = lookupPostalCodeCentroid(raw)
  if (!centroid) {
    return {
      fieldErrors: { postalCode: 'Diese Postleitzahl kennen wir nicht — bitte prüfen.' },
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('update_project_postal_code', {
    p_id: projectId,
    p_postal_code: centroid.postalCode,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_project_postal_code:', error)
    return { formError: GENERIC }
  }

  const status = statusOf(data)
  if (status === 'not_found') return { formError: UNKNOWN_PROJECT }
  if (status !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (PLZ):', data)
    return { formError: GENERIC }
  }

  revalidatePath(projectDataEntryHref(projectId))
  return { success: `Standort gespeichert: ${centroid.name} (${centroid.postalCode}).` }
}

// ── PV-Erzeugung schätzen (PVGIS) ────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — der PV-GENERATOR: aus Standort und Modulflächen wird eine geschätzte Erzeugung
 * (Phase B; Phase A hat die zwei Bausteine geliefert, die hier zusammenkommen).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS HIER ENTSTEHT, IST EINE SCHÄTZUNG — UND SIE WIRD AUCH SO GESPEICHERT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Entwurf bekommt die Kennzahlen mit `source: 'assumed'` und einer Begründung, nicht mit
 * `'measured'`. Die Erzeugungsreihe selbst wird als Dokument ABGELEGT (`pvGeneratedDocumentId`) —
 * einmal gerechnet, nicht bei jeder Analyse neu geholt: ein zweiter PVGIS-Abruf könnte andere
 * Wetterjahre tragen und schriebe eine bereits abgegebene Auslegung still um (B14-1 Regel a). Das ist der GANZE Unterschied zum Upload-Weg zwei Funktionen weiter oben, und er
 * ist der Grund, warum diese Action ihren Schreibvorgang selbst führt statt
 * `writeMeteringPointDraftFields` zu rufen: jener Helfer schreibt ausdrücklich `'measured'`, mit
 * einer eigenen Begründung („der Admin trägt ein, was der Kunde über SEINE Anlage sagt"). Sie
 * trifft hier nicht zu — niemand hat diese Erzeugung gesehen, sie ist aus zehn Wetterjahren
 * gerechnet. Als Messwert gekennzeichnet stünde sie im Report ununterscheidbar neben einer
 * ausgelesenen Wechselrichter-Reihe (Delta §3.2), und der Vorbehalt, um den es geht, wäre genau
 * dort verschwunden, wo er hingehört.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ALLES ODER NICHTS: EINE UNVOLLSTÄNDIGE FLÄCHE BRICHT DEN GANZEN LAUF AB
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `splitPvArrayDesigns` trennt vollständige von unvollständigen Flächen, und die naheliegende
 * Verwendung wäre, die vollständigen zu rechnen und die übrigen zu benennen. Das ist hier FALSCH,
 * und der Fehler wäre still: eine Anlage mit drei Flächen, von denen eine unvollständig erfasst
 * ist, ergäbe den Ertrag von zwei Flächen — eine Zahl in völlig plausibler Grössenordnung, der
 * niemand ansieht, dass ihr ein Drittel der Anlage fehlt. Sie landet als `pvEstimatedAnnualKwh` im
 * Entwurf, von dort in der Rechnung, und der einzige Hinweis wäre ein Satz in einer
 * Erfolgsmeldung, den nach dem nächsten Neuladen niemand mehr sieht.
 *
 * Ein Abbruch dagegen ist laut, sofort behebbar (die fehlende Angabe steht eine Station höher) und
 * kostet nichts ausser einem zweiten Klick. Der Kopf von `pv-estimate.ts` hat diese Richtung schon
 * benannt: die beiden Konsumenten von `splitPvArrayDesigns` sind „die Station, um den Knopf gar
 * nicht erst anzubieten, und die Action, um ABZUBRECHEN".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE ANBIETBARKEIT WIRD HIER ERNEUT GEPRÜFT, obwohl die Station den Knopf schon versteckt
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * „Wird nicht angeboten" ist der Zustand einer ANSICHT, keine Regel. Zwischen dem Rendern und dem
 * Klick kann in einem zweiten Tab ein Lastgang MIT gemessener Einspeisung hochgeladen worden sein
 * — und dann addierte dieser Lauf eine geschätzte Erzeugung auf eine bereits gemessene. Das
 * Ergebnis sähe nicht falsch aus, sondern nur besser (§2.4). Die Prüfung liest die Datei dafür
 * erneut: Einspeisung erkennt man nur an den einzelnen Messwerten, der Metadaten-Leser kann die
 * Frage strukturell nicht beantworten.
 *
 * Ein ERZEUGTES Standardprofil ist davon ausgenommen — es hat keine Datei, und es hat per
 * Konstruktion keine Einspeisung (es ist eine reine Verbrauchskurve). Dort gibt es nichts zu
 * öffnen und nichts zu prüfen.
 *
 * ── DIE REIHENFOLGE: ERST ALLE PRÜFUNGEN, DANN DER EXTERNE ABRUF, DANN DIE SCHREIBVORGÄNGE ────
 * Jeder Abbruchgrund liegt VOR dem ersten PVGIS-Aufruf. Ein Lauf, der an einer fehlenden Neigung
 * scheitert, soll einen fremden, kostenlosen Dienst nicht mit N Anfragen belasten — und die
 * Frequenzgrenze des Abrufs (`takePvReferenceRateLimitSlot`) ist knapp bemessen.
 *
 * ⚠ ES SIND SEIT DER ABLAGE DER REIHE ZWEI SCHREIBVORGÄNGE: erst die Datei, dann der Entwurf, der
 * auf sie zeigt (s. Schritt 5). Scheitert der erste, wird auch der zweite nicht ausgeführt.
 *
 * ⚠ EIN FEHLSCHLAG EINER EINZIGEN FLÄCHE BRICHT ALLES AB, und nichts wird gespeichert. Aus
 * demselben Grund wie oben: die Summe über die übrigen Flächen wäre eine plausible Zahl mit
 * fehlendem Anteil. `Promise.all` tut genau das — es lehnt ab, sobald eine Zusage ablehnt; hier
 * werfen die Abrufe allerdings nicht, sie liefern ein `ok: false`, also wird danach ausgewertet.
 *
 * ⚠ DER ENTWURF WIRD NACH DEM ABRUF FRISCH GELESEN, nicht der Stand von vor den Prüfungen
 * verwendet. Zwischen beiden liegen mehrere Sekunden echter Wartezeit (ein Abruf misst rund acht
 * Sekunden, und es sind N davon) — mehr als genug, damit in einem zweiten Tab eine Rechnung
 * ausgelesen wird. `update_metering_point_draft` ERSETZT den Entwurf; ein veralteter Stand machte
 * jede solche Angabe rückgängig.
 *
 * KEIN NEUER WRAPPER, KEINE MIGRATION: derselbe Lesepfad wie die übrigen Stationen
 * (`list_metering_points`, `admin_get_project`) und derselbe Schreibpfad
 * (`update_metering_point_draft`).
 */
export async function generatePvProfileAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  // Kommt wie die Projekt-Kennung als verstecktes Feld aus unserer eigenen Seite.
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const supabase = await createClient()

  // ── Schritt 1: Zählpunkt und Projekt lesen. Beides wird gebraucht: die Flächen und der
  //    Lastgang-Zeitraum hängen am ZÄHLPUNKT, der Standort am PROJEKT.
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (PV-Schätzung):', listRes.error)
    return { formError: GENERIC }
  }

  const point = readMeteringPointList(listRes.data)?.find(
    (candidate) => candidate.id === meteringPointId,
  )
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  const projectRes = await supabase.rpc('admin_get_project', { p_id: projectId })
  if (projectRes.error) {
    if (isForbidden(projectRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] admin_get_project (PV-Schätzung):', projectRes.error)
    return { formError: GENERIC }
  }
  const project = readAdminProject(projectRes.data)
  if (project === 'not_found') return { formError: UNKNOWN_PROJECT }
  if (project === null) {
    console.error('[admin/dateneingabe] unerwartete Antwort (PV-Schätzung, Projekt)')
    return { formError: GENERIC }
  }

  // ── Schritt 2: Vorbedingungen. Jede bekommt einen eigenen Satz — „geht nicht" ohne Grund
  //    schickt den Admin auf die Suche nach einem Fehler, den es nicht gibt.
  if (hasPvProfile(readPvProfileDraft(point.draft))) {
    return {
      formError:
        'Für diesen Zählpunkt liegt bereits ein Erzeugungsprofil vor. Eine Schätzung daneben ' +
        'wäre eine zweite Aussage über dieselbe Anlage.',
    }
  }

  /*
   * ⚠ OHNE LASTGANG KEIN ZEITRAUM — und ohne Zeitraum keine Erzeugungsreihe. Das erzeugte Profil
   * deckt genau den Zeitraum ab, für den es einen Verbrauch gibt (s. `pvGeneratedProfileDraftValues`);
   * es gibt hier nichts zu erfinden, und ein Vorgabezeitraum wäre eine Erzeugung in Jahren, in
   * denen der Kunde gar nicht gemessen wurde.
   */
  if (point.coveredFrom === null || point.coveredTo === null || point.intervalMinutes === null) {
    return {
      formError:
        'Für diesen Zählpunkt liegt noch kein Lastgang vor. Die geschätzte Erzeugung deckt genau ' +
        'dessen Zeitraum ab — bitte zuerst den Lastgang-Schritt abschliessen.',
    }
  }

  const postalCode = project.postal_code
  if (postalCode === null || postalCode.trim() === '') {
    return {
      formError:
        'Für dieses Projekt ist noch keine Postleitzahl hinterlegt. Ohne Standort lässt sich die ' +
        'Erzeugung nicht schätzen.',
    }
  }

  /*
   * ⚠ Die Koordinate kommt aus der statischen Tabelle und wird NICHT geraten (B22b): eine
   * unbekannte PLZ liefert `null`, und daraus eine Ersatzkoordinate zu bilden verschöbe den
   * Standort, ohne dass die Zahl falsch aussähe. Erreichbar ist der Zweig kaum — gespeichert wird
   * die Postleitzahl nur, wenn sie beim Eintragen aufgelöst werden konnte —, aber die Tabelle und
   * die gespeicherte Angabe liegen an zwei Orten.
   */
  const centroid = lookupPostalCodeCentroid(postalCode)
  if (!centroid) {
    return {
      formError:
        `Die hinterlegte Postleitzahl (${postalCode}) lässt sich keinem Ort zuordnen. Bitte den ` +
        'Standort erneut eintragen.',
    }
  }

  const arrays = readPvArraysDraft(point.draft)
  if (pvArraysDraftIsEmpty(arrays)) {
    return {
      formError:
        'Für diesen Zählpunkt ist noch keine Modulfläche erfasst. Nennleistung, Ausrichtung und ' +
        'Neigung sind die Grundlage der Schätzung.',
    }
  }

  const { designs, incompleteNumbers } = splitPvArrayDesigns(arrays)
  if (incompleteNumbers.length > 0) {
    // Alles oder nichts — s. Kopf. Die Nummern sind das, woran ein Mensch die Zeile wiedererkennt.
    const list = incompleteNumbers.join(', ')
    return {
      formError:
        `${incompleteNumbers.length === 1 ? `Fläche ${list} ist` : `Die Flächen ${list} sind`} ` +
        'unvollständig erfasst — es fehlt Nennleistung, Ausrichtung oder Neigung. Es wurde nichts ' +
        'gerechnet und nichts gespeichert: eine Schätzung über die übrigen Flächen ergäbe einen ' +
        'zu niedrigen Ertrag, dem man das nicht ansieht.',
    }
  }

  /*
   * ── Schritt 3: Anbietbarkeit ────────────────────────────────────────────────────────────────
   *
   * ⚠ DIE VERZWEIGUNG HÄNGT AN DER DOKUMENT-KENNUNG, NICHT AN `profileSource` — und der
   * Unterschied ist nicht kosmetisch. `readProfileSource` leitet `'standard'` daraus ab, dass eine
   * Kennung FEHLT (`metering-points.ts`); ein hochgeladener Lastgang, der seinen Zeiger über
   * `on delete set null` verloren hat, erscheint dort also als Standardprofil. An `profileSource`
   * geprüft überspränge dieser Lauf für ihn die Einspeise-Prüfung — und addierte womöglich eine
   * geschätzte Erzeugung auf eine gemessene. Am Zeiger geprüft ist die Frage die richtige: „gibt es
   * eine Datei, die ich öffnen kann?"
   *
   * ⚠ OFFENGELEGTER REST: Ein solcher verwaister Upload ist danach von einem echten Standardprofil
   * NICHT mehr zu unterscheiden — beide haben einen Zeitraum und keine Datei. Dieser Lauf behandelt
   * ihn wie ein Standardprofil und prüft nicht. Der Rest ist klein und nachprüfbar: der einzige
   * Löschweg für ein Lastgang-Dokument (`admin_delete_metering_point_document`) weist ab, solange
   * ein Zählpunkt es noch als Quelle führt (`in_use`), und der Reset nullt Kennung und Zeitraum
   * GEMEINSAM. Über die gebauten Wege entsteht der Zustand also nicht. Wer ihn ganz ausschliessen
   * will, braucht eine eigene Spalte für die Herkunft des LASTGANGS — dieselbe Unterscheidung, die
   * die PV-Seite seit `PV_PROFILE_SOURCE_KEY` ausdrücklich führt, statt sie abzuleiten.
   *
   * Ein echtes Standardprofil hat nichts zu prüfen: es ist eine synthetische Verbrauchskurve und
   * trägt per Konstruktion keine Einspeisung.
   */
  /*
   * ⚠ DIE DATEI WIRD HIER GELESEN UND WEITERGEREICHT, nicht zweimal geholt. Sie beantwortet zwei
   * verschiedene Fragen: „liegt bereits eine gemessene Einspeisung vor?" (jetzt) und „auf welche
   * Zeitstempel wird die geschätzte Reihe gelegt?" (in Schritt 4). Ein zweiter
   * `readProjectDocument`-Aufruf lüde bis zu 20 MB ein zweites Mal aus der Ablage.
   */
  let loadProfileFile: { bytes: ArrayBuffer; fileName: string } | null = null
  if (point.sourceDocumentId !== null) {
    const document = await readProjectDocument(point.sourceDocumentId)
    if (!document.ok) {
      return {
        formError:
          'Die Lastgang-Datei dieses Zählpunkts liess sich nicht öffnen. Ohne sie lässt sich ' +
          'nicht prüfen, ob bereits eine gemessene Einspeisung vorliegt — es wurde nichts ' +
          'gerechnet und nichts gespeichert.',
      }
    }

    const eligibility = checkPvGeneratorEligibility(document.bytes, document.filename)
    if (!eligibility.offered) {
      return { formError: pvGeneratorRefusalText(eligibility) }
    }

    loadProfileFile = { bytes: document.bytes, fileName: document.filename }
  }

  /*
   * ── Schritt 4: PVGIS + die abzulegende Reihe ────────────────────────────────────────────────
   * EIN Aufruf für alle Flächen: er fragt PVGIS je Fläche einzeln (zwei verschieden ausgerichtete
   * Flächen haben eine andere Tagesform als eine gemittelte, s. Kopf von `pv-estimate.ts`),
   * summiert die Stundenreihen und legt die Summe auf die ECHTEN Zeitstempel des Lastgangs.
   *
   * ⚠ DIE 8.760 STUNDENWERTE JE FLÄCHE BLEIBEN DABEI IM PAKET. Heraus kommen die Kennzahlen für
   * den Entwurf und EINE fertig serialisierte Datei für die Ablage.
   */
  const seriesOutcome = await generateEstimatedPvSeries({
    designs: designs.map((design) => ({
      ...design,
      latitudeDeg: centroid.lat,
      longitudeDeg: centroid.lon,
    })),
    loadProfile: loadProfileFile,
  })

  if (!seriesOutcome.ok) {
    if (seriesOutcome.reason === 'load_profile_unreadable') {
      console.error('[admin/dateneingabe] Lastgang nicht lesbar (PV-Schätzung)')
      return {
        formError:
          'Die Lastgang-Datei dieses Zählpunkts liess sich nicht auswerten, obwohl sie beim ' +
          'Hochladen gelesen wurde. Ohne ihre Zeitstempel lässt sich keine Erzeugungsreihe ' +
          'ablegen — es wurde nichts gerechnet und nichts gespeichert.',
      }
    }
    console.error(
      `[admin/dateneingabe] generateEstimatedPvSeries (Fläche ${seriesOutcome.arrayNumber}):`,
      seriesOutcome.reason,
      seriesOutcome.reason === 'invalid_request' ? seriesOutcome.rejection : '',
    )
    return { formError: pvReferenceFailureText(seriesOutcome.reason, seriesOutcome.arrayNumber) }
  }

  const summaries = seriesOutcome.summaries

  /*
   * ⚠ ERST JE WETTERJAHR SUMMIEREN, DANN ZUSAMMENFASSEN — die tragende Regel von `pv-estimate.ts`.
   * Die Streuungen der Einzelflächen zu mitteln ergäbe eine „± x %"-Angabe, die zu gross ist und
   * eine Eigenschaft beschreibt, die die Anlage gar nicht hat.
   */
  const combined = combinePvArrayYields(summaries.map((summary) => summary.annualYields))
  if (!combined) {
    console.error('[admin/dateneingabe] combinePvArrayYields lieferte null (PV-Schätzung)')
    return { formError: GENERIC }
  }

  /*
   * Die Wetterjahre der ERSTEN Fläche — sie gelten für alle. Dass die Jahressätze übereinstimmen,
   * hat `combinePvArrayYields` bereits geprüft (sonst stünde hier `null`); es ist also keine
   * Annahme, sondern eine bereits durchgesetzte Bedingung.
   */
  const weatherYears = summaries[0]!.weatherYears

  /*
   * ── Schritt 5: die Reihe ablegen ────────────────────────────────────────────────────────────
   * ⚠ ZUERST DIE DATEI, DANN DER ZEIGER IM ENTWURF — dieselbe Reihenfolge und dieselbe Begründung
   * wie in `uploadProjectDocument` (dort ausführlich): der schlimmste Rest ist eine Datei, auf die
   * niemand verweist; andersherum stünde eine Kennung im Entwurf, zu der es nichts zu holen gibt.
   *
   * ⚠ SCHEITERT DIE ABLAGE, WIRD NICHTS GESPEICHERT — auch nicht die Kennzahlen. Ein Entwurf mit
   * geschätztem Jahresertrag ohne die Reihe dahinter sähe vollständig aus, und der nächste Schritt
   * (die Analyse) fände die Erzeugung nicht, auf die die Zahl sich beruft. Die PVGIS-Abrufe sind
   * dann vergeblich gewesen; das ist der kleinere Schaden.
   *
   * ⚠ OHNE HOCHGELADENEN LASTGANG ENTSTEHT KEINE DATEI (Standardprofil-Zweig, s.
   * `generateEstimatedPvSeries`): dort fehlen die echten Zeitstempel. Die Kennzahlen entstehen
   * trotzdem — der Zustand ist derselbe wie vor diesem Schritt.
   */
  let generatedDocumentId: string | null = null
  if (seriesOutcome.file !== null) {
    const bytes = new TextEncoder().encode(seriesOutcome.file.text)
    const upload = await uploadProjectDocument(projectId, {
      name: seriesOutcome.file.filename,
      type: seriesOutcome.file.contentType,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    })

    if (!upload.ok) {
      if (upload.reason === 'not_found') return { formError: UNKNOWN_PROJECT }
      console.error('[admin/dateneingabe] uploadProjectDocument (PV-Schätzung):', upload.reason)
      return {
        formError:
          'Die geschätzte Erzeugungsreihe liess sich nicht ablegen. Es wurde nichts gespeichert — ' +
          'bitte erneut versuchen.',
      }
    }

    generatedDocumentId = upload.documentId
  }

  // ── Schritt 6: schreiben. Entwurf FRISCH lesen — zwischen Schritt 1 und hier liegen Sekunden.
  const freshRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (freshRes.error) {
    if (isForbidden(freshRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (PV-Schätzung, frisch):', freshRes.error)
    return { formError: GENERIC }
  }
  const fresh = readMeteringPointList(freshRes.data)?.find(
    (candidate) => candidate.id === meteringPointId,
  )
  if (!fresh) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  /*
   * ⚠ DIE LÜCKEN WERDEN AUSDRÜCKLICH GELEERT, nicht ausgelassen. Eine erzeugte Reihe ist per
   * Konstruktion lückenlos — dieselbe Aussage, die `set_metering_point_standard_profile` auf der
   * Lastgang-Seite als Literal `'[]'` schreibt. Ausgelassen bliebe ein Eintrag aus einem früheren
   * Upload stehen und behauptete Lücken in einer Reihe, die es so nie gab.
   */
  let nextDraft = withPvProfileGaps(fresh.draft, [])
  const now = new Date()
  const note = pvEstimateNote(designs.length, weatherYears, centroid.name, centroid.postalCode)
  for (const { field, value } of pvGeneratedProfileDraftValues({
    intervalMinutes: point.intervalMinutes,
    coveredFrom: point.coveredFrom,
    coveredTo: point.coveredTo,
    estimate: {
      annualKwh: combined.spread.meanKwh,
      spreadPercent: combined.spread.spreadPercent,
      weatherYears,
    },
    documentId: generatedDocumentId,
  })) {
    // `assumed` samt Begründung — s. Kopf. Der Vorbehalt gehört an die Zahl, nicht in eine Meldung.
    nextDraft = setDraftField(nextDraft, field, value, 'assumed', note, now)
  }

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Entwurf-Schreibwegen: zur Laufzeit dasselbe.
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (PV-Schätzung):', draftRes.error)
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (PV-Schätzung):', draftRes.data)
    return { formError: GENERIC }
  }

  // ⚠ Ohne das bliebe die Zusammenfassung unsichtbar — s. die Begründung beim PV-Upload.
  revalidatePath(projectDataEntryHref(projectId))

  return {
    success:
      `Erzeugung geschätzt: rund ${formatKwh(combined.spread.meanKwh)} im Jahr ` +
      `(± ${formatPercent(combined.spread.spreadPercent)} über die Wetterjahre ` +
      `${weatherYears.from}–${weatherYears.to}), aus ` +
      `${designs.length === 1 ? 'einer Modulfläche' : `${designs.length} Modulflächen`}.` +
      (seriesOutcome.file === null
        ? ' Die Erzeugungsreihe selbst wurde nicht abgelegt: dafür braucht es einen hochgeladenen ' +
          'Lastgang mit echten Zeitstempeln.'
        : ` Die Erzeugungsreihe ist abgelegt (${seriesOutcome.file.readingCount.toLocaleString('de-AT')} Werte).`),
  }
}

/**
 * Warum der Generator NICHT angeboten wird — ein Satz je Grund.
 *
 * ⚠ `measured_feed_in` ist die einzige FACHLICHE Antwort unter den vieren und bekommt deshalb eine
 * Begründung statt einer Fehlermeldung: es ist kein Versagen, sondern der richtige Zustand. Die
 * übrigen drei beschreiben, dass die Prüfung nicht durchgeführt werden konnte — und fail closed
 * heisst hier, sie wie eine Ablehnung zu behandeln (s. Kopf von `checkPvGeneratorEligibility`).
 */
function pvGeneratorRefusalText(
  outcome: Exclude<PvGeneratorEligibilityOutcome, { offered: true }>,
): string {
  const tail = ' Es wurde nichts gerechnet und nichts gespeichert.'
  switch (outcome.reason) {
    case 'measured_feed_in':
      return (
        'Der Lastgang dieses Zählpunkts enthält bereits eine gemessene Einspeisung. Eine ' +
        'geschätzte Erzeugung daneben zöge dieselbe Energie ein zweites Mal ab.' +
        tail
      )
    case 'too_large':
      return (
        `Die Lastgang-Datei ist zu gross (${formatMegabytes(outcome.sizeBytes)} MB), um erneut ` +
        'geprüft zu werden — und ohne diese Prüfung lässt sich nicht ausschliessen, dass bereits ' +
        'eine Einspeisung gemessen vorliegt.' +
        tail
      )
    case 'ambiguous_columns':
      return (
        'Die Lastgang-Datei führt mehrere Wert-Spalten, die sich nicht eindeutig zuordnen lassen ' +
        '— unter ihnen könnte eine Einspeise-Spalte sein.' +
        tail
      )
    case 'unreadable':
      return (
        'Die Lastgang-Datei liess sich nicht mehr lesen, obwohl sie beim Hochladen gelesen wurde. ' +
        'Damit lässt sich nicht prüfen, ob bereits eine Einspeisung vorliegt.' +
        tail
      )
  }
}

/**
 * Warum ein PVGIS-Abruf fehlgeschlagen ist — und für welche Fläche.
 *
 * ⚠ `invalid_request` UND `rate_limited` bedeuten: es ist NICHTS hinausgegangen. Sie als Ausfall
 * des Dienstes zu melden hiesse, PVGIS etwas anzulasten, das bei uns liegt — dieselbe Trennung,
 * die der Abruf selbst in seinen drei Ausgängen trifft.
 */
function pvReferenceFailureText(
  reason: 'invalid_request' | 'rate_limited' | 'pvgis_error',
  arrayNumber: number,
): string {
  const tail = ' Es wurde nichts gespeichert.'
  switch (reason) {
    case 'invalid_request':
      return (
        `Die Angaben zu Fläche ${arrayNumber} liegen ausserhalb des Bereichs, den der ` +
        'Erzeugungs-Dienst annimmt — bitte Nennleistung, Ausrichtung und Neigung prüfen.' +
        tail
      )
    case 'rate_limited':
      return (
        'Es wurden gerade zu viele Schätzungen angefordert. Der Erzeugungs-Dienst ist kostenlos ' +
        'und wird deshalb sparsam befragt — bitte in ein paar Minuten erneut versuchen.' +
        tail
      )
    case 'pvgis_error':
      return (
        `Der Erzeugungs-Dienst hat auf die Anfrage für Fläche ${arrayNumber} nicht verwertbar ` +
        'geantwortet. Das ist meist vorübergehend — bitte später erneut versuchen.' +
        tail
      )
  }
}

/**
 * Die Begründung, die an JEDER geschätzten Angabe im Entwurf steht.
 *
 * ⚠ SIE NENNT DIE VIER GRÖSSEN, AUS DENEN DIE ZAHL ENTSTANDEN IST (Verfahren, Standort, Flächen,
 * Wetterjahre) — nicht „PVGIS-Schätzung". Wer 2028 im Entwurf steht und die Zahl nicht mehr
 * einordnen kann, soll ihr ansehen, worauf sie beruht; dieselbe Form wie beim Standardprofil
 * („Geschätzt aus 3 Personen im Haushalt: 2 000 kWh + 2 × 1 000 kWh").
 */
function pvEstimateNote(
  arrayCount: number,
  weatherYears: { from: number; to: number },
  placeName: string,
  postalCode: string,
): string {
  const arrays = arrayCount === 1 ? '1 Modulfläche' : `${arrayCount} Modulflächen`
  return (
    `Geschätzt aus ${arrays} am Standort ${postalCode} ${placeName}, ` +
    `Mittel der Wetterjahre ${weatherYears.from}–${weatherYears.to} (PVGIS).`
  )
}
