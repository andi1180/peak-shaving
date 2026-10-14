import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } } }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, auth: { getUser } }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/project-chat/supabase-ports', () => ({ loadProjectDocuments: vi.fn() }))
vi.mock('@/lib/project-documents/storage', () => ({ removeProjectDocumentBytes: vi.fn() }))

import { createAdminProjectAction, updateProjectLocationAction } from './projects-actions'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: { status: 'ok', project_id: 'p1' }, error: null })
})

describe('createAdminProjectAction — Land (Pflicht) und PLZ (optional)', () => {
  const create = (fields: Record<string, string>) =>
    createAdminProjectAction({}, form({ customerLabel: 'Testprojekt', ...fields }))

  it('lehnt fehlendes und ungültiges Land ab, ohne zu schreiben', async () => {
    for (const country of ['', 'FR']) {
      const state = await create({ country, postalCode: '' })
      expect(state.fieldErrors?.country).toBeTruthy()
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('prüft die PLZ je Land: AT vier, DE fünf Ziffern; ohne PLZ ok', async () => {
    expect((await create({ country: 'DE', postalCode: '1010' })).fieldErrors?.postalCode).toMatch(
      /fünf Ziffern/,
    )
    expect((await create({ country: 'AT', postalCode: '10115' })).fieldErrors?.postalCode).toMatch(
      /vier Ziffern/,
    )
    expect(rpc).not.toHaveBeenCalled()

    expect((await create({ country: 'AT', postalCode: '1100' })).success).toBeTruthy()
    expect((await create({ country: 'DE', postalCode: '10115' })).success).toBeTruthy()
    expect((await create({ country: 'AT', postalCode: '' })).success).toBeTruthy()
    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_create_project', {
      p_customer_label: 'Testprojekt',
      p_country: 'AT',
      p_postal_code: '1100',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_create_project', {
      p_customer_label: 'Testprojekt',
      p_country: 'DE',
      p_postal_code: '10115',
    })
    expect(rpc).toHaveBeenNthCalledWith(3, 'admin_create_project', {
      p_customer_label: 'Testprojekt',
      p_country: 'AT',
    })
  })
})

describe('updateProjectLocationAction — Stammdaten', () => {
  const update = (fields: Record<string, string>) =>
    updateProjectLocationAction({}, form({ projectId: 'p1', ...fields }))

  it('speichert Land und PLZ gemeinsam, mit Prüfung je Land', async () => {
    expect((await update({ country: '', postalCode: '1100' })).fieldErrors?.country).toBeTruthy()
    expect((await update({ country: 'DE', postalCode: '1010' })).fieldErrors?.postalCode).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()

    const state = await update({ country: 'DE', postalCode: '10115' })
    expect(state.success).toMatch(/Deutschland, 10115/)
    expect(rpc).toHaveBeenCalledWith('update_project_postal_code', {
      p_id: 'p1',
      p_country: 'DE',
      p_postal_code: '10115',
    })
  })

  it('meldet eine nicht passende bestehende PLZ beim Land-Wechsel als Feldfehler', async () => {
    rpc.mockResolvedValue({ data: { status: 'invalid_postal_code' }, error: null })
    const state = await update({ country: 'DE', postalCode: '' })
    expect(state.fieldErrors?.postalCode).toMatch(/passt nicht zu diesem Land/)
  })
})
