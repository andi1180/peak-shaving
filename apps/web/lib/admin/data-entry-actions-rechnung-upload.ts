'use server'

import { revalidatePath } from 'next/cache'
import { MAX_INVOICE_FILE_BYTES } from 'extractors'
import {
  claimDirectUpload,
  discardDirectUpload,
  issueDirectUpload,
  registerDirectUpload,
} from '@/lib/project-documents/direct-upload'
import type { DirectUploadGrant } from '@/lib/project-documents/direct-upload-client'
import { createClient } from '@/lib/supabase/server'
import { mapWithConcurrency } from './map-with-concurrency'
import { MAX_INVOICES_PER_UPLOAD, readStoredInvoiceExtractions } from './invoice-extractions'
import {
  INVOICE_FAILURE_TEXT,
  INVOICE_UPLOAD_BUDGET_MS,
  buildInvoiceDraft,
  loadStoredInvoiceDocument,
  readOneStoredInvoice,
  type InvoiceFileResult,
  type StoredInvoiceDocument,
} from './invoice-stored-read'
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
    const loaded = await loadStoredInvoiceDocument(db, projectId, documentId)
    if (!loaded.ok && loaded.reason === 'forbidden') return { formError: FORBIDDEN }
    if (!loaded.ok) {
      return {
        formError:
          'Mindestens eine Datei gehört nicht zu diesem Projekt oder ist nicht mehr vorhanden. ' +
          'Es wurde nichts ausgelesen. Bitte laden Sie die Seite neu.',
      }
    }
    documents.push(loaded.document)
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
            result.ok ? '' : `„${result.filename}": ${INVOICE_FAILURE_TEXT[result.reason]}`,
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
  const { draft: nextDraft, conflicts } = buildInvoiceDraft({
    draft: point.draft,
    stored,
    all,
    knownOperatorIds: await readKnownOperatorIdsForProject(supabase, projectId),
    now: new Date(),
  })

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie im Standardprofil-Zweig: zur Laufzeit dasselbe, TypeScript kann es nur nicht wissen.
    p_draft: nextDraft as Json,
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
