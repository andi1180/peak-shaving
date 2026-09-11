import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B24, Teil 1 — der Lastgang-Rückweg als Server Action.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST: WAS BEI EINEM TEILAUSFALL STEHEN BLEIBT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das Verhalten der beiden Wrapper selbst (Adminrolle, `in_use`-Sperre, Rückgabe der noch gültigen
 * Dokument-Kennung) ist Sache der Migration und liegt im DB-Gate. Was DORT nicht messbar ist, ist
 * die Orchestrierung dazwischen — und genau in ihr sitzt die Entscheidung dieses Schritts:
 *
 *   1. ERST die Datei, DANN die Zeile. Umgekehrt bliebe im Fehlerfall ein Objekt im Bucket, auf das
 *      nichts mehr zeigt — unsichtbar in jeder Liste.
 *   2. SCHEITERT DAS LÖSCHEN DER DATEI, BLEIBT DIE ZEILE STEHEN. Sie ist der einzige Beleg dafür,
 *      dass die Datei noch da ist; sie trotzdem zu löschen wäre der stille Datenverlust, den die
 *      Reihenfolge gerade verhindern soll.
 *   3. IN BEIDEN FÄLLEN WIRD DIE STATION NEU GERENDERT. Der Zählpunkt ist ab Schritt 1
 *      zurückgesetzt; ohne `revalidatePath` zeigte der Browser weiter die Zusammenfassung eines
 *      Lastgangs, den es nicht mehr gibt.
 *
 * Der Storage-Rand ist deshalb ersetzt und zählt mit, OB und WANN er gerufen wurde — ein Fehlschlag
 * lässt sich in einer echten Ablage nicht auf Zuruf herstellen.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const removeProjectDocumentBytes = vi.fn()
const revalidatePath = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  },
}))
/*
 * `extractors` ist `server-only` und zieht den gesamten Parser nach — für den Rückweg wird nichts
 * davon gebraucht. Der Upload-Pfad ist hier ausdrücklich NICHT Gegenstand.
 */
vi.mock('extractors', () => ({ readLoadProfile: vi.fn() }))
vi.mock('@/lib/project-documents/documents', () => ({ uploadProjectDocument: vi.fn() }))
vi.mock('@/lib/project-documents/storage', () => ({
  removeProjectDocumentBytes: (path: string) => removeProjectDocumentBytes(path),
}))

const { removeMeteringPointLoadProfileAction } = await import('./data-entry-actions')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const DOCUMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const STORAGE_PATH = `${PROJECT_ID}/${DOCUMENT_ID}`

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('meteringPointId', POINT_ID)
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

/** Der Gutfall beider Wrapper — einzelne Tests überschreiben gezielt einen davon. */
function withWrappers(
  reset: unknown = {
    status: 'ok',
    metering_point_id: POINT_ID,
    project_id: PROJECT_ID,
    document_id: DOCUMENT_ID,
    storage_path: STORAGE_PATH,
  },
  del: unknown = { status: 'ok', document_id: DOCUMENT_ID, project_id: PROJECT_ID },
) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'admin_reset_metering_point_load_profile') return { data: reset, error: null }
    if (fn === 'admin_delete_metering_point_document') return { data: del, error: null }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
}

beforeEach(() => {
  rpc.mockReset()
  createClient.mockClear()
  removeProjectDocumentBytes.mockReset()
  revalidatePath.mockReset()
  removeProjectDocumentBytes.mockResolvedValue({ ok: true })
  withWrappers()
})

describe('removeMeteringPointLoadProfileAction — der vollständige Rückweg', () => {
  it('setzt zurück, löscht die Datei und DANN die Zeile', async () => {
    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(state.success).toBe('Lastgang entfernt. Sie können eine neue Datei hochladen.')
    expect(state.formError).toBeUndefined()

    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_reset_metering_point_load_profile', {
      p_metering_point_id: POINT_ID,
    })
    expect(removeProjectDocumentBytes).toHaveBeenCalledWith(STORAGE_PATH)
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_delete_metering_point_document', {
      p_metering_point_id: POINT_ID,
      p_document_id: DOCUMENT_ID,
    })

    // ⚠ Die Reihenfolge selbst, nicht nur die Tatsache, dass beides passiert ist.
    const [storageCall] = removeProjectDocumentBytes.mock.invocationCallOrder
    const rowCall = rpc.mock.invocationCallOrder[1]
    expect(storageCall).toBeDefined()
    expect(rowCall).toBeDefined()
    expect(storageCall as number).toBeLessThan(rowCall as number)
    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/kalkulator-projekte/${PROJECT_ID}/dateneingabe`,
    )
  })

  // ── Der geforderte Simulationsfall ────────────────────────────────────────────────────────────
  it('⚠ lässt die Zeile STEHEN, wenn das Löschen der Datei scheitert', async () => {
    removeProjectDocumentBytes.mockResolvedValue({ ok: false, message: 'network down' })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    // Kein zweiter Wrapper-Aufruf: die Zeile ist der einzige Beleg dafür, dass die Datei noch da ist.
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalledWith('admin_delete_metering_point_document', expect.anything())

    // Und der Admin erfährt BEIDES: dass der Zählpunkt frei ist UND dass ein Rest bleibt.
    expect(state.success).toBeUndefined()
    expect(state.formError).toContain('vom Zählpunkt entfernt')
    expect(state.formError).toContain('neue Datei hochladen')
    expect(state.formError).toContain('nicht aus der Ablage löschen')

    // Der Zählpunkt IST zurückgesetzt — die Station muss das zeigen, auch im Fehlerfall.
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('meldet einen stehengebliebenen Eintrag, wenn nur der letzte Schritt scheitert', async () => {
    withWrappers(undefined, { status: 'in_use' })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(removeProjectDocumentBytes).toHaveBeenCalledTimes(1)
    expect(state.success).toBeUndefined()
    expect(state.formError).toContain('Dokumentenliste')
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })
})

describe('removeMeteringPointLoadProfileAction — nichts anfassen, wo nichts zu tun ist', () => {
  it('fasst die Ablage nicht an, wenn der Zählpunkt keine Quelle trug', async () => {
    withWrappers({
      status: 'ok',
      metering_point_id: POINT_ID,
      project_id: PROJECT_ID,
      document_id: null,
      storage_path: null,
    })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(state.success).toBe('Es war kein Lastgang hinterlegt. Der Zählpunkt ist leer.')
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('benennt einen unbekannten Zählpunkt und rendert die Station NICHT neu', async () => {
    withWrappers({ status: 'not_found' })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(state.formError).toContain('Diesen Zählpunkt gibt es nicht')
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
    // Es wurde nichts geändert — ein Neurendern behauptete das Gegenteil.
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('gibt eine entzogene Rolle als solche zurück, ohne die Ablage anzufassen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('fragt die Datenbank gar nicht erst, wenn die Kennungen unbrauchbar sind', async () => {
    const badPoint = await removeMeteringPointLoadProfileAction({}, form({ meteringPointId: 'x' }))
    expect(badPoint.formError).toBeDefined()

    const badProject = await removeMeteringPointLoadProfileAction({}, form({ projectId: 'x' }))
    expect(badProject.formError).toBeDefined()

    expect(rpc).not.toHaveBeenCalled()
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
  })
})
