/**
 * Die Zugangsgrenze des Cron-Endpunkts (B4-1).
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Diese Datei prüft AUSSCHLIESSLICH die eine Eigenschaft, die sich im DB-Gate nicht prüfen lässt:
 * dass eine unberechtigte Anfrage 401 bekommt und die Datenbank dabei GAR NICHT ERREICHT. Der
 * service_role-Client ist dafür ersetzt und zählt mit, ob er angefasst wurde — wird er nie
 * aufgerufen, kann auch kein Laufdatensatz entstehen (`platform.job_runs` ist nur über
 * `public.run_lead_retention_job` beschreibbar, und der Wrapper ist nur über diesen Client
 * erreichbar; die Grant-Fläche dahinter beweist das DB-Gate).
 *
 * Was der Job TUT, wenn er berechtigt ist — Auswahl, Verweigerung oberhalb der Obergrenze,
 * Protokollierung — steht vollständig in der Datenbank und wird dort geprüft
 * (`packages/db-tests/src/job-runs-lead-retention.test.ts`). Es hier zu spiegeln hiesse, dieselbe
 * Regel zweimal zu behaupten.
 *
 * ── WARUM DIE BEIDEN MODULE ERSETZT WERDEN ───────────────────────────────────────────────────────
 * `lib/env.server` und `lib/supabase/service-role` tragen beide `import 'server-only'` — ein
 * Import davon würde ausserhalb der React-Server-Umgebung hart werfen. Die Ersetzung ist damit
 * nicht Bequemlichkeit, sondern die Voraussetzung dafür, den echten Handler überhaupt aufzurufen
 * (und nicht eine nachgebaute Kopie seiner Logik).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CRON_SECRET = 'test-geheimnis-b4-1'

const mocks = vi.hoisted(() => ({
  secret: null as string | null,
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/env.server', () => ({
  cronSecretOrNull: () => mocks.secret,
}))

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}))

const { GET } = await import('./route')

/** Ein Client, dessen RPC einen erfolgreichen Lauf meldet — für den einen Positivfall. */
function stubClient(rpcResult: unknown) {
  return { rpc: vi.fn().mockResolvedValue({ data: rpcResult, error: null }) }
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://coolin.at/api/cron/lead-retention', { headers })
}

describe('GET /api/cron/lead-retention — Zugangsgrenze', () => {
  beforeEach(() => {
    mocks.secret = CRON_SECRET
    mocks.createServiceRoleClient.mockReset()
  })

  it('ohne Authorization-Kopfzeile: 401 und KEIN Datenbankzugriff', async () => {
    const res = await GET(request())

    expect(res.status).toBe(401)
    // Der eigentliche Beweis: ohne Client kein RPC, ohne RPC kein Laufdatensatz.
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('mit falschem Geheimnis: 401 und KEIN Datenbankzugriff', async () => {
    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}-falsch` }))

    expect(res.status).toBe(401)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('mit richtigem Geheimnis, aber ohne Bearer-Präfix: 401', async () => {
    // Vercel schickt ausschliesslich `Bearer <secret>`. Ein blosser Wert im Kopf ist kein zweites,
    // stillschweigend akzeptiertes Format — sonst gäbe es zwei Auslegungen derselben Kopfzeile.
    const res = await GET(request({ authorization: CRON_SECRET }))

    expect(res.status).toBe(401)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('FEHLENDES CRON_SECRET in der Umgebung: 401, nicht 200 (fail-closed)', async () => {
    mocks.secret = null

    // Selbst ein Aufrufer, der ein Geheimnis MITBRINGT, kommt nicht durch: ohne konfigurierten
    // Sollwert gibt es nichts, wogegen sich vergleichen liesse — und „nichts konfiguriert" darf
    // niemals „für alle offen" bedeuten. Sonst wäre der Endpunkt ein fremdgesteuerter
    // Massen-Anonymisierungslauf (ab B4-2: ein fremdgesteuerter Massenversand).
    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(res.status).toBe(401)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('mit richtigem Geheimnis: der Wrapper wird aufgerufen und die Kennzahlen kommen zurück', async () => {
    const client = stubClient({
      status: 'ok',
      run_id: '11111111-1111-4111-8111-111111111111',
      outcome: 'success',
      items_considered: 0,
      items_processed: 0,
      detail: null,
    })
    mocks.createServiceRoleClient.mockReturnValue(client)

    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(res.status).toBe(200)
    // OHNE Argumente: die Schwellwerte stehen in der Datenbank, nicht im Endpunkt.
    expect(client.rpc).toHaveBeenCalledWith('run_lead_retention_job')
    await expect(res.json()).resolves.toMatchObject({
      job: 'lead_retention',
      outcome: 'success',
      refused: false,
      itemsConsidered: 0,
      itemsProcessed: 0,
    })
  })

  it('eine Verweigerung ist 200 mit Kennzeichnung, kein Fehler', async () => {
    // Ein 4xx/5xx würde einen Wiederholungsversuch nahelegen, der genauso ausginge. Die
    // Verweigerung IST das vorgesehene Verhalten oberhalb der Obergrenze.
    mocks.createServiceRoleClient.mockReturnValue(
      stubClient({
        status: 'ok',
        outcome: 'refused',
        items_considered: 4000,
        items_processed: 0,
        detail: 'Fällig: 4000 Leads — das übersteigt die Obergrenze von 1000.',
      }),
    )

    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      outcome: 'refused',
      refused: true,
      itemsProcessed: 0,
    })
  })

  it('ein abgebrochener Lauf ist 500 — er soll als fehlgeschlagen sichtbar sein', async () => {
    mocks.createServiceRoleClient.mockReturnValue(
      stubClient({ status: 'ok', outcome: 'error', items_processed: 0, detail: 'Ursache: …' }),
    )

    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ outcome: 'error', refused: false })
  })
})
