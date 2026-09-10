// DB-Gate für den Schreibweg der Branche (B24, Migration
// 20260910150000_create_project_industry_write_path.sql; fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §4.1).
//
// Die Migration schliesst die grösste benannte Lücke des Fragenkatalog-Schritts: die Spalte
// `platform.projects.industry` existierte, der Katalog-Leser nahm eine Branche entgegen — dazwischen
// fehlte das Stück, das die Branche überhaupt an ein Projekt schreibt.
//
// Zwei Fehlerarten wären beim Klicken unsichtbar:
//
//   * EINE ZWEITE ÜBERLADUNG. `p_industry` ist per DROP+CREATE dazugekommen. Wäre stattdessen ein
//     `create or replace` (oder ein blosses CREATE) benutzt worden, stünde eine zweite Fassung
//     daneben — und ein Aufruf mit drei Argumenten träfe still die ALTE, die `industry` gar nicht
//     kennt. Die Branche verschwände, ohne dass irgendetwas fehlschlüge.
//   * EINE BRANCHE AM PRIVATHAUSHALT. `list_question_catalog` nimmt Segment UND Branche; eine
//     Branche an einem `privat`-Projekt lüde still den falschen Fragen-Pool.
//
// Das Gate beweist deshalb fünf Dinge:
//
//   (1) GENAU EINE ÜBERLADUNG mit genau vier Parametern, und die Grants stehen nach dem DROP wieder
//       (ein DROP nimmt sie mit — in B3-1 real passiert).
//   (2) DIE BRANCHE WIRD GESCHRIEBEN UND GELESEN — `get_project` liefert sie mit; ohne das könnte
//       der Chat sie setzen und nie wieder sehen.
//   (3) `p_industry` null HEISST UNVERÄNDERT, nicht löschen — sonst löschte jeder gewöhnliche
//       Entwurfs-Schreibvorgang die Branche mit.
//   (4) DIE SEGMENT-BEDINGUNG TRÄGT, und zwar gegen das nach dem Aufruf geltende Segment (der
//       legitime Fall „Segment und Branche in einem Zug" muss durchlaufen).
//   (5) ES WIRD NICHTS STILL KLEINGESCHRIEBEN — „Hotel" ist `invalid_industry`, kein `hotel`.
//
// ── JEDER GEÄNDERTE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ────────────────────────────────────────
// Arbeitsregel 2: plpgsql prüft Funktionsrümpfe nicht beim Anlegen. Beide (`update_project_draft`
// und das per `create or replace` nachgezogene `get_project`) laufen hier echt, der schreibende auch
// auf seinen Abweisungspfaden.
//
// ── WIE AUFGERÄUMT WIRD ────────────────────────────────────────────────────────────────────────
// vitest fährt Testdateien parallel gegen dieselbe Datenbank. Jede Assertion filtert auf die eigenen
// Zeilen; gelöscht werden am Ende ausschliesslich die eigenen Projekte, Accounts und Konten.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  runAs,
  sql,
  type TestUser,
} from './client'

const createdUsers: string[] = []
const createdProjects: string[] = []
const createdAccounts: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  createdUsers.push(u.id)
  return u
}

/** Ruft einen Wrapper als eingeloggtes Konto auf und persistiert (commit). */
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

/** Wie oben, aber ohne commit — für reine Lese-Assertions und erwartete Ablehnungen. */
async function readAs<T = Record<string, unknown>>(
  user: TestUser,
  fnCall: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id }, async (c) => {
    const { rows } = await c.query<{ out: T }>(`select ${fnCall} as out`, params)
    return rows[0]!.out
  })
}

async function createProjectFor(user: TestUser) {
  const out = await callAs<{ status: string; project_id: string; account_id: string }>(
    user,
    'public.create_my_project($1)',
    [`B24 Branche ${randomUUID()}`],
  )
  expect(out.status).toBe('ok')
  createdProjects.push(out.project_id)
  createdAccounts.push(out.account_id)
  return out.project_id
}

/** Die Zeile privilegiert gelesen — unabhängig davon, was ein Wrapper zurückgibt. */
async function projectRow(id: string) {
  const [row] = await sql<{ segment: string | null; industry: string | null; draft: unknown }>(
    `select segment, industry, draft from platform.projects where id = $1`,
    [id],
  )
  return row!
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Branche — Signatur und Rechtefläche', () => {
  it('⚠ GENAU EINE Überladung mit vier Parametern — der DROP hat keine zweite hinterlassen', async () => {
    const rows = await sql<{ args: string; names: string[] }>(
      `select pg_get_function_identity_arguments(p.oid) as args, p.proargnames as names
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'update_project_draft'`,
    )
    // Zwei Zeilen hier hiessen: ein Aufruf mit drei Argumenten trifft still die alte Fassung.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.args).toBe('p_id uuid, p_draft jsonb, p_segment text, p_industry text')
    expect(rows[0]!.names).toEqual(['p_id', 'p_draft', 'p_segment', 'p_industry'])
  })

  it('die Grants stehen nach dem DROP wieder — authenticated ja, anon und service_role nein', async () => {
    // Arbeitsregel 5: has_function_privilege statt eines Aufrufs als Rolle ohne Grant.
    const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role',  $1, 'execute') as svc`,
      ['public.update_project_draft(uuid, jsonb, text, text)'],
    )
    expect(row).toEqual({ anon: false, auth: true, svc: false })
  })

  it('get_project bleibt bei EINER Überladung und behält seine Grants', async () => {
    const rows = await sql(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_project'`,
    )
    expect(rows).toHaveLength(1)

    const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role',  $1, 'execute') as svc`,
      ['public.get_project(uuid)'],
    )
    expect(row).toEqual({ anon: false, auth: true, svc: false })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Branche — schreiben und lesen', () => {
  it('⚠ die Branche wird geschrieben UND von get_project mitgeliefert', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)

    await callAs(user, 'public.update_project_draft($1, $2, $3)', [projectId, '{}', 'betrieb'])
    expect(
      await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
        projectId,
        '{}',
        null,
        'hotel',
      ]),
    ).toEqual({ status: 'ok' })

    expect((await projectRow(projectId)).industry).toBe('hotel')

    // Ohne diese Hälfte könnte der Chat die Branche setzen und nie wieder sehen — sein
    // Zustandsblock entsteht aus get_project.
    const out = await readAs<{ project: { industry: string | null; segment: string | null } }>(
      user,
      'public.get_project($1)',
      [projectId],
    )
    expect(out.project.industry).toBe('hotel')
    expect(out.project.segment).toBe('betrieb')
  })

  it('Segment und Branche in EINEM Aufruf — gegen das danach geltende Segment geprüft', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)

    // Gegen das BESTEHENDE Segment allein geprüft scheiterte genau dieser legitime Fall.
    expect(
      await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
        projectId,
        JSON.stringify({ energyPriceCtPerKwh: 24.4 }),
        'betrieb',
        'tischlerei',
      ]),
    ).toEqual({ status: 'ok' })

    expect(await projectRow(projectId)).toEqual({
      segment: 'betrieb',
      industry: 'tischlerei',
      draft: { energyPriceCtPerKwh: 24.4 },
    })
  })

  it('⚠ p_industry null heisst UNVERÄNDERT, nicht löschen', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)

    await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
      projectId,
      '{}',
      'betrieb',
      'hotel',
    ])
    // Ein gewöhnlicher Entwurfs-Schreibvorgang, wie ihn set_draft_field auslöst.
    await callAs(user, 'public.update_project_draft($1, $2)', [projectId, JSON.stringify({ a: 1 })])

    const row = await projectRow(projectId)
    expect(row.industry).toBe('hotel')
    expect(row.draft).toEqual({ a: 1 })
  })

  it('eine bestehende Branche lässt sich korrigieren', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)

    await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
      projectId,
      '{}',
      'betrieb',
      'hotel',
    ])
    await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
      projectId,
      '{}',
      null,
      'pension',
    ])

    expect((await projectRow(projectId)).industry).toBe('pension')
  })

  it('Randleerzeichen fallen weg, ein leerer Wert zählt als „nicht übergeben"', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)

    await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
      projectId,
      '{}',
      'betrieb',
      '  hotel  ',
    ])
    expect((await projectRow(projectId)).industry).toBe('hotel')

    // Ein leer abgesendetes Feld darf nichts löschen (dieselbe Lesart wie p_segment).
    await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [projectId, '{}', null, '   '])
    expect((await projectRow(projectId)).industry).toBe('hotel')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Branche — die Grenzen', () => {
  it('⚠ eine Branche am Privathaushalt wird ABGEWIESEN, ohne etwas zu schreiben', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)
    await callAs(user, 'public.update_project_draft($1, $2, $3)', [projectId, '{}', 'privat'])

    const out = await readAs<{ status: string; segment: string | null }>(
      user,
      'public.update_project_draft($1, $2, $3, $4)',
      [projectId, JSON.stringify({ a: 1 }), null, 'hotel'],
    )
    expect(out.status).toBe('industry_requires_betrieb')
    expect(out.segment).toBe('privat')

    // Die Ablehnung kommt VOR jeder Wirkung: auch der mitgeschickte Entwurf bleibt aussen vor.
    expect(await projectRow(projectId)).toEqual({
      segment: 'privat',
      industry: null,
      draft: {},
    })
  })

  it('⚠ ohne bestimmtes Segment ebenfalls abgewiesen', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)

    const out = await readAs<{ status: string; segment: string | null }>(
      user,
      'public.update_project_draft($1, $2, $3, $4)',
      [projectId, '{}', null, 'hotel'],
    )
    expect(out.status).toBe('industry_requires_betrieb')
    expect(out.segment).toBeNull()
    expect((await projectRow(projectId)).industry).toBeNull()
  })

  it('⚠ „Hotel" wird als invalid_industry abgewiesen, NICHT kleingeschrieben', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)
    await callAs(user, 'public.update_project_draft($1, $2, $3)', [projectId, '{}', 'betrieb'])

    // Was der Aufrufer eingetragen hat und was gespeichert wurde, soll dasselbe sein.
    for (const bad of ['Hotel', 'kfz-werkstatt', '_hotel', 'hotel!', 'hôtel']) {
      expect(
        await readAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
          projectId,
          '{}',
          null,
          bad,
        ]),
      ).toEqual({ status: 'invalid_industry' })
    }
    expect((await projectRow(projectId)).industry).toBeNull()
  })

  it('das Segment bleibt unabhängig prüfbar — invalid_segment kommt weiterhin', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)

    expect(
      await readAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
        projectId,
        '{}',
        'hotel',
        'hotel',
      ]),
    ).toEqual({ status: 'invalid_segment' })
    expect((await projectRow(projectId)).industry).toBeNull()
  })

  it('ein fremdes Projekt liefert not_found und bleibt unangetastet', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const projectId = await createProjectFor(owner)
    await callAs(owner, 'public.update_project_draft($1, $2, $3)', [projectId, '{}', 'betrieb'])

    expect(
      await readAs(stranger, 'public.update_project_draft($1, $2, $3, $4)', [
        projectId,
        '{}',
        null,
        'hotel',
      ]),
    ).toEqual({ status: 'not_found' })
    expect((await projectRow(projectId)).industry).toBeNull()
  })

  it('⚠ OFFENGELEGT: eine gesetzte Branche überlebt einen Segmentwechsel auf privat', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user)
    await callAs(user, 'public.update_project_draft($1, $2, $3, $4)', [
      projectId,
      '{}',
      'betrieb',
      'hotel',
    ])

    // set_segment muss weiterhin durchlaufen: ein Tabellen-CHECK machte daraus einen rohen 23514,
    // und das Modell hätte keinen Weg, ihn zu beheben. Die Branche zu nullen wäre eine stille
    // Löschung einer Angabe des Kunden — beides ist in der Migration begründet.
    expect(
      await callAs(user, 'public.update_project_draft($1, $2, $3)', [projectId, '{}', 'privat']),
    ).toEqual({ status: 'ok' })

    const row = await projectRow(projectId)
    expect(row.segment).toBe('privat')
    expect(row.industry).toBe('hotel')
  })
})
