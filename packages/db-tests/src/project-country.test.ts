// DB-Gate für das Land am Projekt (Migration 20261014090000_project_country.sql).
//
// Land und PLZ hängen über den CHECK `projects_postal_code_country_check` aneinander (AT vier,
// DE fünf Ziffern). Der Wrapper `update_project_postal_code` ist per DROP+CREATE um `p_country`
// erweitert worden — er wird hier tatsächlich aufgerufen (Arbeitsregel 2), die Rechtefläche nach
// dem DROP per `has_function_privilege` gemessen (Arbeitsregel 5).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { assertStackReachable, createUser, deleteUser, runAs, sql, type TestUser } from './client'

const createdUsers: string[] = []
const createdProjects: string[] = []
const createdAccounts: string[] = []

async function callAs<T = Record<string, unknown>>(
  user: TestUser,
  fnCall: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ out: T }>(`select ${fnCall} as out`, params)
    return rows[0]!.out
  })
}

async function newProject(): Promise<{ user: TestUser; projectId: string }> {
  const user = await createUser()
  createdUsers.push(user.id)
  const out = await callAs<{ status: string; project_id: string; account_id: string }>(
    user,
    'public.create_my_project($1)',
    [`Land ${randomUUID()}`],
  )
  expect(out.status).toBe('ok')
  createdProjects.push(out.project_id)
  createdAccounts.push(out.account_id)
  return { user, projectId: out.project_id }
}

async function row(id: string) {
  const [r] = await sql<{ country: string; postal_code: string | null }>(
    `select country, postal_code from platform.projects where id = $1`,
    [id],
  )
  return r!
}

beforeAll(assertStackReachable)

afterAll(async () => {
  if (createdProjects.length > 0) {
    await sql(`delete from platform.projects where id = any($1::uuid[])`, [createdProjects])
  }
  if (createdAccounts.length > 0) {
    await sql(`delete from platform.accounts where id = any($1::uuid[])`, [createdAccounts])
  }
  for (const id of createdUsers) await deleteUser(id)
})

describe('Land am Projekt', () => {
  it('neue Projekte stehen auf AT; genau eine Überladung, Grants nach dem DROP wieder da', async () => {
    const { projectId } = await newProject()
    expect((await row(projectId)).country).toBe('AT')

    const [fn] = await sql<{ n: string; anon: boolean; auth: boolean; svc: boolean }>(
      `select (select count(*) from pg_proc where proname = 'update_project_postal_code')::text as n,
              has_function_privilege('anon',          $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role',  $1, 'execute') as svc`,
      ['public.update_project_postal_code(uuid, text, text)'],
    )
    expect(fn).toEqual({ n: '1', anon: false, auth: true, svc: false })
  })

  it('PLZ-Regel je Land: AT vier / DE fünf Ziffern, Land und PLZ in einem Aufruf', async () => {
    const { user, projectId } = await newProject()
    const call = (plz: string | null, country: string | null) =>
      callAs<{ status: string }>(user, 'public.update_project_postal_code($1, $2, $3)', [
        projectId,
        plz,
        country,
      ])

    expect((await call('1100', null)).status).toBe('ok')
    expect((await call('12345', null)).status).toBe('invalid_postal_code') // AT, fünf Ziffern
    expect((await call('10115', 'DE')).status).toBe('ok')
    expect(await row(projectId)).toEqual({ country: 'DE', postal_code: '10115' })
    expect((await call('1010', 'DE')).status).toBe('invalid_postal_code') // DE, vier Ziffern
    expect((await call(null, 'AT')).status).toBe('invalid_postal_code') // bestehende DE-PLZ passt nicht zu AT
    expect((await call(null, 'FR')).status).toBe('invalid_country')
    // Abgewiesene Aufrufe haben nichts verändert.
    expect(await row(projectId)).toEqual({ country: 'DE', postal_code: '10115' })
  })

  it('get_project liefert das Land mit', async () => {
    const { user, projectId } = await newProject()
    await callAs(user, 'public.update_project_postal_code($1, $2, $3)', [projectId, '10115', 'DE'])
    const out = await callAs<{ project: { country: string; postal_code: string } }>(
      user,
      'public.get_project($1)',
      [projectId],
    )
    expect(out.project).toMatchObject({ country: 'DE', postal_code: '10115' })
  })
})
