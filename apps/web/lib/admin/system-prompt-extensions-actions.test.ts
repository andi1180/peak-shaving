import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN_INITIAL_STATE } from './schema'
import { readPromptExtension } from './system-prompt-extensions'

/**
 * B24 (Station 6) — die Server Action der Prompt-Pflege.
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * 1. ⚠ DIE ART REIST IMMER MIT. Ohne `p_kind` fiele der Wrapper auf seinen Vorgabewert `kunde`
 *    zurück — ein Energieberater-Schreibvorgang schlösse dann den offenen KUNDEN-Stand oder
 *    ersetzte dessen Text, ohne jede Meldung (Migration `20260915120000`, TEIL 2). Das ist der
 *    teuerste Fehler, den diese Action machen könnte, und er sähe wie ein Erfolg aus.
 * 2. ⚠ ES WIRD KEIN `p_valid_from` ÜBERGEBEN. Ein Beginn in der Zukunft erzeugte einen Stand, den
 *    `admin_get_...` zeigt und `get_system_prompt_extension` nicht liefert — die Seite zeigte einen
 *    Text, nach dem gerade nicht gesprochen wird.
 * 3. Ein LEERER Text erreicht die Datenbank GAR NICHT (kein RPC) und ergibt einen Feldfehler.
 * 4. Eine unbekannte Art erreicht sie ebenso wenig — und ergibt KEINEN Feldfehler: der Nutzer hat
 *    sie nicht eingegeben und könnte an keinem Feld etwas korrigieren.
 * 5. `created` und `replaced` sind fachlich verschieden, und die Meldung unterscheidet sie.
 * 6. Ein geworfenes 42501 wird abgefangen und bleibt lesbar.
 *
 * Das Verhalten des Wrappers selbst (Ordnungspflicht je Kette, der Advisory-Lock, die
 * in-place-Korrektur, 42501 ohne Adminrolle) liegt im DB-Gate (`packages/db-tests`).
 */

const rpc = vi.fn()
const getUser = vi.fn()
const createClient = vi.fn(async () => ({ rpc, auth: { getUser } }))
const revalidatePath = vi.fn()

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }))

const { saveSystemPromptExtensionAction } = await import('./system-prompt-extensions-actions')

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

describe('B24 Station 6 — saveSystemPromptExtensionAction', () => {
  it('⚠ schickt die Art MIT und das Datum NICHT — für den Kunden-Chat', async () => {
    rpc.mockResolvedValue({ data: { status: 'created', id: 'e1' }, error: null })

    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'Frag zuerst nach dem Jahresverbrauch.' }),
    )

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_set_system_prompt_extension', {
      p_text: 'Frag zuerst nach dem Jahresverbrauch.',
      p_kind: 'kunde',
    })
    // Die Abwesenheit ist die Aussage: der Vorgabewert `current_date` der Datenbank soll greifen.
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty('p_valid_from')
    expect(state.success).toBeTruthy()
    expect(state.formError).toBeUndefined()
  })

  it('⚠ schickt für den Energieberater `ki_check` — nicht den Vorgabewert der Datenbank', async () => {
    rpc.mockResolvedValue({ data: { status: 'created', id: 'e2' }, error: null })

    await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'ki_check', text: 'Prüfe die Plausibilität der Lastspitzen.' }),
    )

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_kind: 'ki_check' })
  })

  it('unterscheidet in der Meldung zwischen neuem Stand und heutiger Korrektur', async () => {
    rpc.mockResolvedValue({ data: { status: 'created' }, error: null })
    const created = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'A' }),
    )

    rpc.mockResolvedValue({ data: { status: 'replaced' }, error: null })
    const replaced = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'B' }),
    )

    expect(created.success).toContain('Neu gesetzt')
    expect(replaced.success).toContain('Heutiger Stand korrigiert')
    /*
     * Die Korrektur ist die einzige, die etwas VERNICHTET (kein Löschweg, keine Historie über eine
     * in-place-Änderung) — steht das nicht in der Meldung, steht es nirgends.
     */
    expect(replaced.success).toContain('nirgends mehr zu finden')
    expect(created.success).not.toContain('nirgends mehr zu finden')
  })

  it('nennt die betroffene Art im Klartext — es gibt zwei Formulare auf einer Seite', async () => {
    rpc.mockResolvedValue({ data: { status: 'created' }, error: null })
    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'ki_check', text: 'A' }),
    )
    expect(state.success).toContain('Energieberater')
  })

  it('⚠ fragt die Datenbank bei leerem Text gar nicht erst', async () => {
    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: '   ' }),
    )

    expect(rpc).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
    expect(state.fieldErrors?.text).toBeTruthy()
    expect(state.success).toBeUndefined()
    // Ein leeres Feld ist keine Abschaltung — die Meldung muss das sagen, sonst probiert es jemand.
    expect(state.fieldErrors?.text).toContain('NICHT ab')
  })

  it('gibt die Eingabe bei einem Feldfehler zurück ins Formular', async () => {
    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: '  ' }),
    )
    expect(state.values?.text).toBe('  ')
  })

  it('⚠ weist eine unbekannte Art ab, ohne zu fragen — und NICHT als Feldfehler', async () => {
    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'bogus', text: 'egal' }),
    )

    expect(rpc).not.toHaveBeenCalled()
    expect(state.formError).toBeTruthy()
    expect(state.fieldErrors).toBeUndefined()
    expect(state.values?.text).toBe('egal')
  })

  it('weist eine FEHLENDE Art ebenso ab — der Vorgabewert der Datenbank darf nicht greifen', async () => {
    const state = await saveSystemPromptExtensionAction(ADMIN_INITIAL_STATE, form({ text: 'egal' }))
    expect(rpc).not.toHaveBeenCalled()
    expect(state.formError).toBeTruthy()
  })

  it('fängt ein geworfenes 42501 ab und bleibt lesbar', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Adminrolle erforderlich' },
    })

    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'A' }),
    )

    expect(state.formError).toContain('Keine Berechtigung')
    expect(state.formError).not.toContain('42501')
    expect(state.success).toBeUndefined()
    // Kein Neurendern: es wurde nichts geändert, und ein revalidate behauptete das Gegenteil.
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rendert nach einem Fehlschlag nicht neu und meldet keinen Erfolg', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'boom' } })

    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'A' }),
    )

    expect(state.formError).toBeTruthy()
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('schreibt nichts ohne Sitzung', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'A' }),
    )

    expect(rpc).not.toHaveBeenCalled()
    expect(state.formError).toContain('Keine Berechtigung')
  })

  it('meldet den Status `invalid_text` mit DERSELBEN Meldung wie die Feldprüfung', async () => {
    const local = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: ' ' }),
    )

    rpc.mockResolvedValue({ data: { status: 'invalid_text' }, error: null })
    const remote = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'A' }),
    )

    // Zwei Wege, ein Sachverhalt — zwei Formulierungen liefen beim nächsten Umbau auseinander.
    expect(remote.fieldErrors?.text).toBe(local.fieldErrors?.text)
  })

  it('rendert genau die Pflegeseite neu — sie zeigt beide Stände', async () => {
    rpc.mockResolvedValue({ data: { status: 'created' }, error: null })
    await saveSystemPromptExtensionAction(ADMIN_INITIAL_STATE, form({ kind: 'kunde', text: 'A' }))

    expect(revalidatePath).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/ki-prompts')
  })

  it('behandelt eine unerwartete Antwort als Fehler statt als Erfolg', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: { status: 'was_auch_immer' }, error: null })

    const state = await saveSystemPromptExtensionAction(
      ADMIN_INITIAL_STATE,
      form({ kind: 'kunde', text: 'A' }),
    )

    expect(state.success).toBeUndefined()
    expect(state.formError).toBeTruthy()
    expect(revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('B24 Station 6 — readPromptExtension', () => {
  it('liest einen Stand samt aufgelöster Urheber-Adresse', () => {
    const out = readPromptExtension({
      status: 'ok',
      extension: {
        id: 'e1',
        extension_text: 'Frag zuerst nach dem Jahresverbrauch.',
        kind: 'kunde',
        valid_from: '2026-09-15',
        valid_until: null,
        created_by_email: 'martin@coolin.at',
      },
    })

    expect(out).toEqual({
      id: 'e1',
      text: 'Frag zuerst nach dem Jahresverbrauch.',
      validFrom: '2026-09-15',
      createdByEmail: 'martin@coolin.at',
    })
  })

  it('verträgt eine fehlende Urheber-Adresse (das Konto kann gelöscht sein)', () => {
    const out = readPromptExtension({
      status: 'ok',
      extension: { id: 'e1', extension_text: 'A', valid_from: '2026-09-15' },
    })
    expect(out?.createdByEmail).toBeNull()
  })

  it('macht aus „noch nichts gesetzt" kein Phantom', () => {
    expect(readPromptExtension({ status: 'none' })).toBeNull()
    expect(readPromptExtension({ status: 'invalid_kind' })).toBeNull()
    expect(readPromptExtension(null)).toBeNull()
    expect(readPromptExtension([])).toBeNull()
  })

  it('⚠ zeigt einen leeren Text nicht als gepflegten Stand an', () => {
    const out = readPromptExtension({
      status: 'ok',
      extension: { id: 'e1', extension_text: '   ', valid_from: '2026-09-15' },
    })
    expect(out).toBeNull()
  })
})
