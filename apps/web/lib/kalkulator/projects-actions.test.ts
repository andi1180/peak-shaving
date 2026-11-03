import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Projekt-Server-Actions nur für Admins (03.11.2026): `createProjectAction` und
 * `sendProjectChatMessage` prüfen den Zugang selbst, weil eine Server Action über ihre Kennung
 * direkt aufrufbar ist.
 */

vi.mock('server-only', () => ({}))

const rpc = vi.fn()
const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, auth: { getUser } }),
}))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'de' }))
const redirectToLocalized = vi.fn()
vi.mock('@/lib/auth/server-helpers', () => ({ redirectToLocalized }))

const runProjectChatTurn = vi.fn()
vi.mock('@/lib/project-chat/agent', () => ({ runProjectChatTurn }))
vi.mock('@/lib/project-chat/supabase-ports', () => ({ createProjectChatPorts: () => ({}) }))
vi.mock('@/lib/project-chat/model', () => ({ callProjectChatModel: vi.fn() }))
vi.mock('extractors', () => ({
  classifyDocument: vi.fn(),
  extractBatteryText: vi.fn(),
  extractInvoiceData: vi.fn(),
  extractPvDesign: vi.fn(),
  readLoadProfile: vi.fn(),
}))

const { createProjectAction } = await import('./projects-actions')
const { sendProjectChatMessage } = await import('@/lib/project-chat/chat')

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

function labelForm(label: string): FormData {
  const form = new FormData()
  form.set('label', label)
  return form
}

function signedIn(isAdmin: boolean) {
  getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'x@example.at' } } })
  rpc.mockImplementation(async (name: string) =>
    name === 'is_admin'
      ? { data: isAdmin, error: null }
      : { data: { status: 'ok', project_id: PROJECT_ID }, error: null },
  )
}

beforeEach(() => {
  rpc.mockReset()
  getUser.mockReset()
  redirectToLocalized.mockReset()
  runProjectChatTurn.mockReset()
  runProjectChatTurn.mockResolvedValue({ status: 'ok', reply: 'Hallo', toolCalls: 0 })
})

describe('Projekt-Actions weisen Nicht-Admins ab', () => {
  it('createProjectAction: angemeldet ohne Admin-Rolle → generic, kein Projekt angelegt', async () => {
    signedIn(false)
    await expect(createProjectAction({}, labelForm('Bäckerei Huber'))).resolves.toEqual({
      formError: 'generic',
    })
    expect(rpc).not.toHaveBeenCalledWith('create_my_project', expect.anything())
    expect(redirectToLocalized).not.toHaveBeenCalled()
  })

  it('createProjectAction: ohne Sitzung → notSignedIn', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(createProjectAction({}, labelForm('Bäckerei Huber'))).resolves.toEqual({
      formError: 'notSignedIn',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sendProjectChatMessage: Nicht-Admin → not_found, kein Chat-Turn', async () => {
    signedIn(false)
    await expect(sendProjectChatMessage(PROJECT_ID, 'Hallo')).resolves.toEqual({
      status: 'not_found',
    })
    expect(runProjectChatTurn).not.toHaveBeenCalled()
  })
})

describe('Positivkontrolle: Admins kommen durch', () => {
  it('createProjectAction legt das Projekt an und leitet weiter', async () => {
    signedIn(true)
    await createProjectAction({}, labelForm('Bäckerei Huber'))
    expect(rpc).toHaveBeenCalledWith('create_my_project', { p_customer_label: 'Bäckerei Huber' })
    expect(redirectToLocalized).toHaveBeenCalledTimes(1)
  })

  it('sendProjectChatMessage führt den Chat-Turn aus', async () => {
    signedIn(true)
    await expect(sendProjectChatMessage(PROJECT_ID, 'Hallo')).resolves.toMatchObject({
      status: 'ok',
    })
    expect(runProjectChatTurn).toHaveBeenCalledTimes(1)
  })
})
