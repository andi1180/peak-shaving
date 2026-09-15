import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `sendEnergyAdvisorMessage` — der Endpunkt des Energieberaters (B24, Station 6).
 *
 * Vorbild `chat.ts`: hier wird ausschliesslich geprüft, was diese Datei ANDERS macht als der
 * Kunden-Chat — die Admin-Prüfung VOR jedem Modellaufruf und den zusammengesetzten Prompt. Die
 * Schleife selbst (`runProjectChatTurn`) und die Werkzeugliste sind an ihrem eigenen Fundort
 * geprüft und werden hier gemockt.
 */

const isCurrentUserAdmin = vi.fn()
const runProjectChatTurn = vi.fn()
const loadSystemPromptExtension = vi.fn()
const createProjectChatPorts = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/guard', () => ({ isCurrentUserAdmin: () => isCurrentUserAdmin() }))
vi.mock('./agent', () => ({
  runProjectChatTurn: (...args: unknown[]) => runProjectChatTurn(...args),
}))
vi.mock('./model', () => ({ callProjectChatModel: vi.fn() }))
vi.mock('./supabase-ports', () => ({
  createProjectChatPorts: (...args: unknown[]) => createProjectChatPorts(...args),
}))

const { sendEnergyAdvisorMessage } = await import('./energy-advisor-chat')
const { ENERGY_ADVISOR_SYSTEM_PROMPT, PROJECT_CHAT_SYSTEM_PROMPT } = await import('./system-prompt')

const PROJECT = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  isCurrentUserAdmin.mockReset()
  runProjectChatTurn.mockReset().mockResolvedValue({ status: 'ok', reply: 'Verstanden.', toolCalls: 0 })
  loadSystemPromptExtension.mockReset().mockResolvedValue(null)
  createProjectChatPorts.mockReset().mockReturnValue({ loadSystemPromptExtension })
})

it('kein Admin → früher Abbruch, kein Modellaufruf', async () => {
  isCurrentUserAdmin.mockResolvedValue(false)

  const result = await sendEnergyAdvisorMessage(PROJECT, 'Wie steht der Datenstand?')

  expect(result).toEqual({ status: 'not_found' })
  expect(runProjectChatTurn).not.toHaveBeenCalled()
  expect(createProjectChatPorts).not.toHaveBeenCalled()
})

describe('als Admin', () => {
  beforeEach(() => {
    isCurrentUserAdmin.mockResolvedValue(true)
  })

  it('der zusammengesetzte Prompt trägt den Energieberater-Basistext, nicht den Kunden-Text', async () => {
    await sendEnergyAdvisorMessage(PROJECT, 'Wie steht der Datenstand?')

    expect(runProjectChatTurn).toHaveBeenCalledTimes(1)
    const [, , deps, attached, kind] = runProjectChatTurn.mock.calls[0]!
    expect(deps.systemPromptText).toContain(ENERGY_ADVISOR_SYSTEM_PROMPT)
    expect(deps.systemPromptText).not.toContain(PROJECT_CHAT_SYSTEM_PROMPT)
    expect(attached).toEqual([])
    expect(kind).toBe('ki_check')
  })
})
