// DB-Gate für das `platform`-Schema (T4-1) — je ein Test pro fachlicher Invariante I1–I10 der Spec
// (Pflichtenheft_Monitor_MVP.md / T4-1-Prompt). Läuft gegen den LAUFENDEN lokalen Supabase-Stack;
// jeder Test stellt seinen Zustand real her (echte Nutzer via Admin-API, echte Rollen, echte
// Transaktionen) und räumt danach auf → wiederholbar OHNE `db reset` dazwischen.

import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  assertStackReachable,
  countForUser,
  createUser,
  deleteUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

const PRODUCT = 'monitor'

// ── Setup/Teardown ───────────────────────────────────────────────────────────────────────────────
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
  // Jeder Test räumt SEINE Nutzer ab (Admin-API Hard-Delete → Cascade entfernt alle platform-Zeilen).
  for (const id of spawned.splice(0)) await deleteUser(id)
})

afterAll(async () => {
  await pool.end()
})

// ── Helfer (Setup-Schreibvorgänge laufen wie in Produktion als service_role, committed) ──────────
async function insertSubscription(fields: {
  subId: string
  userId: string
  status: string
  periodEnd: string | null
  eventCreatedAt: string
  cancelAtPeriodEnd?: boolean
}): Promise<void> {
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `insert into platform.subscriptions
         (stripe_subscription_id, user_id, product, status, price_id, current_period_end,
          cancel_at_period_end, stripe_event_created_at)
       values ($1, $2, $3, $4, 'price_test', $5, $6, $7)`,
      [
        fields.subId,
        fields.userId,
        PRODUCT,
        fields.status,
        fields.periodEnd,
        fields.cancelAtPeriodEnd ?? false,
        fields.eventCreatedAt,
      ],
    ),
  )
}

async function updateSubscription(fields: {
  subId: string
  status: string
  periodEnd?: string | null
  eventCreatedAt: string
  cancelAtPeriodEnd?: boolean
}): Promise<void> {
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `update platform.subscriptions
         set status = $2,
             current_period_end = coalesce($3, current_period_end),
             cancel_at_period_end = $4,
             stripe_event_created_at = $5
       where stripe_subscription_id = $1`,
      [
        fields.subId,
        fields.status,
        fields.periodEnd ?? null,
        fields.cancelAtPeriodEnd ?? false,
        fields.eventCreatedAt,
      ],
    ),
  )
}

interface EntitlementRow {
  is_active: boolean
  source: string
  valid_until_epoch: number | null
}

async function getEntitlement(userId: string): Promise<EntitlementRow | null> {
  const rows = await sql<EntitlementRow>(
    `select is_active, source, extract(epoch from valid_until)::float8 as valid_until_epoch
       from platform.entitlements where user_id = $1 and product = $2`,
    [userId, PRODUCT],
  )
  return rows[0] ?? null
}

const soon = () => new Date(Date.now() + 30 * 864e5).toISOString() // +30 Tage
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

// ── T1 (I7) ──────────────────────────────────────────────────────────────────────────────────────
describe('I7 — Profil-Automatik', () => {
  it('T1: ein neuer auth.users-Eintrag erzeugt automatisch GENAU EIN Profil', async () => {
    const user = await newUser()
    const rows = await sql<{ n: number }>(
      'select count(*)::int as n from platform.profiles where user_id = $1',
      [user.id],
    )
    expect(rows[0]?.n).toBe(1)
  })
})

// ── T2 (I4) ──────────────────────────────────────────────────────────────────────────────────────
describe('I4 — Zeilen-Isolation', () => {
  it('T2: User A sieht KEINE profiles/customers/subscriptions/entitlements-Zeile von User B', async () => {
    const a = await newUser()
    const b = await newUser()

    // Für BEIDE echte Zeilen anlegen — ein leeres Ergebnis bei leerer Tabelle bewiese nichts.
    for (const u of [a, b]) {
      await runAs({ role: 'service_role', commit: true }, (c) =>
        c.query(`insert into platform.customers (user_id, stripe_customer_id) values ($1, $2)`, [
          u.id,
          `cus_${u.id}`,
        ]),
      )
      await insertSubscription({
        subId: `sub_${u.id}`,
        userId: u.id,
        status: 'active',
        periodEnd: soon(),
        eventCreatedAt: iso(0),
      })
    }

    // A liest mit SEINER Session: nur eigene Zeilen sichtbar, keine von B.
    await runAs({ role: 'authenticated', userId: a.id }, async (c) => {
      for (const table of ['profiles', 'customers', 'subscriptions', 'entitlements']) {
        const own = await c.query<{ n: number }>(
          `select count(*)::int as n from platform.${table} where user_id = $1`,
          [a.id],
        )
        const foreign = await c.query<{ n: number }>(
          `select count(*)::int as n from platform.${table} where user_id = $1`,
          [b.id],
        )
        expect(own.rows[0]?.n, `${table}: A sieht die eigene Zeile`).toBe(1)
        expect(foreign.rows[0]?.n, `${table}: A sieht KEINE Zeile von B`).toBe(0)
      }
    })
  })
})

// ── T3 (I3) ──────────────────────────────────────────────────────────────────────────────────────
describe('I3 — kein Nutzer-Schreibzugriff auf entitlements (Bezahlschutz)', () => {
  it('T3: eine authentifizierte Session kann sich NICHT selbst is_active=true setzen (INSERT/UPDATE/DELETE verweigert)', async () => {
    const user = await newUser()
    // Ein echtes Entitlement (inaktiv) herstellen, damit UPDATE/DELETE eine Zielzeile haben.
    await insertSubscription({
      subId: `sub_${user.id}`,
      userId: user.id,
      status: 'canceled',
      periodEnd: iso(-864e5),
      eventCreatedAt: iso(0),
    })

    // Jede Schreiboperation in EIGENER Transaktion (ein Fehler bricht die Transaktion ab).
    await expect(
      runAs({ role: 'authenticated', userId: user.id }, (c) =>
        c.query(
          `insert into platform.entitlements (user_id, product, is_active, source) values ($1, $2, true, 'manual')`,
          [user.id, PRODUCT],
        ),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      runAs({ role: 'authenticated', userId: user.id }, (c) =>
        c.query(`update platform.entitlements set is_active = true where user_id = $1`, [user.id]),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      runAs({ role: 'authenticated', userId: user.id }, (c) =>
        c.query(`delete from platform.entitlements where user_id = $1`, [user.id]),
      ),
    ).rejects.toThrow(/permission denied/i)

    // Beweis, dass der Schutz gegriffen hat: die Zeile ist unverändert inaktiv.
    expect((await getEntitlement(user.id))?.is_active).toBe(false)
  })
})

// ── T4 (I3) ──────────────────────────────────────────────────────────────────────────────────────
describe('I3 — anon hat keinerlei Zugriff', () => {
  it('T4: anon bekommt auf ALLEN sechs Tabellen permission denied bei SELECT', async () => {
    for (const table of [
      'profiles',
      'customers',
      'subscriptions',
      'entitlements',
      'stripe_events',
      'user_roles',
    ]) {
      await expect(
        runAs({ role: 'anon' }, (c) => c.query(`select * from platform.${table} limit 1`)),
        `anon SELECT auf ${table} muss scheitern`,
      ).rejects.toThrow(/permission denied/i)
    }
  })
})

// ── T5 (I2/I9) ─────────────────────────────────────────────────────────────────────────────────
describe('I2/I9 — Status-Mapping Stripe → Entitlement', () => {
  it('T5: active→aktiv, canceled→inaktiv, past_due→aktiv, cancel_at_period_end lässt aktiv + valid_until unverändert', async () => {
    const user = await newUser()
    const periodEnd = soon()
    const subId = `sub_${user.id}`

    await insertSubscription({
      subId,
      userId: user.id,
      status: 'active',
      periodEnd,
      eventCreatedAt: iso(0),
    })
    const afterActive = await getEntitlement(user.id)
    expect(afterActive?.is_active).toBe(true)
    expect(afterActive?.source).toBe('stripe')
    const activeValidUntil = afterActive?.valid_until_epoch ?? null
    expect(activeValidUntil).not.toBeNull()

    await updateSubscription({ subId, status: 'canceled', eventCreatedAt: iso(60_000) })
    expect((await getEntitlement(user.id))?.is_active).toBe(false)

    await updateSubscription({ subId, status: 'past_due', periodEnd, eventCreatedAt: iso(120_000) })
    expect((await getEntitlement(user.id))?.is_active).toBe(true)

    // Zurück auf active MIT geplanter Kündigung zum Periodenende → bleibt aktiv, valid_until unverändert.
    await updateSubscription({
      subId,
      status: 'active',
      periodEnd,
      eventCreatedAt: iso(180_000),
      cancelAtPeriodEnd: true,
    })
    const afterCancelFlag = await getEntitlement(user.id)
    expect(afterCancelFlag?.is_active).toBe(true)
    expect(afterCancelFlag?.valid_until_epoch).toBe(activeValidUntil)
  })
})

// ── T6 (I2) ──────────────────────────────────────────────────────────────────────────────────────
describe('I2 — manueller Grant wird nicht überschrieben', () => {
  it('T6: source=manual bleibt von einem danach eintreffenden subscriptions-Update unangetastet', async () => {
    const user = await newUser()

    // Manueller Grant (Testnutzer), wie ihn das Admin-UI (T4-4) per service_role schreibt.
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `insert into platform.entitlements (user_id, product, is_active, valid_until, source, note)
         values ($1, $2, true, null, 'manual', 'tester')`,
        [user.id, PRODUCT],
      ),
    )

    // Danach trifft ein (inaktivierendes) Stripe-Abo ein — darf den manuellen Grant NICHT umschreiben.
    await insertSubscription({
      subId: `sub_${user.id}`,
      userId: user.id,
      status: 'canceled',
      periodEnd: iso(-864e5),
      eventCreatedAt: iso(0),
    })

    const ent = await getEntitlement(user.id)
    expect(ent?.source).toBe('manual')
    expect(ent?.is_active).toBe(true)
  })

  it('T6b: Anwendungscode (service_role) kann KEINE source=stripe-Zeile direkt schreiben (I2-Hartschutz)', async () => {
    const user = await newUser()
    await expect(
      runAs({ role: 'service_role', commit: true }, (c) =>
        c.query(
          `insert into platform.entitlements (user_id, product, is_active, source) values ($1, $2, true, 'stripe')`,
          [user.id, PRODUCT],
        ),
      ),
    ).rejects.toThrow(/Invariante I2/)
  })
})

// ── T7 (I5) ──────────────────────────────────────────────────────────────────────────────────────
describe('I5 — Out-of-order-Schutz', () => {
  it('T7: ein Update mit älterem Event lässt die Zeile unverändert (kein Fehler); ein neueres greift', async () => {
    const user = await newUser()
    const subId = `sub_${user.id}`
    await insertSubscription({
      subId,
      userId: user.id,
      status: 'active',
      periodEnd: soon(),
      eventCreatedAt: iso(0),
    })

    // Älteres Event (t-10min) darf NICHTS ändern und darf NICHT werfen.
    await expect(
      updateSubscription({ subId, status: 'canceled', eventCreatedAt: iso(-600_000) }),
    ).resolves.toBeUndefined()

    const stale = await sql<{ status: string }>(
      `select status from platform.subscriptions where stripe_subscription_id = $1`,
      [subId],
    )
    expect(stale[0]?.status).toBe('active')
    expect((await getEntitlement(user.id))?.is_active).toBe(true)

    // Neueres Event greift.
    await updateSubscription({ subId, status: 'canceled', eventCreatedAt: iso(600_000) })
    const fresh = await sql<{ status: string }>(
      `select status from platform.subscriptions where stripe_subscription_id = $1`,
      [subId],
    )
    expect(fresh[0]?.status).toBe('canceled')
    expect((await getEntitlement(user.id))?.is_active).toBe(false)
  })
})

// ── T8 (I6) ──────────────────────────────────────────────────────────────────────────────────────
describe('I6 — stripe_events append-only / Idempotenz', () => {
  it('T8: zweites Insert derselben Event-ID scheitert; UPDATE und DELETE scheitern, Zeile bleibt', async () => {
    const eventId = `evt_${randomUUID()}`
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `insert into platform.stripe_events (stripe_event_id, type) values ($1, 'customer.subscription.updated')`,
        [eventId],
      ),
    )

    await expect(
      runAs({ role: 'service_role', commit: true }, (c) =>
        c.query(`insert into platform.stripe_events (stripe_event_id, type) values ($1, 'x')`, [
          eventId,
        ]),
      ),
    ).rejects.toThrow(/duplicate key/i)

    // service_role hat gar kein update/delete-Grant → schon der Grant-Layer sperrt (Defense-in-Depth).
    await expect(
      runAs({ role: 'service_role', commit: true }, (c) =>
        c.query(`update platform.stripe_events set type = 'z' where stripe_event_id = $1`, [
          eventId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i)

    // Der Append-only-TRIGGER ist der harte Backstop — er greift auch für einen privilegierten Akteur
    // (postgres/BYPASSRLS), der den Grant-Layer umgeht (genau der Fall, den I6 absichern soll).
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.stripe_events set type = 'z' where stripe_event_id = $1`, [
          eventId,
        ]),
      ),
    ).rejects.toThrow(/append-only/i)

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`delete from platform.stripe_events where stripe_event_id = $1`, [eventId]),
      ),
    ).rejects.toThrow(/append-only/i)

    const rows = await sql<{ type: string }>(
      `select type from platform.stripe_events where stripe_event_id = $1`,
      [eventId],
    )
    expect(rows[0]?.type).toBe('customer.subscription.updated')
  })
})

// ── T9 (I8) ──────────────────────────────────────────────────────────────────────────────────────
describe('I8 — DSGVO-Cascade', () => {
  it('T9: Löschen des auth.users-Eintrags hinterlässt in allen Tabellen null personenbezogene Zeilen', async () => {
    const user = await createUser() // NICHT tracken — dieser Test löscht selbst
    // Alle fünf user-gebundenen Tabellen befüllen (profile automatisch) + einen Idempotenz-Event.
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(`insert into platform.customers (user_id, stripe_customer_id) values ($1, $2)`, [
        user.id,
        `cus_${user.id}`,
      ]),
    )
    await insertSubscription({
      subId: `sub_${user.id}`,
      userId: user.id,
      status: 'active',
      periodEnd: soon(),
      eventCreatedAt: iso(0),
    })
    await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [user.id])
    const eventId = `evt_${randomUUID()}`
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(`insert into platform.stripe_events (stripe_event_id, type) values ($1, 'test')`, [
        eventId,
      ]),
    )

    // Vorbedingung: die fünf user-gebundenen Tabellen tragen jetzt Zeilen.
    for (const table of ['profiles', 'customers', 'subscriptions', 'entitlements', 'user_roles']) {
      expect(
        await countForUser(table, user.id),
        `${table} vor dem Löschen befüllt`,
      ).toBeGreaterThan(0)
    }

    await deleteUser(user.id)

    // Alle fünf user-gebundenen Tabellen: 0 Zeilen (ON DELETE CASCADE).
    for (const table of ['profiles', 'customers', 'subscriptions', 'entitlements', 'user_roles']) {
      expect(await countForUser(table, user.id), `${table} nach dem Löschen leer`).toBe(0)
    }

    // stripe_events ist bewusst NICHT user-gebunden (Idempotenz-Ledger, PK=Event-ID; Personenbezug
    // lebt in den fünf Tabellen oben). "Null Zeilen für diesen Nutzer" gilt hier by-design: die Zeile
    // enthält keinerlei Personenbezug des gelöschten Nutzers.
    const orphan = await sql<{ n: number }>(
      `select count(*)::int as n from platform.stripe_events where payload::text like $1`,
      [`%${user.id}%`],
    )
    expect(orphan[0]?.n, 'kein stripe_events-Payload referenziert den gelöschten Nutzer').toBe(0)
  })
})

// ── T10 (I10) ─────────────────────────────────────────────────────────────────────────────────
describe('I10 — Admin-Rolle greift sofort (kein Token-Refresh)', () => {
  it('T10: is_admin() false → true nach user_roles-Insert → wieder false nach Entfernen, ohne neue Session', async () => {
    const user = await newUser()
    const asUser = () =>
      runAs({ role: 'authenticated', userId: user.id }, async (c) => {
        const { rows } = await c.query<{ admin: boolean }>('select platform.is_admin() as admin')
        return rows[0]?.admin
      })

    // Identische "Session" (dieselben JWT-Claims) über alle drei Checks — nur die Tabelle ändert sich.
    expect(await asUser()).toBe(false)
    await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [user.id])
    expect(await asUser()).toBe(true)
    await sql(`delete from platform.user_roles where user_id = $1 and role = 'admin'`, [user.id])
    expect(await asUser()).toBe(false)
  })
})

// ── T11 (I1) ──────────────────────────────────────────────────────────────────────────────────
describe('I1 — has_entitlement sperrt bei Zeitablauf', () => {
  it('T11: has_entitlement=false bei abgelaufenem valid_until, auch wenn is_active=true', async () => {
    const user = await newUser()

    // Manueller Grant, aktiv, aber gestern abgelaufen.
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `insert into platform.entitlements (user_id, product, is_active, valid_until, source)
         values ($1, $2, true, now() - interval '1 day', 'manual')`,
        [user.id, PRODUCT],
      ),
    )
    const expired = await sql<{ granted: boolean }>(
      'select platform.has_entitlement($1, $2) as granted',
      [user.id, PRODUCT],
    )
    expect(expired[0]?.granted).toBe(false)

    // Gegenprobe: valid_until in der Zukunft → true (der Zeitablauf allein sperrt, nicht is_active).
    await sql(
      `update platform.entitlements set valid_until = now() + interval '1 day' where user_id = $1`,
      [user.id],
    )
    const future = await sql<{ granted: boolean }>(
      'select platform.has_entitlement($1, $2) as granted',
      [user.id, PRODUCT],
    )
    expect(future[0]?.granted).toBe(true)
  })
})
