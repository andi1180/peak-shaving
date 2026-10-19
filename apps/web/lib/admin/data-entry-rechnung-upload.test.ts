import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_INVOICE_FILE_BYTES } from 'extractors'

/**
 * Rechnungen ablegen (direkt zu Storage): Anfordern, Eintragen, Verwerfen — mit dem ECHTEN
 * `direct-upload.ts`. Ersetzt sind nur Datenbank und Storage.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const createProjectDocumentUploadUrl = vi.fn()
const getProjectDocumentBytes = vi.fn()
const removeProjectDocumentBytes = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/project-documents/storage', () => ({
  createProjectDocumentUploadUrl: (path: string) => createProjectDocumentUploadUrl(path),
  getProjectDocumentBytes: (path: string) => getProjectDocumentBytes(path),
  removeProjectDocumentBytes: (path: string) => removeProjectDocumentBytes(path),
}))

const { requestInvoiceUploadAction, registerInvoiceUploadAction, discardInvoiceUploadAction } =
  await import('./data-entry-actions-rechnung-upload')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const DOCUMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

type Overrides = Partial<Record<string, { data: unknown; error: unknown }>>

function withDatabase(overrides: Overrides = {}) {
  const defaults: Record<string, { data: unknown; error: unknown }> = {
    list_metering_points: {
      data: { status: 'ok', metering_points: [{ id: POINT_ID, position: 1, label: null }] },
      error: null,
    },
    get_project: { data: { status: 'ok' }, error: null },
    get_project_document: { data: { status: 'not_found' }, error: null },
    append_project_document: { data: { status: 'ok' }, error: null },
  }
  rpc.mockImplementation(async (fn: string) => {
    const answer = overrides[fn] ?? defaults[fn]
    if (!answer) throw new Error(`unerwarteter Wrapper: ${fn}`)
    return answer
  })
}

function request(overrides: Record<string, unknown> = {}) {
  return requestInvoiceUploadAction({
    projectId: PROJECT_ID,
    meteringPointId: POINT_ID,
    fileName: 'Rechnung 01.pdf',
    fileSize: 900_000,
    contentType: 'application/pdf',
    ...overrides,
  } as Parameters<typeof requestInvoiceUploadAction>[0])
}

function register() {
  return registerInvoiceUploadAction({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    fileName: 'Rechnung 01.pdf',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  withDatabase()
  createProjectDocumentUploadUrl.mockResolvedValue({
    ok: true,
    signedUrl: 'https://storage.test/object/upload/sign/x?token=t',
  })
  getProjectDocumentBytes.mockResolvedValue({ ok: true, bytes: new ArrayBuffer(900_000) })
  removeProjectDocumentBytes.mockResolvedValue({ ok: true })
})

describe('requestInvoiceUploadAction', () => {
  it('gibt für ein PDF im Rahmen Kennung und signierte URL aus', async () => {
    const res = await request()
    expect(res.ok).toBe(true)
    expect(createProjectDocumentUploadUrl).toHaveBeenCalledTimes(1)
  })

  it('lehnt falschen Typ und zu grosse Datei ohne URL ab', async () => {
    const foto = await request({ contentType: 'image/png', fileName: 'foto.png' })
    const gross = await request({ fileSize: MAX_INVOICE_FILE_BYTES + 1 })

    expect(!foto.ok && foto.state).toContain('Nur PDF')
    expect(!gross.ok && gross.state).toContain('Grösser als')
    expect(rpc).not.toHaveBeenCalled()
    expect(createProjectDocumentUploadUrl).not.toHaveBeenCalled()
  })

  it('lehnt ein fremdes Projekt ab, ohne eine URL auszugeben', async () => {
    withDatabase({
      list_metering_points: { data: null, error: { code: '42501', message: 'denied' } },
    })
    const forbidden = await request()
    expect(forbidden.ok).toBe(false)

    // Zählpunkt passt, aber das Projekt ist für diese Sitzung nicht zugänglich.
    withDatabase({ get_project: { data: { status: 'not_found' }, error: null } })
    const notAccessible = await request()
    expect(notAccessible.ok).toBe(false)

    expect(createProjectDocumentUploadUrl).not.toHaveBeenCalled()
  })
})

describe('registerInvoiceUploadAction', () => {
  it('trägt eine angekommene Datei ein', async () => {
    const res = await register()
    expect(res).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith(
      'append_project_document',
      expect.objectContaining({
        p_document_id: DOCUMENT_ID,
        p_content_type: 'application/pdf',
      }),
    )
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
  })

  it('⚠ verwirft eine zu grosse Datei, statt sie einzutragen', async () => {
    getProjectDocumentBytes.mockResolvedValue({
      ok: true,
      bytes: new ArrayBuffer(MAX_INVOICE_FILE_BYTES + 1),
    })

    const res = await register()

    expect(res.ok).toBe(false)
    expect(rpc).not.toHaveBeenCalledWith('append_project_document', expect.anything())
    expect(removeProjectDocumentBytes).toHaveBeenCalledWith(`${PROJECT_ID}/${DOCUMENT_ID}`)
  })
})

describe('discardInvoiceUploadAction', () => {
  it('räumt ein nicht eingetragenes Objekt ab, ein eingetragenes nie', async () => {
    await discardInvoiceUploadAction({ projectId: PROJECT_ID, documentId: DOCUMENT_ID })
    expect(removeProjectDocumentBytes).toHaveBeenCalledTimes(1)

    removeProjectDocumentBytes.mockClear()
    withDatabase({ get_project_document: { data: { status: 'ok' }, error: null } })
    await discardInvoiceUploadAction({ projectId: PROJECT_ID, documentId: DOCUMENT_ID })
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
  })
})
