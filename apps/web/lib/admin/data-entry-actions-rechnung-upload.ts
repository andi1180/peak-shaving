'use server'

import { MAX_INVOICE_FILE_BYTES } from 'extractors'
import {
  claimDirectUpload,
  discardDirectUpload,
  issueDirectUpload,
  registerDirectUpload,
} from '@/lib/project-documents/direct-upload'
import type { DirectUploadGrant } from '@/lib/project-documents/direct-upload-client'
import { createClient } from '@/lib/supabase/server'
import { INVOICE_FAILURE_TEXT } from './invoice-stored-read'
import { readMeteringPointList } from './metering-points'
import {
  FORBIDDEN,
  GENERIC,
  PDF_MEDIA_TYPE,
  UNKNOWN_PROJECT,
  UUID,
  isForbidden,
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
 *   4. Auslesen je Dokument und Abschluss: `data-entry-actions-rechnung-extract.ts`.
 *
 * Abgelegt wird VOR dem Lesen: eine unlesbare Rechnung ist trotzdem die echte Rechnung des Kunden
 * und gehört ins Projekt.
 */

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

