import { describe, expect, it, vi } from 'vitest'

import {
  INVOICE_EXTRACT_STALE_MS,
  canRetryInvoiceRow,
  createInvoiceExtractionQueue,
  invoiceRowView,
  invoiceRowsInProgress,
} from './invoice-extract-queue'

/** Ein Auslesen, das erst endet, wenn der Test es auflöst. */
function controllableExtract() {
  const open = new Map<string, (status: string) => void>()
  let running = 0
  let maxRunning = 0
  const extract = vi.fn(
    (id: string) =>
      new Promise<{ status: string }>((resolve) => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        open.set(id, (status) => {
          running -= 1
          open.delete(id)
          resolve({ status })
        })
      }),
  )
  return { extract, open, maxRunning: () => maxRunning }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createInvoiceExtractionQueue', () => {
  it('liest höchstens drei gleichzeitig und schliesst erst ab, wenn nichts mehr läuft — genau einmal', async () => {
    const { extract, open, maxRunning } = controllableExtract()
    const finalize = vi.fn(async () => {})
    const queue = createInvoiceExtractionQueue({ extract, finalize })

    queue.enqueue(['a', 'b', 'c', 'd', 'e'])
    expect(extract).toHaveBeenCalledTimes(3)

    for (const id of ['a', 'b', 'c', 'd']) {
      open.get(id)!('done')
      await flush()
      // Solange noch eine Rechnung liest oder wartet, wird nicht zusammengeführt.
      expect(finalize).not.toHaveBeenCalled()
    }
    open.get('e')!('failed')
    await flush()

    expect(maxRunning()).toBe(3)
    expect(extract).toHaveBeenCalledTimes(5)
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(queue.active()).toEqual([])
  })

  it('Neu lesen nach einem Fehlschlag schliesst danach erneut ab; ein Lauf ohne done schliesst nicht ab', async () => {
    const { extract, open } = controllableExtract()
    const finalize = vi.fn(async () => {})
    const queue = createInvoiceExtractionQueue({ extract, finalize })

    queue.enqueue(['a'])
    open.get('a')!('failed')
    await flush()
    expect(finalize).not.toHaveBeenCalled()

    queue.enqueue(['a'])
    // Dieselbe Kennung wartet nicht zweimal.
    queue.enqueue(['a'])
    expect(extract).toHaveBeenCalledTimes(2)
    open.get('a')!('done')
    await flush()
    expect(finalize).toHaveBeenCalledTimes(1)
  })
})

describe('invoiceRowView', () => {
  const now = Date.parse('2026-10-19T08:00:00.000Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('„Neu lesen" nur bei fehlgeschlagen oder hängend (running älter als 10 Minuten)', () => {
    const cases = [
      { row: { status: 'pending' as const, startedAt: null }, view: 'waiting', retry: false },
      {
        row: { status: 'running' as const, startedAt: ago(60_000) },
        view: 'reading',
        retry: false,
      },
      {
        row: { status: 'running' as const, startedAt: ago(INVOICE_EXTRACT_STALE_MS + 1) },
        view: 'stale',
        retry: true,
      },
      { row: { status: 'done' as const, startedAt: ago(60_000) }, view: 'done', retry: false },
      { row: { status: 'failed' as const, startedAt: ago(60_000) }, view: 'failed', retry: true },
    ]
    for (const { row, view, retry } of cases) {
      expect(invoiceRowView(row, now)).toBe(view)
      expect(canRetryInvoiceRow(invoiceRowView(row, now))).toBe(retry)
    }
    // Eine hängende Zeile hält das Neuladen nicht am Laufen, eine lesende schon.
    expect(invoiceRowsInProgress([cases[2]!.row, cases[3]!.row], now)).toBe(false)
    expect(invoiceRowsInProgress([cases[1]!.row], now)).toBe(true)
  })
})
