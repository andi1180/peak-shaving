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

  it('(b) stop_reason max_tokens → ein Wiederholversuch mit derselben Obergrenze → ok', async () => {
    create
      .mockResolvedValueOnce(response('{"netzebene": 7, "rat', 'max_tokens', 16000))
      .mockResolvedValueOnce(response(VALID_JSON))
    const outcome = await extractInvoiceData(PDF)
    expect(outcome.ok).toBe(true)
    expect(create.mock.calls.map(([body]) => body.max_tokens)).toEqual([16000, 16000])
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

  it('Thinking-Block + Text-Block → der Text wird gelesen; Thinking ist ausdrücklich aus', async () => {
    create.mockResolvedValueOnce({
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: VALID_JSON },
      ],
      stop_reason: 'end_turn',
      usage: { output_tokens: 400 },
    })
    const outcome = await extractInvoiceData(PDF)
    expect(outcome.ok).toBe(true)
    const [body, options] = create.mock.calls[0]!
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.max_tokens).toBe(16000)
    expect(options.timeout).toBe(120_000)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('max_tokens ohne Text bei knappem Budget → definierter Fehler, kein zweiter Versuch', async () => {
    create.mockResolvedValueOnce(response('', 'max_tokens', 16000))
    const outcome = await extractInvoiceData(PDF, { deadline: Date.now() + 30_000 })
    expect(outcome).toEqual({ ok: false, reason: 'api_error' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![1].timeout).toBeLessThanOrEqual(30_000)
  })

  it('hängende Antwort → Abbruch je Versuch nach 120 s, höchstens 2 Versuche, Ergebnis timeout', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    create.mockImplementation((_body, options: { signal: AbortSignal }) => {
      signals.push(options.signal)
      return new Promise(() => {})
    })
    const started = Date.now()
    let settled = false
    const pending = extractInvoiceData(PDF).finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(119_999)
    expect(create).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(signals[0]!.aborted).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(120_000)
    expect(settled).toBe(true)
    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
    expect(create).toHaveBeenCalledTimes(2)
    expect(signals[1]!.aborted).toBe(true)
    expect(Date.now() - started).toBe(240_000)
  })
})
