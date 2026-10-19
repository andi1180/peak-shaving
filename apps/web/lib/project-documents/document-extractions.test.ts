import { beforeEach, describe, expect, it, vi } from 'vitest'

// Das Verhalten der Wrapper prüft das DB-Gate; hier nur die Übersetzung der Antworten.
vi.mock('server-only', () => ({}))

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))

const { startDocumentExtraction, finishDocumentExtraction } = await import('./document-extractions')

const ROW = { id: 'e1', status: 'running', attempts: 1 }

beforeEach(() => rpc.mockReset())

describe('document-extractions', () => {
  it('reicht null als Zählpunkt durch und liefert die Zeile', async () => {
    rpc.mockResolvedValue({ data: { status: 'ok', extraction: ROW }, error: null })
    const out = await startDocumentExtraction({
      documentId: 'd1',
      meteringPointId: null,
      kind: 'invoice',
      extractorVersion: 'v1',
    })
    expect(rpc).toHaveBeenCalledWith('start_document_extraction', {
      p_document_id: 'd1',
      p_metering_point_id: null,
      p_kind: 'invoice',
      p_extractor_version: 'v1',
    })
    expect(out).toEqual({ ok: true, extraction: ROW })
  })

  it('unterscheidet Doppellauf und falschen Status von einem Fehler', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'already_running', extraction: ROW }, error: null })
    expect(
      await startDocumentExtraction({
        documentId: 'd1',
        meteringPointId: null,
        kind: 'invoice',
        extractorVersion: null,
      }),
    ).toEqual({ ok: false, reason: 'already_running', extraction: ROW })

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(
      await finishDocumentExtraction({ id: 'e1', status: 'done', result: {}, error: null }),
    ).toEqual({
      ok: false,
      reason: 'request_failed',
    })
  })
})
