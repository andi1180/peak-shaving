/**
 * Gemeinsame Teile des Rechnungs-Auslesens aus der Ablage: Dokument prüfen, eine Datei scannen, den
 * Entwurf aus den gelesenen Rechnungen bauen.
 *
 * Benutzt vom Auslesen je Dokument und vom Abschluss (`data-entry-actions-rechnung-extract.ts`).
 *
 * Kein `'use server'`: das Modul exportiert Konstanten und synchrone Funktionen.
 */
import 'server-only'

import { INVOICE_SCAN_MIN_ATTEMPT_MS, MAX_INVOICE_FILE_BYTES, extractInvoiceData } from 'extractors'
import { getProjectDocumentBytes } from '@/lib/project-documents/storage'
import { dropInapplicableBillingModel, setDraftField } from '@/lib/project-chat/draft'
import type { createClient } from '@/lib/supabase/server'
import { replaceInvoiceDraftFields } from './invoice-draft-fields'
import {
  INVOICE_SKIPPED_KEY,
  foldStoredInvoices,
  withInvoicePriceBasis,
  withStoredInvoiceExtractions,
  type KnownOperatorIds,
  type StoredInvoiceExtraction,
} from './invoice-extractions'
import { PDF_MEDIA_TYPE, isForbidden, statusOf } from './data-entry-actions-shared'

/** Zeit für die Scans eines Requests; der Rest von `maxDuration` 300 s bleibt fürs Lesen der Ablage und den Entwurf. */
export const INVOICE_UPLOAD_BUDGET_MS = 250_000

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
export type InvoiceFileFailure =
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
 * Der Grund je Datei, in einem Satz — kürzer als im öffentlichen Rechner, weil mehrere Gründe
 * in EINER Zeile stehen. `wrong_type` und `unreadable` verweisen dort auf andere Einstiege, die es
 * hier nicht gibt.
 */
export const INVOICE_FAILURE_TEXT: Record<InvoiceFileFailure, string> = {
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
export type InvoiceFileResult =
  | { ok: true; entry: StoredInvoiceExtraction }
  | { ok: false; filename: string; reason: InvoiceFileFailure }

export type StoredInvoiceDocument = {
  documentId: string
  filename: string
  contentType: string
  storagePath: string
}

type Db = Awaited<ReturnType<typeof createClient>>

/**
 * Ein abgelegtes Dokument, sofern es zu diesem Projekt gehört. Die Kennung kommt vom Browser; die
 * Zugehörigkeit beantwortet die Datenbank (`get_project_document`, `project_accessible`).
 */
export async function loadStoredInvoiceDocument(
  db: Db,
  projectId: string,
  documentId: string,
): Promise<
  { ok: true; document: StoredInvoiceDocument } | { ok: false; reason: 'forbidden' | 'not_found' }
> {
  const { data, error } = await db.rpc('get_project_document', { p_document_id: documentId })
  if (error && isForbidden(error)) return { ok: false, reason: 'forbidden' }
  const doc = (data as { status?: string; document?: Record<string, unknown> } | null)?.document
  if (error || statusOf(data) !== 'ok' || !doc || doc.project_id !== projectId) {
    return { ok: false, reason: 'not_found' }
  }
  return {
    ok: true,
    document: {
      documentId,
      filename: String(doc.original_filename ?? '').trim() || 'Unbenannte Datei',
      contentType: String(doc.content_type ?? ''),
      storagePath: String(doc.storage_path ?? ''),
    },
  }
}

/**
 * Eine einzelne abgelegte Datei: prüfen, aus der Ablage lesen, auslesen.
 *
 * Wirft nie — jeder Ausgang ist ein benanntes Ergebnis. Ein Wurf aus einer der nebenläufigen
 * Ketten liesse `mapWithConcurrency` scheitern und nähme die anderen mit, obwohl sie längst gelesen
 * (und bezahlt) sind.
 */
export async function readOneStoredInvoice(
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

/**
 * Der Entwurf nach dem Auslesen: Seiteneintrag `all`, die über ALLE gefalteten Werte und das
 * widerlegte „ohne Rechnungsdaten fortgefahren". `stored` ist die Liste VOR dem Vorgang.
 *
 * ⚠ EIN EINZIGER SCHREIBVORGANG beim Aufrufer: Seiteneintrag und übernommene Werte gehören
 * zusammen, und `update_metering_point_draft` ERSETZT den Entwurf.
 */
export function buildInvoiceDraft(input: {
  draft: Record<string, unknown>
  stored: readonly StoredInvoiceExtraction[]
  all: readonly StoredInvoiceExtraction[]
  knownOperatorIds: KnownOperatorIds
  now: Date
}) {
  const { draft, stored, all, knownOperatorIds, now } = input
  const fold = foldStoredInvoices(all, knownOperatorIds)
  let next = withInvoicePriceBasis(withStoredInvoiceExtractions(draft, all), fold)
  /*
   * `measured`: jeder dieser Werte steht übereinstimmend auf allen Rechnungen, die etwas dazu sagen.
   * Ein früher übernommener Wert, zu dem keine gelesene Rechnung mehr etwas sagt, wird entfernt;
   * Handeingaben und widersprüchliche Felder bleiben (s. `replaceInvoiceDraftFields`).
   */
  next = replaceInvoiceDraftFields(next, fold.values, fold.conflicts, now, stored.length > 0)
  /*
   * ⚠ EIN ECHTER UPLOAD WIDERLEGT EIN FRÜHERES „ohne Rechnungsdaten fortgefahren" — ohne diese
   * Zeile stünden „bewusst keine Tarifangabe" und eine gelesene Rechnung gleichzeitig im Entwurf.
   */
  next = setDraftField(next, INVOICE_SKIPPED_KEY, false, 'measured', undefined, now)
  return { draft: dropInapplicableBillingModel(next), conflicts: fold.conflicts }
}
