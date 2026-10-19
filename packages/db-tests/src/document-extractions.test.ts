// DB-Gate für platform.document_extractions und ihre drei Wrapper
// (20261019090000_create_document_extractions.sql).

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

const WRAPPERS = [
  'public.start_document_extraction(uuid, uuid, text, text)',
  'public.finish_document_extraction(uuid, text, jsonb, text)',
  'public.list_document_extractions(uuid, uuid, text)',
  'public.discard_document_extraction(uuid, text)',
]

const createdUsers: string[] = []
const createdProjects: string[] = []

type Extraction = {
  id: string
  project_id: string
  document_id: string
  metering_point_id: string | null
  status: string
  attempts: number
  result: unknown
  error: string | null
  finished_at: string | null
}
type Out = { status: string; extraction?: Extraction; extractions?: Extraction[] }

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  createdUsers.push(u.id)
  return u
}

async function newAdmin(): Promise<TestUser> {
  const u = await newUser()
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

async function callAs(user: TestUser, fnCall: string, params: unknown[] = []): Promise<Out> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ out: Out }>(`select ${fnCall} as out`, params)
    return rows[0]!.out
  })
}

/** Projekt mit einem Dokument und einem Zählpunkt. */
async function newProject(
  admin: TestUser,
): Promise<{ projectId: string; documentId: string; meteringPointId: string }> {
  const out = (await callAs(admin, 'public.admin_create_project($1)', [
    'Auslese-Test',
  ])) as unknown as {
    status: string
    project_id: string
  }
  expect(out.status).toBe('ok')
  const projectId = out.project_id
  createdProjects.push(projectId)
  const documentId = randomUUID()
  await sql(
    `insert into platform.project_documents (id, project_id, storage_path, original_filename, content_type)
     values ($1, $2, $3, 'rechnung.pdf', 'application/pdf')`,
    [documentId, projectId, `${projectId}/${documentId}`],
  )
  const [mp] = await sql<{ id: string }>(
    `insert into platform.metering_points (project_id) values ($1) returning id`,
    [projectId],
  )
  return { projectId, documentId, meteringPointId: mp!.id }
}

const start = 'public.start_document_extraction($1, $2, $3, $4)'
const finish = 'public.finish_document_extraction($1, $2, $3::jsonb, $4)'
const list = 'public.list_document_extractions($1, $2, $3)'
const discard = 'public.discard_document_extraction($1, $2)'

beforeAll(assertStackReachable)

afterEach(async () => {
  if (createdProjects.length > 0) {
    await sql(`delete from platform.projects where id = any($1::uuid[])`, [createdProjects])
    createdProjects.length = 0
  }
  for (const id of createdUsers.splice(0)) await deleteUser(id)
})

afterAll(async () => {
  await pool.end()
})

describe('document_extractions — Schema und Rechte', () => {
  it('RLS an, keine Policy, kein Tabellenrecht; Wrapper nur für authenticated', async () => {
    const [t] = await sql<{
      rls: boolean
      policies: number
      auth_select: boolean
      anon_select: boolean
    }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies where schemaname = 'platform' and tablename = 'document_extractions') as policies,
              has_table_privilege('authenticated', 'platform.document_extractions', 'select') as auth_select,
              has_table_privilege('anon', 'platform.document_extractions', 'select') as anon_select
       from pg_class c where c.oid = 'platform.document_extractions'::regclass`,
    )
    expect(t).toEqual({ rls: true, policies: 0, auth_select: false, anon_select: false })

    for (const fn of WRAPPERS) {
      const [p] = await sql<{ auth: boolean; anon: boolean; service: boolean }>(
        `select has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('service_role', $1, 'execute') as service`,
        [fn],
      )
      expect(p, fn).toEqual({ auth: true, anon: false, service: false })
    }
  })
})

describe('document_extractions — Wrapper', () => {
  it('Normalablauf: start → finish done → erneuter start erhöht attempts; list filtert', async () => {
    const admin = await newAdmin()
    const { projectId, documentId, meteringPointId } = await newProject(admin)

    const first = await callAs(admin, start, [documentId, meteringPointId, 'invoice', 'v1'])
    expect(first.status).toBe('ok')
    expect(first.extraction).toMatchObject({
      project_id: projectId,
      status: 'running',
      attempts: 1,
    })

    const done = await callAs(admin, finish, [
      first.extraction!.id,
      'done',
      '{"billedKw": 12}',
      null,
    ])
    expect(done.status).toBe('ok')
    expect(done.extraction).toMatchObject({ status: 'done', result: { billedKw: 12 }, error: null })
    expect(done.extraction!.finished_at).not.toBeNull()

    const again = await callAs(admin, start, [documentId, meteringPointId, 'invoice', 'v2'])
    expect(again.status).toBe('ok')
    expect(again.extraction).toMatchObject({
      id: first.extraction!.id,
      status: 'running',
      attempts: 2,
      finished_at: null,
    })

    const failed = await callAs(admin, finish, [first.extraction!.id, 'failed', null, 'kaputt'])
    expect(failed.extraction).toMatchObject({
      status: 'failed',
      result: { billedKw: 12 },
      error: 'kaputt',
    })

    const all = await callAs(admin, list, [projectId, null, null])
    expect(all.extractions).toHaveLength(1)
    const filtered = await callAs(admin, list, [projectId, randomUUID(), 'invoice'])
    expect(filtered).toEqual({ status: 'ok', extractions: [] })
  })

  it('fremdes Projekt und Dokument/Zählpunkt aus anderem Projekt → not_found, nichts angelegt', async () => {
    const admin = await newAdmin()
    const stranger = await newUser()
    const a = await newProject(admin)
    const b = await newProject(admin)

    expect((await callAs(stranger, start, [a.documentId, null, 'invoice', null])).status).toBe(
      'not_found',
    )
    expect((await callAs(stranger, list, [a.projectId, null, null])).status).toBe('not_found')
    // Dokument aus A, Zählpunkt aus B.
    expect(
      (await callAs(admin, start, [a.documentId, b.meteringPointId, 'invoice', null])).status,
    ).toBe('not_found')

    const ok = await callAs(admin, start, [a.documentId, null, 'invoice', null])
    expect((await callAs(stranger, finish, [ok.extraction!.id, 'done', '{}', null])).status).toBe(
      'not_found',
    )

    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.document_extractions where project_id = any($1::uuid[])`,
      [[a.projectId, b.projectId]],
    )
    expect(n!.n).toBe(1)
  })

  it('Doppellauf und finish aus falschem Status werden abgelehnt; nach 10 Minuten ist Neustart erlaubt', async () => {
    const admin = await newAdmin()
    const { documentId } = await newProject(admin)

    const first = await callAs(admin, start, [documentId, null, 'invoice', null])
    const second = await callAs(admin, start, [documentId, null, 'invoice', null])
    expect(second.status).toBe('already_running')
    expect(second.extraction!.attempts).toBe(1)

    expect(
      (await callAs(admin, finish, [first.extraction!.id, 'running', null, null])).status,
    ).toBe('invalid_status')
    await callAs(admin, finish, [first.extraction!.id, 'done', '{}', null])
    expect((await callAs(admin, finish, [first.extraction!.id, 'failed', null, 'x'])).status).toBe(
      'not_running',
    )

    await callAs(admin, start, [documentId, null, 'invoice', null])
    await sql(
      `update platform.document_extractions set started_at = now() - interval '11 minutes' where id = $1`,
      [first.extraction!.id],
    )
    const restarted = await callAs(admin, start, [documentId, null, 'invoice', null])
    expect(restarted.extraction).toMatchObject({ status: 'running', attempts: 3 })
  })

  it('discard: fremdes Projekt → not_found, keine Zeile → no_row, sonst removed; danach finish not_running und start removed', async () => {
    const admin = await newAdmin()
    const stranger = await newUser()
    const { documentId, meteringPointId } = await newProject(admin)

    expect(await callAs(admin, discard, [documentId, 'invoice'])).toEqual({ status: 'no_row' })

    const started = await callAs(admin, start, [documentId, meteringPointId, 'invoice', null])
    expect((await callAs(stranger, discard, [documentId, 'invoice'])).status).toBe('not_found')
    expect((await callAs(admin, discard, [randomUUID(), 'invoice'])).status).toBe('not_found')

    // Aus 'running' heraus.
    const discarded = await callAs(admin, discard, [documentId, 'invoice'])
    expect(discarded.status).toBe('ok')
    expect(discarded.extraction).toMatchObject({ id: started.extraction!.id, status: 'removed' })
    expect(discarded.extraction!.finished_at).not.toBeNull()

    expect((await callAs(admin, finish, [started.extraction!.id, 'done', '{}', null])).status).toBe(
      'not_running',
    )

    const restart = await callAs(admin, start, [documentId, meteringPointId, 'invoice', null])
    expect(restart.status).toBe('removed')
    expect(restart.extraction).toMatchObject({ status: 'removed', attempts: 1 })
  })
})
