// DB-Gate für die public-RPC-Wrapper aus T4-2, Aufgabe 3
// (Migration 20260718104400_auth_rpc_wrappers.sql).
//
// Beweist J3/J8/J9: der EINGELOGGTE Nutzer liest seinen eigenen Zustand über public-Wrapper
// (platform selbst ist nicht exponiert), fremde Konten sind nicht abfragbar (kein user_id-Param),
// anon hat KEIN Execute-Recht. Läuft gegen den laufenden lokalen Stack.
//
// ── WARUM die anon-Ablehnung per Katalog-Introspektion statt per Aufruf geprüft wird ─────────────
// Das lokal/CI gepinnte Postgres-Image (supabase/postgres:17.6.1.106, PG 17.6) hat einen Bug:
// ein NICHT-Owner-Rollen-Aufruf einer public-Funktion OHNE execute-Grant löst statt eines sauberen
// "permission denied for function" einen Backend-SEGFAULT aus (signal 11 → DB in Recovery). Das
// ist unabhängig von SECURITY DEFINER/INVOKER, search_path oder Body reproduzierbar (per
// Bisektion belegt, s. T4-2-Report) und liegt in einem der vorgeladenen Hooks (auto_explain/
// pgaudit/plan_filter) dieses Images, NICHT in unserem SQL — Vanilla-PG 17 wirft hier sauber, und
// die verwaltete Supabase-Cloud ist ein anderer, gepatchter Build. Die T4-1-Funktionen (is_admin/
// has_entitlement) sind davon verschont, weil sie im nicht-exponierten `platform`-Schema liegen
// (anon scheitert dort schon an der Schema-Usage, VOR der Funktions-Rechteprüfung).
//
// Konsequenz: Die Sicherheitseigenschaft „anon darf diese Wrapper nicht ausführen" wird über
// has_function_privilege (die AUTORISIERUNGS-Wahrheit) geprüft — NICHT über einen echten anon-
// Aufruf, der auf diesem Image die gemeinsame Test-/CI-DB zum Absturz brächte. App und Tests rufen
// die Wrapper nie als anon auf; der Grant ist authenticated-only (design-korrekt).

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

const spawned: string[] = []
async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawned.push(u.id)
  return u
}
async function grantMonitor(userId: string) {
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `insert into platform.entitlements (user_id, product, is_active, valid_until, source)
       values ($1, 'monitor', true, now() + interval '30 days', 'manual')`,
      [userId],
    ),
  )
}
async function readEntitlementAs(userId: string): Promise<boolean | undefined> {
  return runAs({ role: 'authenticated', userId }, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>("select public.get_my_entitlement('monitor') as ok")
    return rows[0]?.ok
  })
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

describe('public.get_my_profile', () => {
  it('ein authentifizierter Nutzer liest GENAU seine eigene Profil-Zeile', async () => {
    const a = await newUser()
    const b = await newUser() // existiert, darf aber nicht sichtbar sein
    const rows = await runAs({ role: 'authenticated', userId: a.id }, async (c) => {
      const res = await c.query<{ user_id: string; display_name: string | null }>(
        'select user_id, display_name from public.get_my_profile()',
      )
      return res.rows
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBe(a.id)
    expect(rows[0]?.user_id).not.toBe(b.id)
  })

  it('anon hat KEIN Execute-Recht, authenticated schon (Autorisierung per Katalog; s. Header zum Image-Bug)', async () => {
    const anon = await sql<{ can: boolean }>(
      "select has_function_privilege('anon', 'public.get_my_profile()', 'execute') as can",
    )
    expect(anon[0]?.can).toBe(false)
    const authed = await sql<{ can: boolean }>(
      "select has_function_privilege('authenticated', 'public.get_my_profile()', 'execute') as can",
    )
    expect(authed[0]?.can).toBe(true)
  })
})

describe('public.get_my_entitlement', () => {
  it('false ohne Entitlement, true nach einem aktiven (manuellen) Grant', async () => {
    const user = await newUser()
    expect(await readEntitlementAs(user.id)).toBe(false)
    await grantMonitor(user.id)
    expect(await readEntitlementAs(user.id)).toBe(true)
  })

  it('sieht NICHT das Entitlement eines anderen Nutzers (kein user_id-Parameter)', async () => {
    const a = await newUser()
    const b = await newUser()
    await grantMonitor(b.id) // nur B hat Zugang
    expect(await readEntitlementAs(a.id)).toBe(false) // A liest ausschließlich seinen eigenen Zustand
  })

  it('anon hat KEIN Execute-Recht, authenticated schon (Autorisierung per Katalog; s. Header zum Image-Bug)', async () => {
    const anon = await sql<{ can: boolean }>(
      "select has_function_privilege('anon', 'public.get_my_entitlement(platform.product_key)', 'execute') as can",
    )
    expect(anon[0]?.can).toBe(false)
    const authed = await sql<{ can: boolean }>(
      "select has_function_privilege('authenticated', 'public.get_my_entitlement(platform.product_key)', 'execute') as can",
    )
    expect(authed[0]?.can).toBe(true)
  })
})
