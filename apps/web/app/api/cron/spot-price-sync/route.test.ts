/**
 * Die Zugangsgrenze des Spotpreis-Cron-Endpunkts (B21-2a).
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Wie bei den beiden bestehenden Cron-Endpunkten prüft diese Datei AUSSCHLIESSLICH die eine
 * Eigenschaft, die sich nirgends sonst prüfen lässt: dass eine unberechtigte Anfrage 401 bekommt und
 * dabei WEDER die Quelle noch die Datenbank erreicht. Beide sind dafür ersetzt und zählen mit, ob
 * sie angefasst wurden.
 *
 * Was der Sync TUT, wenn er berechtigt ist — Prüfung, Umrechnung, Stapelung — steht in
 * `lib/spot-prices/sync.test.ts`; die Rechtefläche dahinter im DB-Gate
 * (`packages/db-tests/src/spot-prices-write-access.test.ts`). Es hier zu spiegeln hiesse, dieselbe
 * Regel zweimal zu behaupten.
 *
 * ── WARUM DIE MODULE ERSETZT WERDEN ──────────────────────────────────────────────────────────────
 * `lib/env.server` und `lib/supabase/service-role` tragen beide `import 'server-only'` — ein Import
 * davon würde ausserhalb der React-Server-Umgebung hart werfen. Die Ersetzung ist damit nicht
 * Bequemlichkeit, sondern die Voraussetzung dafür, den ECHTEN Handler aufzurufen und nicht eine
 * nachgebaute Kopie seiner Logik.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const CRON_SECRET = 'test-geheimnis-b21-2a'

const mocks = vi.hoisted(() => ({
  secret: null as string | null,
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/env.server', () => ({ cronSecretOrNull: () => mocks.secret }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: mocks.createServiceRoleClient }))

const { GET } = await import('./route')

const ENTRY = {
  start_timestamp: 1787666400000,
  end_timestamp: 1787670000000,
  marketprice: 177.97,
  unit: 'Eur/MWh',
}

/** Ein Client, dessen Upsert gelingt — für den einen Positivfall. */
function stubClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  return { client: { from: vi.fn().mockReturnValue({ upsert }) }, upsert }
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://coolin.at/api/cron/spot-price-sync', { headers })
}

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  mocks.secret = CRON_SECRET
  mocks.createServiceRoleClient.mockReset()
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [ENTRY] }) } as Response)
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('GET /api/cron/spot-price-sync — Zugangsgrenze', () => {
  it('ohne Authorization-Kopfzeile: 401, kein Netzabruf, kein Datenbankzugriff', async () => {
    const res = await GET(request())

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('mit FALSCHEM Geheimnis: 401, kein Netzabruf, kein Datenbankzugriff', async () => {
    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}-falsch` }))

    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('bei FEHLENDEM CRON_SECRET in der Umgebung: 401 — fail-closed, nicht fail-open', async () => {
    // Eine vergessene Umgebungsvariable darf den Endpunkt nicht für jeden öffnen.
    mocks.secret = null

    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('mit korrektem Geheimnis: 200, und der Lauf schreibt tatsächlich', async () => {
    const { client, upsert } = stubClient()
    mocks.createServiceRoleClient.mockReturnValue(client)

    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      job: 'spot_price_sync',
      outcome: 'success',
      fetched: 1,
      written: 1,
    })
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ provider: 'awattar_at', ct_per_kwh: 17.797, price_basis: 'net' })],
      { onConflict: 'provider,ts_start' },
    )
  })

  it('das abgefragte Fenster beginnt um Mitternacht UTC und umfasst drei Tage', async () => {
    // Es darf nicht mit der Uhrzeit des Laufs wandern, sonst repariert ein ausgefallener Lauf sich
    // nicht mehr von selbst.
    const { client } = stubClient()
    mocks.createServiceRoleClient.mockReturnValue(client)
    vi.setSystemTime(new Date('2026-08-27T13:20:41.000Z'))

    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    await expect(res.json()).resolves.toMatchObject({
      windowStart: '2026-08-27T00:00:00.000Z',
      windowEnd: '2026-08-30T00:00:00.000Z',
    })
    vi.useRealTimers()
  })

  it('ein Fehler der Quelle wird 500, nicht ein stilles 200', async () => {
    // Sonst erschiene der Lauf in der Vercel-Übersicht als einer von vielen grünen.
    const { client } = stubClient()
    mocks.createServiceRoleClient.mockReturnValue(client)
    fetchSpy.mockResolvedValue({ ok: false, status: 503, json: async () => null } as Response)

    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ outcome: 'error' })
  })
})
