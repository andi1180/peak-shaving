import 'server-only'

import { MAX_PROJECT_DOCUMENT_BYTES, projectDocumentPath } from 'shared'

import { createClient } from '@/lib/supabase/server'
import {
  createProjectDocumentUploadUrl,
  getProjectDocumentBytes,
  removeProjectDocumentBytes,
} from './storage'

/**
 * Direkter Upload Browser → Storage, in drei Schritten, die jede Upload-Action gleich benutzt.
 *
 * Grund: Vercel begrenzt den Rumpf einer Function-Anfrage hart auf 4,5 MB (nicht konfigurierbar,
 * `bodySizeLimit` wirkt dort nicht). Eine Datei durch eine Server Action zu schicken, endet
 * oberhalb davon mit 413, bevor die Anwendung sie sieht. Hier trägt keine Anfrage an die Anwendung
 * Dateiinhalt — nur Kennungen.
 *
 *   1. `issueDirectUpload`  — Eigentum prüfen, Kennung + signierte URL ausgeben.
 *   2. (Browser lädt an die URL.)
 *   3. `claimDirectUpload`  — die Bytes aus dem Bucket holen; danach entweder
 *      `registerDirectUpload` (Zeile eintragen) oder `discardDirectUpload` (Objekt entfernen).
 *
 * Die Kennung kommt beim Abschluss vom Client zurück; den PFAD bildet immer der Server aus Projekt
 * und Kennung, und ein bereits eingetragenes Dokument wird nie angefasst — sonst liesse sich über
 * eine fremde Kennung eine abgelegte Rechnung einlesen oder löschen.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type WrapperResult = { status?: string; [key: string]: unknown }

export type DirectUploadFile = { name: string; size: number; type: string }

export type IssueResult =
  | { ok: true; documentId: string; uploadUrl: string }
  | { ok: false; reason: 'invalid_file' | 'too_large' | 'not_found' | 'storage_failed' }

export type ClaimResult =
  | { ok: true; bytes: ArrayBuffer }
  | {
      ok: false
      reason: 'not_found' | 'already_registered' | 'missing' | 'too_large' | 'storage_failed'
    }

export type RegisterResult = { ok: true } | { ok: false; reason: 'not_found' | 'record_failed' }

/** Leerer Browser-Typ wird wie beim bisherigen Upload neutral ersetzt. */
export function directUploadContentType(type: string): string {
  return type.trim() === '' ? 'application/octet-stream' : type
}

async function projectIsAccessible(projectId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_project', { p_id: projectId })
  return !error && (data as WrapperResult | null)?.status === 'ok'
}

export async function issueDirectUpload(
  projectId: string,
  file: DirectUploadFile,
  deps?: { newDocumentId?: () => string },
): Promise<IssueResult> {
  // Die angegebene Grösse ist eine Angabe des Browsers; die harte Grenze hält der Bucket
  // (`file_size_limit`), und `claimDirectUpload` misst die tatsächlichen Bytes noch einmal.
  if (!(file.size > 0) || file.name.trim() === '') return { ok: false, reason: 'invalid_file' }
  if (file.size > MAX_PROJECT_DOCUMENT_BYTES) return { ok: false, reason: 'too_large' }

  if (!(await projectIsAccessible(projectId))) return { ok: false, reason: 'not_found' }

  const documentId = deps?.newDocumentId?.() ?? crypto.randomUUID()
  const url = await createProjectDocumentUploadUrl(projectDocumentPath(projectId, documentId))
  if (!url.ok) {
    console.error('[project-documents] createSignedUploadUrl:', url.message)
    return { ok: false, reason: 'storage_failed' }
  }
  return { ok: true, documentId, uploadUrl: url.signedUrl }
}

export async function claimDirectUpload(
  projectId: string,
  documentId: string,
): Promise<ClaimResult> {
  if (!UUID.test(projectId) || !UUID.test(documentId)) return { ok: false, reason: 'not_found' }
  if (!(await projectIsAccessible(projectId))) return { ok: false, reason: 'not_found' }

  // Nur ein noch NICHT eingetragenes Objekt ist ein laufender Upload. Kann die Frage nicht
  // beantwortet werden, wird abgebrochen statt angefasst.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_project_document', {
    p_document_id: documentId,
  })
  if (error) {
    console.error('[project-documents] get_project_document:', error)
    return { ok: false, reason: 'storage_failed' }
  }
  if ((data as WrapperResult | null)?.status === 'ok') {
    return { ok: false, reason: 'already_registered' }
  }

  const got = await getProjectDocumentBytes(projectDocumentPath(projectId, documentId))
  if (!got.ok) return { ok: false, reason: 'missing' }

  if (got.bytes.byteLength > MAX_PROJECT_DOCUMENT_BYTES) {
    await discardDirectUpload(projectId, documentId)
    return { ok: false, reason: 'too_large' }
  }
  return { ok: true, bytes: got.bytes }
}

export async function registerDirectUpload(
  projectId: string,
  documentId: string,
  file: { name: string; type: string },
): Promise<RegisterResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('append_project_document', {
    p_project_id: projectId,
    p_document_id: documentId,
    p_original_filename: file.name,
    p_content_type: directUploadContentType(file.type),
  })

  const status = (data as WrapperResult | null)?.status
  if (!error && status === 'ok') return { ok: true }

  console.error('[project-documents] append_project_document:', error ?? data)
  await discardDirectUpload(projectId, documentId)
  return { ok: false, reason: status === 'not_found' ? 'not_found' : 'record_failed' }
}

/**
 * Entfernt ein NICHT eingetragenes Objekt. Nur nach `claimDirectUpload` aufrufen — der hat
 * festgestellt, dass zu dieser Kennung keine Dokument-Zeile existiert.
 */
export async function discardDirectUpload(projectId: string, documentId: string): Promise<void> {
  const removed = await removeProjectDocumentBytes(projectDocumentPath(projectId, documentId))
  if (!removed.ok) console.error('[project-documents] Aufräumen fehlgeschlagen:', removed.message)
}
