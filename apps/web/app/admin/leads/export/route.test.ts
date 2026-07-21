/**
 * Die Zugangsgrenze der Export-Route (B2-1).
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Diese Datei prüft die eine Eigenschaft, die sich im DB-Gate nicht prüfen lässt: dass eine Anfrage
 * OHNE angemeldete Sitzung keine Daten bekommt — und dass dabei kein einziger RPC losgeht. Der
 * Supabase-Client ist dafür ersetzt und zählt mit, ob `rpc` angefasst wurde; wird er nie aufgerufen,
 * kann weder eine Zeile herausgehen noch ein Protokolleintrag entstehen.
 *
 * WER exportieren darf und WELCHE Zeilen die Datei enthält, steht vollständig in der Datenbank
 * (`public.admin_export_leads`: `platform.is_admin()`, die zwei strukturellen Ausschlüsse, das
 * Protokoll) und wird dort geprüft — `packages/db-tests/src/lead-editing-export.test.ts`. Es hier
 * zu spiegeln hiesse, dieselbe Regel zweimal zu behaupten.
 *
 * ── WARUM DER CLIENT ERSETZT WIRD ────────────────────────────────────────────────────────────────
 * `lib/supabase/server` trägt `import 'server-only'` und liest `cookies()` — ein Import davon würde
 * ausserhalb der React-Server-Umgebung hart werfen. Die Ersetzung ist damit nicht Bequemlichkeit,
 * sondern die Voraussetzung dafür, den ECHTEN Handler aufzurufen und nicht eine nachgebaute Kopie
 * seiner Logik.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  rpc: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

const { GET } = await import('./route')

function request(query = ''): Request {
  return new Request(`https://coolin.at/admin/leads/export${query}`)
}

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.createClient.mockReset()
  mocks.createClient.mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: mocks.rpc,
  }))
})

describe('GET /admin/leads/export — ohne Admin-Sitzung', () => {
  it('ohne Sitzung: 307 auf die Anmeldung, KEIN RPC und KEINE Daten', async () => {
    mocks.user = null

    const res = await GET(request('?branche=handel'))

    // 307 und nicht 404: die Route existiert, sie ist nur nicht für jeden — und nicht 200 mit
    // leerer Datei, denn eine leere CSV liest sich wie „es gibt keine Leads".
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://coolin.at/anmelden')
    // Der eigentliche Beweis: ohne RPC keine Zeile und kein Protokolleintrag.
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/csv/)
    await expect(res.text()).resolves.toBe('')
  })

  it('angemeldet, aber ohne Adminrolle: 403 und keine CSV', async () => {
    mocks.user = { id: 'user-1' }
    // Die Datenbank ist die Grenze: der Wrapper WIRFT 42501, statt eine leere Antwort zu liefern.
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const res = await GET(request())

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).not.toMatch(/text\/csv/)
    await expect(res.text()).resolves.toBe('Keine Berechtigung.')
  })

  it('ein abgelehnter Filter wird als 400 durchgereicht, nicht als leere Datei', async () => {
    mocks.user = { id: 'admin-1' }
    mocks.rpc.mockResolvedValue({
      data: { status: 'invalid_filter', filter: 'postal_prefix' },
      error: null,
    })

    const res = await GET(request('?plz=11a'))

    expect(res.status).toBe(400)
    await expect(res.text()).resolves.toContain('postal_prefix')
  })
})

describe('GET /admin/leads/export — mit Adminrolle', () => {
  it('reicht GENAU die Filter der Anfrage an den Wrapper weiter und liefert eine CSV', async () => {
    mocks.user = { id: 'admin-1' }
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'ok',
        rows: [
          {
            id: 'lead-1',
            email: 'max@example.at',
            company: 'Muster GmbH',
            contact_name: null,
            phone: null,
            status: 'new',
            first_source_key: 'warteliste',
            first_source_label: 'Warteliste Leistungstarif 2027',
            industry: 'kuehlhaus',
            postal_code: '1100',
            annual_consumption_kwh: 180000,
            metering_type: 'netzebene_7',
            supplier: null,
            contract_end_date: null,
            created_at: '2026-07-01T08:00:00Z',
            last_interaction_at: '2026-07-02T08:00:00Z',
            marketing_consent: 'bestätigt',
          },
        ],
        row_count: 1,
        filter_summary: 'Branche: kuehlhaus — ohne gesperrte und anonymisierte Zeilen',
        export_id: 'export-1',
        exported_at: '2026-07-21T10:11:12Z',
      },
      error: null,
    })

    const res = await GET(request('?branche=kuehlhaus&plz=11&verbrauch-ab=100000'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toContain('attachment;')
    // Der Dateiname trägt den Zeitpunkt AUS DER DATENBANK — derselbe, der im Protokoll steht.
    expect(res.headers.get('content-disposition')).toContain('2026-07-21-10-11-12')

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = mocks.rpc.mock.calls[0]!
    expect(fn).toBe('admin_export_leads')
    // Die Filter der Sicht werden UNVERÄNDERT übernommen — es gibt keinen ungefilterten Export.
    expect(args).toMatchObject({
      p_industry: 'kuehlhaus',
      p_postal_prefix: '11',
      p_consumption_min: 100000,
    })

    /*
     * Das BOM wird auf den BYTES geprüft, nicht auf `res.text()`: `TextDecoder` entfernt ein
     * führendes BOM beim Dekodieren (Voreinstellung `ignoreBOM: false`) — die Zeichenkette hätte es
     * also NIE, auch wenn die Datei es trägt. Genau die drei Bytes EF BB BF sind es aber, an denen
     * Excel die Kodierung erkennt.
     */
    const bytes = new Uint8Array(await res.clone().arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])

    const text = await res.text()
    expect(text).toContain('Muster GmbH')
    expect(text).toContain('bestätigt')
  })

  it('eine erfundene Branche wird NICHT durchgereicht (sie scheiterte sonst am Postgres-Enum)', async () => {
    mocks.user = { id: 'admin-1' }
    mocks.rpc.mockResolvedValue({
      data: { status: 'ok', rows: [], row_count: 0, filter_summary: 'alle', exported_at: null },
      error: null,
    })

    await GET(request('?branche=erfunden'))

    const [, args] = mocks.rpc.mock.calls[0]!
    expect((args as { p_industry?: unknown }).p_industry).toBeUndefined()
  })

  it('null Treffer liefern eine Datei MIT Kopfzeile, nicht eine leere Antwort', async () => {
    mocks.user = { id: 'admin-1' }
    mocks.rpc.mockResolvedValue({
      data: { status: 'ok', rows: [], row_count: 0, filter_summary: 'alle', exported_at: null },
      error: null,
    })

    const res = await GET(request())
    const text = await res.text()

    expect(res.status).toBe(200)
    // Eine Datei ohne Kopfzeile sieht aus wie ein fehlgeschlagener Download.
    expect(text).toContain('Marketing-Einwilligung')
    expect(text.trimEnd().split('\r\n')).toHaveLength(1)
  })
})
