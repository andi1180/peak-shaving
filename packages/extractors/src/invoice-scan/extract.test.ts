import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))

const create = vi.fn()
vi.mock('./ai-client', () => ({
  INVOICE_SCAN_MODEL: 'test-model',
  createInvoiceScanClient: () => ({ messages: { create } }),
}))

const { extractInvoiceData } = await import('./extract')

/** Erfundene Werte — keine Rechnung. */
const VALID_JSON = JSON.stringify({ netzebene: 7, rates: { energyPriceCtPerKwh: 12.345 } })
const PDF = Buffer.from('%PDF-1.4 erfunden').toString('base64')

function response(text: string, stop_reason = 'end_turn', output_tokens = 321) {
  return { content: [{ type: 'text', text }], stop_reason, usage: { output_tokens } }
}

let log: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  create.mockReset()
  log = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  log.mockRestore()
  vi.useRealTimers()
})

describe('extractInvoiceData — leere/abgeschnittene Antwort und API-Fehler', () => {
  it('(a) leerer Text → ein Wiederholversuch → ok', async () => {
    create.mockResolvedValueOnce(response('')).mockResolvedValueOnce(response(VALID_JSON))
    const outcome = await extractInvoiceData(PDF)
    expect(outcome.ok).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('(b) stop_reason max_tokens → Wiederholversuch mit grösserem max_tokens → ok', async () => {
    create
      .mockResolvedValueOnce(response('{"netzebene": 7, "rat', 'max_tokens', 16000))
      .mockResolvedValueOnce(response(VALID_JSON))
    const outcome = await extractInvoiceData(PDF)
    expect(outcome.ok).toBe(true)
    expect(create.mock.calls.map(([body]) => body.max_tokens)).toEqual([16000, 20000])
  })

  it('(c) HTTP 400 → kein Wiederholversuch, api_error', async () => {
    create.mockRejectedValueOnce(
      new Anthropic.BadRequestError(400, { type: 'error' }, 'invalid schema', new Headers()),
    )
    expect(await extractInvoiceData(PDF)).toEqual({ ok: false, reason: 'api_error' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('(d) zweimal unbrauchbar → api_error; Log mit stop_reason und output_tokens, ohne Inhalt', async () => {
    const leaky = '{"netzebene": 7, "ERFUNDENER-INHALT-4711'
    create.mockResolvedValue(response(leaky, 'end_turn', 987))
    expect(await extractInvoiceData(PDF)).toEqual({ ok: false, reason: 'api_error' })
    expect(create).toHaveBeenCalledTimes(2)

    const logged = JSON.stringify(log.mock.calls)
    expect(logged).toContain('"stopReason":"end_turn"')
    expect(logged).toContain('"outputTokens":987')
    expect(logged).toContain(`"textLength":${leaky.length}`)
    expect(logged).not.toContain('ERFUNDENER-INHALT-4711')
    expect(logged).not.toContain(PDF)
  })

  it('(e) HTTP 429, dann ok — ein Wiederholversuch nach kurzer Pause', async () => {
    vi.useFakeTimers()
    create
      .mockRejectedValueOnce(
        new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers()),
      )
      .mockResolvedValueOnce(response(VALID_JSON))
    const pending = extractInvoiceData(PDF)
    await vi.runAllTimersAsync()
    expect((await pending).ok).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('stop_reason refusal → kein Wiederholversuch, unreadable', async () => {
    create.mockResolvedValueOnce(response('', 'refusal'))
    expect(await extractInvoiceData(PDF)).toEqual({ ok: false, reason: 'unreadable' })
    expect(create).toHaveBeenCalledTimes(1)
  })
})
