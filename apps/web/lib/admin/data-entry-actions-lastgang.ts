'use server'

import { revalidatePath } from 'next/cache'
import { generateStandardProfileMetadata, readLoadProfile } from 'extractors'
import { MAX_PROJECT_DOCUMENT_BYTES, standardProfileYear } from 'shared'
import {
  claimDirectUpload,
  discardDirectUpload,
  issueDirectUpload,
  registerDirectUpload,
} from '@/lib/project-documents/direct-upload'
import type { DirectUploadGrant } from '@/lib/project-documents/direct-upload-client'
import { removeProjectDocumentBytes } from '@/lib/project-documents/storage'
import { setDraftField } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import { formatKwh } from './format'
import { readMeteringPointList } from './metering-points'
import {
  PROJECT_SEGMENTS,
  projectDataEntryHref,
  readAdminProject,
  type ProjectSegment,
} from './projects'
import {
  ANNUAL_CONSUMPTION_KWH_KEY,
  MAX_HOUSEHOLD_PERSONS,
  MAX_STANDARD_PROFILE_ANNUAL_KWH,
  customerClassForSegment,
  estimateHouseholdConsumptionKwh,
  householdEstimateNote,
  parseAnnualConsumptionKwh,
} from './standard-profile'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'
import {
  AUSTRIA_TIME_ZONE,
  FORBIDDEN,
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  formatMegabytes,
  isForbidden,
  readProjectId,
  statusOf,
} from './data-entry-actions-shared'

// ── Lastgang ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Die WIRKSAME Grössengrenze für eine Lastgang-Datei in diesem Wizard.
 *
 * ⚠ ES SIND ZWEI ZAHLEN IM SPIEL, UND DIE KLEINERE GEWINNT — deshalb steht hier keine dritte.
 * `MAX_LOAD_PROFILE_FILE_BYTES` (25 MB, `packages/extractors`) begrenzt, was der LESER verarbeitet;
 * `MAX_PROJECT_DOCUMENT_BYTES` (20 MB, `packages/shared`) begrenzt, was die ABLAGE annimmt. Der
 * Wrapper `set_metering_point_load_profile` VERLANGT ein Dokument (`invalid_document`) — es gibt
 * also keinen Weg, eine Datei zu verwenden, die nicht abgelegt werden kann. Wirksam ist damit immer
 * die Ablage-Grenze, und nur die darf dem Admin genannt werden.
 */
const MAX_LOAD_PROFILE_BYTES = MAX_PROJECT_DOCUMENT_BYTES

/** Für die Meldung am Feld — ganze Megabyte, weil die Grenze eine ganze Zahl ist. */
const MAX_LOAD_PROFILE_MB = Math.floor(MAX_LOAD_PROFILE_BYTES / (1024 * 1024))

const NOTHING_SAVED = 'Es wurde nichts hochgeladen und nichts gespeichert.'

function tooLarge(bytes?: number): AdminState {
  const size = bytes === undefined ? '' : ` (${formatMegabytes(bytes)} MB)`
  return {
    fieldErrors: {
      file:
        `Diese Datei ist zu gross${size}. ` +
        `Mehr als ${MAX_LOAD_PROFILE_MB} MB nimmt der Wizard nicht an. ${NOTHING_SAVED}`,
    },
  }
}

export type LoadProfileUploadRequest = {
  projectId: string
  meteringPointId: string
  fileName: string
  fileSize: number
  contentType: string
}

export type LoadProfileUploadCompletion = {
  projectId: string
  meteringPointId: string
  documentId: string
  fileName: string
  contentType: string
}

/**
 * Schritt 1 des Lastgang-Uploads: prüft Projekt, Zählpunkt und Dateigrösse und gibt eine signierte
 * Upload-URL aus. Die Datei selbst läuft danach direkt vom Browser in den Bucket — durch eine
 * Server Action ginge sie nicht: Vercel schneidet jeden Function-Rumpf über 4,5 MB mit 413 ab, und
 * ein Jahres-Lastgang liegt regelmässig darüber.
 */
export async function requestLoadProfileUploadAction(
  input: LoadProfileUploadRequest,
): Promise<DirectUploadGrant<AdminState>> {
  const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
  const meteringPointId = typeof input?.meteringPointId === 'string' ? input.meteringPointId : ''
  if (!UUID.test(projectId)) return { ok: false, state: { formError: UNKNOWN_PROJECT } }
  if (!UUID.test(meteringPointId)) return { ok: false, state: { formError: GENERIC } }

  const fileName = typeof input.fileName === 'string' ? input.fileName : ''
  const fileSize = typeof input.fileSize === 'number' ? input.fileSize : 0
  const contentType = typeof input.contentType === 'string' ? input.contentType : ''
  if (!(fileSize > 0) || fileName.trim() === '') {
    return { ok: false, state: { fieldErrors: { file: 'Bitte eine Datei auswählen.' } } }
  }
  if (fileSize > MAX_LOAD_PROFILE_BYTES) return { ok: false, state: tooLarge(fileSize) }

  // Der Zählpunkt muss zu DIESEM Projekt gehören, bevor irgendetwas hochgeladen wird.
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { ok: false, state: { formError: FORBIDDEN } }
    console.error('[admin/dateneingabe] list_metering_points (Lastgang):', listRes.error)
    return { ok: false, state: { formError: GENERIC } }
  }
  const point = readMeteringPointList(listRes.data)?.find((p) => p.id === meteringPointId)
  if (!point) {
    return {
      ok: false,
      state: { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' },
    }
  }

  const issued = await issueDirectUpload(projectId, {
    name: fileName,
    size: fileSize,
    type: contentType,
  })
  if (!issued.ok) {
    if (issued.reason === 'not_found') return { ok: false, state: { formError: UNKNOWN_PROJECT } }
    if (issued.reason === 'too_large') return { ok: false, state: tooLarge(fileSize) }
    return { ok: false, state: { formError: GENERIC } }
  }
  return { ok: true, documentId: issued.documentId, uploadUrl: issued.uploadUrl }
}

/**
 * Schritt 2 des Lastgang-Uploads: liest die hochgeladene Datei aus dem Bucket und schreibt die
 * Metadaten an den Zählpunkt. Die Anfrage trägt nur Kennungen, keinen Dateiinhalt.
 *
 * Reihenfolge wie zuvor: ERST lesen, DANN eintragen — eine unlesbare Datei darf keine
 * Dokument-Zeile hinterlassen. Neu ist nur, dass sie beim Lesen schon im Bucket liegt; wird sie
 * abgelehnt, wird das Objekt wieder entfernt. Was zwischen Eintragen und
 * `set_metering_point_load_profile` scheitert, bleibt als Dokument ohne Zuordnung stehen (die
 * harmlose Richtung, unverändert).
 */
export async function completeLoadProfileUploadAction(
  input: LoadProfileUploadCompletion,
): Promise<AdminState> {
  const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
  const meteringPointId = typeof input?.meteringPointId === 'string' ? input.meteringPointId : ''
  const documentId = typeof input?.documentId === 'string' ? input.documentId : ''
  const fileName = typeof input?.fileName === 'string' ? input.fileName : ''
  const contentType = typeof input?.contentType === 'string' ? input.contentType : ''
  if (!UUID.test(projectId)) return { formError: UNKNOWN_PROJECT }
  if (!UUID.test(meteringPointId) || !UUID.test(documentId) || fileName.trim() === '') {
    return { formError: GENERIC }
  }

  const claim = await claimDirectUpload(projectId, documentId)
  if (!claim.ok) {
    switch (claim.reason) {
      case 'not_found':
        return { formError: UNKNOWN_PROJECT }
      case 'missing':
        return {
          formError:
            'Die Datei ist beim Speicher nicht angekommen. Bitte versuchen Sie es erneut. ' +
            'Es wurde nichts gespeichert.',
        }
      case 'too_large':
        return tooLarge()
      default:
        console.error('[admin/dateneingabe] Lastgang übernehmen:', claim.reason)
        return { formError: GENERIC }
    }
  }

  const rejected = (state: AdminState) =>
    discardDirectUpload(projectId, documentId).then(() => state)

  // ── lesen. Rein, deterministisch, ohne Nebeneffekt.
  const outcome = readLoadProfile(claim.bytes, fileName)

  if (!outcome.ok) {
    // Unerreichbar, solange die Ablage-Grenze unter der des Lesers liegt; trotzdem beantwortet.
    return rejected(tooLarge())
  }

  const scan = outcome.scan

  if (scan.ok && scan.needsMapping) {
    // Welche Spalte zu welchem Zählpunkt gehört, entscheidet ein Mensch — hier wird nichts geraten.
    return rejected({
      fieldErrors: {
        file:
          `Format nicht eindeutig erkennbar — bitte Datei prüfen oder eine andere Version ` +
          `hochladen. Die Datei führt ${scan.ambiguousColumns.length} Wert-Spalten, und welche ` +
          `zu diesem Zählpunkt gehört, lässt sich daraus nicht ableiten. ${NOTHING_SAVED}`,
      },
    })
  }

  if (!scan.ok) {
    // Die Meldung des Lesers ist fertig formuliert und sagt, WAS an der Datei nicht stimmt.
    return rejected({ fieldErrors: { file: `${scan.error.message} ${NOTHING_SAVED}` } })
  }

  // ── eintragen. `content_type` ist eine Angabe des Browsers; gelesen wurde am Dateinamen.
  const registered = await registerDirectUpload(projectId, documentId, {
    name: fileName,
    type: contentType,
  })
  if (!registered.ok) {
    if (registered.reason === 'not_found') return { formError: UNKNOWN_PROJECT }
    return { formError: GENERIC }
  }

  // ── die gelesenen Metadaten an den Zählpunkt schreiben.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('set_metering_point_load_profile', {
    p_metering_point_id: meteringPointId,
    p_source_document_id: documentId,
    p_interval_minutes: scan.intervalMinutes,
    p_covered_from: scan.coveredFrom,
    p_covered_to: scan.coveredTo,
    // Immer mitgeschickt, auch leer: „keine Lücke gemessen" ist etwas anderes als „nichts gesagt".
    p_gaps: scan.gaps,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] set_metering_point_load_profile:', error)
    return { formError: GENERIC }
  }

  switch (statusOf(data)) {
    case 'ok':
      break
    case 'not_found':
      return {
        formError:
          'Diesen Zählpunkt gibt es nicht (mehr). Die Datei ist im Projekt abgelegt, aber keinem ' +
          'Zählpunkt zugeordnet. Bitte laden Sie die Seite neu.',
      }
    default:
      console.error('[admin/dateneingabe] unerwartete Antwort (Lastgang):', data)
      return { formError: GENERIC }
  }

  // Die Station liest den gespeicherten Stand aus der Datenbank; ohne das bliebe die
  // Zusammenfassung bis zum nächsten Neuladen unsichtbar.
  revalidatePath(projectDataEntryHref(projectId))

  return { success: 'Lastgang eingelesen und gespeichert.' }
}

// ── Lastgang entfernen ───────────────────────────────────────────────────────────────────────────
/**
 * Nimmt den eingelesenen Lastgang eines Zählpunkts vollständig zurück: Metadaten am Zählpunkt,
 * Datei im Bucket, Zeile in `platform.project_documents`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DREI SCHRITTE, UND EINER DAVON KANN SQL NICHT — deshalb orchestriert diese Action
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. `admin_reset_metering_point_load_profile` — nullt Intervall, Zeitraum und Quelle am
 *      Zählpunkt, setzt `gaps` auf `[]` und LIEFERT DIE DOKUMENT-KENNUNG SAMT PFAD ZURÜCK, bevor
 *      sie genullt wird. Ohne diese Rückgabe wüsste hier niemand mehr, welche Datei gemeint war.
 *   2. Das Objekt im Bucket entfernen (`removeProjectDocumentBytes`) — der Schritt, den eine
 *      Datenbankfunktion nicht ausführen kann. Genau deshalb gibt es bis heute keinen allgemeinen
 *      `delete_project_document`-Wrapper (TEIL 9 der Migration `20260910090000`).
 *   3. `admin_delete_metering_point_document` — die Zeile in `platform.project_documents`.
 *
 * ⚠ DIE REIHENFOLGE IST DIE ENTSCHEIDUNG, NICHT DIE BEQUEMLICHKEIT: erst Storage, dann DB-Zeile.
 * Bricht es dazwischen ab, bleibt eine DB-Zeile ohne Datei — sichtbar in
 * `list_project_documents`, benennbar, und beim nächsten Anlauf löschbar (die Storage-API meldet
 * für einen unbekannten Pfad keinen Fehler, s. Kopf von `removeProjectDocumentBytes`). Umgekehrt
 * bliebe ein Objekt im Bucket, auf das nichts mehr zeigt: unsichtbar in jeder Liste, von niemandem
 * mehr adressierbar und nur noch über den Speicherverbrauch auffindbar. Ein sichtbarer Rest ist
 * billiger als ein unsichtbarer.
 *
 * ⚠ SCHRITT 1 IST SCHON GESCHEHEN, WENN SCHRITT 2 SCHEITERT — und das ist der Grund, warum diese
 * Action auch dann `revalidatePath` ruft und einen FEHLERTEXT liefert statt einfach abzubrechen:
 * der Zählpunkt ist bereits zurückgesetzt, die Station zeigt wieder die Ja/Nein-Frage, ein neuer
 * Upload ist also möglich. Wer nur „das hat nicht geklappt" läse, hielte den Zustand für
 * unverändert und versuchte es ein zweites Mal — mit demselben Ergebnis.
 *
 * ⚠ ES WIRD NICHT UMGELEITET, aus demselben Grund wie beim Upload (s. Kopf dieser Datei): die
 * Station muss danach die ursprüngliche Frage zeigen, und dass sie das tut, sieht nur, wer auf ihr
 * bleibt.
 */
export async function removeMeteringPointLoadProfileAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) {
    // Kommt wie die Projekt-Kennung als verstecktes Feld aus unserer eigenen Seite.
    return { formError: GENERIC }
  }

  const supabase = await createClient()

  // ── Schritt 1: zurücksetzen. Liefert die noch gültige Dokument-Kennung mit.
  const { data: reset, error: resetError } = await supabase.rpc(
    'admin_reset_metering_point_load_profile',
    { p_metering_point_id: meteringPointId },
  )

  if (resetError) {
    if (isForbidden(resetError)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] admin_reset_metering_point_load_profile:', resetError)
    return { formError: GENERIC }
  }

  const resetResult = (reset ?? {}) as Record<string, unknown>
  if (resetResult.status === 'not_found') {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }
  if (resetResult.status !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Lastgang zurücksetzen):', reset)
    return { formError: GENERIC }
  }

  /*
   * ⚠ AB HIER IST DER ZÄHLPUNKT ZURÜCKGESETZT. Jeder weitere Ausgang dieser Funktion muss die
   * Station neu rendern lassen — sonst zeigte der Browser weiter die Zusammenfassung eines
   * Lastgangs, den es nicht mehr gibt.
   */
  revalidatePath(projectDataEntryHref(projectId))

  const documentId = typeof resetResult.document_id === 'string' ? resetResult.document_id : null
  const storagePath = typeof resetResult.storage_path === 'string' ? resetResult.storage_path : null

  if (documentId === null) {
    /*
     * Der Zählpunkt trug keine Quelle. Erreichbar, wenn jemand zweimal hintereinander klickt oder
     * ein zweiter Tab schneller war — dann ist das Ziel bereits hergestellt, und genau das wird
     * gemeldet statt eines Fehlers über einen Zustand, den der Klickende wollte.
     */
    return { success: 'Es war kein Lastgang hinterlegt. Der Zählpunkt ist leer.' }
  }

  // ── Schritt 2: die Bytes. Scheitert das, bleibt die DB-Zeile ABSICHTLICH stehen — s. Kopf.
  if (storagePath !== null) {
    const removed = await removeProjectDocumentBytes(storagePath)
    if (!removed.ok) {
      console.error('[admin/dateneingabe] removeProjectDocumentBytes:', removed.message)
      return {
        formError:
          'Der Lastgang ist vom Zählpunkt entfernt — Sie können jetzt eine neue Datei hochladen. ' +
          'Die alte Datei liess sich allerdings nicht aus der Ablage löschen; ihr Eintrag bleibt ' +
          'deshalb bewusst sichtbar stehen, statt still zu verschwinden.',
      }
    }
  }

  // ── Schritt 3: die Zeile. Der Wrapper prüft, dass kein Zählpunkt mehr auf sie zeigt (`in_use`).
  const { data: deleted, error: deleteError } = await supabase.rpc(
    'admin_delete_metering_point_document',
    { p_metering_point_id: meteringPointId, p_document_id: documentId },
  )

  const leftoverRow =
    'Der Lastgang ist vom Zählpunkt entfernt — Sie können jetzt eine neue Datei hochladen. Der ' +
    'Eintrag der alten Datei liess sich allerdings nicht löschen und bleibt in der Dokumentenliste ' +
    'des Projekts stehen.'

  if (deleteError) {
    if (isForbidden(deleteError)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] admin_delete_metering_point_document:', deleteError)
    return { formError: leftoverRow }
  }

  if (statusOf(deleted) !== 'ok') {
    /*
     * `not_found`, `unknown_document`, `in_use` — für den Admin gibt es daran nichts zu tun, und
     * der Zählpunkt ist in allen drei Fällen bereits frei. Die Ursache gehört ins Log.
     */
    console.error('[admin/dateneingabe] unerwartete Antwort (Dokument löschen):', deleted)
    return { formError: leftoverRow }
  }

  return { success: 'Lastgang entfernt. Sie können eine neue Datei hochladen.' }
}


// ── Standardprofil ───────────────────────────────────────────────────────────────────────────────
/**
 * Erzeugt ein synthetisches Standardlastprofil aus dem Jahresverbrauch und schreibt seine
 * Metadaten an einen Zählpunkt — der „Nein"-Zweig der Lastgang-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIESELBE REIHENFOLGE WIE BEIM UPLOAD: ERST ERZEUGEN, DANN SCHREIBEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. Eingabe prüfen (rein) und, wo nötig, aus der Haushaltsgrösse schätzen
 *   2. `generateStandardProfileMetadata` — DETERMINISTISCH, kein Netz, kein Nebeneffekt
 *   3. den Jahresverbrauch samt Herkunftsvermerk in den Entwurf des Zählpunkts
 *   4. `set_metering_point_standard_profile`
 *
 * Schritt 2 lehnt eine unbrauchbare Eingabe ab, bevor irgendetwas geschrieben ist — wortgleich zur
 * Begründung beim Datei-Upload. Dass es hier billiger wäre, falsch herum zu laufen (es gibt keine
 * Datei, die liegen bliebe), ändert daran nichts: ein Entwurf, der einen Jahresverbrauch trägt, zu
 * dem kein Profil existiert, wäre für den nächsten Schritt nicht von einem gültigen zu
 * unterscheiden.
 *
 * ⚠ SCHRITT 3 STEHT VOR SCHRITT 4, UND NICHT UMGEKEHRT. Bricht es dazwischen ab, steht die EINGABE
 * ohne den daraus erzeugten Zeitraum — der Admin sieht die Frage erneut, trägt dieselbe Zahl ein
 * und ist am Ziel. Umgekehrt stünde ein Zeitraum da, dessen Grundlage nirgends steht: die Station
 * zeigte ein Standardprofil ohne Jahresverbrauch, und woraus es entstand, wüsste niemand mehr.
 *
 * ⚠ ES WIRD NICHT UMGELEITET, aus demselben Grund wie beim Upload: Zeitraum und Jahresverbrauch
 * sind das Einzige, woran ein Mensch erkennt, womit gerechnet werden wird.
 *
 * ── ⚠ DAS SEGMENT KOMMT AUS DER DATENBANK, NICHT AUS DEM FORMULAR ──────────────────────────────
 * Es entscheidet, WELCHE Kurve gilt — und damit über den Verbrauchsverlauf eines ganzen Jahres.
 * Als verstecktes Feld mitgeschickt wäre es eine Behauptung des Browsers über den Serverzustand,
 * und ein veralteter Tab (Segment inzwischen gewechselt) erzeugte ein Profil nach der falschen
 * Kurve, ohne dass irgendetwas fehlschlüge. Der zusätzliche Roundtrip ist der Preis dafür, dass
 * diese eine Angabe nicht geraten wird.
 */
export async function saveMeteringPointStandardProfileAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) {
    // Kommt wie die Projekt-Kennung als verstecktes Feld aus unserer eigenen Seite.
    return { formError: GENERIC }
  }

  const rawAnnual = String(formData.get('annualKwh') ?? '')
  const rawPersons = String(formData.get('persons') ?? '')
  const mode = String(formData.get('mode') ?? 'direct')
  const values = { annualKwh: rawAnnual, persons: rawPersons }

  const supabase = await createClient()

  // ── Das Segment, und damit die Kurve ──────────────────────────────────────────────────────────
  const projectRes = await supabase.rpc('admin_get_project', { p_id: projectId })
  if (projectRes.error) {
    if (isForbidden(projectRes.error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] admin_get_project (Standardprofil):', projectRes.error)
    return { formError: GENERIC, values }
  }

  const project = readAdminProject(projectRes.data)
  if (project === null || project === 'not_found') return { formError: UNKNOWN_PROJECT, values }

  const segment = (PROJECT_SEGMENTS as readonly string[]).includes(project.segment ?? '')
    ? (project.segment as ProjectSegment)
    : null
  const customerClass = customerClassForSegment(segment)
  if (customerClass === null) {
    /*
     * Über den Wizard nicht erreichbar: ohne Segment gibt es genau EINE Station, und das ist die
     * Segment-Frage. Beantwortet statt ignoriert, weil eine Server Action ein Endpunkt ist.
     */
    return {
      formError:
        'Für dieses Projekt ist noch nicht festgelegt, ob es ein Privathaushalt oder ein Betrieb ' +
        'ist. Ohne diese Angabe steht nicht fest, welche Verbrauchskurve gilt.',
      values,
    }
  }

  // ── Die Zahl: eingetragen oder geschätzt ──────────────────────────────────────────────────────
  let annualConsumptionKwh: number
  let source: 'measured' | 'assumed'
  let note: string | undefined

  if (mode === 'persons') {
    const persons = Number(rawPersons.trim())
    const estimate = estimateHouseholdConsumptionKwh(persons)
    if (estimate === null) {
      return {
        fieldErrors: {
          persons: `Bitte eine ganze Zahl zwischen 1 und ${MAX_HOUSEHOLD_PERSONS} angeben.`,
        },
        values,
      }
    }
    annualConsumptionKwh = estimate
    source = 'assumed'
    note = householdEstimateNote(persons)
  } else {
    const parsed = parseAnnualConsumptionKwh(rawAnnual)
    if (!parsed.ok) {
      return { fieldErrors: { annualKwh: annualConsumptionMessage(parsed.reason) }, values }
    }
    annualConsumptionKwh = parsed.value
    source = 'measured'
  }

  // ── Schritt 2: erzeugen. Rein, deterministisch, ohne Nebeneffekt — s. Kopf.
  const year = standardProfileYear(new Date())
  const generated = generateStandardProfileMetadata({
    annualConsumptionKwh,
    customerClass,
    year,
    timeZone: STANDARD_PROFILE_TIME_ZONE,
  })

  if (!generated.ok) {
    switch (generated.reason) {
      case 'no_profile_for_class':
        /*
         * Für Betriebe gibt es (noch) keine Profilkurve — Delta 8 lässt offen, welches G-Profil in
         * Österreich üblich ist. Die Oberfläche fragt deshalb gar nicht erst; der Satz steht hier
         * als Tiefenstaffelung, damit ein Aufruf daneben eine Auskunft bekommt statt eines
         * allgemeinen Fehlers (dieselbe Zurückhaltung wie beim Abweisungsgrund in
         * `admin_approve_partner_application`, der durch eine spätere Sperre unerreichbar wurde).
         */
        return {
          formError:
            'Für Betriebe ist noch keine Standard-Verbrauchskurve hinterlegt. Ein aus dem ' +
            'Haushaltsprofil abgeleiteter Verlauf wäre geraten — bitte laden Sie einen echten ' +
            'Lastgang hoch.',
          values,
        }
      case 'invalid_consumption':
        return {
          fieldErrors: { annualKwh: annualConsumptionMessage('invalid') },
          values,
        }
      default:
        // `invalid_year` und `empty_profile`: beide beschreiben einen Widerspruch im Generator, an
        // dem der Admin nichts ändern kann. Die Ursache gehört ins Log.
        console.error('[admin/dateneingabe] Standardprofil nicht erzeugbar:', generated.reason)
        return { formError: GENERIC, values }
    }
  }

  const metadata = generated.metadata

  // ── Schritt 3: die EINGABE in den Entwurf des Zählpunkts ─────────────────────────────────────
  /*
   * ⚠ DER ENTWURF WIRD FRISCH GELESEN, NICHT AUS EINER PROP ÜBERNOMMEN.
   * `update_metering_point_draft` ERSETZT ihn, er verschmilzt ihn nicht (bewusst: eine flache
   * Verschmelzung könnte einen Schlüssel nie wieder entfernen). Wer einen veralteten Stand
   * hineingibt, macht damit jede Angabe rückgängig, die seit dem Rendern dazugekommen ist —
   * derselbe Grund, aus dem der Chat-Ausführer vor jedem Schreibvorgang neu liest.
   */
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] list_metering_points (Standardprofil):', listRes.error)
    return { formError: GENERIC, values }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.', values }
  }

  const nextDraft = setDraftField(
    point.draft,
    ANNUAL_CONSUMPTION_KWH_KEY,
    annualConsumptionKwh,
    source,
    note,
    new Date(),
  )

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    /*
     * ⚠ Die Zusicherung ist nötig und harmlos: `setDraftField` liefert ein
     * `Record<string, unknown>`, der generierte Parametertyp ist `Json`. Die beiden sind zur
     * Laufzeit dasselbe (der Entwurf kam als `jsonb` aus derselben Datenbank und geht unverändert
     * zurück) — TypeScript kann das nur nicht wissen, weil `unknown` auch Nicht-JSON zuliesse.
     */
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] update_metering_point_draft:', draftRes.error)
    return { formError: GENERIC, values }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Entwurf):', draftRes.data)
    return { formError: GENERIC, values }
  }

  // ── Schritt 4: die Metadaten des erzeugten Profils an den Zählpunkt ──────────────────────────
  /*
   * ⚠ EIN ANDERER WRAPPER ALS BEIM UPLOAD, und das ist keine Bequemlichkeit:
   * `set_metering_point_load_profile` weist `p_source_document_id => null` mit `invalid_document`
   * ab. Ein Standardprofil hat keine Quelldatei und soll keine vortäuschen — die Begründung steht
   * im Kopf der Migration 20260911200000. Gemeinsam ist den beiden, dass sie dieselben Spalten
   * füllen: der KI-Check muss später nicht unterscheiden, woher der Zeitraum stammt.
   */
  const { data, error } = await supabase.rpc('set_metering_point_standard_profile', {
    p_metering_point_id: meteringPointId,
    p_interval_minutes: metadata.intervalMinutes,
    p_covered_from: metadata.coveredFrom,
    p_covered_to: metadata.coveredTo,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] set_metering_point_standard_profile:', error)
    return { formError: GENERIC, values }
  }

  switch (statusOf(data)) {
    case 'ok':
      break
    case 'not_found':
      return {
        formError:
          'Diesen Zählpunkt gibt es nicht (mehr). Der Jahresverbrauch ist gespeichert, das Profil ' +
          'konnte aber nicht zugeordnet werden. Bitte laden Sie die Seite neu.',
        values,
      }
    default:
      // `invalid_interval`, `invalid_range` — ein Widerspruch zwischen dem, was der Generator
      // geliefert hat, und dem, was die Datenbank zulässt. Für den Admin nichts zu tun.
      console.error('[admin/dateneingabe] unerwartete Antwort (Standardprofil):', data)
      return { formError: GENERIC, values }
  }

  // ⚠ Ohne das bliebe die Zusammenfassung unsichtbar — s. die Begründung beim Upload.
  revalidatePath(projectDataEntryHref(projectId))

  return {
    success: `Standardprofil für ${year} erzeugt, gerechnet mit ${formatKwh(annualConsumptionKwh)} im Jahr.`,
  }
}

/**
 * Die Zeitzone der Tagesform eines erzeugten Profils.
 *
 * ⚠ Ein Pflichtparameter der Engine, ohne Vorgabewert — „eine stillschweigend angenommene wäre eine
 * zweite Wahrheit". Hier ist sie gesetzt statt erfragt: der Wizard ist der Admin-Weg für
 * österreichische Kunden, und eine Auswahl daneben wäre ein Feld, das in jedem realen Fall denselben
 * Wert trägt. ⚠ Dieselbe Zahl steht als `STANDARD_PROFILE_TIMEZONE` in
 * `apps/website/lib/constants.ts` — sie zusammenzulegen hiesse, den öffentlichen Rechner
 * anzufassen; laufen sie je auseinander, erzeugen die zwei Wege verschiedene Tagesverläufe.
 */

const STANDARD_PROFILE_TIME_ZONE = AUSTRIA_TIME_ZONE

/** Die drei Ablehnungsgründe einer Jahresverbrauchs-Eingabe, jeder mit eigener Auskunft. */
function annualConsumptionMessage(reason: 'missing' | 'invalid' | 'too_large'): string {
  switch (reason) {
    case 'missing':
      return 'Bitte den Jahresverbrauch in kWh eintragen — er steht auf der Stromrechnung.'
    case 'too_large':
      return (
        `Über ${formatKwh(MAX_STANDARD_PROFILE_ANNUAL_KWH)} im Jahr ist ein ` +
        'Haushalts-Standardprofil keine belastbare Grundlage mehr. Für diese Grössenordnung bitte ' +
        'einen echten Lastgang hochladen.'
      )
    default:
      return 'Bitte eine Zahl grösser als 0 eintragen.'
  }
}

