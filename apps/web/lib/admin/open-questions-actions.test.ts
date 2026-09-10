import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN_INITIAL_STATE } from './schema'

/**
 * B24 (zehnter Bauschritt) — die Server Action der Antwort.
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * 1. Eine LEERE Antwort erreicht die Datenbank GAR NICHT (kein RPC) — und ergibt einen Feldfehler,
 *    keinen Erfolg. Ohne diese Bremse würde die Frage als beantwortet markiert, ohne dass irgendwo
 *    stünde, was gilt.
 * 2. Es wird GENAU EIN Wrapper gerufen, und zwar der, der ausschliesslich beantworten kann.
 * 3. ⚠ Eine stehende Annahme ändert den WORTLAUT der Erfolgsmeldung — sie ist der einzige Hinweis
 *    darauf, dass eine bereits gezeigte Rechnung zu prüfen ist (Delta §3.3).
 * 4. Es geht KEINE Nachricht an den Kunden raus, und die Meldung sagt das.
 *
 * Das Verhalten des Wrappers selbst (`answered_by`, dass die Annahme stehen bleibt, 42501 ohne
 * Adminrolle) ist B24 zweiter Bauschritt und liegt im DB-Gate.
 */

const rpc = vi.fn()
const getUser = vi.fn()
const createClient = vi.fn(async () => ({ rpc, auth: { getUser } }))
const revalidatePath = vi.fn()

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }))

const { answerOpenQuestionAction } = await import('./open-questions-actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  rpc.mockReset()
  createClient.mockClear()
  revalidatePath.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
})

describe('B24 — answerOpenQuestionAction', () => {
  it('⚠ fragt die Datenbank bei leerer Antwort gar nicht erst', async () => {
    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: '   ' }),
    )

    expect(rpc).not.toHaveBeenCalled()
    expect(state.fieldErrors?.answer).toBeTruthy()
    expect(state.success).toBeUndefined()
  })

  it('gibt die Eingabe bei einem Feldfehler zurück ins Formular', async () => {
    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: '' }),
    )
    expect(state.values?.answer).toBe('')
  })

  it('fragt ohne Kennung nicht — es gäbe nichts zu beantworten', async () => {
    const state = await answerOpenQuestionAction(ADMIN_INITIAL_STATE, form({ answer: 'egal' }))
    expect(rpc).not.toHaveBeenCalled()
    expect(state.formError).toBeTruthy()
  })

  it('ruft GENAU EINEN Wrapper, mit Kennung und Antworttext', async () => {
    rpc.mockResolvedValue({ data: { status: 'ok', question_id: 'q1' }, error: null })

    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: 'Der Zähler steht bei 42 kW.' }),
    )

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_answer_open_question', {
      p_question_id: 'q1',
      p_answer: 'Der Zähler steht bei 42 kW.',
    })
    expect(state.success).toBeTruthy()
    expect(state.formError).toBeUndefined()
  })

  it('sagt in der Erfolgsmeldung, dass der Kunde NICHT benachrichtigt wird', async () => {
    // Delta §3.3, offener Punkt 6: es gibt keine Benachrichtigung. Ungesagt hielte man den Vorgang
    // für abgeschlossen.
    rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })
    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: 'Antwort' }),
    )
    expect(state.success).toMatch(/nicht automatisch benachrichtigt/i)
  })

  it('⚠ nennt bei einer stehenden Annahme die mögliche Korrektur — sonst nicht', async () => {
    rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })

    const mitAnnahme = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: 'Antwort', hadAssumption: '1' }),
    )
    const ohneAnnahme = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q2', projectId: 'p1', answer: 'Antwort', hadAssumption: '0' }),
    )

    expect(mitAnnahme.success).toMatch(/Annahme bleibt/i)
    expect(mitAnnahme.success).toMatch(/korrigieren/i)
    expect(ohneAnnahme.success).not.toMatch(/Annahme/i)
  })

  it('frischt Warteschlange UND Projektseite auf — sonst stünde die Frage noch in der Liste', async () => {
    rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })

    await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: 'Antwort' }),
    )

    expect(revalidatePath).toHaveBeenCalledWith('/admin/rueckfragen')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/rueckfragen/p1')
  })

  it('meldet eine verschwundene Frage benannt, nicht als Sammelfehler', async () => {
    rpc.mockResolvedValue({ data: { status: 'not_found' }, error: null })
    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'weg', projectId: 'p1', answer: 'Antwort' }),
    )
    expect(state.formError).toMatch(/nicht \(mehr\)/i)
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('macht aus 42501 eine Berechtigungsmeldung, nicht „das hat nicht geklappt"', async () => {
    // Die Rolle wurde zwischen Seitenaufbau und Klick entzogen — ein Sammeltext lüde zum
    // Wiederholen ein, das nie klappen kann.
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: 'Antwort' }),
    )
    expect(state.formError).toMatch(/Berechtigung/i)
  })

  it('schreibt ohne Sitzung nicht', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: 'Antwort' }),
    )
    expect(rpc).not.toHaveBeenCalled()
    expect(state.formError).toMatch(/Berechtigung/i)
  })

  it('meldet eine unerwartete Antwort als Fehler statt als Erfolg', async () => {
    rpc.mockResolvedValue({ data: { status: 'huch' }, error: null })
    const state = await answerOpenQuestionAction(
      ADMIN_INITIAL_STATE,
      form({ id: 'q1', projectId: 'p1', answer: 'Antwort' }),
    )
    expect(state.success).toBeUndefined()
    expect(state.formError).toBeTruthy()
  })
})
