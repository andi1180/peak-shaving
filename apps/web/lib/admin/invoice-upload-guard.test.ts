import { describe, expect, it, vi } from 'vitest'

import {
  INVOICE_UPLOAD_CRASH_TEXT,
  MAX_INVOICE_UPLOAD_REQUEST_BYTES,
  guardInvoiceUpload,
} from './invoice-upload-guard'

function form(sizes: number[]): FormData {
  const data = new FormData()
  sizes.forEach((size, i) =>
    data.append(
      'files',
      new File([new Uint8Array(size)], `r${i}.pdf`, { type: 'application/pdf' }),
    ),
  )
  return data
}

describe('guardInvoiceUpload', () => {
  it('ein abgewiesener Server-Aufruf (504) wird zur Meldung statt zum Wurf', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const action = vi
      .fn()
      .mockRejectedValue(new Error('An unexpected response was received from the server.'))
    await expect(guardInvoiceUpload(action)({}, form([1000]))).resolves.toEqual({
      formError: INVOICE_UPLOAD_CRASH_TEXT,
    })
  })

  it('zu grosse Auswahl → Meldung „Datei zu gross", die Action läuft gar nicht erst', async () => {
    const action = vi.fn()
    const state = await guardInvoiceUpload(action)({}, form([MAX_INVOICE_UPLOAD_REQUEST_BYTES, 1]))
    expect(state.fieldErrors?.files).toMatch(/^Datei zu gross: .* max\. 4 MB je Vorgang/)
    expect(action).not.toHaveBeenCalled()
  })

  it('Gutfall reicht das Ergebnis der Action unverändert durch', async () => {
    const action = vi.fn().mockResolvedValue({ success: 'ok' })
    await expect(
      guardInvoiceUpload(action)({}, form([MAX_INVOICE_UPLOAD_REQUEST_BYTES])),
    ).resolves.toEqual({
      success: 'ok',
    })
  })
})
