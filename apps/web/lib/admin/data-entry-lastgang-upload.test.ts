import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PROJECT_DOCUMENT_BYTES } from 'shared'

/**
 * Lastgang-Upload direkt zu Storage: die zwei Actions samt dem ECHTEN `direct-upload.ts`.
 * Ersetzt sind nur die Ränder (Datenbank, Storage, Leser), damit sich zählen lässt, ob eine URL
 * ausgegeben, ein Objekt entfernt oder eine Zeile eingetragen wurde.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const revalidatePath = vi.fn()
const readLoadProfile = vi.fn()
const createProjectDocumentUploadUrl = vi.fn()
const getProjectDocumentBytes = vi.fn()
const removeProjectDocumentBytes = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))
vi.mock('extractors', async () => ({
  ...(await vi.importActual<typeof import('extractors')>('extractors')),
  readLoadProfile: (bytes: ArrayBuffer, name: string) => readLoadProfile(bytes, name),
}))
vi.mock('@/lib/project-documents/storage', () => ({
  createProjectDocumentUploadUrl: (path: string) => createProjectDocumentUploadUrl(path),
  getProjectDocumentBytes: (path: string) => getProjectDocumentBytes(path),
  removeProjectDocumentBytes: (path: string) => removeProjectDocumentBytes(path),
}))

const { requestLoadProfileUploadAction, completeLoadProfileUploadAction } = await import(
  './data-entry-actions-lastgang'
)

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const OTHER_POINT_ID = '99999999-7777-4888-8999-aaaaaaaaaaaa'
const DOCUMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const STORAGE_PATH = `${PROJECT_ID}/${DOCUMENT_ID}`
const BYTES = new TextEncoder().encode('Zeitstempel;kW\n').buffer

const SCAN = {
  ok: true,
  needsMapping: false,
  intervalMinutes: 15,
  coveredFrom: '2025-01-01T00:00:00+01:00',
  coveredTo: '2026-01-01T00:00:00+01:00',
  gaps: [],
}

function point(id: string) {
  return { id, position: 1, label: null, profileSource: null }
}

type Overrides = Partial<Record<string, { data: unknown; error: unknown }>>

function withDatabase(overrides: Overrides = {}) {
  const defaults: Record<string, { data: unknown; error: unknown }> = {
    list_metering_points: { data: { status: 'ok', metering_points: [point(POINT_ID)] }, error: null },
    get_project: { data: { status: 'ok' }, error: null },
    get_project_document: { data: { status: 'not_found' }, error: null },
    append_project_document: { data: { status: 'ok' }, error: null },
    set_metering_point_load_profile: { data: { status: 'ok' }, error: null },
  }
  rpc.mockImplementation(async (fn: string) => {
    const answer = overrides[fn] ?? defaults[fn]
    if (!answer) throw new Error(`unerwarteter Wrapper: ${fn}`)
    return answer
  })
}

function request(overrides: Record<string, unknown> = {}) {
  return requestLoadProfileUploadAction({
    projectId: PROJECT_ID,
    meteringPointId: POINT_ID,
    fileName: 'lastgang.csv',
    fileSize: 5_280_000,
    contentType: 'text/csv',
    ...overrides,
  } as Parameters<typeof requestLoadProfileUploadAction>[0])
}

function complete() {
  return completeLoadProfileUploadAction({
    projectId: PROJECT_ID,
    meteringPointId: POINT_ID,
    documentId: DOCUMENT_ID,
    fileName: 'lastgang.csv',
    contentType: '',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  withDatabase()
  createProjectDocumentUploadUrl.mockResolvedValue({
    ok: true,
    signedUrl: 'https://storage.test/object/upload/sign/x?token=t',
  })
  getProjectDocumentBytes.mockResolvedValue({ ok: true, bytes: BYTES })
  removeProjectDocumentBytes.mockResolvedValue({ ok: true })
  readLoadProfile.mockReturnValue({ ok: true, scan: SCAN })
})

describe('requestLoadProfileUploadAction — Ablehnung ohne URL', () => {
  it('zu grosse Datei', async () => {
    const res = await request({ fileSize: MAX_PROJECT_DOCUMENT_BYTES + 1 })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.state.fieldErrors?.file).toMatch(/zu gross/)
    expect(createProjectDocumentUploadUrl).not.toHaveBeenCalled()
  })

  it('Zählpunkt gehört nicht zum Projekt', async () => {
    withDatabase({
      list_metering_points: {
        data: { status: 'ok', metering_points: [point(OTHER_POINT_ID)] },
        error: null,
      },
    })
    const res = await request()
    expect(res.ok).toBe(false)
    expect(!res.ok && res.state.formError).toMatch(/Zählpunkt/)
    expect(createProjectDocumentUploadUrl).not.toHaveBeenCalled()
  })

  it('fremdes Projekt (keine Berechtigung bzw. nicht gefunden)', async () => {
    withDatabase({ list_metering_points: { data: null, error: { code: '42501' } } })
    expect((await request()).ok).toBe(false)

    withDatabase({ get_project: { data: { status: 'not_found' }, error: null } })
    const res = await request()
    expect(res.ok).toBe(false)
    expect(!res.ok && res.state.formError).toMatch(/Projekt/)
    expect(createProjectDocumentUploadUrl).not.toHaveBeenCalled()
  })

  it('Gutfall: URL für einen Pfad unter DIESEM Projekt', async () => {
    const res = await request()
    expect(res.ok).toBe(true)
    const path = createProjectDocumentUploadUrl.mock.calls[0]![0] as string
    expect(path).toMatch(new RegExp(`^${PROJECT_ID}/[0-9a-f-]{36}$`))
    expect(res.ok && path.endsWith(res.documentId)).toBe(true)
  })
})

describe('completeLoadProfileUploadAction', () => {
  it('liest die Bytes aus dem Storage und schreibt dieselben Wrapper-Argumente wie der bisherige Pfad', async () => {
    const res = await complete()
    expect(res).toEqual({ success: 'Lastgang eingelesen und gespeichert.' })

    expect(getProjectDocumentBytes).toHaveBeenCalledWith(STORAGE_PATH)
    expect(readLoadProfile).toHaveBeenCalledWith(BYTES, 'lastgang.csv')
    expect(rpc).toHaveBeenCalledWith('append_project_document', {
      p_project_id: PROJECT_ID,
      p_document_id: DOCUMENT_ID,
      p_original_filename: 'lastgang.csv',
      p_content_type: 'application/octet-stream',
    })
    expect(rpc).toHaveBeenCalledWith('set_metering_point_load_profile', {
      p_metering_point_id: POINT_ID,
      p_source_document_id: DOCUMENT_ID,
      p_interval_minutes: 15,
      p_covered_from: SCAN.coveredFrom,
      p_covered_to: SCAN.coveredTo,
      p_gaps: [],
    })
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('abgelehnte Datei: Storage-Objekt wird entfernt, nichts eingetragen', async () => {
    readLoadProfile.mockReturnValue({
      ok: true,
      scan: { ok: false, error: { message: 'Das ist kein Lastgang.' } },
    })
    const res = await complete()
    expect(res.fieldErrors?.file).toMatch(/^Das ist kein Lastgang\./)
    expect(removeProjectDocumentBytes).toHaveBeenCalledWith(STORAGE_PATH)
    const called = rpc.mock.calls.map((c) => c[0])
    expect(called).not.toContain('append_project_document')
    expect(called).not.toContain('set_metering_point_load_profile')
  })

  it('bereits eingetragenes Dokument wird weder gelesen noch entfernt', async () => {
    withDatabase({ get_project_document: { data: { status: 'ok' }, error: null } })
    const res = await complete()
    expect(res.formError).toBeTruthy()
    expect(getProjectDocumentBytes).not.toHaveBeenCalled()
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
  })
})
