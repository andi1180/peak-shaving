// DB-Gate für den Zählpunkt: das Gerüst samt der zwei nachgezogenen Admin-Leser (B24, Teil 1
// Schritt 1; Migration 20260911090000) UND der Lastgang-Bezug samt seinen drei Wrappern
// (B24, Teil 1 Baustein 1; Migration 20260911120000). Fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.2/§2.3/§3.2.
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
//   * STILLER DATENVERLUST BEIM VERKLEINERN. `admin_set_metering_point_count` löscht Zeilen. Ohne
//     die Sperre gegen einen bereits gesetzten `source_document_id` nähme ein versehentliches
//     „setz auf 1" den gelesenen Lastgang mit — und zwar unbemerkt, weil die Funktion danach
//     fröhlich `ok` meldet. Die Sperre wird deshalb PROVOZIERT, nicht introspiziert.
//
//   * ZWEI FREMDSCHLÜSSEL MIT ENTGEGENGESETZTER AKTION. `project_id` kaskadiert (ein Zählpunkt ohne
//     Projekt ist keiner), `source_document_id` nullt (ein Zählpunkt ohne Quelldokument behält
//     seine gelesenen Angaben). Vertauscht nähme das Löschen eines Dokuments den Zählpunkt mit —
//     ein Datenverlust, den nichts meldet. Beide werden am VERHALTEN gemessen.
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
  it('⚠ trägt EXAKT die acht entschiedenen Spalten — eine neunte lässt diesen Test fallen', async () => {
    /*
     * Der eigentliche Zweck dieser Datei. Bis 20260911090000 war `metering_points` absichtlich
     * inhaltsleer; 20260911120000 hat sie erweitert — aber NUR um das, was ein Lastgang-Leser
     * tatsächlich liefert. Zählpunktnummer, Netzebene und Messvariante stehen NICHT in einer
     * Lastgang-Datei; eine Spalte dafür entschiede den offenen Punkt 1 des Deltas still, und zwar
     * an der Stelle, an der es am teuersten wäre.
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
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'project_id',
      'created_at',
      'interval_minutes',
      'covered_from',
      'covered_to',
      'gaps',
      'source_document_id',
    ])
    // ⚠ `gaps` ist NOT NULL mit Default `[]` — „keine Lücken gemessen" und „noch nichts gelesen"
    // unterscheidet `interval_minutes IS NULL`, nicht ein NULL-Array.
    expect(rows.map((r) => r.is_nullable)).toEqual([
      'NO',
      'NO',
      'NO',
      'YES',
      'YES',
      'YES',
      'NO',
      'YES',
    ])
    expect(rows.map((r) => r.data_type)).toEqual([
      'uuid',
      'uuid',
      'timestamp with time zone',
      'integer',
      'timestamp with time zone',
      'timestamp with time zone',
      'jsonb',
      'uuid',
    ])
  })

  it('⚠ source_document_id ist SET NULL, nicht CASCADE — ein gelöschtes Dokument löscht keinen Zählpunkt', async () => {
    const [row] = await sql<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'platform' and t.relname = 'metering_points' and c.contype = 'f'
          and pg_get_constraintdef(c.oid) like '%project_documents%'`,
    )
    expect(row!.def).toContain('REFERENCES platform.project_documents(id)')
    expect(row!.def).toContain('ON DELETE SET NULL')
  })

  it('project_id zeigt auf platform.projects und kaskadiert', async () => {
    /*
     * ⚠ Der Filter auf `projects` ist seit 20260911120000 nötig: die Tabelle trägt jetzt ZWEI
     * Fremdschlüssel, und ohne ihn entschiede die Reihenfolge von `pg_constraint`, welchen dieser
     * Test misst — er wäre dann mal grün und mal rot, ohne dass sich etwas geändert hätte.
     */
    const [row] = await sql<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'platform' and t.relname = 'metering_points' and c.contype = 'f'
          and pg_get_constraintdef(c.oid) like '%platform.projects(id)%'`,
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// B24 Teil 1 Baustein 1 — der Lastgang-Bezug (Migration 20260911120000)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** Legt ein Dokument am Projekt an (der echte Weg — `append_project_document`). */
async function createDocumentFor(user: TestUser, projectId: string, name: string): Promise<string> {
  const documentId = randomUUID()
  const out = await callAs<{ status: string }>(
    user,
    'public.append_project_document($1, $2, $3, $4)',
    [projectId, documentId, name, 'text/csv'],
  )
  expect(out.status).toBe('ok')
  return documentId
}

/** Die Zählpunkte eines Projekts, privilegiert gelesen — für Assertions gegen den Bestand. */
async function meteringPointsOf(projectId: string) {
  return sql<{
    id: string
    interval_minutes: number | null
    covered_from: string | null
    covered_to: string | null
    gaps: unknown
    source_document_id: string | null
  }>(
    `select id, interval_minutes, covered_from, covered_to, gaps, source_document_id
       from platform.metering_points
      where project_id = $1
      order by created_at, id`,
    [projectId],
  )
}

describe('B24 Lastgang-Bezug — die CHECKs am Schnitt', () => {
  it('interval_minutes lässt 15 und 60 zu und weist alles andere ab', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user, `B24 Intervall ${randomUUID()}`)
    await sql(`insert into platform.metering_points (project_id) values ($1)`, [projectId])

    for (const minutes of [15, 60]) {
      await sql(`update platform.metering_points set interval_minutes = $2 where project_id = $1`, [
        projectId,
        minutes,
      ])
    }
    // 30 min ist ein plausibles, aber nicht unterstütztes Intervall — genau der Fall, der ohne
    // CHECK still in die Tabelle liefe und erst im Rechenkern auffiele.
    await expect(
      sql(`update platform.metering_points set interval_minutes = 30 where project_id = $1`, [
        projectId,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('⚠ ein halber Zeitraum wird abgewiesen — eine Grenze allein ist keine Aussage', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user, `B24 Zeitraum ${randomUUID()}`)
    await sql(`insert into platform.metering_points (project_id) values ($1)`, [projectId])

    await expect(
      sql(`update platform.metering_points set covered_from = now() where project_id = $1`, [
        projectId,
      ]),
    ).rejects.toMatchObject({ code: '23514' })

    // Und verdrehte Grenzen ebenfalls: covered_to muss NACH covered_from liegen.
    await expect(
      sql(
        `update platform.metering_points
            set covered_from = now(), covered_to = now() - interval '1 day'
          where project_id = $1`,
        [projectId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('gaps ist NOT NULL, startet als leeres Array und nimmt nur Arrays an', async () => {
    const user = await newUser()
    const projectId = await createProjectFor(user, `B24 Lücken ${randomUUID()}`)
    await sql(`insert into platform.metering_points (project_id) values ($1)`, [projectId])

    const [fresh] = await meteringPointsOf(projectId)
    expect(fresh!.gaps).toEqual([])

    await expect(
      sql(`update platform.metering_points set gaps = '{"a":1}'::jsonb where project_id = $1`, [
        projectId,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('⚠ ein gelöschtes Dokument nullt den Verweis und LÄSST den Zählpunkt samt Angaben stehen', async () => {
    /*
     * Die Gegenrichtung zur Kaskade auf `projects`. Wäre hier `cascade` gesetzt, nähme das Löschen
     * eines Dokuments den Zählpunkt mit — und der Kunde verlöre eine Struktur, die er von Hand
     * anlegen liess, weil er eine Datei aufgeräumt hat.
     */
    const user = await newUser()
    const projectId = await createProjectFor(user, `B24 Quelle weg ${randomUUID()}`)
    const documentId = await createDocumentFor(user, projectId, 'lastgang.csv')
    await sql(`insert into platform.metering_points (project_id) values ($1)`, [projectId])
    const [point] = await meteringPointsOf(projectId)

    await sql(
      `update platform.metering_points
          set source_document_id = $2,
              interval_minutes = 15,
              covered_from = '2025-01-01T00:00:00Z',
              covered_to = '2026-01-01T00:00:00Z'
        where id = $1`,
      [point!.id, documentId],
    )

    await sql(`delete from platform.project_documents where id = $1`, [documentId])

    const [after] = await meteringPointsOf(projectId)
    expect(after, 'der Zählpunkt existiert noch').toBeDefined()
    expect(after!.source_document_id).toBeNull()
    // Die gelesenen Angaben bleiben — sie sind die letzte Aussage darüber, was einmal dastand.
    expect(after!.interval_minutes).toBe(15)
    expect(after!.covered_from).not.toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 admin_set_metering_point_count', () => {
  it('legt an, ist idempotent und wächst', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Anzahl ${randomUUID()}`)

    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 3]),
    ).toEqual({ status: 'ok', count: 3, created: 3, removed: 0 })
    expect(await meteringPointsOf(projectId)).toHaveLength(3)

    // Derselbe Aufruf ein zweites Mal legt NICHTS zusätzlich an.
    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 3]),
    ).toEqual({ status: 'ok', count: 3, created: 0, removed: 0 })
    expect(await meteringPointsOf(projectId)).toHaveLength(3)

    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 5]),
    ).toEqual({ status: 'ok', count: 5, created: 2, removed: 0 })
    expect(await meteringPointsOf(projectId)).toHaveLength(5)
  })

  it('verkleinert und entfernt dabei die ZULETZT angelegten', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Verkleinern ${randomUUID()}`)

    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 4])
    const before = await meteringPointsOf(projectId)
    expect(before).toHaveLength(4)

    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 2]),
    ).toEqual({ status: 'ok', count: 2, created: 0, removed: 2 })

    const after = await meteringPointsOf(projectId)
    expect(after).toHaveLength(2)
    // Die ÄLTESTEN zwei bleiben — die Reihenfolge ist deterministisch, nicht datenabhängig.
    expect(after.map((r) => r.id)).toEqual([before[0]!.id, before[1]!.id])
  })

  it('⚠ DIE GEFORDERTE POSITIV-KONTROLLE: Verkleinern mit gesetztem source_document_id wird abgelehnt', async () => {
    /*
     * Der eine Fall, für den die Funktion gebaut ist. Ohne die Sperre nähme ein versehentliches
     * „setz auf 1" den bereits gelesenen Lastgang mit — und die Funktion meldete danach `ok`.
     * Geprüft wird deshalb BEIDES: der Status UND dass tatsächlich nichts verschwunden ist.
     */
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Sperre ${randomUUID()}`)
    const documentId = await createDocumentFor(kunde, projectId, 'lastgang.csv')

    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 3])
    const points = await meteringPointsOf(projectId)
    expect(points).toHaveLength(3)

    // Der Lastgang landet auf dem JÜNGSTEN — also genau auf dem, den ein Verkleinern zuerst nähme.
    const out = await callAs<{ status: string }>(
      kunde,
      'public.set_metering_point_load_profile($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)',
      [
        points[2]!.id,
        documentId,
        15,
        '2025-01-01T00:00:00Z',
        '2026-01-01T00:00:00Z',
        JSON.stringify([]),
      ],
    )
    expect(out.status).toBe('ok')

    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1]),
    ).toEqual({ status: 'has_load_profile', count: 3, blocked: 1 })

    // ⚠ Und es ist WIRKLICH nichts verschwunden — der Status allein bewiese das nicht.
    const after = await meteringPointsOf(projectId)
    expect(after).toHaveLength(3)
    expect(after.map((r) => r.id)).toEqual(points.map((r) => r.id))
    expect(after[2]!.source_document_id).toBe(documentId)
  })

  it('⚠ GEGENPROBE: liegt der Lastgang auf einem BLEIBENDEN Zählpunkt, läuft das Verkleinern durch', () =>
    (async () => {
      /*
       * Ohne diese Richtung bliebe der Test oben auch dann grün, wenn die Funktion JEDES
       * Verkleinern ablehnte, sobald irgendwo ein Lastgang hängt — sie prüft aber gezielt die
       * BETROFFENEN Zeilen.
       */
      const admin = await newUser()
      await makeAdmin(admin)
      const kunde = await newUser()
      const projectId = await createProjectFor(kunde, `B24 Gegenprobe ${randomUUID()}`)
      const documentId = await createDocumentFor(kunde, projectId, 'lastgang.csv')

      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 3])
      const points = await meteringPointsOf(projectId)

      // Diesmal auf dem ÄLTESTEN — der bleibt beim Verkleinern auf 1 erhalten.
      await callAs(
        kunde,
        'public.set_metering_point_load_profile($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)',
        [
          points[0]!.id,
          documentId,
          15,
          '2025-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
          JSON.stringify([]),
        ],
      )

      expect(
        await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1]),
      ).toEqual({ status: 'ok', count: 1, created: 0, removed: 2 })

      const after = await meteringPointsOf(projectId)
      expect(after).toHaveLength(1)
      expect(after[0]!.id).toBe(points[0]!.id)
      expect(after[0]!.source_document_id).toBe(documentId)
    })())

  it('weist 0, negative Zahlen und die Tippfehler-Grenze ab — ohne eine Zeile anzulegen', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Grenzen ${randomUUID()}`)

    for (const count of [0, -1, 101]) {
      expect(
        await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, count]),
        `count=${count}`,
      ).toEqual({ status: 'invalid_count', max: 100 })
    }
    expect(await meteringPointsOf(projectId)).toHaveLength(0)

    // Die Grenze selbst ist zulässig — sonst wäre die Meldung („max: 100") falsch.
    expect(
      await callAs<{ status: string; count: number }>(
        admin,
        'public.admin_set_metering_point_count($1, $2)',
        [projectId, 100],
      ),
    ).toMatchObject({ status: 'ok', count: 100 })
  })

  it('ein unbekanntes Projekt liefert not_found statt eines rohen 23503', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [randomUUID(), 2]),
    ).toEqual({ status: 'not_found' })
  })

  it('⚠ ein Nicht-Admin bekommt 42501 — auch für sein EIGENES Projekt', async () => {
    /*
     * Die Zahl der Zählpunkte ist eine fachliche Frage, die der Fragenkatalog stellen soll; bis
     * dahin legt ein Mensch sie an. Wäre der Wrapper an `project_accessible` gehängt, entschiede
     * das Modell die Betriebsstruktur, bevor jemand entschieden hat, wie danach gefragt wird.
     *
     * Der Aufruf ist sicher im Sinn von Arbeitsregel 5: die Rolle HAT das Grant, die Ablehnung
     * erfolgt per RAISE im Rumpf.
     */
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Nicht-Admin ${randomUUID()}`)
    await expect(
      readAs(kunde, 'public.admin_set_metering_point_count($1, $2)', [projectId, 2]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 list_metering_points', () => {
  it('der Eigentümer sieht seine Zählpunkte, ÄLTESTE ZUERST', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Liste ${randomUUID()}`)
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 3])

    const out = await readAs<{
      status: string
      metering_points: { id: string; interval_minutes: number | null; gaps: unknown }[]
    }>(kunde, 'public.list_metering_points($1)', [projectId])

    expect(out.status).toBe('ok')
    expect(out.metering_points).toHaveLength(3)
    const bestand = await meteringPointsOf(projectId)
    expect(out.metering_points.map((p) => p.id)).toEqual(bestand.map((p) => p.id))
    // Ein frischer Zählpunkt sagt „noch nichts gelesen" — nicht „keine Lücken".
    expect(out.metering_points[0]!.interval_minutes).toBeNull()
    expect(out.metering_points[0]!.gaps).toEqual([])
  })

  it('ein Projekt ohne Zählpunkte liefert ok mit leerer Liste, nicht not_found', async () => {
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Leer ${randomUUID()}`)
    expect(await readAs(kunde, 'public.list_metering_points($1)', [projectId])).toEqual({
      status: 'ok',
      metering_points: [],
    })
  })

  it('⚠ ein FREMDES und ein unbekanntes Projekt liefern denselben Status', async () => {
    const kunde = await newUser()
    const fremder = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Fremd ${randomUUID()}`)

    expect(await readAs(fremder, 'public.list_metering_points($1)', [projectId])).toEqual({
      status: 'not_found',
    })
    expect(await readAs(fremder, 'public.list_metering_points($1)', [randomUUID()])).toEqual({
      status: 'not_found',
    })
  })

  it('ein Admin sieht das Projekt eines Kunden — project_accessible trägt beide', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Adminsicht ${randomUUID()}`)
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 2])

    const out = await readAs<{ status: string; metering_points: unknown[] }>(
      admin,
      'public.list_metering_points($1)',
      [projectId],
    )
    expect(out.status).toBe('ok')
    expect(out.metering_points).toHaveLength(2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 set_metering_point_load_profile', () => {
  /** Legt Projekt, Dokument und einen Zählpunkt an — der Ausgangspunkt jedes Falls hier. */
  async function fixture(label: string) {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `${label} ${randomUUID()}`)
    const documentId = await createDocumentFor(kunde, projectId, 'lastgang.csv')
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1])
    const [point] = await meteringPointsOf(projectId)
    return { admin, kunde, projectId, documentId, pointId: point!.id }
  }

  const GAPS = JSON.stringify([{ from: '2025-06-03T22:00:00.000Z', to: '2025-06-06T22:00:00.000Z' }])

  function write(user: TestUser, pointId: string, documentId: string, overrides: Partial<{
    interval: number
    from: string
    to: string
    gaps: string
  }> = {}) {
    return callAs<{ status: string; metering_point_id?: string }>(
      user,
      'public.set_metering_point_load_profile($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)',
      [
        pointId,
        documentId,
        overrides.interval ?? 15,
        overrides.from ?? '2025-01-01T00:00:00Z',
        overrides.to ?? '2026-01-01T00:00:00Z',
        overrides.gaps ?? GAPS,
      ],
    )
  }

  it('⚠ schreibt alle vier Angaben und den Quell-Bezug — echt aufgerufen, nicht introspiziert', async () => {
    const f = await fixture('B24 Schreiben')
    expect(await write(f.kunde, f.pointId, f.documentId)).toMatchObject({
      status: 'ok',
      metering_point_id: f.pointId,
    })

    const [row] = await meteringPointsOf(f.projectId)
    expect(row!.interval_minutes).toBe(15)
    expect(row!.source_document_id).toBe(f.documentId)
    expect(row!.gaps).toEqual([
      { from: '2025-06-03T22:00:00.000Z', to: '2025-06-06T22:00:00.000Z' },
    ])
    expect(new Date(row!.covered_from!).toISOString()).toBe('2025-01-01T00:00:00.000Z')
    expect(new Date(row!.covered_to!).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('ein zweiter Aufruf ERSETZT alle vier Angaben gemeinsam', async () => {
    const f = await fixture('B24 Ersetzen')
    await write(f.kunde, f.pointId, f.documentId)
    const zweites = await createDocumentFor(f.kunde, f.projectId, 'lastgang-neu.csv')

    expect(
      await write(f.kunde, f.pointId, zweites, {
        interval: 60,
        from: '2024-01-01T00:00:00Z',
        to: '2025-01-01T00:00:00Z',
        gaps: JSON.stringify([]),
      }),
    ).toMatchObject({ status: 'ok' })

    const [row] = await meteringPointsOf(f.projectId)
    expect(row!.interval_minutes).toBe(60)
    expect(row!.source_document_id).toBe(zweites)
    // ⚠ Die Lücken des VORIGEN Laufs stehen nicht mehr da — sonst gehörten sie zu einem anderen
    // Dokument als der Zeitraum daneben.
    expect(row!.gaps).toEqual([])
  })

  it('⚠ ein Dokument aus einem ANDEREN Projekt wird abgewiesen — der Fremdschlüssel sagt das nicht', async () => {
    const f = await fixture('B24 Fremddokument')
    // Zweites Projekt DESSELBEN Kunden: kein Zugriffsproblem, aber eine falsche Herkunft.
    const anderes = await createProjectFor(f.kunde, `B24 Anderes ${randomUUID()}`)
    const fremdesDokument = await createDocumentFor(f.kunde, anderes, 'fremd.csv')

    expect(await write(f.kunde, f.pointId, fremdesDokument)).toEqual({ status: 'unknown_document' })

    const [row] = await meteringPointsOf(f.projectId)
    expect(row!.source_document_id).toBeNull()
    expect(row!.interval_minutes).toBeNull()
  })

  it('ein unbekanntes Dokument liefert denselben Status wie ein fremdes', async () => {
    const f = await fixture('B24 Unbekanntes Dokument')
    expect(await write(f.kunde, f.pointId, randomUUID())).toEqual({ status: 'unknown_document' })
  })

  it('⚠ ein FREMDER Zählpunkt liefert not_found, und zwar VOR jeder Argument-Prüfung', async () => {
    /*
     * Die Reihenfolge ist die Aussage: käme zuerst `invalid_interval`, verriete die Antwort, dass
     * die Kennung existiert. Deshalb wird hier mit einem ABSICHTLICH ungültigen Intervall gerufen.
     */
    const f = await fixture('B24 Fremder Zählpunkt')
    const fremder = await newUser()
    expect(await write(fremder, f.pointId, f.documentId, { interval: 30 })).toEqual({
      status: 'not_found',
    })
    expect(await write(fremder, randomUUID(), f.documentId)).toEqual({ status: 'not_found' })
  })

  it('weist ein nicht unterstütztes Intervall und einen verdrehten Zeitraum benannt ab', async () => {
    const f = await fixture('B24 Argumente')
    expect(await write(f.kunde, f.pointId, f.documentId, { interval: 30 })).toEqual({
      status: 'invalid_interval',
    })
    expect(
      await write(f.kunde, f.pointId, f.documentId, {
        from: '2026-01-01T00:00:00Z',
        to: '2025-01-01T00:00:00Z',
      }),
    ).toEqual({ status: 'invalid_range' })
    expect(
      await write(f.kunde, f.pointId, f.documentId, { gaps: JSON.stringify({ a: 1 }) }),
    ).toEqual({ status: 'invalid_gaps' })

    // Nach drei Ablehnungen steht der Zählpunkt unverändert leer da.
    const [row] = await meteringPointsOf(f.projectId)
    expect(row!.interval_minutes).toBeNull()
    expect(row!.source_document_id).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Lastgang-Bezug — Grants der drei neuen Wrapper', () => {
  it('⚠ nur authenticated — anon und service_role bekommen NIRGENDS ein EXECUTE', async () => {
    // Arbeitsregel 5: has_function_privilege statt eines Aufrufs als Rolle ohne Grant.
    for (const fn of [
      'public.admin_set_metering_point_count(uuid, integer)',
      'public.list_metering_points(uuid)',
      'public.set_metering_point_load_profile(uuid, uuid, integer, timestamptz, timestamptz, jsonb)',
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

  it('alle drei sind SECURITY DEFINER mit leerem search_path', async () => {
    const rows = await sql<{ proname: string; prosecdef: boolean; config: string[] | null }>(
      `select p.proname, p.prosecdef, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_set_metering_point_count', 'list_metering_points',
                            'set_metering_point_load_profile')
        order by p.proname`,
    )
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(true)
      // `proconfig` trägt den Eintrag als GANZES Element (`search_path=""`), nicht als Teilstring.
      expect(row.config?.join('|'), row.proname).toContain('search_path=')
    }
  })

  it('⚠ die Tabellen-Rechtefläche ist unverändert leer — der Schreibweg läuft NUR über die Wrapper', async () => {
    const rows = await sql(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'metering_points'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    )
    expect(rows).toEqual([])
  })
})
