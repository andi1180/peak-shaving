/**
 * Der Cron-Endpunkt der Vertragsablauf-Erinnerung (B4-2).
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Anders als beim Fristenlauf (B4-1) prüft diese Datei mehr als die Zugangsgrenze — und zwar aus
 * einem sachlichen Grund: dort liegt der gesamte Vorgang in EINER Datenbankfunktion, die das DB-Gate
 * prüft; hier ist der Lauf im Endpunkt orchestriert, weil der wirksame Schritt (der Versand) ausser-
 * halb der Datenbank liegt. Genau diese Orchestrierung — verweigern statt versenden, Fehlversand
 * festhalten ohne den Lauf abzubrechen — lässt sich NUR hier prüfen.
 *
 * Was die Datenbank entscheidet (wer fällig ist, dass ein zweites Beanspruchen nichts überschreibt,
 * dass Widerruf die Zeilen löscht), bleibt im DB-Gate
 * (`packages/db-tests/src/contract-reminders.test.ts`). Es hier zu spiegeln hiesse, dieselbe Regel
 * zweimal zu behaupten.
 *
 * ── WARUM DIE MODULE ERSETZT WERDEN ──────────────────────────────────────────────────────────────
 * `lib/env.server`, `lib/supabase/service-role` und `lib/leads/mail` tragen `import 'server-only'` —
 * ein Import davon würde ausserhalb der React-Server-Umgebung hart werfen. Die Ersetzung ist damit
 * nicht Bequemlichkeit, sondern die Voraussetzung dafür, den ECHTEN Handler aufzurufen (und nicht
 * eine nachgebaute Kopie seiner Logik).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CRON_SECRET = 'test-geheimnis-b4-2'
const END_DATE = '2026-09-30'

const mocks = vi.hoisted(() => ({
  secret: null as string | null,
  createServiceRoleClient: vi.fn(),
  sendContractReminderMail: vi.fn(),
}))

vi.mock('@/lib/env.server', () => ({
  cronSecretOrNull: () => mocks.secret,
}))

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}))

vi.mock('@/lib/leads/mail', () => ({
  sendContractReminderMail: mocks.sendContractReminderMail,
}))

const { GET } = await import('./route')

type RpcCall = { fn: string; args: unknown }

/**
 * Ein Client, der die vier Wrapper nachstellt und JEDEN Aufruf mitschreibt.
 *
 * Der Mitschnitt ist der eigentliche Beweis: „es wurde nichts versendet" heisst hier nachweislich
 * „`claim_contract_reminder` wurde kein einziges Mal aufgerufen", nicht „die Mail-Attrappe meldet
 * nichts".
 */
function stubClient(options: {
  due: Array<{ lead_id: string; email: string; supplier: string | null; contract_end_date: string }>
  considered?: number
  claimOutcome?: (leadId: string) => string
}) {
  const calls: RpcCall[] = []
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    calls.push({ fn, args })
    switch (fn) {
      case 'start_contract_reminder_run':
        return {
          data: {
            status: 'ok',
            run_id: '22222222-2222-4222-8222-222222222222',
            started_at: '2026-07-22T06:40:00.000Z',
            items_considered: options.considered ?? options.due.length,
            due: options.due,
          },
          error: null,
        }
      case 'claim_contract_reminder': {
        const leadId = (args as { p_lead_id: string }).p_lead_id
        const outcome = options.claimOutcome?.(leadId) ?? 'claimed'
        const row = options.due.find((d) => d.lead_id === leadId)
        return {
          data:
            outcome === 'claimed'
              ? { status: 'ok', outcome, email: row?.email, supplier: row?.supplier }
              : { status: 'ok', outcome },
          error: null,
        }
      }
      default:
        return { data: { status: 'ok' }, error: null }
    }
  })
  return { client: { rpc }, calls }
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://coolin.at/api/cron/contract-reminders', { headers })
}

function authorized(): Request {
  return request({ authorization: `Bearer ${CRON_SECRET}` })
}

function dueLead(n: number) {
  return {
    lead_id: `1111111${n}-1111-4111-8111-111111111111`,
    email: `empfaenger-${n}@test.local`,
    supplier: 'Testversorger GmbH',
    contract_end_date: END_DATE,
  }
}

describe('GET /api/cron/contract-reminders — Zugangsgrenze (13)', () => {
  beforeEach(() => {
    mocks.secret = CRON_SECRET
    mocks.createServiceRoleClient.mockReset()
    mocks.sendContractReminderMail.mockReset()
  })

  it('ohne Authorization-Kopfzeile: 401, kein Datenbankzugriff, kein Versand', async () => {
    const res = await GET(request())

    expect(res.status).toBe(401)
    // Ohne Client kein RPC, ohne RPC kein Laufdatensatz — und ohne Lauf keine Mail.
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
    expect(mocks.sendContractReminderMail).not.toHaveBeenCalled()
  })

  it('mit falschem Geheimnis: 401, kein Datenbankzugriff, kein Versand', async () => {
    const res = await GET(request({ authorization: `Bearer ${CRON_SECRET}-falsch` }))

    expect(res.status).toBe(401)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
    expect(mocks.sendContractReminderMail).not.toHaveBeenCalled()
  })

  it('mit richtigem Geheimnis, aber ohne Bearer-Präfix: 401', async () => {
    // Vercel schickt ausschliesslich `Bearer <secret>`. Ein blosser Wert im Kopf ist kein zweites,
    // stillschweigend akzeptiertes Format.
    const res = await GET(request({ authorization: CRON_SECRET }))

    expect(res.status).toBe(401)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('FEHLENDES CRON_SECRET in der Umgebung: 401, nicht 200 (fail-closed)', async () => {
    mocks.secret = null

    // „Nichts konfiguriert" darf niemals „für alle offen" bedeuten — hier wäre die Folge ein
    // fremdgesteuerter Massenversand an reale Personen.
    const res = await GET(authorized())

    expect(res.status).toBe(401)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
    expect(mocks.sendContractReminderMail).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/contract-reminders — Mengenobergrenze (14)', () => {
  beforeEach(() => {
    mocks.secret = CRON_SECRET
    mocks.createServiceRoleClient.mockReset()
    mocks.sendContractReminderMail.mockReset()
  })

  it('oberhalb des Schwellwerts wird KEIN einziger Versand ausgelöst und der Lauf steht auf refused', async () => {
    const { client, calls } = stubClient({ due: [dueLead(1), dueLead(2)], considered: 501 })
    mocks.createServiceRoleClient.mockReturnValue(client)

    const res = await GET(authorized())

    // Eine Verweigerung ist das VORGESEHENE Verhalten und darf keinen Wiederholungsversuch
    // auslösen, der genauso ausginge → 200 mit Kennzeichnung.
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      outcome: 'refused',
      refused: true,
      itemsConsidered: 501,
      itemsProcessed: 0,
    })

    // Der eigentliche Beweis: NICHT die erste Teilmenge, sondern gar nichts. Es wurde nicht einmal
    // beansprucht — eine beanspruchte Zeile ohne Versand wäre bereits ein Nebeneffekt.
    expect(mocks.sendContractReminderMail).not.toHaveBeenCalled()
    expect(calls.filter((c) => c.fn === 'claim_contract_reminder')).toHaveLength(0)

    const finish = calls.find((c) => c.fn === 'finish_contract_reminder_run')
    expect(finish?.args).toMatchObject({ p_outcome: 'refused', p_items_processed: 0 })
    expect(String((finish?.args as { p_detail: string }).p_detail)).toContain('KEINE einzige Mail')
  })

  it('bis zum Schwellwert läuft der Versand normal', async () => {
    const { client } = stubClient({ due: [dueLead(1)], considered: 500 })
    mocks.createServiceRoleClient.mockReturnValue(client)
    mocks.sendContractReminderMail.mockResolvedValue({ ok: true })

    const res = await GET(authorized())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ outcome: 'success', itemsProcessed: 1 })
    expect(mocks.sendContractReminderMail).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/cron/contract-reminders — Teilfehler (15)', () => {
  beforeEach(() => {
    mocks.secret = CRON_SECRET
    mocks.createServiceRoleClient.mockReset()
    mocks.sendContractReminderMail.mockReset()
  })

  it('ein fehlgeschlagener Einzelversand bricht den Lauf nicht ab und hinterlässt error, nicht delivered_at', async () => {
    const { client, calls } = stubClient({ due: [dueLead(1), dueLead(2), dueLead(3)] })
    mocks.createServiceRoleClient.mockReturnValue(client)
    mocks.sendContractReminderMail
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'send_failed' })
      .mockResolvedValueOnce({ ok: true })

    const res = await GET(authorized())

    // Der Lauf läuft durch: ein abgelehnter Empfänger darf die anderen nicht aufhalten.
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      outcome: 'success',
      itemsProcessed: 2,
      failed: 1,
    })
    expect(mocks.sendContractReminderMail).toHaveBeenCalledTimes(3)

    const results = calls.filter((c) => c.fn === 'record_contract_reminder_result')
    expect(results).toHaveLength(3)
    // Erfolg: KEIN Fehlertext (`undefined` ⇒ die Datenbank setzt delivered_at).
    expect((results[0]!.args as { p_error?: string }).p_error).toBeUndefined()
    // Fehlschlag: Fehlertext gesetzt — und ausdrücklich OHNE Empfängeradresse (ein Fehlertext ist
    // kein zweiter Speicherort für Personenbezug).
    const failure = (results[1]!.args as { p_error?: string }).p_error
    expect(failure).toBeTruthy()
    expect(failure).not.toContain('@')
    expect((results[2]!.args as { p_error?: string }).p_error).toBeUndefined()

    // Der Lauf endet auf 'success' und weist die Fehlschläge GESONDERT aus — „2 versendet" allein
    // läse sich wie „fertig".
    const finish = calls.find((c) => c.fn === 'finish_contract_reminder_run')
    expect(finish?.args).toMatchObject({ p_outcome: 'success', p_items_processed: 2 })
    expect(String((finish?.args as { p_detail: string }).p_detail)).toContain('nicht zugestellt')
  })

  it('ein Fall, der zwischen Auswahl und Versand hinfällig wird, löst KEINEN Versand aus', async () => {
    const withdrawn = dueLead(2)
    const { client } = stubClient({
      due: [dueLead(1), withdrawn],
      // Widerruf oder Sperre in der Zwischenzeit: die Datenbank lehnt die Beanspruchung ab.
      claimOutcome: (leadId) => (leadId === withdrawn.lead_id ? 'not_eligible' : 'claimed'),
    })
    mocks.createServiceRoleClient.mockReturnValue(client)
    mocks.sendContractReminderMail.mockResolvedValue({ ok: true })

    const res = await GET(authorized())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ itemsProcessed: 1, skipped: 1, failed: 0 })
    // Genau EIN Versand — an den anderen Empfänger.
    expect(mocks.sendContractReminderMail).toHaveBeenCalledTimes(1)
    expect(mocks.sendContractReminderMail.mock.calls[0]![0]).toMatchObject({
      to: 'empfaenger-1@test.local',
    })
  })

  it('ein Empfänger je Aufruf — kein Sammelversand, kein BCC', async () => {
    const { client } = stubClient({ due: [dueLead(1), dueLead(2)] })
    mocks.createServiceRoleClient.mockReturnValue(client)
    mocks.sendContractReminderMail.mockResolvedValue({ ok: true })

    await GET(authorized())

    expect(mocks.sendContractReminderMail).toHaveBeenCalledTimes(2)
    for (const [payload] of mocks.sendContractReminderMail.mock.calls) {
      // `to` ist ein einzelner String, kein Array — und die Nutzlast trägt weder bcc noch cc.
      expect(typeof (payload as { to: unknown }).to).toBe('string')
      expect(payload).not.toHaveProperty('bcc')
      expect(payload).not.toHaveProperty('cc')
    }
  })
})
