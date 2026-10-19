import { describe, expect, it, vi } from 'vitest'

import { INVOICE_UPLOAD_CRASH_TEXT, guardInvoiceRead } from './invoice-upload-guard'

const INPUT = { projectId: 'p', meteringPointId: 'm', documentIds: ['d'] }

describe('guardInvoiceRead', () => {
  it('ein abgewiesener Server-Aufruf (504) wird zur Meldung statt zum Wurf', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const action = vi
      .fn()
      .mockRejectedValue(new Error('An unexpected response was received from the server.'))
    await expect(guardInvoiceRead(action)({}, INPUT)).resolves.toEqual({
      formError: INVOICE_UPLOAD_CRASH_TEXT,
    })
  })

  it('Gutfall reicht das Ergebnis der Action unverändert durch', async () => {
    const action = vi.fn().mockResolvedValue({ success: 'ok' })
    await expect(guardInvoiceRead(action)({}, INPUT)).resolves.toEqual({ success: 'ok' })
    expect(action).toHaveBeenCalledWith({}, INPUT)
  })
})
