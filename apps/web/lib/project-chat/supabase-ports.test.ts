import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B24 Station 6 — `kind` durch die zwei Verlaufs-Wrapper.
 *
 * ── WAS SICH NUR HIER PRÜFEN LÄSST ──────────────────────────────────────────────────────────────
 * Die Ports sind die einzige Stelle, an der aus einem TypeScript-Argument eine RPC-Nutzlast wird.
 * Ob `p_kind` mitfährt, ist von aussen (Speicher-Attrappe, Schleife) nicht sichtbar — und genau das
 * ist die Eigenschaft, auf der dieser Schritt beruht:
 *
 *   1. OHNE Angabe geht `p_kind` GAR NICHT hinaus. Der Kunden-Chat schickt damit Zeichen für
 *      Zeichen dieselbe Nutzlast wie vor diesem Schritt — die Zusage ist eine Eigenschaft des
 *      Aufrufs und keine Behauptung über einen Datenbank-Vorgabewert.
 *   2. `ki_check` kommt tatsächlich an. Ohne diesen zweiten Fall bliebe der erste auch dann grün,
 *      wenn `p_kind` NIE mitfährt — dann wäre der Energieberater-Chat still ein Kunden-Chat.
 *
 * ⚠ Eine ausdrückliche `kunde`-Angabe MUSS sich wie das Weglassen verhalten: beides bedeutet
 * dasselbe Gespräch, und zwei verschiedene Nutzlasten für dieselbe Aussage wären der Anfang einer
 * Abweichung.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))

const { createProjectChatPorts, loadProjectMessages } = await import('./supabase-ports')

const PROJECT = '11111111-1111-4111-8111-111111111111'

/** Die Ports brauchen die vier Extraktoren nicht, um den Verlauf zu lesen oder zu schreiben. */
const ports = createProjectChatPorts({})

beforeEach(() => {
  rpc.mockReset()
  createClient.mockClear()
})

function lastArgs(): Record<string, unknown> {
  return rpc.mock.calls[0]?.[1] as Record<string, unknown>
}

describe('list_project_messages — p_kind', () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: { status: 'ok', messages: [], total: 0 }, error: null })
  })

  it('⚠ schickt OHNE Angabe kein p_kind — der Kunden-Chat bleibt unverändert', async () => {
    await loadProjectMessages(PROJECT)

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('list_project_messages', {
      p_project_id: PROJECT,
      p_limit: 500,
      p_offset: 0,
    })
    expect(lastArgs()).not.toHaveProperty('p_kind')
  })

  it('schickt auch bei ausdrücklichem "kunde" kein p_kind — dieselbe Aussage, dieselbe Nutzlast', async () => {
    await loadProjectMessages(PROJECT, 'kunde')

    expect(lastArgs()).not.toHaveProperty('p_kind')
  })

  it('reicht "ki_check" an die RPC durch', async () => {
    await loadProjectMessages(PROJECT, 'ki_check')

    expect(rpc).toHaveBeenCalledWith('list_project_messages', {
      p_project_id: PROJECT,
      p_limit: 500,
      p_offset: 0,
      p_kind: 'ki_check',
    })
  })

  it('der Port delegiert an dieselbe Funktion — kein zweiter Aufrufweg', async () => {
    await ports.loadMessages(PROJECT, 'ki_check')

    expect(lastArgs().p_kind).toBe('ki_check')
  })
})

describe('append_project_message — p_kind', () => {
  const content = [{ type: 'text' as const, text: 'Guten Tag.' }]

  beforeEach(() => {
    rpc.mockResolvedValue({ data: { status: 'ok', message_id: 'msg-1' }, error: null })
  })

  it('⚠ schickt OHNE Angabe kein p_kind — der Kunden-Chat bleibt unverändert', async () => {
    const result = await ports.appendMessage(PROJECT, 'user', content)

    expect(result.status).toBe('ok')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('append_project_message', {
      p_project_id: PROJECT,
      p_role: 'user',
      p_content: content,
    })
    expect(lastArgs()).not.toHaveProperty('p_kind')
  })

  it('schickt auch bei ausdrücklichem "kunde" kein p_kind', async () => {
    await ports.appendMessage(PROJECT, 'assistant', content, 'kunde')

    expect(lastArgs()).not.toHaveProperty('p_kind')
  })

  it('reicht "ki_check" an die RPC durch', async () => {
    await ports.appendMessage(PROJECT, 'assistant', content, 'ki_check')

    expect(rpc).toHaveBeenCalledWith('append_project_message', {
      p_project_id: PROJECT,
      p_role: 'assistant',
      p_content: content,
      p_kind: 'ki_check',
    })
  })
})
