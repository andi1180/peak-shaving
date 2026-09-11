// DB-Gate für das Zählpunkt-Gerüst und die zwei nachgezogenen Admin-Leser (B24, Teil 1 Schritt 1;
// Migration 20260911090000_create_metering_points.sql, fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.2/§2.3).
//
// ── WAS HIER SCHIEFGEHEN KANN, OHNE DASS ES AUFFÄLLT ────────────────────────────────────────────
//
//   * SCOPE-CREEP AN EINER LEEREN TABELLE. `metering_points` ist ein Gerüst: sie trägt die
//     Beziehung und sonst nichts, weil der Zuschnitt des Betrieb-Contracts offener Punkt 1 des
//     Deltas ist. Eine später „nebenbei" angehängte Spalte (`meter_number`, `netzebene`) entschiede
//     diese Frage still — und niemand bemerkte es, weil eine zusätzliche Spalte nirgends
//     fehlschlägt. Der erste Test misst die Spaltenliste deshalb EXAKT.
//
//   * EIN VERSEHENTLICHES DROP+CREATE DER ZWEI LESER. `admin_list_projects`/`admin_get_project`
//     sind per `create or replace` bei UNVERÄNDERTER Signatur erweitert worden. Wäre stattdessen
//     ein DROP+CREATE benutzt worden, wären die Grants weg (in B3-1 real passiert) — und der
//     Admin-Bereich antwortete mit 42501 auf einer Seite, die vorher lief. Geprüft wird deshalb:
//     genau EINE Überladung, und die Grants stehen.
//
//   * DIE ERWEITERUNG LÄUFT INS LEERE. Beide Funktionen führen eine ausgeschriebene Spaltenliste;
//     `segment`/`industry` dort zu vergessen ist kein Fehler, den irgendetwas meldet — die Ansicht
//     zeigte schlicht nie ein Segment. Beide Wrapper werden deshalb ECHT aufgerufen (Arbeitsregel 2)
//     und ihr Ergebnis gegen die privilegiert gelesene Zeile gehalten.
//
//   * DIE KASKADE. `on delete cascade` statt `set null` ist hier die bewusste Abweichung vom
//     Fundament. Geprüft wird das VERHALTEN (ein gelöschtes Projekt nimmt seine Zählpunkte mit),
//     nicht die Constraint-Definition — und zusätzlich die Gegenrichtung, dass das Löschen
//     überhaupt durchläuft (ein DELETE-abweisender Trigger machte das Projekt unlöschbar; die
//     Migration schliesst genau das aus).
//
// ── WIE AUFGERÄUMT WIRD ─────────────────────────────────────────────────────────────────────────
// vitest fährt Testdateien parallel gegen dieselbe Datenbank. Jede Assertion filtert auf die eigenen
// Zeilen; gelöscht werden am Ende ausschliesslich die eigenen Projekte, Accounts und Konten.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { assertStackReachable, createUser, deleteUser, runAs, sql, type TestUser } from './client'

const createdUsers: string[] = []
const createdProjects: string[] = []
const createdAccounts: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  createdUsers.push(u.id)
  return u
}

async function makeAdmin(user: TestUser): Promise<void> {
  await sql(
    `insert into platform.user_roles (user_id, role) values ($1, 'admin')
       on conflict (user_id, role) do nothing`,
    [user.id],
  )
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

/** Wie oben, aber ohne commit — für reine Lese-Assertions. */
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

/** Legt ein KUNDEN-Projekt an (eigener Weg), damit `account_id` gesetzt ist. */
async function createProjectFor(user: TestUser, label: string) {
  const out = await callAs<{ status: string; project_id: string; account_id: string }>(
    user,
    'public.create_my_project($1)',
    [label],
  )
  expect(out.status).toBe('ok')
  createdProjects.push(out.project_id)
  createdAccounts.push(out.account_id)
  return out.project_id
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
describe('B24 Zählpunkt-Gerüst — Schnitt der Tabelle', () => {
  it('⚠ trägt EXAKT id, project_id und created_at — eine vierte Spalte lässt diesen Test fallen', async () => {
    /*
     * Der eigentliche Zweck dieser Datei. `metering_points` ist absichtlich inhaltsleer: WELCHE
     * Angaben ein Zählpunkt trägt, entscheidet die Dateneingabe, nicht dieser Schritt. Eine hier
     * vorweggenommene Spalte (Zählpunktnummer, Netzebene, Messvariante) entschiede den offenen
     * Punkt 1 des Deltas still — und zwar an der Stelle, an der es am teuersten wäre.
     *
     * Geprüft wird die VOLLSTÄNDIGE Liste in Reihenfolge, nicht „enthält": nur so wird der Test
     * rot, wenn jemand etwas ANHÄNGT.
     */
    const rows = await sql<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'platform' and table_name = 'metering_points'
        order by ordinal_position`,
    )
    expect(rows.map((r) => r.column_name)).toEqual(['id', 'project_id', 'created_at'])
    expect(rows.map((r) => r.is_nullable)).toEqual(['NO', 'NO', 'NO'])
    expect(rows.map((r) => r.data_type)).toEqual([
      'uuid',
      'uuid',
      'timestamp with time zone',
    ])
  })

  it('project_id zeigt auf platform.projects und kaskadiert', async () => {
    const [row] = await sql<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'platform' and t.relname = 'metering_points' and c.contype = 'f'`,
    )
    expect(row!.def).toContain('REFERENCES platform.projects(id)')
    expect(row!.def).toContain('ON DELETE CASCADE')
  })

  it('⚠ es gibt KEINEN nicht-internen Trigger — ein DELETE-Wächter machte das Projekt unlöschbar', async () => {
    /*
     * Die Kehrseite der Kaskade, und sie ist nicht theoretisch: dieselbe Auflage hat der
     * Chat-Zustand-Schritt für `project_messages` als Wächter-Probe gemessen (ein Append-only-
     * Trigger dort riss 26 von 39 Tests um, weil das Aufräumen der Projekte brach).
     */
    const rows = await sql(
      `select 1 from pg_trigger tg
         join pg_class t on t.oid = tg.tgrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'platform' and t.relname = 'metering_points' and not tg.tgisinternal`,
    )
    expect(rows).toHaveLength(0)
  })

  it('hat einen Index auf der Kindspalte — sonst ist jedes Projekt-Löschen ein Seq-Scan', async () => {
    const rows = await sql<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'platform' and tablename = 'metering_points'
          and indexname = 'metering_points_project_created_idx'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.indexdef).toContain('project_id')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Zählpunkt-Gerüst — Rechtefläche', () => {
  it('RLS ist aktiv und es gibt KEINE Policy', async () => {
    const [rls] = await sql<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'metering_points'`,
    )
    expect(rls!.relrowsecurity).toBe(true)

    const policies = await sql(
      `select 1 from pg_policies where schemaname = 'platform' and tablename = 'metering_points'`,
    )
    expect(policies).toHaveLength(0)
  })

  it('⚠ KEINE Client-Rolle hat irgendein Tabellenrecht — auch service_role nicht', async () => {
    // Zwei Schichten, die unabhängig voneinander tragen (Muster accounts/projects/analyses).
    const rows = await sql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'metering_points'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    )
    expect(rows).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Zählpunkt-Gerüst — Kaskade am echten Datensatz', () => {
  it('ein gelöschtes Projekt nimmt seine Zählpunkte mit, und das Löschen läuft durch', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user, `B24 Zählpunkt ${randomUUID()}`)

    // Es gibt bewusst keinen Schreib-Wrapper — der Zählpunkt entsteht hier privilegiert, weil
    // genau das der Zustand ist, den dieser Schritt herstellt: Beziehung ja, Schreibweg nein.
    await sql(`insert into platform.metering_points (project_id) values ($1), ($1)`, [projectId])
    const before = await sql(`select 1 from platform.metering_points where project_id = $1`, [
      projectId,
    ])
    expect(before).toHaveLength(2)

    await sql(`delete from platform.projects where id = $1`, [projectId])

    const after = await sql(`select 1 from platform.metering_points where project_id = $1`, [
      projectId,
    ])
    expect(after).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Admin-Leser — Signatur und Grants überstehen die Erweiterung', () => {
  it('admin_list_projects: GENAU EINE Überladung mit unveränderter Parameterliste', async () => {
    const rows = await sql<{ args: string; names: string[] }>(
      `select pg_get_function_identity_arguments(p.oid) as args, p.proargnames as names
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_list_projects'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.args).toBe('p_limit integer, p_offset integer, p_account_id uuid')
    expect(rows[0]!.names).toEqual(['p_limit', 'p_offset', 'p_account_id'])
  })

  it('admin_get_project: GENAU EINE Überladung mit unveränderter Parameterliste', async () => {
    const rows = await sql<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_get_project'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.args).toBe('p_id uuid')
  })

  it('⚠ die Grants stehen unverändert — ein DROP+CREATE hätte sie mitgenommen', async () => {
    // Arbeitsregel 5: has_function_privilege statt eines Aufrufs als Rolle ohne Grant.
    for (const fn of [
      'public.admin_list_projects(integer, integer, uuid)',
      'public.admin_get_project(uuid)',
      'public.admin_create_project(text, uuid)',
    ]) {
      const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon',          $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role',  $1, 'execute') as svc`,
        [fn],
      )
      expect(row, fn).toEqual({ anon: false, auth: true, svc: false })
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Admin-Leser — segment und industry kommen wirklich an', () => {
  it('⚠ beide Wrapper liefern Segment und Branche — echt aufgerufen, nicht introspiziert', async () => {
    /*
     * Arbeitsregel 2. Ohne echten Aufruf bewiese dieser Block nur, dass es die Funktionen gibt —
     * und genau das war vorher auch schon wahr, während beide das Segment verschwiegen.
     */
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()

    const label = `B24 Segmenttest ${randomUUID()}`
    const projectId = await createProjectFor(kunde, label)
    await callAs(kunde, 'public.update_project_draft($1, $2, $3, $4)', [
      projectId,
      '{}',
      'betrieb',
      'hotel',
    ])

    const detail = await readAs<{
      status: string
      project: { customer_label: string; segment: string | null; industry: string | null }
    }>(admin, 'public.admin_get_project($1)', [projectId])
    expect(detail.status).toBe('ok')
    expect(detail.project.customer_label).toBe(label)
    expect(detail.project.segment).toBe('betrieb')
    expect(detail.project.industry).toBe('hotel')

    const list = await readAs<{
      status: string
      projects: { id: string; segment: string | null; industry: string | null }[]
    }>(admin, 'public.admin_list_projects($1, $2)', [200, 0])
    expect(list.status).toBe('ok')
    const row = list.projects.find((p) => p.id === projectId)
    expect(row, 'das eigene Projekt steht in der Liste').toBeDefined()
    expect(row!.segment).toBe('betrieb')
    expect(row!.industry).toBe('hotel')
  })

  it('⚠ NULL bleibt NULL — ein frisches Projekt bekommt kein erfundenes Segment', async () => {
    /*
     * Die Gegenrichtung, und sie trägt eine fachliche Aussage: `segment is null` heisst „das
     * Gespräch hat es noch nicht bestimmt", NICHT „privat". Ein Vorgabewert im Wrapper (oder in der
     * Ansicht) machte daraus eine Angabe, die niemand getroffen hat.
     */
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 ohne Segment ${randomUUID()}`)

    const detail = await readAs<{
      project: { segment: string | null; industry: string | null }
    }>(admin, 'public.admin_get_project($1)', [projectId])
    expect(detail.project.segment).toBeNull()
    expect(detail.project.industry).toBeNull()
  })

  it('admin_create_project legt an, und die Liste zeigt es ohne Account', async () => {
    // Der Schreibweg der neuen Oberfläche — ebenfalls echt aufgerufen, samt Abweisungspfad.
    const admin = await newUser()
    await makeAdmin(admin)

    const label = `B24 Adminprojekt ${randomUUID()}`
    const out = await callAs<{ status: string; project_id: string }>(
      admin,
      'public.admin_create_project($1)',
      [label],
    )
    expect(out.status).toBe('ok')
    createdProjects.push(out.project_id)

    const detail = await readAs<{
      project: { account_id: string | null; customer_label: string; created_by_email: string | null }
    }>(admin, 'public.admin_get_project($1)', [out.project_id])
    expect(detail.project.account_id).toBeNull()
    expect(detail.project.customer_label).toBe(label)
    expect(detail.project.created_by_email).toBe(admin.email)

    // Leerer Name wird abgewiesen, BEVOR eine Zeile entsteht.
    expect(await callAs(admin, 'public.admin_create_project($1)', ['   '])).toEqual({
      status: 'invalid_label',
    })
  })

  it('ein Nicht-Admin bekommt 42501 — auf allen drei Wegen', async () => {
    /*
     * Alle drei WERFEN, statt leer zu antworten (Muster admin_list_analyses, B14-1): eine leere
     * Liste ist hier die haeufigste ECHTE Antwort und darf nicht zugleich „kein Zugriff" heissen.
     *
     * Der Aufruf ist sicher im Sinn von Arbeitsregel 5, weil die aufrufende Rolle einen Grant
     * BESITZT (`authenticated`) und die Ablehnung im Funktionsrumpf per RAISE erfolgt — nicht auf
     * Grant-Ebene.
     */
    const kunde = await newUser()
    const faelle: [string, unknown[]][] = [
      ['public.admin_list_projects()', []],
      ['public.admin_get_project($1)', [randomUUID()]],
      ['public.admin_create_project($1)', ['egal']],
    ]
    for (const [call, params] of faelle) {
      await expect(readAs(kunde, call, params), call).rejects.toMatchObject({ code: '42501' })
    }
  })
})
