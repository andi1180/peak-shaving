// DB-Gate für den Fail-open-Constraint aus T4-2, Aufgabe 0a
// (Migration 20260718104300_entitlements_valid_until_constraint.sql).
//
// Bewacht: eine AKTIVE Stripe-Zeile MUSS ein valid_until tragen. has_entitlement() behandelt
// valid_until IS NULL als unbegrenzt gültig — bei source=stripe wäre das Dauerzugang trotz
// gekündigtem Abo. source=manual bleibt mit valid_until NULL erlaubt (Lifetime-/Testkonten).
//
// Läuft gegen den laufenden lokalen Stack; jeder Test stellt seinen Zustand real her und räumt ab.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

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
const CONSTRAINT = /entitlements_stripe_active_requires_valid_until/

const spawned: string[] = []
async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawned.push(u.id)
  return u
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

/** Ein Stripe-Abo einspielen (wie der Webhook T4-3, service_role) — löst den Sync-Trigger aus. */
async function insertSubscription(userId: string, status: string, periodEnd: string | null) {
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `insert into platform.subscriptions
         (stripe_subscription_id, user_id, product, status, current_period_end, stripe_event_created_at)
       values ($1, $2, $3, $4, $5, now())`,
      [`sub_${userId}`, userId, PRODUCT, status, periodEnd],
    ),
  )
}

describe('0a — entitlements: aktive Stripe-Zeile erzwingt valid_until', () => {
  it('direkter Insert source=stripe + is_active=true + valid_until NULL scheitert am CHECK (Guard umgangen)', async () => {
    const user = await newUser()
    // Den I2-Guard genauso umgehen wie der Sync-Trigger (transaktionslokales Flag), damit hier
    // der neue CHECK greift und nicht schon der Guard — der CHECK wird so isoliert bewiesen.
    await expect(
      runAs({ role: 'service_role', commit: true }, async (c) => {
        await c.query("select set_config('platform.entitlement_sync', 'on', true)")
        await c.query(
          `insert into platform.entitlements (user_id, product, is_active, valid_until, source)
           values ($1, $2, true, null, 'stripe')`,
          [user.id, PRODUCT],
        )
      }),
    ).rejects.toThrow(CONSTRAINT)
  })

  it('realistischer Pfad: ein aktives Stripe-Abo OHNE current_period_end wird über den Sync-Trigger abgelehnt', async () => {
    // Genau der "Basil"-Fallstrick: current_period_end fehlt (undefined → NULL), Status active.
    const user = await newUser()
    await expect(insertSubscription(user.id, 'active', null)).rejects.toThrow(CONSTRAINT)
    // Beweis, dass NICHTS durchrutschte: keine subscription-, keine entitlement-Zeile.
    const subs = await sql<{ n: number }>(
      'select count(*)::int as n from platform.subscriptions where user_id = $1',
      [user.id],
    )
    const ents = await sql<{ n: number }>(
      'select count(*)::int as n from platform.entitlements where user_id = $1',
      [user.id],
    )
    expect(subs[0]?.n).toBe(0)
    expect(ents[0]?.n).toBe(0)
  })

  it('Kontrolle: aktives Stripe-Abo MIT current_period_end leitet eine gültige, aktive Zeile ab', async () => {
    const user = await newUser()
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()
    await insertSubscription(user.id, 'active', periodEnd)
    const rows = await sql<{ is_active: boolean; vu: number | null }>(
      `select is_active, extract(epoch from valid_until)::float8 as vu
         from platform.entitlements where user_id = $1 and product = $2`,
      [user.id, PRODUCT],
    )
    expect(rows[0]?.is_active).toBe(true)
    expect(rows[0]?.vu).not.toBeNull()
  })

  it('source=manual mit is_active=true + valid_until NULL bleibt erlaubt (Lifetime-/Testkonto)', async () => {
    const user = await newUser()
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `insert into platform.entitlements (user_id, product, is_active, valid_until, source, note)
         values ($1, $2, true, null, 'manual', 'lifetime tester')`,
        [user.id, PRODUCT],
      ),
    )
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.entitlements
         where user_id = $1 and source = 'manual' and valid_until is null and is_active`,
      [user.id],
    )
    expect(rows[0]?.n).toBe(1)
  })
})
