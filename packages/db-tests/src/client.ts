// Test-Harness gegen den LAUFENDEN lokalen Supabase-Stack (`supabase start` + `supabase db reset`).
//
// Warum echte DB statt Prosa: ein RLS-/Grant-Fehler auf Zugangsrechten/Zahlungsstatus ist ein
// Datenleck über Nutzergrenzen hinweg und beim Klicken unsichtbar (Pflichtenheft §10). Das Gate
// stellt jeden Zustand REAL her — echte Nutzer über die GoTrue-Admin-API, echte Rollen, echte
// Transaktionen; keine Mocks, keine simulierte DB.
//
// Zwei Zugänge:
//   1. GoTrue Admin-API (HTTP, service-Key) → echte auth.users-Zeilen anlegen/löschen. Das ist der
//      reale Signup-/Lösch-Pfad und feuert die auth.users-Trigger (I7/I8).
//   2. Direkte Postgres-Verbindung (pg) → Rollen-treue RLS-/Grant-/Trigger-Assertions. Für
//      'authenticated' werden request.jwt.claims exakt wie bei PostgREST gesetzt (auth.uid() liest
//      claims->>'sub'). Das ist KEINE Simulation, sondern derselbe Mechanismus, den PostgREST/GoTrue
//      selbst nutzen — und der einzig gangbare Weg, weil das `platform`-Schema bewusst NICHT über die
//      REST-API exponiert ist (ein supabase-js-.from()-Client könnte es gar nicht erreichen). Die
//      user_id in den Claims ist die ECHTE id des über die Admin-API angelegten Nutzers.
//
// Konfiguration über Env (Defaults = lokaler Stack). In CI aus `supabase status -o env` gespeist.

import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { randomUUID } from 'node:crypto'

// Statischer, für JEDEN lokalen Supabase-Stack identischer service_role-Key (iss "supabase-demo").
// Kein Geheimnis — ausschließlich der lokale Dev-Key. In CI via SUPABASE_SERVICE_ROLE_KEY überschrieben.
const DEFAULT_LOCAL_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.' +
  'EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

export const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const API_URL = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_LOCAL_SERVICE_KEY

export const pool = new Pool({ connectionString: DB_URL, max: 6 })

export type AppRole = 'anon' | 'authenticated' | 'service_role' | 'postgres'

function adminHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

// Harter, KLARER Fehler statt stillem Skip, wenn der Stack fehlt (ein selbst-wegskippender Test ist
// kein Gate). Prüft DB-Verbindung, dass die platform-Migration angewandt ist, und die Auth-API.
export async function assertStackReachable(): Promise<void> {
  try {
    const c = await pool.connect()
    try {
      await c.query('select 1')
      const { rows } = await c.query<{ present: boolean }>(
        `select exists(select 1 from information_schema.schemata where schema_name = 'platform') as present`,
      )
      if (!rows[0]?.present) {
        throw new Error(
          "Schema 'platform' fehlt — `supabase db reset` ausführen (Migration nicht angewandt)",
        )
      }
    } finally {
      c.release()
    }
  } catch (err) {
    throw new Error(
      `Lokaler Supabase-Stack/DB nicht erreichbar unter ${DB_URL} — ` +
        '`supabase start` und `supabase db reset` ausführen. Ursache: ' +
        (err as Error).message,
    )
  }
  let res: Response
  try {
    res = await fetch(`${API_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: adminHeaders(),
    })
  } catch (err) {
    throw new Error(
      `Supabase Auth-API nicht erreichbar unter ${API_URL} — \`supabase start\`. Ursache: ` +
        (err as Error).message,
    )
  }
  if (!res.ok) {
    throw new Error(`Supabase Auth Admin-API antwortet ${res.status} — Service-Key/Stack prüfen`)
  }
}

export interface TestUser {
  id: string
  email: string
}

// Echter Nutzer über die GoTrue-Admin-API (feuert den auth.users-INSERT-Trigger, I7).
export async function createUser(): Promise<TestUser> {
  const email = `dbtest-${randomUUID()}@test.local`
  const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password: `Pw-${randomUUID()}`, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`Admin createUser ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { id: string }
  return { id: data.id, email }
}

// Hard-Delete über die Admin-API (entfernt die auth.users-Zeile → ON DELETE CASCADE, I8).
export async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  })
  if (!res.ok && res.status !== 404)
    throw new Error(`Admin deleteUser ${res.status}: ${await res.text()}`)
}

// Führt fn in EINER Transaktion unter der Ziel-Rolle aus. commit=false (Default) → rollback am Ende
// (nebenwirkungsfrei; für Lese-Assertions und erwartete Permission-Fehler). commit=true → persistiert
// (Setup-Schreibvorgänge, z. B. der Webhook-Pfad als service_role).
export async function runAs<T>(
  ctx: { role: AppRole; userId?: string; commit?: boolean },
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const claims = ctx.userId
      ? JSON.stringify({ sub: ctx.userId, role: ctx.role, aud: 'authenticated' })
      : ''
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims])
    if (ctx.role !== 'postgres') {
      // ctx.role stammt aus einer festen Union (kein Nutzer-Input) — Interpolation ist sicher.
      await client.query(`set local role ${ctx.role}`)
    }
    const out = await fn(client)
    await client.query(ctx.commit ? 'commit' : 'rollback')
    return out
  } catch (err) {
    await client.query('rollback').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

// Privilegierter Postgres-Kontext (Superuser, Autocommit) für Setup/Inspektion.
export async function sql<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<R[]> {
  const res = await pool.query<R>(text, params)
  return res.rows
}

// Anzahl Zeilen einer platform-Tabelle für einen Nutzer (table stammt aus fixem Set — sicher).
export async function countForUser(table: string, userId: string): Promise<number> {
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n from platform.${table} where user_id = $1`,
    [userId],
  )
  return rows[0]?.n ?? 0
}
