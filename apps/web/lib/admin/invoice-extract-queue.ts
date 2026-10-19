/**
 * Ablauf der Rechnung-Station im Browser: jede Rechnung in einem eigenen Request lesen, höchstens
 * drei gleichzeitig, und danach zusammenführen. Rein (kein React, kein Netz) — die Station reicht
 * Auslesen und Abschluss als Funktionen herein.
 */
import type { InvoiceExtractionRow } from './data-entry-actions-rechnung-extract'

export const INVOICE_EXTRACT_CONCURRENCY = 3
export const INVOICE_EXTRACT_POLL_MS = 5_000
/** Ab hier gilt `running` als hängend; dieselbe Frist erlaubt `start_document_extraction` den Neustart. */
export const INVOICE_EXTRACT_STALE_MS = 10 * 60 * 1000

export type InvoiceRowView = 'waiting' | 'reading' | 'done' | 'failed' | 'stale'

export function invoiceRowView(
  row: Pick<InvoiceExtractionRow, 'status' | 'startedAt'>,
  now: number,
): InvoiceRowView {
  if (row.status === 'pending') return 'waiting'
  if (row.status === 'done') return 'done'
  if (row.status === 'failed') return 'failed'
  const started = row.startedAt === null ? Number.NaN : Date.parse(row.startedAt)
  return Number.isFinite(started) && now - started > INVOICE_EXTRACT_STALE_MS ? 'stale' : 'reading'
}

export function canRetryInvoiceRow(view: InvoiceRowView): boolean {
  return view === 'failed' || view === 'stale'
}

/** Solange etwas wartet oder gelesen wird, lädt die Station die Liste neu (hängende nicht). */
export function invoiceRowsInProgress(
  rows: readonly Pick<InvoiceExtractionRow, 'status' | 'startedAt'>[],
  now: number,
): boolean {
  return rows.some((row) => {
    const view = invoiceRowView(row, now)
    return view === 'waiting' || view === 'reading'
  })
}

export type InvoiceExtractionQueue = {
  enqueue: (documentIds: readonly string[]) => void
  /** Kennungen, die noch warten oder gerade gelesen werden. */
  active: () => string[]
}

/**
 * ⚠ ZUSAMMENGEFÜHRT WIRD ERST, WENN NICHTS MEHR LÄUFT — nicht nach jedem einzelnen `done`.
 * Ein Abschluss über die ganze Auswahl ergibt den Entwurf des früheren Sammelwegs, ohne dass ein
 * Zwischenstand nach Rechnung A allein geschrieben wird; zudem läuft so nie mehr als ein
 * Abschluss gleichzeitig.
 */
export function createInvoiceExtractionQueue(ports: {
  extract: (documentId: string) => Promise<{ status: string }>
  finalize: () => Promise<void>
  onChange?: () => void
  concurrency?: number
}): InvoiceExtractionQueue {
  const limit = ports.concurrency ?? INVOICE_EXTRACT_CONCURRENCY
  const waiting: string[] = []
  const running = new Set<string>()
  let doneSinceFinalize = false
  let finalizing = false

  const notify = () => ports.onChange?.()

  async function finalizeWhenIdle(): Promise<void> {
    if (finalizing || running.size > 0 || waiting.length > 0 || !doneSinceFinalize) return
    finalizing = true
    doneSinceFinalize = false
    try {
      await ports.finalize()
    } catch (cause) {
      console.error('[admin/dateneingabe] Rechnungen abschliessen:', cause)
    } finally {
      finalizing = false
    }
    // Während des Abschlusses fertig gewordene Rechnungen bekommen ihren eigenen.
    void finalizeWhenIdle()
  }

  function pump(): void {
    while (running.size < limit && waiting.length > 0) {
      const documentId = waiting.shift()!
      running.add(documentId)
      ports
        .extract(documentId)
        .catch(() => ({ status: 'request_failed' }))
        .then((result) => {
          running.delete(documentId)
          if (result.status === 'done') doneSinceFinalize = true
          pump()
          notify()
          void finalizeWhenIdle()
        })
    }
  }

  return {
    enqueue(documentIds) {
      for (const id of documentIds) {
        if (!running.has(id) && !waiting.includes(id)) waiting.push(id)
      }
      pump()
      notify()
    },
    active: () => [...running, ...waiting],
  }
}
