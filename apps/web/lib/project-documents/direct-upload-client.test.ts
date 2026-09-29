import { describe, expect, it, vi } from 'vitest'

import { uploadFileDirect } from './direct-upload-client'

type State = { ok?: true; failed?: string; formError?: string }

const CONTENT = 'Zeitstempel;kW\n'.repeat(1000)
const file = () => new File([CONTENT], 'lastgang.csv', { type: 'text/csv' })

function steps(overrides: Partial<Parameters<typeof uploadFileDirect<State>>[1]> = {}) {
  return {
    request: vi.fn(async () => ({
      ok: true as const,
      documentId: 'doc-1',
      uploadUrl: 'https://storage.test/upload?token=t',
    })),
    complete: vi.fn(async (): Promise<State> => ({ ok: true })),
    failed: (step: string): State => ({ failed: step }),
    ...overrides,
  }
}

describe('uploadFileDirect', () => {
  it('die Datei geht nur an die Storage-URL; der Abschluss bekommt nur die Kennung', async () => {
    const complete = vi.fn(async (_documentId: string): Promise<State> => ({ ok: true }))
    const s = steps({ complete })
    const fetch = vi.fn(async () => new Response(null, { status: 200 }))
    const f = file()

    expect(await uploadFileDirect(f, s, { fetch })).toEqual({ ok: true })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://storage.test/upload?token=t')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(f)

    // Positivkontrolle: was an die Anwendung geht, trägt keinen Dateiinhalt.
    expect(complete).toHaveBeenCalledWith('doc-1')
    expect(JSON.stringify(complete.mock.calls)).not.toContain('Zeitstempel')
    expect(s.request).toHaveBeenCalledWith()
  })

  it('eine Ablehnung aus Schritt 1 kommt unverändert zurück, ohne Upload', async () => {
    const fetch = vi.fn()
    const s = steps({ request: vi.fn(async () => ({ ok: false as const, state: { formError: 'zu gross' } })) })
    expect(await uploadFileDirect(file(), s, { fetch })).toEqual({ formError: 'zu gross' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('jeder Fehlschlag wird zu einem Zustand statt zu einer Ausnahme', async () => {
    const ok = async () => new Response(null, { status: 200 })

    const thrownRequest = steps({ request: vi.fn(async () => Promise.reject(new Error('413'))) })
    expect(await uploadFileDirect(file(), thrownRequest, { fetch: ok })).toEqual({ failed: 'request' })

    const storage413 = async () => new Response(null, { status: 413 })
    expect(await uploadFileDirect(file(), steps(), { fetch: storage413 })).toEqual({ failed: 'transfer' })

    const offline = async () => Promise.reject(new TypeError('Failed to fetch'))
    expect(await uploadFileDirect(file(), steps(), { fetch: offline })).toEqual({ failed: 'transfer' })

    const unexpected = steps({
      complete: vi.fn(async () =>
        Promise.reject(new Error('An unexpected response was received from the server.')),
      ),
    })
    expect(await uploadFileDirect(file(), unexpected, { fetch: ok })).toEqual({ failed: 'complete' })
  })
})
