/**
 * Der Resend-Webhook (B2-2).
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Die WIRKUNG (was eine Sperre auslöst, was einen Widerruf) liegt vollständig in der Datenbank und
 * wird im DB-Gate geprüft (`packages/db-tests/src/email-events.test.ts`). Sie hier zu spiegeln hiesse,
 * dieselbe Regel zweimal zu behaupten.
 *
 * Was sich NUR hier prüfen lässt, ist die AUSSENGRENZE: dass eine ungültige, fehlende oder
 * unprüfbare Signatur zu 400 führt und die Datenbank dabei nicht einmal angefasst wird — und dass
 * die Nutzlast korrekt auf die Wrapper-Parameter abgebildet wird. Der Mitschnitt der RPC-Aufrufe ist
 * der eigentliche Beweis: „kein Datenbankzugriff" heisst hier nachweislich „der service_role-Client
 * wurde kein einziges Mal erzeugt", nicht „die Attrappe meldet nichts".
 *
 * ── WARUM DIE MODULE ERSETZT WERDEN ──────────────────────────────────────────────────────────────
 * `lib/env.server` und `lib/supabase/service-role` tragen `import 'server-only'` — ein Import davon
 * würde ausserhalb der React-Server-Umgebung hart werfen. Die Ersetzung ist damit nicht
 * Bequemlichkeit, sondern die Voraussetzung dafür, den ECHTEN Handler aufzurufen.
 *
 * ── DIE SIGNATUREN SIND ECHT ─────────────────────────────────────────────────────────────────────
 * Die gültigen Nutzlasten werden mit derselben Bibliothek signiert, die der Handler zur Prüfung
 * benutzt (`standardwebhooks`) — kein nachgebautes HMAC. Eine selbst gebaute Signatur bewiese nur,
 * dass zwei eigene Implementierungen zueinander passen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Webhook } from 'standardwebhooks'

/** `whsec_` + base64 — genau die Form, die Resend auf der Endpunkt-Seite ausgibt. */
const SECRET = `whsec_${Buffer.from('b2-2-test-geheimnis-32-byte-lang!').toString('base64')}`

const mocks = vi.hoisted(() => ({
  secret: null as string | null,
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/env.server', () => ({
  resendWebhookSecretOrNull: () => mocks.secret,
}))

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}))

const { POST } = await import('./route')

type RpcCall = { fn: string; args: Record<string, unknown> }

/** Ein Client, der `record_email_event` nachstellt und JEDEN Aufruf mitschreibt. */
function stubClient(
  result: unknown = { outcome: 'recorded', effect: 'suppressed' },
  error: string | null = null,
) {
  const calls: RpcCall[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    return error ? { data: null, error: { message: error } } : { data: result, error: null }
  })
  mocks.createServiceRoleClient.mockReturnValue({ rpc })
  return { calls }
}

/** Signiert eine Nutzlast wie Resend: `svix-id` / `svix-timestamp` / `svix-signature`. */
function signedRequest(payload: unknown, opts: { secret?: string; eventId?: string } = {}) {
  const body = JSON.stringify(payload)
  const id = opts.eventId ?? 'msg_2abc'
  const timestamp = new Date()
  const signature = new Webhook(opts.secret ?? SECRET).sign(id, timestamp, body)
  return new Request('https://coolin.at/api/resend/webhook', {
    method: 'POST',
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
  })
}

const BOUNCE_PAYLOAD = {
  type: 'email.bounced',
  created_at: '2026-07-23T10:11:12.000Z',
  data: {
    email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
    from: 'COOLiN ENERGY <energy@coolin.at>',
    to: ['empfaenger@example.test'],
    subject: 'Erinnerung',
    bounce: {
      type: 'Permanent',
      subType: 'General',
      message: 'The recipient does not exist.',
    },
  },
}

beforeEach(() => {
  mocks.secret = SECRET
  mocks.createServiceRoleClient.mockReset()
})

describe('Zugangsgrenze — fail-closed', () => {
  it('ungültige Signatur → 400, und die Datenbank wird nicht einmal angefasst', async () => {
    stubClient()
    // Mit einem ANDEREN Geheimnis signiert: die Kopfzeilen sind vollständig und formal korrekt,
    // nur die Signatur passt nicht — der Fall, den ein Angreifer erzeugt.
    const req = signedRequest(BOUNCE_PAYLOAD, {
      secret: `whsec_${Buffer.from('ein-voellig-anderes-geheimnis!!!').toString('base64')}`,
    })

    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('fehlende Signaturkopfzeile → 400', async () => {
    stubClient()
    const res = await POST(
      new Request('https://coolin.at/api/resend/webhook', {
        method: 'POST',
        body: JSON.stringify(BOUNCE_PAYLOAD),
      }),
    )

    expect(res.status).toBe(400)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('fehlendes Geheimnis in der Umgebung → 400, NICHT 200', async () => {
    // Der wichtigste der drei Fälle: „es ist keins konfiguriert, also nehme ich alles an" machte die
    // dauerhafte Sperre beliebiger Adressen zu einer offenen Schnittstelle.
    mocks.secret = null
    stubClient()

    const res = await POST(signedRequest(BOUNCE_PAYLOAD))

    expect(res.status).toBe(400)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('eine manipulierte Nutzlast bei sonst gültigen Kopfzeilen → 400', async () => {
    stubClient()
    const original = JSON.stringify(BOUNCE_PAYLOAD)
    const id = 'msg_tamper'
    const timestamp = new Date()
    const signature = new Webhook(SECRET).sign(id, timestamp, original)

    // Der Rumpf wird NACH dem Signieren verändert — genau das, was die Signatur verhindern soll.
    const tampered = original.replace('empfaenger@example.test', 'opfer@example.test')

    const res = await POST(
      new Request('https://coolin.at/api/resend/webhook', {
        method: 'POST',
        body: tampered,
        headers: {
          'svix-id': id,
          'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
          'svix-signature': signature,
        },
      }),
    )

    expect(res.status).toBe(400)
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled()
  })
})

describe('Ereignisarten', () => {
  it('unbekannte Ereignisart → 200 ohne Wirkung', async () => {
    const { calls } = stubClient()

    const res = await POST(
      signedRequest({ type: 'domain.updated', created_at: '2026-07-23T10:00:00.000Z', data: {} }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, ignored: 'domain.updated' })
    expect(calls).toHaveLength(0)
  })

  it('Öffnungen und Klicks werden verworfen, selbst wenn sie zugestellt würden', async () => {
    // Sie sind nicht abonniert und die Verfolgung ist abgeschaltet — aber falls beides einmal
    // versehentlich anders steht, speichert dieser Endpunkt sie trotzdem nicht.
    const { calls } = stubClient()

    for (const type of ['email.opened', 'email.clicked']) {
      const res = await POST(
        signedRequest({ type, created_at: '2026-07-23T10:00:00.000Z', data: { to: ['x@y.test'] } }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ignored: type })
    }
    expect(calls).toHaveLength(0)
  })

  it('ein Zustellereignis ohne Empfängeradresse → 200, aber kein Aufruf', async () => {
    // Eine Wiederholung änderte daran nichts, deshalb kein 500 (das erzeugte eine Endlosschleife).
    const { calls } = stubClient()

    const res = await POST(
      signedRequest({
        type: 'email.bounced',
        created_at: '2026-07-23T10:00:00.000Z',
        data: { to: [] },
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ignored: 'no recipient' })
    expect(calls).toHaveLength(0)
  })
})

describe('Abbildung auf den Wrapper', () => {
  it('ein dauerhafter Rückläufer geht vollständig und unverändert an record_email_event', async () => {
    const { calls } = stubClient({ outcome: 'recorded', effect: 'suppressed' })

    const res = await POST(signedRequest(BOUNCE_PAYLOAD, { eventId: 'msg_bounce_1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      received: true,
      outcome: 'recorded',
      effect: 'suppressed',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.fn).toBe('record_email_event')
    expect(calls[0]!.args).toEqual({
      // Die Ereigniskennung stammt aus der KOPFZEILE, nicht aus der Nutzlast — die trägt keine.
      p_event_id: 'msg_bounce_1',
      p_event_type: 'email.bounced',
      p_email: 'empfaenger@example.test',
      p_occurred_at: '2026-07-23T10:11:12.000Z',
      p_bounce_type: 'Permanent',
      p_bounce_subtype: 'General',
      p_reason: 'The recipient does not exist.',
    })
  })

  it('eine Beschwerde ohne bounce-Objekt lässt die optionalen Felder weg (SQL-Default NULL)', async () => {
    const { calls } = stubClient({ outcome: 'recorded', effect: 'suppressed_and_withdrawn' })

    await POST(
      signedRequest(
        {
          type: 'email.complained',
          created_at: '2026-07-23T11:00:00.000Z',
          data: { to: ['beschwerde@example.test'] },
        },
        { eventId: 'msg_complaint_1' },
      ),
    )

    expect(calls[0]!.args).toEqual({
      p_event_id: 'msg_complaint_1',
      p_event_type: 'email.complained',
      p_email: 'beschwerde@example.test',
      p_occurred_at: '2026-07-23T11:00:00.000Z',
      p_bounce_type: undefined,
      p_bounce_subtype: undefined,
      p_reason: undefined,
    })
  })

  it('Duplikat → 200 (die Wiederholung hat ihr Ziel erreicht)', async () => {
    stubClient({ outcome: 'duplicate', effect: 'none' })

    const res = await POST(signedRequest(BOUNCE_PAYLOAD))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ outcome: 'duplicate', effect: 'none' })
  })

  it('Verarbeitungsfehler → 500, damit Resend wiederholt', async () => {
    // Ein verlorener Rückläufer hiesse, dass eine tote Adresse im Verteiler bleibt.
    stubClient(null, 'connection refused')

    const res = await POST(signedRequest(BOUNCE_PAYLOAD))

    expect(res.status).toBe(500)
  })
})
