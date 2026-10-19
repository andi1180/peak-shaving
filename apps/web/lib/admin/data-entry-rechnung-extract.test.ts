import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Rechnung je Dokument + Abschluss. Der Datenbankrand ist `rpc`; die drei Auslese-Wrapper laufen
 * gegen eine kleine Tabelle im Speicher, damit `document-extractions.ts` echt mitübersetzt. Das
 * Ergebnis geht durch JSON wie durch `jsonb`.
 */

const rpc = vi.fn()
const getProjectDocumentBytes = vi.fn()
const extractInvoiceData = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./grid-operators', () => ({
  readKnownOperatorIdsForProject: async () => ['wiener_netze', 'netz_noe', 'salzburg_netz'],
}))
vi.mock('extractors', async () => ({
  ...(await vi.importActual<typeof import('extractors')>('extractors')),
  extractInvoiceData: (base64: string) => extractInvoiceData(base64),
}))
vi.mock('@/lib/project-documents/storage', () => ({
  getProjectDocumentBytes: (path: string) => getProjectDocumentBytes(path),
}))

const { extractStoredInvoiceAction, finalizeInvoiceExtractionsAction, listInvoiceExtractionsAction } =
  await import('./data-entry-actions-rechnung-extract')
const { removeMeteringPointInvoiceAction } = await import('./data-entry-actions-rechnung')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_PROJECT_ID = '22222222-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'

type Row = {
  id: string
  project_id: string
  document_id: string
  metering_point_id: string | null
  kind: 'invoice'
  status: 'pending' | 'running' | 'done' | 'failed' | 'removed'
  result: unknown
  error: string | null
  attempts: number
  started_at: string | null
}

let draft: Record<string, unknown> = {}
let table: Row[] = []
const files = new Map<string, { name: string; project: string }>()
let draftWrites = 0
let discardFails = false

function idFor(name: string): string {
  const n = [...files.values()].findIndex((f) => f.name === name)
  return `00000000-0000-4000-8000-${String((n === -1 ? files.size : n) + 1).padStart(12, '0')}`
}

function file(name: string, project = PROJECT_ID): string {
  const id = idFor(name)
  files.set(id, { name, project })
  return id
}

function extraction(rates: Record<string, number> = {}, head: Record<string, unknown> = {}) {
  return {
    ok: true,
    extraction: {
      netzbetreiber: 'wiener_netze',
      netzebene: 5,
      meteringVariant: null,
      annualConsumptionKwh: null,
      billingPeriodFrom: null,
      billingPeriodTo: null,
      billingPeriodAssumed: null,
      supplierPriceBasis: 'net',
      ...head,
      rates: {
        leistungspreisEurPerKwYear: null,
        minBillableKw: null,
        arbeitspreisNetzCtPerKwh: null,
        energyPriceCtPerKwh: null,
        energyPriceNightCtPerKwh: null,
        einspeiseverguetungCtPerKwh: null,
        supplierBaseFeeEurPerMonth: null,
        ...rates,
      },
    },
  }
}

/** Der Extraktor sieht den Dateinamen in den Bytes — so ordnen sich nebenläufige Aufrufe zu. */
const outcomes = new Map<string, unknown>()

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
  if (fn === 'get_project_document') {
    const f = files.get(String(args.p_document_id))
    if (!f) return { data: { status: 'not_found' }, error: null }
    const id = String(args.p_document_id)
    return {
      data: {
        status: 'ok',
        document: {
          id,
          project_id: f.project,
          storage_path: `${f.project}/${id}`,
          original_filename: f.name,
          content_type: 'application/pdf',
        },
      },
      error: null,
    }
  }
  if (fn === 'list_metering_points') {
    return { data: { status: 'ok', metering_points: [{ id: POINT_ID, draft }] }, error: null }
  }
  if (fn === 'update_metering_point_draft') {
    draftWrites += 1
    draft = json(args.p_draft as Record<string, unknown>)
    return { data: { status: 'ok' }, error: null }
  }
  if (fn === 'start_document_extraction') {
    const docId = String(args.p_document_id)
    let row = table.find((r) => r.document_id === docId)
    if (!row) {
      row = {
        id: `e-${docId}`,
        project_id: files.get(docId)!.project,
        document_id: docId,
        metering_point_id: null,
        kind: 'invoice',
        status: 'pending',
        result: null,
        error: null,
        attempts: 0,
        started_at: null,
      }
      table.push(row)
    }
    if (row.status === 'removed')
      return { data: { status: 'removed', extraction: row }, error: null }
    if (row.status === 'running')
      return { data: { status: 'already_running', extraction: row }, error: null }
    Object.assign(row, {
      status: 'running',
      attempts: row.attempts + 1,
      metering_point_id: args.p_metering_point_id,
      started_at: new Date().toISOString(),
      error: null,
    })
    return { data: { status: 'ok', extraction: json(row) }, error: null }
  }
  if (fn === 'finish_document_extraction') {
    const row = table.find((r) => r.id === args.p_id)
    if (!row) return { data: { status: 'not_found' }, error: null }
    if (row.status !== 'running')
      return { data: { status: 'not_running', extraction: row }, error: null }
    Object.assign(row, { status: args.p_status, result: json(args.p_result), error: args.p_error })
    return { data: { status: 'ok', extraction: json(row) }, error: null }
  }
  if (fn === 'discard_document_extraction') {
    if (discardFails) return { data: null, error: { code: 'XX000', message: 'kaputt' } }
    const row = table.find((r) => r.document_id === args.p_document_id)
    if (!row) return { data: { status: 'no_row' }, error: null }
    row.status = 'removed'
    return { data: { status: 'ok', extraction: json(row) }, error: null }
  }
  if (fn === 'list_project_documents') {
    const documents = [...files.entries()]
      .filter(([, f]) => f.project === args.p_project_id)
      .map(([id, f]) => ({ id, original_filename: f.name, content_type: 'application/pdf' }))
    return { data: { status: 'ok', documents }, error: null }
  }
  if (fn === 'list_document_extractions') {
    const rows = table.filter((r) => r.metering_point_id === args.p_metering_point_id)
    return { data: { status: 'ok', extractions: json(rows) }, error: null }
  }
  throw new Error(`unerwarteter Wrapper: ${fn}`)
})

beforeEach(() => {
  draft = {}
  table = []
  files.clear()
  outcomes.clear()
  draftWrites = 0
  discardFails = false
  rpc.mockClear()
  getProjectDocumentBytes.mockReset()
  getProjectDocumentBytes.mockImplementation(async (path: string) => {
    const name = files.get(path.slice(path.lastIndexOf('/') + 1))?.name ?? ''
    const bytes = new Uint8Array(1024)
    bytes.set(new TextEncoder().encode(name))
    return { ok: true, bytes: bytes.buffer }
  })
  extractInvoiceData.mockReset()
  extractInvoiceData.mockImplementation(async (base64: string) =>
    outcomes.get(Buffer.from(base64, 'base64').toString('utf8').replace(/\0+$/, '')),
  )
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

/** B je Dokument, danach C über dieselben Kennungen. */
async function extractAndFinalize(ids: string[]) {
  for (const id of ids) await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, id)
  return finalizeInvoiceExtractionsAction(PROJECT_ID, POINT_ID, ids)
}

describe('Rechnung je Dokument + Abschluss', () => {
  it('⚠ GLEICHHEITS-GATE: ergibt bit-identisch den Entwurf des entfernten Sammelwegs', async () => {
    // Widerspruch (a ↔ b beim Arbeitspreis) und unklare Preisbasis (c), wie im #514-Gleichheitstest.
    outcomes.set(
      'a.pdf',
      extraction({ energyPriceCtPerKwh: 24.5, leistungspreisEurPerKwYear: 38.52 }),
    )
    outcomes.set('b.pdf', extraction({ energyPriceCtPerKwh: 26.9 }))
    outcomes.set('c.pdf', extraction({ minBillableKw: 44 }, { supplierPriceBasis: null }))
    const ids = [file('a.pdf'), file('b.pdf'), file('c.pdf')]

    // Wie die Station: jede Rechnung einzeln, danach EIN Abschluss ohne Kennungen.
    for (const id of ids) await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, id)
    const state = await finalizeInvoiceExtractionsAction(PROJECT_ID, POINT_ID)

    expect(state.open).toEqual([])
    expect(state.success).toContain('widersprechen einander')
    expect(JSON.stringify(draft)).toBe(JSON.stringify(SAMMELWEG_ENTWURF))
  })

  it('Statusliste: Zeilen aus document_extractions mit Dateinamen, ohne entfernte — auch nach Neuladen', async () => {
    outcomes.set('a.pdf', extraction({ energyPriceCtPerKwh: 24.5 }))
    outcomes.set('kaputt.pdf', { ok: false, reason: 'unreadable' })
    const [a, kaputt, weg] = [file('a.pdf'), file('kaputt.pdf'), file('weg.pdf')]
    await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, a)
    await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, kaputt)
    table.push({
      id: 'e-weg',
      project_id: PROJECT_ID,
      document_id: weg,
      metering_point_id: POINT_ID,
      kind: 'invoice',
      status: 'removed',
      result: null,
      error: null,
      attempts: 1,
      started_at: null,
    })

    // Ein neuer Aufruf ohne Browserzustand — genau das, was ein Neuladen der Station tut.
    const listed = await listInvoiceExtractionsAction(PROJECT_ID, POINT_ID)

    expect(listed).toEqual({
      ok: true,
      rows: [
        {
          documentId: a,
          filename: 'a.pdf',
          status: 'done',
          error: null,
          attempts: 1,
          startedAt: '2026-10-19T08:00:00.000Z',
        },
        {
          documentId: kaputt,
          filename: 'kaputt.pdf',
          status: 'failed',
          error: expect.stringContaining('keine der gesuchten Angaben'),
          attempts: 1,
          startedAt: '2026-10-19T08:00:00.000Z',
        },
      ],
    })
  })

  it('ersetzt beim Neulesen derselben Kennung statt zu verdoppeln; zweimal abschliessen ändert nichts', async () => {
    outcomes.set('a.pdf', extraction({ energyPriceCtPerKwh: 24.5 }))
    outcomes.set('b.pdf', extraction({ leistungspreisEurPerKwYear: 38.52 }))
    const [a, b] = [file('a.pdf'), file('b.pdf')]
    await extractAndFinalize([a, b])

    outcomes.set('a.pdf', extraction({ energyPriceCtPerKwh: 25.1 }))
    await extractAndFinalize([a])

    const entries = draft._invoiceExtractions as { documentId: string }[]
    expect(entries.map((e) => e.documentId)).toEqual([a, b])
    expect(draft.energyPriceCtPerKwh).toBe(25.1)

    const before = JSON.stringify(draft)
    const writes = draftWrites
    vi.setSystemTime(new Date('2026-10-19T09:00:00.000Z'))
    const again = await finalizeInvoiceExtractionsAction(PROJECT_ID, POINT_ID, [a, b])

    expect(again.success).toContain('Keine neuen Leseergebnisse')
    expect(draftWrites).toBe(writes)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('lässt ein fehlgeschlagenes Dokument aus dem Entwurf und meldet es im Abschluss', async () => {
    outcomes.set('gut.pdf', extraction({ energyPriceCtPerKwh: 24.5 }))
    outcomes.set('kaputt.pdf', { ok: false, reason: 'unreadable' })
    const [gut, kaputt] = [file('gut.pdf'), file('kaputt.pdf')]

    expect(await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, kaputt)).toEqual({
      status: 'failed',
      error: expect.stringContaining('keine der gesuchten Angaben'),
    })
    await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, gut)
    const state = await finalizeInvoiceExtractionsAction(PROJECT_ID, POINT_ID, [gut, kaputt])

    expect(
      (draft._invoiceExtractions as { documentId: string }[]).map((e) => e.documentId),
    ).toEqual([gut])
    expect(state.open).toEqual([
      { documentId: kaputt, filename: 'kaputt.pdf', status: 'failed', error: expect.any(String) },
    ])
    expect(state.fieldErrors?.files).toContain('kaputt.pdf')
  })

  it('reicht already_running durch und liest nichts', async () => {
    const a = file('a.pdf')
    table.push({
      id: 'e-laufend',
      project_id: PROJECT_ID,
      document_id: a,
      metering_point_id: POINT_ID,
      kind: 'invoice',
      status: 'running',
      result: null,
      error: null,
      attempts: 1,
      started_at: new Date().toISOString(),
    })

    expect(await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, a)).toEqual({
      status: 'already_running',
    })
    expect(getProjectDocumentBytes).not.toHaveBeenCalled()
    expect(extractInvoiceData).not.toHaveBeenCalled()
  })

  it('⚠ fremdes Projekt / unbekanntes Dokument: not_found, keine Zeile, kein Storage', async () => {
    const fremd = file('fremd.pdf', OTHER_PROJECT_ID)

    expect(await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, fremd)).toEqual({
      status: 'not_found',
    })
    expect(
      await extractStoredInvoiceAction(
        PROJECT_ID,
        POINT_ID,
        '99999999-0000-4000-8000-000000000000',
      ),
    ).toEqual({ status: 'not_found' })
    expect(rpc.mock.calls.some(([fn]) => fn === 'start_document_extraction')).toBe(false)
    expect(getProjectDocumentBytes).not.toHaveBeenCalled()
  })

  describe('Entfernen und Abschluss ohne Kennungen', () => {
    function removeForm(documentId: string): FormData {
      const fd = new FormData()
      fd.set('projectId', PROJECT_ID)
      fd.set('meteringPointId', POINT_ID)
      fd.set('documentId', documentId)
      return fd
    }

    it('⚠ eine entfernte Rechnung kommt beim Abschluss ohne Kennungen nicht zurück', async () => {
      outcomes.set('a.pdf', extraction({ energyPriceCtPerKwh: 24.5 }))
      outcomes.set('b.pdf', extraction({ leistungspreisEurPerKwYear: 38.52 }))
      const [a, b] = [file('a.pdf'), file('b.pdf')]
      await extractAndFinalize([a, b])

      const removed = await removeMeteringPointInvoiceAction({}, removeForm(a))
      expect(removed.formError).toBeUndefined()
      expect(table.find((r) => r.document_id === a)?.status).toBe('removed')

      const state = await finalizeInvoiceExtractionsAction(PROJECT_ID, POINT_ID)
      const entries = draft._invoiceExtractions as { documentId: string }[]
      expect(entries.map((e) => e.documentId)).toEqual([b])
      expect(state.open).toEqual([])
      // Neu lesen lässt sich ein entferntes Dokument nicht.
      expect(await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, a)).toEqual({
        status: 'removed',
      })
    })

    it('Abschluss ohne Kennungen ergibt denselben Entwurf wie mit allen Kennungen', async () => {
      outcomes.set('a.pdf', extraction({ energyPriceCtPerKwh: 24.5 }))
      outcomes.set('b.pdf', extraction({ energyPriceCtPerKwh: 26.9 }))
      outcomes.set('c.pdf', { ok: false, reason: 'unreadable' })
      const ids = [file('a.pdf'), file('b.pdf'), file('c.pdf')]
      for (const id of ids) await extractStoredInvoiceAction(PROJECT_ID, POINT_ID, id)

      const withIds = await finalizeInvoiceExtractionsAction(PROJECT_ID, POINT_ID, ids)
      const viaIds = JSON.stringify(draft)

      draft = {}
      const withoutIds = await finalizeInvoiceExtractionsAction(PROJECT_ID, POINT_ID)

      expect(JSON.stringify(draft)).toBe(viaIds)
      expect(withoutIds.open).toEqual(withIds.open)
      expect(withoutIds.open.map((o) => o.filename)).toEqual(['c.pdf'])
    })

    it('⚠ scheitert das Markieren, bleibt der Entwurf unverändert', async () => {
      outcomes.set('a.pdf', extraction({ energyPriceCtPerKwh: 24.5 }))
      const a = file('a.pdf')
      await extractAndFinalize([a])
      const before = JSON.stringify(draft)
      const writes = draftWrites

      discardFails = true
      const state = await removeMeteringPointInvoiceAction({}, removeForm(a))

      expect(state.formError).toBeDefined()
      expect(state.success).toBeUndefined()
      expect(draftWrites).toBe(writes)
      expect(JSON.stringify(draft)).toBe(before)
      expect(table.find((r) => r.document_id === a)?.status).toBe('done')
    })
  })
})

/**
 * Der Entwurf, den der entfernte Sammelweg (alle Rechnungen in einer Action) für a/b/c oben geschrieben
 * hat — erzeugt aus dessen letztem Lauf vor dem Entfernen (Uhr fest auf 2026-10-19T08:00Z).
 * Nicht anpassen, um einen Test grün zu machen: er ist die Erwartung „identisch zu vorher".
 */
const SAMMELWEG_ENTWURF = {
  "_invoiceExtractions": [
    {
      "documentId": "00000000-0000-4000-8000-000000000001",
      "filename": "a.pdf",
      "extraction": {
        "netzbetreiber": "wiener_netze",
        "netzebene": 5,
        "meteringVariant": null,
        "annualConsumptionKwh": null,
        "billingPeriodFrom": null,
        "billingPeriodTo": null,
        "billingPeriodAssumed": null,
        "supplierPriceBasis": "net",
        "rates": {
          "leistungspreisEurPerKwYear": 38.52,
          "minBillableKw": null,
          "arbeitspreisNetzCtPerKwh": null,
          "energyPriceCtPerKwh": 24.5,
          "energyPriceNightCtPerKwh": null,
          "einspeiseverguetungCtPerKwh": null,
          "supplierBaseFeeEurPerMonth": null
        }
      }
    },
    {
      "documentId": "00000000-0000-4000-8000-000000000002",
      "filename": "b.pdf",
      "extraction": {
        "netzbetreiber": "wiener_netze",
        "netzebene": 5,
        "meteringVariant": null,
        "annualConsumptionKwh": null,
        "billingPeriodFrom": null,
        "billingPeriodTo": null,
        "billingPeriodAssumed": null,
        "supplierPriceBasis": "net",
        "rates": {
          "leistungspreisEurPerKwYear": null,
          "minBillableKw": null,
          "arbeitspreisNetzCtPerKwh": null,
          "energyPriceCtPerKwh": 26.9,
          "energyPriceNightCtPerKwh": null,
          "einspeiseverguetungCtPerKwh": null,
          "supplierBaseFeeEurPerMonth": null
        }
      }
    },
    {
      "documentId": "00000000-0000-4000-8000-000000000003",
      "filename": "c.pdf",
      "extraction": {
        "netzbetreiber": "wiener_netze",
        "netzebene": 5,
        "meteringVariant": null,
        "annualConsumptionKwh": null,
        "billingPeriodFrom": null,
        "billingPeriodTo": null,
        "billingPeriodAssumed": null,
        "supplierPriceBasis": null,
        "rates": {
          "leistungspreisEurPerKwYear": null,
          "minBillableKw": 44,
          "arbeitspreisNetzCtPerKwh": null,
          "energyPriceCtPerKwh": null,
          "energyPriceNightCtPerKwh": null,
          "einspeiseverguetungCtPerKwh": null,
          "supplierBaseFeeEurPerMonth": null
        }
      }
    }
  ],
  "supplierPriceBasis": "net",
  "netzbetreiber": "wiener_netze",
  "_provenance": {
    "netzbetreiber": {
      "source": "measured",
      "at": "2026-10-19T08:00:00.000Z",
      "origin": "invoice"
    },
    "netzebene": {
      "source": "measured",
      "at": "2026-10-19T08:00:00.000Z",
      "origin": "invoice"
    },
    "leistungspreisEurPerKwYear": {
      "source": "measured",
      "at": "2026-10-19T08:00:00.000Z",
      "origin": "invoice"
    },
    "minBillableKw": {
      "source": "measured",
      "at": "2026-10-19T08:00:00.000Z",
      "origin": "invoice"
    },
    "invoiceSkipped": {
      "source": "measured",
      "at": "2026-10-19T08:00:00.000Z"
    }
  },
  "netzebene": "NE 5",
  "leistungspreisEurPerKwYear": 38.52,
  "minBillableKw": 44,
  "invoiceSkipped": false
}
