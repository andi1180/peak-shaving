'use server'

import { revalidatePath } from 'next/cache'
import {
  MAX_PV_ARRAY_TEXT_CHARS,
  MAX_PV_DESIGN_FILE_BYTES,
  extractPvArrayText,
  extractPvDesign,
  readPvProfile,
} from 'extractors'
import {
  MAX_PROJECT_DOCUMENT_BYTES,
  pvDesignArrayPrefill,
  lookupPostalCodeCentroid,
  type CompassDirection,
  type PvDesignArrayPrefill,
} from 'shared'
import { uploadProjectDocument } from '@/lib/project-documents/documents'
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
  readPvArraysDraft,
  withPvArrays,
  type PvArrayEntry,
} from './pv-array-draft'
import { PV_PRESENT_KEY } from './pv-draft'
import { pvProfileDraftValues, withPvProfileGaps } from './pv-profile-draft'
import { projectDataEntryHref } from './projects'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'
import {
  FORBIDDEN,
  GENERIC,
  PDF_MEDIA_TYPE,
  UNKNOWN_PROJECT,
  UUID,
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

  const answer = String(formData.get(PV_PRESENT_KEY) ?? '')
  if (answer !== 'ja' && answer !== 'nein') {
    // Erreichbar nur an den zwei Knöpfen vorbei — die schicken feste Werte.
    return { formError: GENERIC }
  }
  const has = answer === 'ja'

  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    [{ field: PV_PRESENT_KEY, value: has }],
    'PV-Anlage',
  )
  if (failure) return failure

  return {
    success: has
      ? 'Vermerkt: Es gibt bereits eine PV-Anlage.'
      : 'Vermerkt: Es gibt keine PV-Anlage.',
  }
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
