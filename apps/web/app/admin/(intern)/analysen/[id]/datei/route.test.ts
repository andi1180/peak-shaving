import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_VERSION, buildAnalysisBundle, serializeAnalysisBundle } from 'shared'

import { ANALYSIS_FIXTURE, SOURCE_BYTES } from '@/lib/admin/__fixtures__/analysis-bundle'
import { prepareAnalysisUpload } from '@/lib/admin/analysis-upload'

/**
 * B14-2 — Der Download der archivierten Ursprungsdatei (Pflicht-Test 6 und der Download-Teil von 7).
 *
 * ── DER RUNDLAUF IST HIER ECHT, NICHT NACHGESTELLT ──────────────────────────────────────────────
 * Die Bytes, die diese Route zurückliefert, sind DIESELBEN, die der Rechner-Export in seine
 * Prüfsumme gerechnet und die Upload-Prüfkette in eine gzip-Fassung gepackt hat — die Kette läuft
 * im Test über `buildAnalysisBundle` → `prepareAnalysisUpload` → diese Route. Ersetzt ist allein
 * die Datenbank, die den Blob dazwischen nur aufbewahrt.
 *
 * Genau das ist der Punkt, an dem eine still dekodierende Zwischenstufe auffliegt: das Fixture
 * trägt Umlaute und CRLF.
 */

const rpc = vi.fn()
const getUser = vi.fn()
const createClient = vi.fn(async () => ({ rpc, auth: { getUser } }))

vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))

const { GET } = await import('./route')

const REAL_COMMIT = 'b96f15ba9c0d1e2f3a4b5c6d7e8f90123456789a'
const ID = '11111111-2222-3333-4444-555555555555'

const params = Promise.resolve({ id: ID })
const request = () => new Request(`http://localhost:3000/admin/analysen/${ID}/datei`)

/** Hex-`bytea` (`\x…`) → Bytes — das Gegenstück zu `toPostgresBytea` im Upload. */
function fromPostgresBytea(hex: string): Uint8Array {
  const pairs = hex.slice(2).match(/../g) ?? []
  return Uint8Array.from(pairs.map((h) => Number.parseInt(h, 16)))
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Läuft die echte Kette Export → Upload und liefert, was die Datenbank aufbewahren würde. */
async function archivedSource() {
  const bundle = await buildAnalysisBundle({
    engineVersion: ENGINE_VERSION,
    engineCommitSha: REAL_COMMIT,
    computedAt: '2026-07-21T10:00:00.000Z',
    inputs: ANALYSIS_FIXTURE.inputs,
    result: ANALYSIS_FIXTURE.result,
    sourceFileName: 'lastgang-2023.csv',
    sourceFile: SOURCE_BYTES,
  })
  const prepared = await prepareAnalysisUpload({
    bundleText: serializeAnalysisBundle(bundle),
    sourceFileName: 'lastgang-2023.csv',
    sourceFile: SOURCE_BYTES,
    form: {
      customerLabel: 'Kühlhaus Nord GmbH',
      siteLabel: '',
      analysisKind: 'betreut',
      leadId: '',
      supersedesId: '',
    },
  })
  if (!prepared.ok) throw new Error(prepared.message)
  const gzip = fromPostgresBytea(prepared.prepared.args.p_source_file_gzip)
  return {
    source_file_name: 'lastgang-2023.csv',
    source_file_sha256: prepared.prepared.args.p_source_file_sha256,
    source_file_gzip_base64: toBase64(gzip),
    source_file_gzip_bytes: gzip.byteLength,
  }
}

beforeEach(() => {
  rpc.mockReset()
  getUser.mockReset()
  createClient.mockClear()
  getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
})

describe('GET /admin/analysen/[id]/datei', () => {
  // ── Pflicht-Test 6 ────────────────────────────────────────────────────────────────────────────
  it('liefert die Ursprungsdatei byte-identisch zurück (Export → Upload → Download)', async () => {
    const source = await archivedSource()
    rpc.mockResolvedValue({ data: { status: 'ok', source }, error: null })

    const res = await GET(request(), { params })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('lastgang-2023.csv')
    expect(res.headers.get('cache-control')).toBe('no-store')

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(bytes)).toEqual(Array.from(SOURCE_BYTES))
    // …und der Inhalt ist auch als Text unversehrt (Umlaute, CRLF).
    expect(new TextDecoder().decode(bytes)).toContain('Zählpunkt')
    expect(new TextDecoder().decode(bytes)).toContain('Überschuss')
  })

  it('liefert NICHTS, wenn die Prüfsumme des Archivs nicht mehr passt', async () => {
    const source = await archivedSource()
    rpc.mockResolvedValue({
      data: {
        status: 'ok',
        source: { ...source, source_file_sha256: 'f'.repeat(64) },
      },
      error: null,
    })

    const res = await GET(request(), { params })
    expect(res.status).toBe(500)
    // Der Befund wird BENANNT: eine still gelieferte Datei ohne Beleg wäre schlimmer als gar keine.
    await expect(res.text()).resolves.toMatch(/Prüfsumme/)
  })

  // ── Pflicht-Test 7 (Download-Teil) ────────────────────────────────────────────────────────────
  it('liefert ohne Sitzung keine Daten und fragt die Datenbank nicht', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const res = await GET(request(), { params })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/anmelden')
    expect(rpc).not.toHaveBeenCalled()
    await expect(res.text()).resolves.toBe('')
  })

  it('liefert ohne Adminrolle 403 statt einer leeren Datei', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Adminrolle erforderlich' },
    })

    const res = await GET(request(), { params })
    expect(res.status).toBe(403)
    await expect(res.text()).resolves.toMatch(/Keine Berechtigung/)
  })

  it('meldet einen unbekannten Schlüssel als 404', async () => {
    rpc.mockResolvedValue({ data: { status: 'not_found' }, error: null })

    const res = await GET(request(), { params })
    expect(res.status).toBe(404)
  })
})
