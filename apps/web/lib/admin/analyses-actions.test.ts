import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENGINE_COMMIT_SHA_PLACEHOLDER,
  ENGINE_VERSION,
  buildAnalysisBundle,
  serializeAnalysisBundle,
  type AnalysisBundle,
} from 'shared'

import { MAX_SOURCE_FILE_BYTES } from './analyses'
import { ANALYSIS_FIXTURE, SOURCE_BYTES, OTHER_SOURCE_BYTES } from './__fixtures__/analysis-bundle'

/**
 * B14-2 — Die Server Action des Analyse-Uploads (Pflicht-Tests 1–5 und der Upload-Teil von 7).
 *
 * ── DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST ─────────────────────────────────────────────
 * Dass ein abgelehntes Bündel die Datenbank NICHT BERÜHRT. Nicht „dort abgelehnt wird" — es
 * entsteht kein Client, kein RPC, gar nichts. Der Supabase-Client ist deshalb ersetzt und zählt
 * mit, ob er überhaupt erzeugt wurde; ohne Client kein RPC, ohne RPC keine Zeile.
 *
 * Das Verhalten der Wrapper selbst (Prüfsumme in SQL, gzip-Bindung, Append-only, Adminrolle) ist
 * B14-1 und liegt im DB-Gate.
 */

const rpc = vi.fn()
const getUser = vi.fn()
const createClient = vi.fn(async () => ({ rpc, auth: { getUser } }))

vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { createAnalysisAction } = await import('./analyses-actions')

const REAL_COMMIT = 'b96f15ba9c0d1e2f3a4b5c6d7e8f90123456789a'

async function bundleFor(commitSha = REAL_COMMIT): Promise<AnalysisBundle> {
  return buildAnalysisBundle({
    engineVersion: ENGINE_VERSION,
    engineCommitSha: commitSha,
    computedAt: '2026-07-21T10:00:00.000Z',
    inputs: ANALYSIS_FIXTURE.inputs,
    result: ANALYSIS_FIXTURE.result,
    sourceFileName: 'lastgang-2023.csv',
    sourceFile: SOURCE_BYTES,
  })
}

function formFor(bundleText: string, source: Uint8Array): FormData {
  const fd = new FormData()
  fd.set('bundle', new File([bundleText], 'buendel.json', { type: 'application/json' }))
  fd.set('sourceFile', new File([source as BlobPart], 'lastgang-2023.csv', { type: 'text/csv' }))
  fd.set('customerLabel', 'Kühlhaus Nord GmbH')
  fd.set('siteLabel', 'Halle 2')
  fd.set('analysisKind', 'betreut')
  fd.set('leadId', '')
  fd.set('supersedesId', '')
  return fd
}

beforeEach(() => {
  rpc.mockReset()
  getUser.mockReset()
  createClient.mockClear()
  getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
  rpc.mockResolvedValue({ data: { status: 'ok', id: 'analysis-1' }, error: null })
})

describe('createAnalysisAction — Ablehnungen berühren die Datenbank nicht', () => {
  // ── Pflicht-Test 1 ────────────────────────────────────────────────────────────────────────────
  it('weist eine unbekannte bundleVersion ab, ohne einen Client zu erzeugen', async () => {
    const bundle = await bundleFor()
    const state = await createAnalysisAction(
      {},
      formFor(JSON.stringify({ ...bundle, bundleVersion: 99 }), SOURCE_BYTES),
    )

    expect(state.fieldErrors?.bundle).toMatch(/Unbekannte Bündel-Fassung 99/)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    // Die Eingaben kommen zurück ins Formular — eine abgelehnte Ablage soll nicht neu getippt werden.
    expect(state.values?.customerLabel).toBe('Kühlhaus Nord GmbH')
  })

  // ── Pflicht-Test 2 ────────────────────────────────────────────────────────────────────────────
  it('weist ein Bündel mit Platzhalter-Commit ab, ohne einen Client zu erzeugen', async () => {
    const bundle = await bundleFor(ENGINE_COMMIT_SHA_PLACEHOLDER)
    const state = await createAnalysisAction(
      {},
      formFor(serializeAnalysisBundle(bundle), SOURCE_BYTES),
    )

    expect(state.fieldErrors?.bundle).toMatch(/keinen belegbaren Engine-Commit/)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  // ── Pflicht-Test 3 ────────────────────────────────────────────────────────────────────────────
  it('legt nichts an, wenn Bündel und Ursprungsdatei nicht zusammengehören', async () => {
    const bundle = await bundleFor()
    const state = await createAnalysisAction(
      {},
      formFor(serializeAnalysisBundle(bundle), OTHER_SOURCE_BYTES),
    )

    expect(state.fieldErrors?.sourceFile).toMatch(/gehören NICHT zusammen/)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  // ── Pflicht-Test 5 ────────────────────────────────────────────────────────────────────────────
  it('lehnt eine Datei über der Obergrenze ab, ohne einen Client zu erzeugen', async () => {
    const bundle = await bundleFor()
    const state = await createAnalysisAction(
      {},
      formFor(serializeAnalysisBundle(bundle), new Uint8Array(MAX_SOURCE_FILE_BYTES + 1)),
    )

    expect(state.fieldErrors?.sourceFile).toMatch(/Obergrenze von 20 MB/)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('verlangt beide Dateien', async () => {
    const fd = new FormData()
    fd.set('customerLabel', 'X')
    const state = await createAnalysisAction({}, fd)
    expect(state.fieldErrors?.bundle).toBeTruthy()
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('createAnalysisAction — der Gutfall', () => {
  // ── Pflicht-Test 4 ────────────────────────────────────────────────────────────────────────────
  it('legt GENAU EINE Zeile an, deren fünf Auszüge mit `result` übereinstimmen', async () => {
    const bundle = await bundleFor()
    const state = await createAnalysisAction(
      {},
      formFor(serializeAnalysisBundle(bundle), SOURCE_BYTES),
    )

    expect(state.formError).toBeUndefined()
    expect(state.success).toMatch(/Analyse archiviert/)

    // GENAU EIN Aufruf — kein Wiederholungsversuch, kein zweiter Schreibweg.
    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]!
    expect(fn).toBe('admin_create_analysis')

    const recommended = ANALYSIS_FIXTURE.result.perBattery[0]!
    expect(args.p_baseline_billed_kw_before).toBe(ANALYSIS_FIXTURE.result.current.billedKw)
    expect(args.p_baseline_billed_kw_after).toBe(recommended.newBilledKw)
    expect(args.p_baseline_annual_saving_eur).toBe(recommended.totalSavingPerYear)
    expect(args.p_recommended_battery_label).toBe(recommended.battery.name)
    expect(args.p_recommended_capacity_kwh).toBe(recommended.battery.usableCapacityKwh)

    // Und die Erfolgsmeldung nennt genau diese Zahlen — sie ist das Einzige, woran ein Mensch
    // sieht, dass das RICHTIGE Bündel archiviert wurde.
    expect(state.success).toContain('50.6')
    expect(state.success).toContain('20.6')
    expect(state.success).toContain('PeakStore C60')
  })

  // ── Pflicht-Test 7 (Upload-Teil) ──────────────────────────────────────────────────────────────
  it('legt ohne Sitzung nichts an', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const bundle = await bundleFor()
    const state = await createAnalysisAction(
      {},
      formFor(serializeAnalysisBundle(bundle), SOURCE_BYTES),
    )

    expect(state.formError).toMatch(/Keine Berechtigung/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('meldet die Ablehnung der Datenbank im Klartext (42501 → keine Berechtigung)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Adminrolle erforderlich' },
    })
    const bundle = await bundleFor()
    const state = await createAnalysisAction(
      {},
      formFor(serializeAnalysisBundle(bundle), SOURCE_BYTES),
    )
    expect(state.formError).toMatch(/Keine Berechtigung/)
    expect(state.success).toBeUndefined()
  })

  it('reicht eine fachliche Ablehnung der Datenbank (22023) im Wortlaut durch', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Prüfsumme passt nicht zur übergebenen Datei' },
    })
    const bundle = await bundleFor()
    const state = await createAnalysisAction(
      {},
      formFor(serializeAnalysisBundle(bundle), SOURCE_BYTES),
    )
    expect(state.formError).toMatch(/Prüfsumme passt nicht zur übergebenen Datei/)
  })
})
