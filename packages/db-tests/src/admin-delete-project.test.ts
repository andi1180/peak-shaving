// DB-Gate für public.admin_delete_project (20260915150000_create_admin_delete_project.sql).
//
// Zwei Dinge werden bewiesen: die Kaskade räumt wirklich auf (positiv geprüft an einem Nachbar-
// Projekt, das unberührt bleiben muss), und ohne Adminrolle passiert nichts (42501, kein Löschen).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { assertStackReachable, createUser, deleteUser, pool, runAs, sql, type TestUser } from './client'

const createdUsers: string[] = []
const createdProjects: string[] = []

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

async function callAs<T = Record<string, unknown>>(
  user: TestUser | null,
  fnCall: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user?.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ out: T }>(`select ${fnCall} as out`, params)
    return rows[0]!.out
  })
}

/** Legt ein admin-geführtes Projekt an und merkt es fürs Aufräumen vor. */
async function newProject(admin: TestUser, label: string): Promise<string> {
  const out = await callAs<{ status: string; project_id: string }>(
    admin,
    'public.admin_create_project($1)',
    [label],
  )
  expect(out.status).toBe('ok')
  createdProjects.push(out.project_id)
  return out.project_id
}

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

describe('admin_delete_project', () => {
  it('löscht ein Projekt samt kaskadierten Zeilen — ein Nachbar-Projekt bleibt unberührt', async () => {
    const admin = await newAdmin()
    const targetId = await newProject(admin, 'Wird gelöscht')
    const neighborId = await newProject(admin, 'Bleibt bestehen')

    // Je eine Zeile in allen vier kaskadierenden Tabellen, für BEIDE Projekte — die Positiv-Kontrolle
    // muss dieselben Kindtabellen tragen wie das Ziel, sonst bewiese ein leeres Ergebnis nichts.
    for (const projectId of [targetId, neighborId]) {
      await sql(
        `insert into platform.project_messages (project_id, role, content)
         values ($1, 'user', '[{"type":"text","text":"hallo"}]'::jsonb)`,
        [projectId],
      )
      const documentId = randomUUID()
      await sql(
        `insert into platform.project_documents (id, project_id, storage_path, original_filename, content_type)
         values ($1, $2, $3, 'rechnung.pdf', 'application/pdf')`,
        [documentId, projectId, `${projectId}/${documentId}`],
      )
      await sql(
        `insert into platform.project_open_questions (project_id, question) values ($1, 'Offene Frage?')`,
        [projectId],
      )
      await sql(`insert into platform.metering_points (project_id) values ($1)`, [projectId])
    }

    const result = await callAs<{ status: string; project_id: string }>(
      admin,
      'public.admin_delete_project($1)',
      [targetId],
    )
    expect(result).toEqual({ status: 'ok', project_id: targetId })

    const [gone] = await sql<{ n: number }>(
      `select
         (select count(*)::int from platform.projects where id = $1) +
         (select count(*)::int from platform.project_messages where project_id = $1) +
         (select count(*)::int from platform.project_documents where project_id = $1) +
         (select count(*)::int from platform.project_open_questions where project_id = $1) +
         (select count(*)::int from platform.metering_points where project_id = $1) as n`,
      [targetId],
    )
    expect(gone!.n).toBe(0)

    const [kept] = await sql<{ n: number }>(
      `select
         (select count(*)::int from platform.projects where id = $1) +
         (select count(*)::int from platform.project_messages where project_id = $1) +
         (select count(*)::int from platform.project_documents where project_id = $1) +
         (select count(*)::int from platform.project_open_questions where project_id = $1) +
         (select count(*)::int from platform.metering_points where project_id = $1) as n`,
      [neighborId],
    )
    expect(kept!.n).toBe(5)

    createdProjects.splice(createdProjects.indexOf(targetId), 1)
  })

  it('kein Zugang ohne Adminrolle — die Zeile bleibt unangetastet', async () => {
    const user = await newUser()
    const admin = await newAdmin()
    const projectId = await newProject(admin, 'Sollte stehen bleiben')

    // ECHTER Aufruf: der Nicht-Admin HAT das Grant, die Ablehnung IM Rumpf ist die zu beweisende
    // Eigenschaft (Arbeitsregel 5 — kein Aufruf als Rolle ohne Grant).
    await expect(
      callAs(user, 'public.admin_delete_project($1)', [projectId]),
    ).rejects.toMatchObject({ code: '42501' })

    const [row] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.projects where id = $1`,
      [projectId],
    )
    expect(row!.n).toBe(1)
  })
})
