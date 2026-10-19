'use server'

import { isDeepStrictEqual } from 'node:util'
import { revalidatePath } from 'next/cache'
import { parseInvoiceExtraction } from 'shared'
import {
  finishDocumentExtraction,
  listDocumentExtractions,
  startDocumentExtraction,
  type DocumentExtraction,
} from '@/lib/project-documents/document-extractions'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/db-types'
import {
  MAX_INVOICES_PER_UPLOAD,
  readStoredInvoiceExtractions,
  type StoredInvoiceExtraction,
} from './invoice-extractions'
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
import { FORBIDDEN, GENERIC, UUID, isForbidden, statusOf } from './data-entry-actions-shared'

/**
 * Rechnungen JE DOKUMENT auslesen (ein Request je Rechnung, Status in `platform.document_extractions`)
 * und danach EINMAL zusammenführen. Noch ohne Aufrufer in der Oberfläche; der Sammelweg
 * `readStoredInvoicesAction` bleibt bis zur Umstellung bestehen.
 */

/** Der Extraktor führt keine Versionskonstante; die Spalte bleibt leer, bis es eine gibt. */
const INVOICE_EXTRACTOR_VERSION: string | null = null

export type ExtractStoredInvoiceStatus =
  | 'done'
  | 'failed'
  | 'not_found'
  | 'already_running'
  | 'not_running'
  | 'invalid_kind'
  | 'invalid_status'
  | 'request_failed'

export type ExtractStoredInvoiceResult = { status: ExtractStoredInvoiceStatus; error?: string }

/**
 * Liest EINE abgelegte Rechnung aus und hält das Ergebnis in `document_extractions` fest. Schreibt
 * den Entwurf NICHT — das tut erst `finalizeInvoiceExtractionsAction`.
 */
export async function extractStoredInvoiceAction(
  projectId: string,
  meteringPointId: string,
  documentId: string,
): Promise<ExtractStoredInvoiceResult> {
  if (
    ![projectId, meteringPointId, documentId].every((id) => typeof id === 'string' && UUID.test(id))
  ) {
    return { status: 'not_found' }
  }

  // Zugehörigkeit zum Projekt VOR dem Start: eine fremde Kennung legt keine Zeile an und liest nichts.
  const db = await createClient()
  const loaded = await loadStoredInvoiceDocument(db, projectId, documentId)
  if (!loaded.ok) {
    return { status: 'not_found', ...(loaded.reason === 'forbidden' ? { error: FORBIDDEN } : {}) }
  }

  const started = await startDocumentExtraction({
    documentId,
    meteringPointId,
    kind: 'invoice',
    extractorVersion: INVOICE_EXTRACTOR_VERSION,
  })
  if (!started.ok) return { status: started.reason }

  // Ein Wurf darf die Zeile nicht auf `running` stehen lassen — sonst sperrt sie zehn Minuten.
  let outcome: InvoiceFileResult
  try {
    outcome = await readOneStoredInvoice(loaded.document, Date.now() + INVOICE_UPLOAD_BUDGET_MS)
  } catch (cause) {
    console.error('[admin/dateneingabe] Rechnung je Dokument:', cause)
    outcome = { ok: false, filename: loaded.document.filename, reason: 'unavailable' }
  }

  const error = outcome.ok ? null : INVOICE_FAILURE_TEXT[outcome.reason]
  const finished = await finishDocumentExtraction({
    id: started.extraction.id,
    status: outcome.ok ? 'done' : 'failed',
    // Genau das, was heute in `_invoiceExtractions[].extraction` landet, plus der Dateiname.
    result: outcome.ok
      ? { filename: outcome.entry.filename, extraction: outcome.entry.extraction }
      : null,
    error,
  })
  if (!finished.ok) {
    console.error('[admin/dateneingabe] finish_document_extraction:', finished.reason)
    return { status: finished.reason, error: GENERIC }
  }

  return outcome.ok ? { status: 'done' } : { status: 'failed', error: error ?? GENERIC }
}

export type OpenInvoiceExtraction = {
  documentId: string
  filename: string
  /** `missing`: für dieses Dokument wurde am Zählpunkt noch kein Auslesen gestartet. */
  status: 'missing' | 'pending' | 'running' | 'failed'
  error: string | null
}

export type FinalizeInvoiceExtractionsState = AdminState & { open: OpenInvoiceExtraction[] }

const BROKEN_RESULT =
  'Das gespeicherte Leseergebnis ist unbrauchbar. Bitte diese Rechnung neu lesen.'

/** `result` einer fertigen Zeile als Eintrag — oder `null`, wenn es nicht die erwartete Form hat. */
function entryFromResult(documentId: string, result: unknown): StoredInvoiceExtraction | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null
  const { filename, extraction } = result as Record<string, unknown>
  if (typeof filename !== 'string' || filename.trim() === '') return null
  if (typeof extraction !== 'object' || extraction === null || Array.isArray(extraction))
    return null
  return { documentId, filename, extraction: extraction as StoredInvoiceExtraction['extraction'] }
}

/** Derselbe Beleg mit demselben Leseergebnis — dann bleibt der gespeicherte Eintrag unangetastet. */
function sameReading(stored: StoredInvoiceExtraction, fresh: StoredInvoiceExtraction): boolean {
  return (
    stored.filename === fresh.filename &&
    isDeepStrictEqual(stored.extraction, parseInvoiceExtraction(fresh.extraction))
  )
}

/**
 * Führt die fertig gelesenen Rechnungen EINES Vorgangs mit den schon gespeicherten zusammen und
 * schreibt den Entwurf genau einmal.
 *
 * ⚠ `documentIds` sind die Dokumente DIESES Vorgangs, nicht „alles, was am Zählpunkt fertig ist":
 * eine entfernte Rechnung behält ihre `done`-Zeile (`removeMeteringPointInvoiceAction` löscht nur
 * den Entwurfseintrag) und käme sonst beim nächsten Abschluss still zurück.
 *
 * Eine schon gespeicherte Kennung wird an ihrer Stelle ersetzt (Neulesen), nie verdoppelt; die vom
 * Menschen gewählte Preisbasis bleibt, weil sie sich auf dieselbe Datei bezieht. Ändert sich nichts,
 * wird nicht geschrieben — ein zweiter Aufruf lässt den Entwurf unverändert.
 */
export async function finalizeInvoiceExtractionsAction(
  projectId: string,
  meteringPointId: string,
  documentIds: string[],
): Promise<FinalizeInvoiceExtractionsState> {
  if (typeof projectId !== 'string' || !UUID.test(projectId))
    return { formError: GENERIC, open: [] }
  if (typeof meteringPointId !== 'string' || !UUID.test(meteringPointId)) {
    return { formError: GENERIC, open: [] }
  }
  const rawIds = Array.isArray(documentIds) ? documentIds : []
  if (!rawIds.every((id) => typeof id === 'string' && UUID.test(id))) {
    return { formError: GENERIC, open: [] }
  }
  const ids = [...new Set(rawIds)]
  if (ids.length === 0) {
    return { fieldErrors: { files: 'Bitte mindestens eine PDF-Rechnung auswählen.' }, open: [] }
  }
  if (ids.length > MAX_INVOICES_PER_UPLOAD) {
    return {
      fieldErrors: { files: `Höchstens ${MAX_INVOICES_PER_UPLOAD} Rechnungen pro Vorgang.` },
      open: [],
    }
  }

  const db = await createClient()
  const documents: StoredInvoiceDocument[] = []
  for (const documentId of ids) {
    const loaded = await loadStoredInvoiceDocument(db, projectId, documentId)
    if (!loaded.ok && loaded.reason === 'forbidden') return { formError: FORBIDDEN, open: [] }
    if (!loaded.ok) {
      return {
        formError:
          'Mindestens eine Datei gehört nicht zu diesem Projekt oder ist nicht mehr vorhanden. ' +
          'Es wurde nichts übernommen. Bitte laden Sie die Seite neu.',
        open: [],
      }
    }
    documents.push(loaded.document)
  }

  const listed = await listDocumentExtractions({ projectId, meteringPointId, kind: 'invoice' })
  if (!listed.ok) {
    console.error('[admin/dateneingabe] list_document_extractions:', listed.reason)
    return { formError: GENERIC, open: [] }
  }
  const byDocument = new Map<string, DocumentExtraction>(
    listed.extractions.map((row) => [row.document_id, row]),
  )

  const fresh: StoredInvoiceExtraction[] = []
  const open: OpenInvoiceExtraction[] = []
  for (const doc of documents) {
    const row = byDocument.get(doc.documentId)
    const entry = row?.status === 'done' ? entryFromResult(doc.documentId, row.result) : null
    if (entry) {
      fresh.push(entry)
      continue
    }
    open.push({
      documentId: doc.documentId,
      filename: doc.filename,
      status: row?.status === 'done' ? 'failed' : (row?.status ?? 'missing'),
      error: row?.status === 'done' ? BROKEN_RESULT : (row?.error ?? null),
    })
  }

  const openText =
    open.length === 0
      ? null
      : open
          .map((item) =>
            item.status === 'failed'
              ? `„${item.filename}": ${item.error ?? GENERIC}`
              : `„${item.filename}": wird noch gelesen.`,
          )
          .join(' · ')

  if (fresh.length === 0) return { fieldErrors: { files: openText ?? GENERIC }, open }

  // Frisch gelesen: `update_metering_point_draft` ERSETZT den Entwurf.
  const listRes = await db.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN, open }
    console.error(
      '[admin/dateneingabe] list_metering_points (Rechnungen abschliessen):',
      listRes.error,
    )
    return { formError: GENERIC, open }
  }
  const point = readMeteringPointList(listRes.data)?.find((p) => p.id === meteringPointId)
  if (!point) {
    return {
      formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.',
      open,
    }
  }

  const stored = readStoredInvoiceExtractions(point.draft)
  const pending = new Map(fresh.map((entry) => [entry.documentId, entry]))
  let taken = 0
  const all = stored.map((old) => {
    const entry = pending.get(old.documentId)
    if (!entry) return old
    pending.delete(old.documentId)
    if (sameReading(old, entry)) return old
    taken += 1
    return old.supplierPriceBasisChosen
      ? { ...entry, supplierPriceBasisChosen: old.supplierPriceBasisChosen }
      : entry
  })
  for (const entry of pending.values()) {
    all.push(entry)
    taken += 1
  }

  const { draft: nextDraft, conflicts } = buildInvoiceDraft({
    draft: point.draft,
    stored,
    all,
    knownOperatorIds: await readKnownOperatorIdsForProject(db, projectId),
    now: new Date(),
  })

  if (taken > 0) {
    const draftRes = await db.rpc('update_metering_point_draft', {
      p_metering_point_id: meteringPointId,
      p_draft: nextDraft as Json,
    })
    if (draftRes.error) {
      if (isForbidden(draftRes.error)) return { formError: FORBIDDEN, open }
      console.error(
        '[admin/dateneingabe] update_metering_point_draft (Rechnungen abschliessen):',
        draftRes.error,
      )
      return { formError: GENERIC, open }
    }
    if (statusOf(draftRes.data) !== 'ok') {
      console.error(
        '[admin/dateneingabe] unerwartete Antwort (Rechnungen abschliessen):',
        draftRes.data,
      )
      return { formError: GENERIC, open }
    }
    revalidatePath(projectDataEntryHref(projectId))
  }

  const gelesen =
    taken === 0
      ? 'Keine neuen Leseergebnisse'
      : taken === 1
        ? 'Eine Rechnung übernommen'
        : `${taken} Rechnungen übernommen`
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
    ...(openText ? { fieldErrors: { files: openText } } : {}),
    open,
  }
}
