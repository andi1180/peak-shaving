// DB-Gate für die Report-Übergabe (D12 Teil 1)
// (Migration 20260916090000_create_report_render_requests.sql).
//
// DIE EINE FRAGE: Kann ein Admin ein gerechnetes Ergebnis hinterlegen, es UNANGEMELDET wieder
// abholen — und ist danach wirklich nichts anderes erreichbar?
//
// Der Leseweg ist der erste unangemeldete Zugang zu Kundendaten in `platform`. Sein Schutz besteht
// aus drei Teilen (unratbare id, keine Auflistung, expires_at), und zwei davon sind nur als
// ABWESENHEIT gebaut. Gemessen wird deshalb das Verhalten: die Ablaufprüfung greift, die Tabelle
// ist für anon direkt nicht erreichbar, und die Grant-Fläche ist exakt die beabsichtigte.
//
// Grants per `has_function_privilege` und nicht per Aufruf als Rolle ohne Grant (Arbeitsregel 5 —
// ein solcher Aufruf hat den Postgres-Prozess schon mit Signal 11 abgeschossen). Die Ablehnung des
// eingeloggten NICHT-Admins wird dagegen ECHT aufgerufen: dort HAT der Aufrufer das Grant, und die
// Ablehnung im Funktionsrumpf ist die zu beweisende Eigenschaft (Arbeitsregel 2).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { assertStackReachable, createUser, deleteUser, pool, runAs, sql, type TestUser } from './client'

const CREATE_SIG = 'public.create_report_render_request(jsonb, jsonb, jsonb, int)'
const GET_SIG = 'public.get_report_render_request(uuid)'

/** Stellvertreter für AnalysisResult / LoadProfile — das Gate misst den Transport, nicht den Inhalt. */
const RESULT = { current: { billedKw: 412.5 }, recommendation: { batteryId: 'demo-1' } }
const PROFILE = { source: 'net_signed', readings: [{ ts: '2026-01-01T00:00:00Z', gridPowerKw: 12.5 }] }
const META = { title: 'Bäckerei Gruber — Auslegung' }

const spawnedUsers: string[] = []
let admin: TestUser

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/** Legt eine Übergabe auf dem REALEN Schreibpfad an (Wrapper, als Admin, committed). */
async function createRequest(ttlHours = 6): Promise<string> {
  return runAs({ role: 'authenticated', userId: admin.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `select public.create_report_render_request($1::jsonb, $2::jsonb, $3::jsonb, $4) as id`,
      [JSON.stringify(RESULT), JSON.stringify(PROFILE), JSON.stringify(META), ttlHours],
    )
    return rows[0]!.id
  })
}

beforeAll(async () => {
  await assertStackReachable()
  admin = await newUser()
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [admin.id])
})

afterAll(async () => {
  // Die Zeilen hängen per ON DELETE CASCADE am Konto — das Löschen der Nutzer räumt sie mit weg.
  for (const id of spawnedUsers) await deleteUser(id)
  await pool.end()
})

describe('D12 — der Rundlauf über beide Wrapper', () => {
  it('Admin hinterlegt, anon holt ab — Ergebnis, Lastgang und Meta kommen wortgleich zurück', async () => {
    const id = await createRequest()

    const rows = await runAs({ role: 'anon' }, async (c) => {
      const res = await c.query<{
        analysis_result: unknown
        load_profile: unknown
        report_input_meta: unknown
      }>(`select * from public.get_report_render_request($1)`, [id])
      return res.rows
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.analysis_result).toEqual(RESULT)
    expect(rows[0]?.load_profile).toEqual(PROFILE)
    expect(rows[0]?.report_input_meta).toEqual(META)

    // created_by ist das Konto des Aufrufers und nicht leer — sonst wäre der Schreibweg über
    // service_role gebaut und die Verantwortung für den Renderlauf nirgends festgehalten.
    const owner = await sql<{ created_by: string }>(
      `select created_by from platform.report_render_requests where id = $1`,
      [id],
    )
    expect(owner[0]?.created_by).toBe(admin.id)
  })
})

describe('D12 — was NICHT geliefert wird', () => {
  it('eine unbekannte id liefert leer', async () => {
    const rows = await runAs({ role: 'anon' }, async (c) => {
      const res = await c.query(`select * from public.get_report_render_request($1)`, [randomUUID()])
      return res.rows
    })
    expect(rows).toHaveLength(0)
  })

  it('eine abgelaufene id liefert leer — die TTL ist die Begrenzung, nicht eine Aufräumhilfe', async () => {
    const id = await createRequest()
    await sql(
      `update platform.report_render_requests set expires_at = now() - interval '1 minute' where id = $1`,
      [id],
    )

    const rows = await runAs({ role: 'anon' }, async (c) => {
      const res = await c.query(`select * from public.get_report_render_request($1)`, [id])
      return res.rows
    })

    // Die Zeile steht noch (kein Aufräum-Job) — unlesbar ist sie trotzdem.
    expect(rows).toHaveLength(0)
    const still = await sql(`select 1 from platform.report_render_requests where id = $1`, [id])
    expect(still).toHaveLength(1)
  })

  it('ein eingeloggter NICHT-Admin scheitert am Schreib-Wrapper mit 42501', async () => {
    const plain = await newUser()
    await expect(
      runAs({ role: 'authenticated', userId: plain.id }, (c) =>
        c.query(`select public.create_report_render_request($1::jsonb, $2::jsonb)`, [
          JSON.stringify(RESULT),
          JSON.stringify(PROFILE),
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('D12 — die Rechtekante', () => {
  it('die Tabelle ist für anon und authenticated direkt unerreichbar (RLS an, keine Policy, kein Grant)', async () => {
    const meta = await sql<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'report_render_requests'`,
    )
    expect(meta[0]?.rls).toBe(true)
    expect(meta[0]?.policies).toBe(0)

    // Die Policy-ZAHL allein wäre kein Nachweis (storage.objects, B24): geprüft wird das Verhalten.
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        runAs({ role }, (c) => c.query(`select * from platform.report_render_requests`)),
      ).rejects.toThrow(/permission denied/i)
    }
  })

  it('die Grant-Fläche ist exakt: schreiben nur authenticated, lesen anon UND authenticated', async () => {
    const rows = await sql<{ fn: string; role: string; allowed: boolean }>(
      `select fn, role, has_function_privilege(role, fn, 'EXECUTE') as allowed
         from unnest(array[$1, $2]) as fn,
              unnest(array['anon', 'authenticated', 'service_role']) as role`,
      [CREATE_SIG, GET_SIG],
    )
    expect(rows).toHaveLength(6)

    for (const row of rows) {
      const expected =
        row.fn === CREATE_SIG ? row.role === 'authenticated' : row.role !== 'service_role'
      expect(row.allowed, `${row.role} → ${row.fn}`).toBe(expected)
    }
  })
})
