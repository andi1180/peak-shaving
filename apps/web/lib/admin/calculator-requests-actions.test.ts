import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN_INITIAL_STATE } from './schema'

/**
 * B18-4 (Oberfläche) — die Server Action der Entscheidung.
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * 1. Ein unbekannter Entscheidungswert erreicht die DATENBANK GAR NICHT (kein RPC).
 * 2. ⚠ Ein Mailproblem kommt NIE als Fehlschlag zurück — die Freigabe ist zu diesem Zeitpunkt
 *    vollzogen (Status und `calculator_pro`-Entitlement stehen in EINER Transaktion). Käme sie als
 *    `formError`, versuchte der Admin es erneut, und der zweite Versuch gäbe `already_reviewed`.
 * 3. Aus einer ABLEHNUNG geht keine Mail hinaus.
 *
 * Das Verhalten der Wrapper selbst (Atomarität, `no_account`, `already_reviewed`, der partielle
 * UNIQUE-Index) ist B18-4 Schema und liegt im DB-Gate.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const notify = vi.fn()

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/partner-portal/calculator-request-notify-server', () => ({
  notifyCalculatorRequestBySlug: (...args: unknown[]) => notify(...args),
}))

const { decideCalculatorRequestAction } = await import('./calculator-requests-actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  rpc.mockReset()
  createClient.mockClear()
  notify.mockReset()
  notify.mockResolvedValue({ status: 'sent' })
})

describe('B18-4 — decideCalculatorRequestAction', () => {
  it('⚠ fragt die Datenbank bei einem unbekannten Entscheidungswert gar nicht erst', async () => {
    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'vielleicht' }),
    )

    expect(rpc).not.toHaveBeenCalled()
    expect(state.formError).toBeTruthy()
    expect(state.success).toBeUndefined()
  })

  it('gibt frei, ruft GENAU EINEN Wrapper und benennt den Mailversand', async () => {
    rpc.mockResolvedValue({
      data: { status: 'ok', decision: 'approved', entitlement: 'granted', partner_slug: 'elektro' },
      error: null,
    })

    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'approved' }),
    )

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_decide_calculator_request', {
      p_id: 'req-1',
      p_decision: 'approved',
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(state.success).toMatch(/freigegeben/)
    expect(state.success).toMatch(/per E-Mail/)
    expect(state.formError).toBeUndefined()
  })

  it('⚠ meldet einen fehlgeschlagenen Versand als ZUSATZ, nie als Fehlschlag der Freigabe', async () => {
    rpc.mockResolvedValue({
      data: { status: 'ok', decision: 'approved', entitlement: 'granted', partner_slug: 'elektro' },
      error: null,
    })
    notify.mockResolvedValue({ status: 'send_failed' })

    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'approved' }),
    )

    expect(state.formError).toBeUndefined()
    expect(state.success).toMatch(/freigegeben/)
    expect(state.success).toMatch(/NICHT versendet/)
  })

  it('sagt es, wenn der Zugang schon bestand', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'ok',
        decision: 'approved',
        entitlement: 'already_active',
        partner_slug: 'elektro',
      },
      error: null,
    })

    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'approved' }),
    )

    expect(state.success).toMatch(/bestand bereits/)
  })

  it('⚠ löst bei einer Ablehnung keinen Versand aus', async () => {
    rpc.mockResolvedValue({
      data: { status: 'ok', decision: 'rejected', entitlement: null, partner_slug: 'elektro' },
      error: null,
    })

    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'rejected' }),
    )

    expect(notify).not.toHaveBeenCalled()
    expect(state.success).toMatch(/abgelehnt/)
    expect(state.success).toMatch(/keine Absagemail/)
  })

  it('benennt eine bereits getroffene Entscheidung samt ihrem Zustand', async () => {
    rpc.mockResolvedValue({
      data: { status: 'already_reviewed', current: 'approved' },
      error: null,
    })

    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'approved' }),
    )

    expect(notify).not.toHaveBeenCalled()
    expect(state.formError).toMatch(/bereits entschieden \(Freigegeben\)/)
    expect(state.success).toBeUndefined()
  })

  it('nennt bei fehlendem Konto den Ausweg — und dass Ablehnen möglich bleibt', async () => {
    rpc.mockResolvedValue({ data: { status: 'no_account' }, error: null })

    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'approved' }),
    )

    expect(state.formError).toMatch(/kein Konto/)
    expect(state.formError).toMatch(/ablehnen/)
  })

  it('macht aus einem Datenbankfehler keine Zusage', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'weg' } })

    const state = await decideCalculatorRequestAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'req-1', entscheidung: 'approved' }),
    )

    expect(notify).not.toHaveBeenCalled()
    expect(state.success).toBeUndefined()
    expect(state.formError).toBeTruthy()
  })
})
