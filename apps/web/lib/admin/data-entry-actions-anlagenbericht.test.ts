import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

const rpc = vi.fn()
const uploadProjectDocument = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/project-documents/documents', () => ({
  uploadProjectDocument: (projectId: string, file: unknown) => uploadProjectDocument(projectId, file),
}))

const { uploadMeteringPointExportReportsAction, removeMeteringPointExportReportsAction } =
  await import('./data-entry-actions-anlagenbericht')
const { DRAFT_EXPORT_REPORTS_KEY, readStoredExportReports } = await import('./export-reports')

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const POINT_ID = '22222222-2222-4222-8222-222222222222'

let draft: Record<string, unknown> = {}

/** Synthetischer Monatsbericht wie in #489: Titelzeile, Kopf, je Stunde eine Zeile. */
function report(name: string, date: string, header = ['Statistischer Zeitraum', 'Netzeinspeisung (kWh)', 'Netzbezug (kWh)']): File {
  const rows = Array.from({ length: 24 }, (_, h) => [
    `${date} ${String(h).padStart(2, '0')}:00:00`,
    h >= 10 && h < 14 ? 2 : 0,
    h < 6 ? 0.5 : 0,
  ])
  const sheet = XLSX.utils.aoa_to_sheet([['Anlagenbericht (synthetisch)'], header, ...rows])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Bericht')
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
  return new File([bytes], name, { type: '' })
}

function form(files: File[]): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('meteringPointId', POINT_ID)
  for (const file of files) fd.append('files', file)
  return fd
}

beforeEach(() => {
  draft = { energyPriceCtPerKwh: 20 }
  rpc.mockReset()
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'list_metering_points') {
      return { data: { status: 'ok', metering_points: [{ id: POINT_ID, draft }] }, error: null }
    }
    if (fn === 'update_metering_point_draft') {
      draft = args.p_draft as Record<string, unknown>
      return { data: { status: 'ok' }, error: null }
    }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
  uploadProjectDocument.mockReset()
  uploadProjectDocument.mockImplementation(async (_p: string, file: { name: string; type: string }) => ({
    ok: true,
    documentId: `doc-${file.name}`,
    storagePath: `${PROJECT_ID}/doc-${file.name}`,
  }))
})

describe('uploadMeteringPointExportReportsAction', () => {
  it('liest zwei Berichte, legt beide ab und setzt den Entwurfsschlüssel mit Herkunft measured', async () => {
    const state = await uploadMeteringPointExportReportsAction(
      {},
      form([report('jun.xlsx', '2026-06-01'), report('jul.xlsx', '2026-07-01')]),
    )

    expect(state.success).toBe('2 Anlagenberichte eingelesen.')
    expect(uploadProjectDocument).toHaveBeenCalledTimes(2)
    expect(uploadProjectDocument.mock.calls[0]![1]).toMatchObject({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const stored = readStoredExportReports(draft)
    expect(stored?.documents.map((d) => d.documentId)).toEqual(['doc-jun.xlsx', 'doc-jul.xlsx'])
    expect(stored?.summary).toMatchObject({ hours: 48, exportKwh: 16, importKwh: 6, duplicateHours: 0 })
    expect((draft._provenance as Record<string, { source: string }>)[DRAFT_EXPORT_REPORTS_KEY]?.source).toBe(
      'measured',
    )
    expect(draft.energyPriceCtPerKwh).toBe(20)
  })

  it('lehnt einen Bericht mit fremdem Kopf ab, nennt die Datei und speichert nichts', async () => {
    const state = await uploadMeteringPointExportReportsAction(
      {},
      form([report('jun.xlsx', '2026-06-01'), report('fremd.xlsx', '2026-07-01', ['Zeit', 'Wert'])]),
    )

    expect(state.fieldErrors?.files).toContain('„fremd.xlsx"')
    expect(state.fieldErrors?.files).toContain('Gefunden: „zeit", „wert".')
    expect(state.fieldErrors?.files).toContain('Es wurde nichts gespeichert.')
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ersetzt einen bestehenden Satz vollständig', async () => {
    await uploadMeteringPointExportReportsAction({}, form([report('jun.xlsx', '2026-06-01'), report('jul.xlsx', '2026-07-01')]))
    const state = await uploadMeteringPointExportReportsAction({}, form([report('aug.xlsx', '2026-08-01')]))

    expect(state.success).toContain('Der bisherige Satz wurde ersetzt.')
    expect(readStoredExportReports(draft)?.documents).toEqual([{ documentId: 'doc-aug.xlsx', filename: 'aug.xlsx' }])
    expect(readStoredExportReports(draft)?.summary.hours).toBe(24)
  })
})

describe('removeMeteringPointExportReportsAction', () => {
  it('entfernt Schlüssel und Herkunftsvermerk, lässt den Rest stehen', async () => {
    await uploadMeteringPointExportReportsAction({}, form([report('jun.xlsx', '2026-06-01')]))
    const state = await removeMeteringPointExportReportsAction({}, form([]))

    expect(state.success).toContain('entfernt')
    expect(DRAFT_EXPORT_REPORTS_KEY in draft).toBe(false)
    expect(draft._provenance).toBeUndefined()
    expect(draft.energyPriceCtPerKwh).toBe(20)
  })
})
