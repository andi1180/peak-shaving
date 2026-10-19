'use server'

import { revalidatePath } from 'next/cache'
import { INVOICE_SCAN_MIN_ATTEMPT_MS, MAX_INVOICE_FILE_BYTES, extractInvoiceData } from 'extractors'
import {
  claimDirectUpload,
  discardDirectUpload,
  issueDirectUpload,
  registerDirectUpload,
} from '@/lib/project-documents/direct-upload'
import type { DirectUploadGrant } from '@/lib/project-documents/direct-upload-client'
import { getProjectDocumentBytes } from '@/lib/project-documents/storage'
import { dropInapplicableBillingModel, setDraftField } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import { replaceInvoiceDraftFields } from './invoice-draft-fields'
import { mapWithConcurrency } from './map-with-concurrency'
import {
  INVOICE_SKIPPED_KEY,
  MAX_INVOICES_PER_UPLOAD,
  foldStoredInvoices,
  readStoredInvoiceExtractions,
  withInvoicePriceBasis,
  withStoredInvoiceExtractions,
  type StoredInvoiceExtraction,
} from './invoice-extractions'
import { readKnownOperatorIdsForProject } from './grid-operators'
import { readMeteringPointList } from './metering-points'
import { projectDataEntryHref } from './projects'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'
import {
  FORBIDDEN,
  GENERIC,
  PDF_MEDIA_TYPE,
  UNKNOWN_PROJECT,
  UUID,
  isForbidden,
  statusOf,
} from './data-entry-actions-shared'

/**
 * Rechnungen der Rechnung-Station: ABLEGEN (direkt vom Browser in den Storage) und AUSLESEN (aus
 * dem Storage) sind zwei getrennte Schritte.
 *
 * Grund: Vercel weist jeden Function-Rumpf über 4,5 MB ab, bevor die Action läuft. Über FormData
 * passten nur wenige Rechnungen in einen Vorgang. Jetzt trägt keine Anfrage an die Anwendung
 * Dateiinhalt — nur Kennungen (Muster Lastgang, `lib/project-documents/direct-upload.ts`).
 *
 *   1. `requestInvoiceUploadAction`  — je Datei: prüfen, Kennung + signierte URL ausgeben.
 *   2. (Browser lädt an die URL.)
 *   3. `registerInvoiceUploadAction` — je Datei: Grösse messen, Zeile eintragen; sonst verwerfen.
 *      Abgebrochene Uploads räumt `discardInvoiceUploadAction` ab.
 *   4. `readStoredInvoicesAction`    — alle abgelegten Dateien EINES Vorgangs auslesen und den
 *      Entwurf einmal schreiben.
 *
 * Abgelegt wird damit VOR dem Lesen, wie schon bisher: eine unlesbare Rechnung ist trotzdem die
 * echte Rechnung des Kunden und gehört ins Projekt (s. Kopf von `readStoredInvoicesAction`).
 */

/** Höchstens so viele Rechnungs-Scans gleichzeitig je Vorgang. */
const INVOICE_SCAN_CONCURRENCY = 4
/** Zeit für alle Scans eines Vorgangs; der Rest von `maxDuration` 300 s bleibt fürs Lesen der Ablage und den Entwurf. */
const INVOICE_UPLOAD_BUDGET_MS = 250_000

/**
 * Warum eine einzelne Datei nicht gelesen werden konnte.
 *
 * ── ⚠ DIE FÜNF ERSTEN SIND WORTWÖRTLICH DIE ZUSTÄNDE DES ÖFFENTLICHEN RECHNUNGS-SCANS ─────────
 * `apps/website/components/flow/invoice-scan-panel.tsx` führt dieselbe Liste (`ERROR_TEXT`), und
 * sie wird hier bewusst nicht erweitert oder umbenannt: es ist derselbe Extraktor, dieselben
 * Ausgänge, und zwei Vokabulare für dieselben Zustände liefen beim nächsten Umbau auseinander.
 *
 * `storage_failed`: die abgelegte Datei liess sich nicht aus der Ablage lesen — kein Fehler der
 * Datei, deshalb nicht unter `unavailable`.
 */
type InvoiceFileFailure =
  | 'no_file'
  | 'wrong_type'
  | 'too_large'
  | 'not_configured'
  | 'unreadable'
  | 'unavailable'
  | 'timeout'
  | 'not_started'
  | 'storage_failed'

/**
 * Der Grund je Datei, in einem Satz — kürzer als im öffentlichen Rechner, weil bis zu zwölf Gründe
 * in EINER Zeile stehen. `wrong_type` und `unreadable` verweisen dort auf andere Einstiege, die es
 * hier nicht gibt.
 */
const INVOICE_FAILURE_TEXT: Record<InvoiceFileFailure, string> = {
  no_file: 'Die Datei scheint leer zu sein.',
  wrong_type: 'Nur PDF — ein Foto oder Screenshot der Rechnung lässt sich nicht auslesen.',
  too_large: `Grösser als ${Math.floor(MAX_INVOICE_FILE_BYTES / (1024 * 1024))} MB. Eine Rechnung von ein bis wenigen Seiten liegt normalerweise weit darunter.`,
  not_configured: 'Das Auslesen von Rechnungen ist auf diesem Server nicht eingerichtet.',
  unreadable:
    'Auf diesem Dokument war keine der gesuchten Angaben zu finden — das kann an der Bildqualität liegen, aber auch daran, dass es keine Strom- oder Netzrechnung ist.',
  unavailable: 'Das Auslesen ist fehlgeschlagen. Bitte später noch einmal versuchen.',
  timeout:
    'Das Auslesen hat zu lange gedauert und wurde abgebrochen; die Datei ist abgelegt. Bitte diese Rechnung einzeln noch einmal hochladen.',
  not_started:
    'Nicht mehr gelesen — die Zeit für diesen Vorgang war aufgebraucht; die Datei ist abgelegt. Bitte in einem eigenen Vorgang noch einmal hochladen.',
  storage_failed:
    'Die abgelegte Datei liess sich nicht aus der Ablage des Projekts lesen; sie wurde deshalb nicht ausgelesen.',
}

/** Das Ergebnis einer einzelnen Datei — gelesen, oder benannt gescheitert. */
type InvoiceFileResult =
  | { ok: true; entry: StoredInvoiceExtraction }
  | { ok: false; filename: string; reason: InvoiceFileFailure }

// ── Ablegen ──────────────────────────────────────────────────────────────────────────────────────

export type InvoiceUploadRequest = {
  projectId: string
  meteringPointId: string
  fileName: string
  fileSize: number
  contentType: string
}

/** Je Datei: Kennung + signierte URL, oder der Grund der Ablehnung als Satz. */
export async function requestInvoiceUploadAction(
  input: InvoiceUploadRequest,
): Promise<DirectUploadGrant<string>> {
  const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
  const meteringPointId = typeof input?.meteringPointId === 'string' ? input.meteringPointId : ''
  if (!UUID.test(projectId)) return { ok: false, state: UNKNOWN_PROJECT }
  if (!UUID.test(meteringPointId)) return { ok: false, state: GENERIC }

  const fileName = typeof input.fileName === 'string' ? input.fileName : ''
  const fileSize = typeof input.fileSize === 'number' ? input.fileSize : 0
  const contentType = typeof input.contentType === 'string' ? input.contentType : ''
  if (!(fileSize > 0) || fileName.trim() === '')
    return { ok: false, state: INVOICE_FAILURE_TEXT.no_file }
  // Der Typ ist eine Angabe des Browsers; die eigentliche Sperre ist der `document`-Block der API.
  if (contentType !== PDF_MEDIA_TYPE) return { ok: false, state: INVOICE_FAILURE_TEXT.wrong_type }
  if (fileSize > MAX_INVOICE_FILE_BYTES) return { ok: false, state: INVOICE_FAILURE_TEXT.too_large }

  // Der Zählpunkt muss zu DIESEM Projekt gehören, bevor irgendetwas hochgeladen wird.
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { ok: false, state: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Rechnung ablegen):', listRes.error)
    return { ok: false, state: GENERIC }
  }
  if (!readMeteringPointList(listRes.data)?.some((p) => p.id === meteringPointId)) {
    return {
      ok: false,
      state: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.',
    }
  }

  const issued = await issueDirectUpload(projectId, {
    name: fileName,
    size: fileSize,
    type: PDF_MEDIA_TYPE,
  })
  if (!issued.ok) {
    if (issued.reason === 'not_found') return { ok: false, state: UNKNOWN_PROJECT }
    if (issued.reason === 'too_large') return { ok: false, state: INVOICE_FAILURE_TEXT.too_large }
    return { ok: false, state: GENERIC }
  }
  return { ok: true, documentId: issued.documentId, uploadUrl: issued.uploadUrl }
}

export type InvoiceUploadCompletion = {
  projectId: string
  documentId: string
  fileName: string
}

export type InvoiceUploadRegistration = { ok: true } | { ok: false; error: string }

/**
 * Nach dem PUT: die Datei aus dem Bucket messen und eintragen. Die Grösse im Antrag war eine
 * Angabe des Browsers — gemessen wird hier; zu Grosses wird verworfen, nicht eingetragen.
 */
export async function registerInvoiceUploadAction(
  input: InvoiceUploadCompletion,
): Promise<InvoiceUploadRegistration> {
  const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
  const documentId = typeof input?.documentId === 'string' ? input.documentId : ''
  const fileName = typeof input?.fileName === 'string' ? input.fileName : ''
  if (!UUID.test(projectId)) return { ok: false, error: UNKNOWN_PROJECT }
  if (!UUID.test(documentId) || fileName.trim() === '') return { ok: false, error: GENERIC }

  const claim = await claimDirectUpload(projectId, documentId)
  if (!claim.ok) {
    switch (claim.reason) {
      case 'not_found':
        return { ok: false, error: UNKNOWN_PROJECT }
      case 'missing':
        return {
          ok: false,
          error: 'Die Datei ist beim Speicher nicht angekommen. Bitte erneut versuchen.',
        }
      case 'too_large':
        return { ok: false, error: INVOICE_FAILURE_TEXT.too_large }
      default:
        console.error('[admin/dateneingabe] Rechnung übernehmen:', claim.reason)
        return { ok: false, error: GENERIC }
    }
  }
  if (claim.bytes.byteLength > MAX_INVOICE_FILE_BYTES) {
    await discardDirectUpload(projectId, documentId)
    return { ok: false, error: INVOICE_FAILURE_TEXT.too_large }
  }

  const registered = await registerDirectUpload(projectId, documentId, {
    name: fileName,
    type: PDF_MEDIA_TYPE,
  })
  if (!registered.ok) {
    return { ok: false, error: registered.reason === 'not_found' ? UNKNOWN_PROJECT : GENERIC }
  }
  return { ok: true }
}

/**
 * Räumt ein angefangenes Objekt ab (Übertragung oder Eintragen gescheitert). Eine bereits
 * eingetragene Datei fasst `claimDirectUpload` nicht an — nur dann wird hier verworfen.
 */
export async function discardInvoiceUploadAction(input: {
  projectId: string
  documentId: string
}): Promise<void> {
  const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
  const documentId = typeof input?.documentId === 'string' ? input.documentId : ''
  if (!UUID.test(projectId) || !UUID.test(documentId)) return
  const claim = await claimDirectUpload(projectId, documentId)
  if (claim.ok) await discardDirectUpload(projectId, documentId)
}

// ── Auslesen ─────────────────────────────────────────────────────────────────────────────────────

export type StoredInvoicesInput = {
  projectId: string
  meteringPointId: string
  documentIds: string[]
}

type StoredInvoiceDocument = {
  documentId: string
  filename: string
  contentType: string
  storagePath: string
}

/**
 * Liest die abgelegten Rechnungen EINES Vorgangs aus und schreibt den zusammengeführten Stand in
 * den Entwurf.
 *
 * ── ⚠ DER AUFRUF IST WIEDERHOLBAR — ER ERGÄNZT, ER ERSETZT NICHT ────────────────────────────
 * Bereits gelesene Rechnungen bleiben stehen; die neuen kommen dazu, und zusammengeführt wird über
 * ALLE. Ausgelesen (und damit bezahlt) werden ausschliesslich die Dokumente DIESES Vorgangs.
 * Eine Kennung, die schon am Zählpunkt liegt, wird abgewiesen — sonst stünde derselbe Beleg zweimal
 * in der Zusammenführung.
 *
 * ── ⚠ JEDES DOKUMENT MUSS ZU DIESEM PROJEKT GEHÖREN ─────────────────────────────────────────
 * Die Kennungen kommen vom Browser. Zuerst beantwortet die Datenbank für JEDES (`get_project_document`,
 * `project_accessible`), ob es dazugehört; passt eines nicht, wird gar nichts gelesen.
 *
 * ── EINE GESCHEITERTE DATEI BRICHT DEN VORGANG NICHT AB ───────────────────────────────────────
 * Die lesbaren werden verarbeitet, die gescheiterte wird NAMENTLICH mit ihrem Grund gemeldet. Was
 * dabei stehen bleiben kann, ist ein abgelegtes Dokument ohne Eintrag im Entwurf — die harmlose
 * Richtung: eine Rechnung zu viel in der Dokumentenliste, nicht eine Angabe, die auf nichts zeigt.
 *
 * ── ⚠ DIE DATEIEN LAUFEN NEBENLÄUFIG ──────────────────────────────────────────────────────────
 * Nacheinander wäre die Wanduhr-Zeit die SUMME der Scans (zwölf mal rund zehn Sekunden) und liefe
 * in `maxDuration` der Seite (300 s). Der Entwurf wird EINMAL am Ende geschrieben — anders als im
 * Chat-Ausführer, wo zwei nebenläufige `set_draft_field` einander überschrieben.
 *
 * ⚠ ES WIRD NICHT UMGELEITET: die zusammengeführten Werte und ein etwaiger Widerspruch sind das
 * Einzige, woran ein Mensch erkennt, ob die richtigen Rechnungen gelesen wurden.
 */
export async function readStoredInvoicesAction(
  _prev: AdminState,
  input: StoredInvoicesInput,
): Promise<AdminState> {
  const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
  if (!UUID.test(projectId)) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = typeof input?.meteringPointId === 'string' ? input.meteringPointId : ''
  // Kommt wie die Projekt-Kennung aus unserer eigenen Seite.
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const rawIds = Array.isArray(input?.documentIds) ? input.documentIds : []
  if (!rawIds.every((id) => typeof id === 'string' && UUID.test(id))) return { formError: GENERIC }
  const documentIds = [...new Set(rawIds)]

  if (documentIds.length === 0) {
    return { fieldErrors: { files: 'Bitte mindestens eine PDF-Rechnung auswählen.' } }
  }
  if (documentIds.length > MAX_INVOICES_PER_UPLOAD) {
    return {
      fieldErrors: {
        files:
          `Höchstens ${MAX_INVOICES_PER_UPLOAD} Rechnungen pro Vorgang — ausgewählt waren ` +
          `${documentIds.length}. Es wurde nichts ausgelesen; die übrigen ` +
          `können Sie anschliessend in einem zweiten Vorgang hinzufügen.`,
      },
    }
  }

  // ── Zugehörigkeit: jedes Dokument zu diesem Projekt, keines schon am Zählpunkt.
  const db = await createClient()
  const documents: StoredInvoiceDocument[] = []
  for (const documentId of documentIds) {
    const { data, error } = await db.rpc('get_project_document', { p_document_id: documentId })
    if (error && isForbidden(error)) return { formError: FORBIDDEN }
    const doc = (data as { status?: string; document?: Record<string, unknown> } | null)?.document
    if (error || statusOf(data) !== 'ok' || !doc || doc.project_id !== projectId) {
      return {
        formError:
          'Mindestens eine Datei gehört nicht zu diesem Projekt oder ist nicht mehr vorhanden. ' +
          'Es wurde nichts ausgelesen. Bitte laden Sie die Seite neu.',
      }
    }
    documents.push({
      documentId,
      filename: String(doc.original_filename ?? '').trim() || 'Unbenannte Datei',
      contentType: String(doc.content_type ?? ''),
      storagePath: String(doc.storage_path ?? ''),
    })
  }

  const before = await db.rpc('list_metering_points', { p_project_id: projectId })
  if (before.error) {
    if (isForbidden(before.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Rechnungen prüfen):', before.error)
    return { formError: GENERIC }
  }
  const pointBefore = readMeteringPointList(before.data)?.find((p) => p.id === meteringPointId)
  if (!pointBefore) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }
  const already = new Set(readStoredInvoiceExtractions(pointBefore.draft).map((e) => e.documentId))
  if (documents.some((doc) => already.has(doc.documentId))) {
    return {
      formError:
        'Mindestens eine dieser Rechnungen ist an diesem Zählpunkt schon gelesen. Es wurde nichts ausgelesen.',
    }
  }

  const deadline = Date.now() + INVOICE_UPLOAD_BUDGET_MS
  const results = await mapWithConcurrency(documents, INVOICE_SCAN_CONCURRENCY, (doc) =>
    readOneStoredInvoice(doc, deadline),
  )

  const read = results.filter(
    (result): result is Extract<InvoiceFileResult, { ok: true }> => result.ok,
  )
  const failed = results.filter((result) => !result.ok)

  const failureText =
    failed.length === 0
      ? null
      : failed
          .map((result) =>
            result.ok
              ? ''
              : `„${result.filename}": ${INVOICE_FAILURE_TEXT[result.reason as InvoiceFileFailure]}`,
          )
          .join(' · ')

  if (read.length === 0) {
    // Nichts zu speichern. Der Entwurf wird gar nicht erst gelesen — es gäbe nichts zu ändern.
    return { fieldErrors: { files: failureText ?? GENERIC } }
  }

  /*
   * ⚠ DER ENTWURF WIRD FRISCH GELESEN, NICHT AUS EINER PROP ÜBERNOMMEN — und zwar HIER, nach den
   * Scans: `update_metering_point_draft` ERSETZT ihn, und ein Stand von vor mehreren Sekunden
   * Modellaufruf machte jede Angabe rückgängig, die inzwischen dazugekommen ist (wortgleiche
   * Begründung wie beim Standardprofil-Zweig).
   */
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Rechnungen):', listRes.error)
    return { formError: GENERIC }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return {
      formError:
        'Diesen Zählpunkt gibt es nicht (mehr). Die Rechnungen sind im Projekt abgelegt, aber ' +
        'keinem Zählpunkt zugeordnet. Bitte laden Sie die Seite neu.',
    }
  }

  const stored = readStoredInvoiceExtractions(point.draft)
  const all = [...stored, ...read.map((result) => result.entry)]
  const fold = foldStoredInvoices(all, await readKnownOperatorIdsForProject(supabase, projectId))
  const { conflicts } = fold

  /*
   * ⚠ EIN EINZIGER SCHREIBVORGANG. Der Seiteneintrag und die übernommenen Werte gehören zusammen:
   * die Werte sind die Auswertung genau dieser Liste. Getrennt geschrieben gäbe es einen Zustand,
   * in dem der Entwurf Werte trägt, deren Belege fehlen (oder umgekehrt) — und `update_metering_point_draft`
   * ERSETZT ohnehin, ein zweiter Aufruf müsste also den ersten mitführen.
   */
  let nextDraft = withInvoicePriceBasis(withStoredInvoiceExtractions(point.draft, all), fold)
  const now = new Date()
  /*
   * `measured`: jeder dieser Werte steht übereinstimmend auf allen Rechnungen, die etwas dazu sagen.
   * Ein früher übernommener Wert, zu dem keine gelesene Rechnung mehr etwas sagt, wird entfernt;
   * Handeingaben und widersprüchliche Felder bleiben (s. `replaceInvoiceDraftFields`).
   */
  nextDraft = replaceInvoiceDraftFields(nextDraft, fold.values, conflicts, now, stored.length > 0)

  /*
   * ⚠ EIN ECHTER UPLOAD WIDERLEGT EIN FRÜHERES „ohne Rechnungsdaten fortgefahren" — deshalb wird
   * das Signal hier ausdrücklich auf `false` gesetzt und nicht bloss stehen gelassen.
   *
   * Ohne diese Zeile stünden ZWEI Aussagen gleichzeitig im Entwurf: „es gibt bewusst keine
   * Tarifangabe für diesen Zählpunkt" und eine gelesene Rechnung mit genau diesen Angaben. Ein
   * späterer Leser (Tarif-Station, Report) müsste raten, welche gilt — und die falsche Antwort
   * wäre die teure: eine Analyse, die den Kostenvergleich weglässt, obwohl die Werte vorliegen.
   *
   * ⚠ Es steht IM SELBEN Schreibvorgang, nicht daneben: `update_metering_point_draft` ERSETZT den
   * Entwurf; ein zweiter Aufruf gäbe es ein Fenster, in dem genau der widersprüchliche Stand von
   * oben gespeichert ist.
   *
   * ⚠ ABWEICHUNG VON DER AUFTRAGSFORMULIERUNG, offengelegt: der Auftrag nannte
   * `writeMeteringPointDraftFields`. Diese Action ruft den Helfer NICHT — sie liest den Entwurf
   * selbst, weil sie zusätzlich `withStoredInvoiceExtractions` anwenden muss (den Seiteneintrag
   * kann der Helfer nicht schreiben). Die Sache ist dieselbe: EIN Schreibvorgang, dieselbe
   * Herkunft `measured`, derselbe Zeitstempel.
   */
  nextDraft = setDraftField(nextDraft, INVOICE_SKIPPED_KEY, false, 'measured', undefined, now)

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie im Standardprofil-Zweig: zur Laufzeit dasselbe, TypeScript kann es nur nicht wissen.
    p_draft: dropInapplicableBillingModel(nextDraft) as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (Rechnungen):', draftRes.error)
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Rechnungen):', draftRes.data)
    return { formError: GENERIC }
  }

  // ⚠ Ohne das bliebe die Zusammenfassung unsichtbar — s. die Begründung beim Lastgang-Upload.
  revalidatePath(projectDataEntryHref(projectId))

  const gelesen = read.length === 1 ? 'Eine Rechnung gelesen' : `${read.length} Rechnungen gelesen`
  const gesamt =
    all.length === 1
      ? 'Es liegt jetzt eine Rechnung an diesem Zählpunkt.'
      : `Es liegen jetzt ${all.length} Rechnungen an diesem Zählpunkt.`
  const widerspruch =
    conflicts.length === 0
      ? ''
      : ' Einzelne Angaben widersprechen einander — sie stehen unten und wurden NICHT übernommen.'

  return {
    success: `${gelesen}. ${gesamt}${widerspruch}`,
    ...(failureText ? { fieldErrors: { files: failureText } } : {}),
  }
}

/**
 * Eine einzelne abgelegte Datei: prüfen, aus der Ablage lesen, auslesen.
 *
 * Wirft nie — jeder Ausgang ist ein benanntes Ergebnis. Ein Wurf aus einer der nebenläufigen
 * Ketten liesse `mapWithConcurrency` scheitern und nähme die anderen mit, obwohl sie längst gelesen
 * (und bezahlt) sind.
 */
async function readOneStoredInvoice(
  doc: StoredInvoiceDocument,
  deadline: number,
): Promise<InvoiceFileResult> {
  const filename = doc.filename

  // ── prüfen. Vor jedem abrechenbaren Aufruf.
  if (doc.contentType !== PDF_MEDIA_TYPE) return { ok: false, filename, reason: 'wrong_type' }
  if (deadline - Date.now() < INVOICE_SCAN_MIN_ATTEMPT_MS) {
    return { ok: false, filename, reason: 'not_started' }
  }

  // ── aus der Ablage lesen. Der Pfad kommt aus der Datenbank, nicht vom Browser.
  let bytes: ArrayBuffer
  try {
    const got = await getProjectDocumentBytes(doc.storagePath)
    if (!got.ok) {
      console.error('[admin/dateneingabe] getProjectDocumentBytes (Rechnung):', got.message)
      return { ok: false, filename, reason: 'storage_failed' }
    }
    bytes = got.bytes
  } catch (cause) {
    console.error('[admin/dateneingabe] getProjectDocumentBytes (Rechnung):', cause)
    return { ok: false, filename, reason: 'storage_failed' }
  }
  if (bytes.byteLength === 0) return { ok: false, filename, reason: 'no_file' }
  if (bytes.byteLength > MAX_INVOICE_FILE_BYTES) return { ok: false, filename, reason: 'too_large' }

  // ── auslesen. Der einzige abrechenbare Aufruf dieser Kette.
  const outcome = await extractInvoiceData(Buffer.from(bytes).toString('base64'), { deadline })

  if (!outcome.ok) {
    /*
     * `not_configured` und `unreadable` reisen als eigene Zustände weiter — „noch nicht
     * eingerichtet" ist kein Fehler der Datei, „darauf war nichts zu finden" keiner der Technik.
     * `api_error` wird zu `unavailable`: was genau schiefging, gehört ins Log, nicht in die
     * Oberfläche.
     */
    if (outcome.reason === 'not_configured')
      return { ok: false, filename, reason: 'not_configured' }
    if (outcome.reason === 'unreadable') return { ok: false, filename, reason: 'unreadable' }
    if (outcome.reason === 'timeout') return { ok: false, filename, reason: 'timeout' }
    return { ok: false, filename, reason: 'unavailable' }
  }

  return {
    ok: true,
    entry: { documentId: doc.documentId, filename, extraction: outcome.extraction },
  }
}
