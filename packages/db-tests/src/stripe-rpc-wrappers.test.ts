// DB-Gate für die Stripe-RPC-Wrapper aus T4-3, Aufgabe 2
// (Migration 20260719101500_create_stripe_rpc_wrappers.sql).
//
// Beweist K1/K2/K3/K5/K7 + I5 auf DB-Ebene: der Webhook schreibt `platform` AUSSCHLIESSLICH über
// public-Wrapper (platform ist nicht exponiert), der Zugang entsteht über den Sync-Trigger (nicht im
// Wrapper), Idempotenz ist atomar, ein fehlendes Periodenende scheitert LAUT (kein Dauerzugang), und
// ein älteres Event lässt die Zeile unverändert. Läuft gegen den laufenden lokalen Stack.
//
// ── WARUM die anon/authenticated-Ablehnung per Katalog-Introspektion statt per Aufruf geprüft wird ──
// Dasselbe wie bei den T4-2-Wrappern: das lokal/CI gepinnte Postgres-Image (supabase/postgres:
// 17.6.1.106) segfaultet bei einem Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant (statt
// sauberem „permission denied"). Die Sicherheitseigenschaft „nur service_role/authenticated darf" wird
// deshalb über has_function_privilege (die Autorisierungs-Wahrheit) geprüft. App/Tests rufen die
// service_role-Wrapper nie als anon/authenticated auf; die Grants sind design-korrekt.
//
// stripe_events ist append-only (kein DELETE) UND nicht user-gebunden (kein Cascade) → Test-Events
// bleiben nach dem Lauf liegen. Deshalb je Test frische, zufällige Event-/Subscription-IDs (kein
// PK-Konflikt bei Wiederholung ohne `db reset`). User-gebundene Zeilen räumt der auth.users-Cascade ab.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

const PRODUCT = 'monitor'

const spawned: string[] = []
async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawned.push(u.id)
  return u
}

/** Aufruf des atomaren Webhook-Wrappers als service_role (wie der echte Handler). */
async function processEvent(p: {
  eventId?: string
  type?: string
  createdAt: string
  userId: string
  product?: string
  customerId?: string | null
  subId: string
  status: string
  priceId?: string | null
  periodEnd: string | null
  cancelAtPeriodEnd?: boolean
}): Promise<string> {
  return runAs({ role: 'service_role', commit: true }, async (c) => {
    // Parameter-Reihenfolge exakt wie die Migration: die vier optionalen/nullable Parameter stehen
    // hinten (subId/status vor customerId/priceId/periodEnd/cancel).
    const { rows } = await c.query<{ r: string }>(
      `select public.process_stripe_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r`,
      [
        p.eventId ?? `evt_${randomUUID()}`,
        p.type ?? 'customer.subscription.updated',
        p.createdAt,
        p.userId,
        p.product ?? PRODUCT,
        p.subId,
        p.status,
        p.customerId ?? null,
        p.priceId ?? 'price_test',
        p.periodEnd,
        p.cancelAtPeriodEnd ?? false,
      ],
    )
    return rows[0]!.r
  })
}

/** Execute-Recht per Katalog (robust über die OID, keine fragile Signatur-Zeichenkette). */
async function canExecute(role: string, funcName: string): Promise<boolean> {
  const rows = await sql<{ can: boolean }>(
    `select has_function_privilege($1, p.oid, 'execute') as can
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $2`,
    [role, funcName],
  )
  return rows[0]?.can ?? false
}

async function subscriptionRow(subId: string) {
  const rows = await sql<{
    status: string
    period_end: number | null
    cancel: boolean
    event_created: number
  }>(
    `select status,
            extract(epoch from current_period_end)::float8 as period_end,
            cancel_at_period_end as cancel,
            extract(epoch from stripe_event_created_at)::float8 as event_created
       from platform.subscriptions where stripe_subscription_id = $1`,
    [subId],
  )
  return rows[0]
}

async function entitlementRow(userId: string) {
  const rows = await sql<{ is_active: boolean; valid_until: number | null; source: string }>(
    `select is_active, extract(epoch from valid_until)::float8 as valid_until, source
       from platform.entitlements where user_id = $1 and product = $2`,
    [userId, PRODUCT],
  )
  return rows[0]
}

beforeAll(async () => {
  await assertStackReachable()
})
afterEach(async () => {
  for (const id of spawned.splice(0)) await deleteUser(id)
})
afterAll(async () => {
  await pool.end()
})

describe('process_stripe_subscription_event — Spiegel + Idempotenz + Reihenfolge', () => {
  it('ein aktives Abo wird gespiegelt, Customer verankert, Entitlement per Trigger abgeleitet (K1)', async () => {
    const user = await newUser()
    const subId = `sub_${randomUUID()}`
    const custId = `cus_${randomUUID()}`
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()

    const outcome = await processEvent({
      createdAt: new Date().toISOString(),
      userId: user.id,
      customerId: custId,
      subId,
      status: 'active',
      periodEnd,
    })
    expect(outcome).toBe('processed')

    // Subscription gespiegelt.
    const sub = await subscriptionRow(subId)
    expect(sub?.status).toBe('active')
    // Customer verankert (K3, defensiv im Wrapper).
    const cust = await sql<{ n: number }>(
      'select count(*)::int as n from platform.customers where user_id = $1 and stripe_customer_id = $2',
      [user.id, custId],
    )
    expect(cust[0]?.n).toBe(1)
    // Entitlement NICHT vom Wrapper, sondern vom Sync-Trigger (K1): aktiv + valid_until gesetzt + stripe.
    const ent = await entitlementRow(user.id)
    expect(ent?.is_active).toBe(true)
    expect(ent?.valid_until).not.toBeNull()
    expect(ent?.source).toBe('stripe')
  })

  it('dasselbe Event ein zweites Mal → "duplicate", KEINE erneute Verarbeitung (K5)', async () => {
    const user = await newUser()
    const subId = `sub_${randomUUID()}`
    const eventId = `evt_${randomUUID()}`
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()

    const first = await processEvent({
      eventId,
      createdAt: new Date().toISOString(),
      userId: user.id,
      subId,
      status: 'active',
      periodEnd,
    })
    expect(first).toBe('processed')

    // Zweite Zustellung DESSELBEN Events, aber mit abweichendem Status: darf NICHT durchschlagen.
    const second = await processEvent({
      eventId,
      createdAt: new Date().toISOString(),
      userId: user.id,
      subId,
      status: 'canceled',
      periodEnd,
    })
    expect(second).toBe('duplicate')
    const sub = await subscriptionRow(subId)
    expect(sub?.status).toBe('active') // unverändert — das Duplikat wurde vor dem Spiegeln abgefangen
  })

  it('ein ÄLTERES Event (kleinerer event.created) lässt die Zeile unverändert (I5)', async () => {
    const user = await newUser()
    const subId = `sub_${randomUUID()}`
    const newer = new Date()
    const older = new Date(newer.getTime() - 60_000)
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()

    // Neuerer Stand zuerst: aktiv.
    await processEvent({
      createdAt: newer.toISOString(),
      userId: user.id,
      subId,
      status: 'active',
      periodEnd,
    })
    // Danach ein ÄLTERES Event mit canceled — I5-Guard verwirft das Update (RETURN NULL).
    const outcome = await processEvent({
      createdAt: older.toISOString(),
      userId: user.id,
      subId,
      status: 'canceled',
      periodEnd,
    })
    expect(outcome).toBe('processed') // das Event selbst ist neu (eigene ID) → aufgezeichnet
    const sub = await subscriptionRow(subId)
    expect(sub?.status).toBe('active') // Spiegel unverändert
    expect(sub?.event_created).toBeCloseTo(newer.getTime() / 1000, 0)
    // Entitlement blieb aktiv (der AFTER-Sync feuerte für das verworfene Update nicht).
    expect((await entitlementRow(user.id))?.is_active).toBe(true)
  })

  it('ein NEUERES Event schlägt durch (Gegenprobe: der Guard verwirft nicht pauschal)', async () => {
    const user = await newUser()
    const subId = `sub_${randomUUID()}`
    const older = new Date()
    const newer = new Date(older.getTime() + 60_000)
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()

    await processEvent({ createdAt: older.toISOString(), userId: user.id, subId, status: 'active', periodEnd })
    await processEvent({
      createdAt: newer.toISOString(),
      userId: user.id,
      subId,
      status: 'canceled',
      periodEnd,
    })
    expect((await subscriptionRow(subId))?.status).toBe('canceled')
    expect((await entitlementRow(user.id))?.is_active).toBe(false) // canceled → kein Zugang
  })

  it('aktives Abo OHNE Periodenende scheitert LAUT und zeichnet das Event NICHT auf (K7 + Atomarität)', async () => {
    const user = await newUser()
    const subId = `sub_${randomUUID()}`
    const eventId = `evt_${randomUUID()}`

    // active + current_period_end NULL → der valid_until-CHECK feuert im Sync-Trigger → die ganze
    // Funktion (inkl. Event-Insert) rollt zurück. Genau der "Basil"-Fallstrick (K7).
    await expect(
      processEvent({
        eventId,
        createdAt: new Date().toISOString(),
        userId: user.id,
        subId,
        status: 'active',
        periodEnd: null,
      }),
    ).rejects.toThrow(/entitlements_stripe_active_requires_valid_until/)

    // Atomarität: weder Event noch Subscription noch Entitlement wurden persistiert → eine
    // Wiederholung durch Stripe verarbeitet erneut (kein stiller Verlust, kein Dauerzugang).
    const evt = await sql<{ n: number }>(
      'select count(*)::int as n from platform.stripe_events where stripe_event_id = $1',
      [eventId],
    )
    expect(evt[0]?.n).toBe(0)
    expect(await subscriptionRow(subId)).toBeUndefined()
    expect(await entitlementRow(user.id)).toBeUndefined()
  })

  it('gekündigtes Abo (deleted → canceled) OHNE Periodenende ist erlaubt und sperrt den Zugang', async () => {
    const user = await newUser()
    const subId = `sub_${randomUUID()}`
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()
    await processEvent({ createdAt: new Date().toISOString(), userId: user.id, subId, status: 'active', periodEnd })
    // Kündigung: der Handler spiegelt status=canceled; current_period_end darf hier NULL sein (I9:
    // is_active=false → der valid_until-CHECK greift nicht).
    const outcome = await processEvent({
      createdAt: new Date(Date.now() + 60_000).toISOString(),
      userId: user.id,
      subId,
      status: 'canceled',
      periodEnd: null,
    })
    expect(outcome).toBe('processed')
    expect((await entitlementRow(user.id))?.is_active).toBe(false)
  })
})

describe('upsert_stripe_customer / get_stripe_customer_id (K3)', () => {
  it('verankert eine Zuordnung und liest sie zurück; write-once', async () => {
    const user = await newUser()
    const custId = `cus_${randomUUID()}`
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query('select public.upsert_stripe_customer($1, $2)', [user.id, custId]),
    )
    const readBack = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ id: string | null }>(
        'select public.get_stripe_customer_id($1) as id',
        [user.id],
      )
      return rows[0]?.id
    })
    expect(readBack).toBe(custId)

    // Write-once: ein zweiter Aufruf mit derselben Customer-ID ändert nichts, wirft nicht.
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query('select public.upsert_stripe_customer($1, $2)', [user.id, custId]),
    )
    const count = await sql<{ n: number }>(
      'select count(*)::int as n from platform.customers where user_id = $1',
      [user.id],
    )
    expect(count[0]?.n).toBe(1)
  })

  it('get_stripe_customer_id liefert NULL, wenn keine Zuordnung existiert', async () => {
    const user = await newUser()
    const id = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ id: string | null }>(
        'select public.get_stripe_customer_id($1) as id',
        [user.id],
      )
      return rows[0]?.id
    })
    expect(id).toBeNull()
  })
})

describe('get_my_subscription (K10-Anzeige) — nur die eigene Zeile', () => {
  it('der eingeloggte Nutzer liest sein Abo-Detail; ein Fremdnutzer sieht es nicht', async () => {
    const a = await newUser()
    const b = await newUser()
    const subId = `sub_${randomUUID()}`
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()
    await processEvent({
      createdAt: new Date().toISOString(),
      userId: a.id,
      subId,
      status: 'active',
      periodEnd,
      cancelAtPeriodEnd: true,
    })

    const own = await runAs({ role: 'authenticated', userId: a.id }, async (c) => {
      const { rows } = await c.query<{ status: string; cancel: boolean }>(
        'select status, cancel_at_period_end as cancel from public.get_my_subscription($1)',
        [PRODUCT],
      )
      return rows
    })
    expect(own).toHaveLength(1)
    expect(own[0]?.status).toBe('active')
    expect(own[0]?.cancel).toBe(true)

    // B hat kein Abo → leere Menge (und sieht insbesondere NICHT A's Zeile).
    const foreign = await runAs({ role: 'authenticated', userId: b.id }, async (c) => {
      const { rows } = await c.query('select * from public.get_my_subscription($1)', [PRODUCT])
      return rows
    })
    expect(foreign).toHaveLength(0)
  })
})

describe('Autorisierung der Wrapper (Katalog-Introspektion; s. Header zum Image-Bug)', () => {
  it('die Webhook-/Checkout-Wrapper sind service_role-only (nicht authenticated, nicht anon)', async () => {
    for (const fn of [
      'process_stripe_subscription_event',
      'upsert_stripe_customer',
      'get_stripe_customer_id',
    ]) {
      expect(await canExecute('service_role', fn)).toBe(true)
      expect(await canExecute('authenticated', fn)).toBe(false)
      expect(await canExecute('anon', fn)).toBe(false)
    }
  })

  it('get_my_subscription ist authenticated-only (nicht anon, nicht service_role)', async () => {
    expect(await canExecute('authenticated', 'get_my_subscription')).toBe(true)
    expect(await canExecute('anon', 'get_my_subscription')).toBe(false)
    expect(await canExecute('service_role', 'get_my_subscription')).toBe(false)
  })
})
