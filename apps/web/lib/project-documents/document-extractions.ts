/**
 * Auslesestatus je Dokument (`platform.document_extractions`) über die drei Wrapper.
 *
 * Noch ohne Aufrufer: der parallele Rechnungs-Scan (je Rechnung ein Request, am Ende einmal
 * zusammenführen) baut darauf auf. Die Zugriffsprüfung liegt in der Datenbank
 * (`platform.project_accessible`), dieses Modul übersetzt nur die Antworten.
 */
import 'server-only'

import type { Json } from '@/db-types'
import { createClient } from '@/lib/supabase/server'

export type DocumentExtractionKind = 'invoice'
export type DocumentExtractionStatus = 'pending' | 'running' | 'done' | 'failed'

export interface DocumentExtraction {
  id: string
  project_id: string
  document_id: string
  metering_point_id: string | null
  kind: DocumentExtractionKind
  status: DocumentExtractionStatus
  result: unknown
  error: string | null
  attempts: number
  extractor_version: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export type StartExtractionResult =
  | { ok: true; extraction: DocumentExtraction }
  | { ok: false; reason: 'not_found' | 'invalid_kind' | 'request_failed' }
  | { ok: false; reason: 'already_running'; extraction: DocumentExtraction }

export type FinishExtractionResult =
  | { ok: true; extraction: DocumentExtraction }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'request_failed' }
  | { ok: false; reason: 'not_running'; extraction: DocumentExtraction }

export type ListExtractionsResult =
  | { ok: true; extractions: DocumentExtraction[] }
  | { ok: false; reason: 'not_found' | 'request_failed' }

type Payload = {
  status?: string
  extraction?: DocumentExtraction
  extractions?: DocumentExtraction[]
}

export async function startDocumentExtraction(input: {
  documentId: string
  meteringPointId: string | null
  kind: DocumentExtractionKind
  extractorVersion: string | null
}): Promise<StartExtractionResult> {
  const supabase = await createClient()
  // Die generierten Typen kennen keine nullbaren Parameter; null geht als JSON-null durch.
  const { data, error } = await supabase.rpc('start_document_extraction', {
    p_document_id: input.documentId,
    p_metering_point_id: input.meteringPointId as string,
    p_kind: input.kind,
    p_extractor_version: input.extractorVersion as string,
  })
  const payload = data as Payload | null
  if (error || !payload) return { ok: false, reason: 'request_failed' }

  if (payload.status === 'ok' && payload.extraction)
    return { ok: true, extraction: payload.extraction }
  if (payload.status === 'already_running' && payload.extraction) {
    return { ok: false, reason: 'already_running', extraction: payload.extraction }
  }
  if (payload.status === 'not_found' || payload.status === 'invalid_kind') {
    return { ok: false, reason: payload.status }
  }
  return { ok: false, reason: 'request_failed' }
}

export async function finishDocumentExtraction(input: {
  id: string
  status: 'done' | 'failed'
  result: unknown
  error: string | null
}): Promise<FinishExtractionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('finish_document_extraction', {
    p_id: input.id,
    p_status: input.status,
    p_result: (input.result ?? null) as Json,
    p_error: input.error as string,
  })
  const payload = data as Payload | null
  if (error || !payload) return { ok: false, reason: 'request_failed' }

  if (payload.status === 'ok' && payload.extraction)
    return { ok: true, extraction: payload.extraction }
  if (payload.status === 'not_running' && payload.extraction) {
    return { ok: false, reason: 'not_running', extraction: payload.extraction }
  }
  if (payload.status === 'not_found' || payload.status === 'invalid_status') {
    return { ok: false, reason: payload.status }
  }
  return { ok: false, reason: 'request_failed' }
}

export async function listDocumentExtractions(input: {
  projectId: string
  meteringPointId?: string | null
  kind?: DocumentExtractionKind | null
}): Promise<ListExtractionsResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_document_extractions', {
    p_project_id: input.projectId,
    p_metering_point_id: input.meteringPointId ?? undefined,
    p_kind: input.kind ?? undefined,
  })
  const payload = data as Payload | null
  if (error || !payload) return { ok: false, reason: 'request_failed' }

  if (payload.status === 'ok' && Array.isArray(payload.extractions)) {
    return { ok: true, extractions: payload.extractions }
  }
  if (payload.status === 'not_found') return { ok: false, reason: 'not_found' }
  return { ok: false, reason: 'request_failed' }
}
