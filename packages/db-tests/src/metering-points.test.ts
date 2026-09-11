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
     *
     * ⚠ NACHGEZOGEN (Migration 20260911150000): `draft` ist dazugekommen — der laufende Entwurf ist
     * vom Projekt an den Zählpunkt gewandert, weil jedes Feld von `tariffParamsSchema` eine
     * Tarif-/Vertragsangabe ist und ein Vertrag je Zählpunkt geschlossen wird. Das ist KEINE
     * Aufweichung des Punktes oben: Zählpunktnummer, Netzebene und Messvariante als eigene SPALTEN
     * bleiben ausgeschlossen — eine Messvariante steht im Entwurf (offen, jsonb, korrigierbar) und
     * nicht im Schema (fest, typisiert, eine Entscheidung über den Betrieb-Zuschnitt).
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
      'draft',
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
      'NO',
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
      'jsonb',
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
    await callAs(kunde, 'public.update_project_segment_industry($1, $2, $3)', [projectId, 'betrieb', 'hotel'])

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

  it('⚠ DIE ZWEITE POSITIV-KONTROLLE: ein STANDARDPROFIL sperrt genauso — auch ohne Dokument', async () => {
    /*
     * Der Fall, für den diese Migration da ist. `set_metering_point_standard_profile` setzt
     * `source_document_id` ausdrücklich auf null — an der alten Bedingung lief ein erzeugtes
     * Profil deshalb durch die Sperre hindurch, und das Verkleinern meldete `ok`, während es
     * einen vollständigen Zeitraum mitnahm. Geprüft wird BEIDES: der Status UND dass wirklich
     * nichts verschwunden ist.
     */
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Sperre Standardprofil ${randomUUID()}`)

    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 3])
    const points = await meteringPointsOf(projectId)
    expect(points).toHaveLength(3)

    // Auf dem JÜNGSTEN — also genau auf dem, den ein Verkleinern zuerst nähme.
    expect(
      await callAs<{ status: string }>(
        kunde,
        'public.set_metering_point_standard_profile($1, $2, $3, $4)',
        [points[2]!.id, 15, '2024-12-31T23:00:00.000Z', '2025-12-31T23:00:00.000Z'],
      ),
    ).toMatchObject({ status: 'ok' })

    // ⚠ Die Voraussetzung des Tests, nicht bloss Beiwerk: OHNE Dokument, MIT Zeitraum. Trüge die
    // Zeile eine Quelle, prüfte der Test unten nur die alte Bedingung noch einmal.
    const [, , armed] = await meteringPointsOf(projectId)
    expect(armed!.source_document_id).toBeNull()
    expect(armed!.covered_from).not.toBeNull()

    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1]),
    ).toEqual({ status: 'has_load_profile', count: 3, blocked: 1 })

    const after = await meteringPointsOf(projectId)
    expect(after).toHaveLength(3)
    expect(after.map((r) => r.id)).toEqual(points.map((r) => r.id))
    expect(after[2]!.covered_from).not.toBeNull()
  })

  it('⚠ GEGENPROBE zur Ausweitung: ein LEERER Zählpunkt bleibt verkleinerbar', async () => {
    /*
     * Ohne diese Richtung bliebe der Test darüber auch dann grün, wenn die Bedingung versehentlich
     * jedes Verkleinern abwiese. Geprüft wird zusätzlich der Zaehlpunkt mit blossem ENTWURF: er
     * setzt `covered_from` NICHT und darf deshalb weiterhin fallen — die Sperre hängt an der
     * Datenlage des Zeitraums, nicht am Entwurf.
     */
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Leer bleibt frei ${randomUUID()}`)

    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 3])
    const points = await meteringPointsOf(projectId)

    // Der jüngste trägt einen Entwurf, aber keinen Zeitraum.
    expect(
      await callAs<{ status: string }>(
        kunde,
        'public.update_metering_point_draft($1, $2::jsonb)',
        [points[2]!.id, JSON.stringify({ annualConsumptionKwh: 4000, source: 'assumed' })],
      ),
    ).toMatchObject({ status: 'ok' })

    const [, , withDraft] = await meteringPointsOf(projectId)
    expect(withDraft!.source_document_id).toBeNull()
    expect(withDraft!.covered_from).toBeNull()

    expect(
      await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1]),
    ).toEqual({ status: 'ok', count: 1, created: 0, removed: 2 })

    const after = await meteringPointsOf(projectId)
    expect(after).toHaveLength(1)
    expect(after[0]!.id).toBe(points[0]!.id)
  })

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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// B24 Teil 1 — der RUECKWEG (Migration 20260911180000): einen eingelesenen Lastgang entfernen.
//
// ── WAS HIER SCHIEFGEHEN KANN, OHNE DASS ES AUFFAELLT ───────────────────────────────────────────
//
//   * DIE ANTWORT NENNT DAS DOKUMENT NICHT (MEHR). `admin_reset_metering_point_load_profile`
//     vernichtet mit demselben Aufruf den einzigen Weg vom Zaehlpunkt zu seiner Quelle. Liest die
//     Funktion den Verweis erst NACH dem UPDATE, kommt `document_id: null` zurueck — und der
//     Aufrufer haelt das fuer „da war nichts", raeumt nichts auf und hinterlaesst bei JEDEM
//     Entfernen ein Dokument samt Datei. Der Zaehlpunkt saehe dabei vollkommen richtig aus.
//
//   * DIE SPERRE GEGEN EIN NOCH BENUTZTES DOKUMENT FEHLT. `source_document_id` traegt
//     `on delete set null` — ein DELETE laeuft also anstandslos durch und nimmt dem verweisenden
//     Zaehlpunkt still seine Quelle. Der `in_use`-Guard wird deshalb PROVOZIERT, nicht
//     introspiziert.
//
//   * DAS ZURUECKSETZEN LAESST EINE DER FUENF SPALTEN STEHEN. Ein uebersehenes `gaps` hinge an der
//     naechsten hochgeladenen Datei — und `set_metering_point_load_profile` ueberschriebe es zwar,
//     aber im Zustand DAZWISCHEN stuende eine Luecke ohne Zeitraum. Geprueft wird der Bestand,
//     nicht der Status.
//
//   * DER ZAEHLPUNKT SELBST VERSCHWINDET. Entfernt wird der LASTGANG, nicht die Struktur, die ein
//     Mensch von Hand angelegt hat.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Lastgang entfernen — admin_reset_metering_point_load_profile', () => {
  /** Projekt mit einem Zaehlpunkt, der einen eingelesenen Lastgang traegt. */
  async function eingelesen(label: string) {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `${label} ${randomUUID()}`)
    const documentId = await createDocumentFor(kunde, projectId, 'lastgang.csv')
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1])
    const [point] = await meteringPointsOf(projectId)

    const out = await callAs<{ status: string }>(
      kunde,
      'public.set_metering_point_load_profile($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)',
      [
        point!.id,
        documentId,
        15,
        '2025-01-01T00:00:00Z',
        '2026-01-01T00:00:00Z',
        JSON.stringify([{ from: '2025-06-03T22:00:00.000Z', to: '2025-06-06T22:00:00.000Z' }]),
      ],
    )
    expect(out.status).toBe('ok')
    return { admin, kunde, projectId, documentId, pointId: point!.id }
  }

  async function documentsOf(projectId: string) {
    return sql<{ id: string; storage_path: string }>(
      `select id, storage_path from platform.project_documents where project_id = $1`,
      [projectId],
    )
  }

  it('⚠ nennt das Dokument samt Pfad UND setzt alle fuenf Spalten zurueck', async () => {
    const f = await eingelesen('B24 Zuruecksetzen')

    const out = await callAs<{
      status: string
      metering_point_id: string
      project_id: string
      document_id: string | null
      storage_path: string | null
    }>(f.admin, 'public.admin_reset_metering_point_load_profile($1)', [f.pointId])

    expect(out).toEqual({
      status: 'ok',
      metering_point_id: f.pointId,
      project_id: f.projectId,
      document_id: f.documentId,
      // ⚠ Der Pfad kommt aus der ZEILE, nicht aus einer zweiten Ableitung — der CHECK
      // project_documents_storage_path_derived haelt ihn auf <project_id>/<id> fest.
      storage_path: `${f.projectId}/${f.documentId}`,
    })

    // ⚠ Der Bestand, nicht der Status: alle fuenf gemeinsam, sonst stuende eine Luecke ohne Zeitraum.
    const [row] = await meteringPointsOf(f.projectId)
    expect(row, 'der Zaehlpunkt existiert noch').toBeDefined()
    expect(row!.source_document_id).toBeNull()
    expect(row!.interval_minutes).toBeNull()
    expect(row!.covered_from).toBeNull()
    expect(row!.covered_to).toBeNull()
    expect(row!.gaps).toEqual([])

    // Das Dokument ist damit NICHT weg — das ist Schritt (3) und ein eigener Aufruf.
    expect(await documentsOf(f.projectId)).toHaveLength(1)
  })

  it('⚠ DIE GEFORDERTE POSITIV-KONTROLLE: danach laesst sich erneut einlesen — keine Altlast', async () => {
    const f = await eingelesen('B24 Neu einlesen')
    await callAs(f.admin, 'public.admin_reset_metering_point_load_profile($1)', [f.pointId])
    await callAs(f.admin, 'public.admin_delete_metering_point_document($1, $2)', [
      f.pointId,
      f.documentId,
    ])
    expect(await documentsOf(f.projectId)).toHaveLength(0)

    // Eine ZWEITE Datei, wie nach einem echten Neu-Upload.
    const zweites = await createDocumentFor(f.kunde, f.projectId, 'lastgang-neu.csv')
    const out = await callAs<{ status: string }>(
      f.kunde,
      'public.set_metering_point_load_profile($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)',
      [f.pointId, zweites, 60, '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', JSON.stringify([])],
    )
    expect(out.status).toBe('ok')

    const [row] = await meteringPointsOf(f.projectId)
    expect(row!.source_document_id).toBe(zweites)
    expect(row!.interval_minutes).toBe(60)
    // ⚠ Und zwar OHNE die Luecke des ersten Laufs — sie gehoerte zu einer Datei, die es nicht gibt.
    expect(row!.gaps).toEqual([])
  })

  it('raeumt auch den Rest auf, den on-delete-set-null hinterlaesst', async () => {
    /*
     * Der reale Stand aus TEIL 1 der Migration 20260911120000: das Dokument ist direkt entfernt
     * worden, der Verweis ist genullt, die abgeleiteten Angaben stehen als „letzte Aussage". Ohne
     * diesen Fall bliebe ein Zaehlpunkt mit Zeitraum und ohne Quelle dauerhaft stehen.
     */
    const f = await eingelesen('B24 Rest')
    await sql(`delete from platform.project_documents where id = $1`, [f.documentId])

    const [vorher] = await meteringPointsOf(f.projectId)
    expect(vorher!.source_document_id).toBeNull()
    expect(vorher!.interval_minutes, 'die Angaben stehen noch da').toBe(15)

    const out = await callAs<{ status: string; document_id: string | null }>(
      f.admin,
      'public.admin_reset_metering_point_load_profile($1)',
      [f.pointId],
    )
    // `document_id: null` heisst „es gab nichts zu loeschen" — eine andere Aussage als ein Fehler.
    expect(out).toMatchObject({ status: 'ok', document_id: null })

    const [nachher] = await meteringPointsOf(f.projectId)
    expect(nachher!.interval_minutes).toBeNull()
    expect(nachher!.covered_from).toBeNull()
  })

  it('ein unbekannter Zaehlpunkt liefert not_found', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    expect(
      await callAs(admin, 'public.admin_reset_metering_point_load_profile($1)', [randomUUID()]),
    ).toEqual({ status: 'not_found' })
  })

  it('⚠ ein NICHT-Admin wird abgewiesen — auch der Eigentuemer des Projekts', async () => {
    /*
     * Die bewusste Abweichung vom Schreibweg daneben: `set_metering_point_load_profile` prueft
     * `project_accessible` und liesse den Kunden durch. Das Entfernen tut es nicht — ob ein KUNDE
     * eine abgelegte Datei wieder entfernen darf, hat niemand entschieden.
     */
    const f = await eingelesen('B24 Kein Admin')
    await expect(
      callAs(f.kunde, 'public.admin_reset_metering_point_load_profile($1)', [f.pointId]),
    ).rejects.toMatchObject({ code: '42501' })

    const fremder = await newUser()
    await expect(
      callAs(fremder, 'public.admin_reset_metering_point_load_profile($1)', [f.pointId]),
    ).rejects.toMatchObject({ code: '42501' })

    // Und es ist nichts geschehen.
    const [row] = await meteringPointsOf(f.projectId)
    expect(row!.source_document_id).toBe(f.documentId)
    expect(row!.interval_minutes).toBe(15)
  })

  it('⚠ nach dem Entfernen laesst sich wieder verkleinern — der Nebeneffekt, der gewollt ist', async () => {
    const f = await eingelesen('B24 Verkleinern wieder moeglich')
    // Ein zweiter Zaehlpunkt, damit es ueberhaupt etwas zu verkleinern gibt; der Lastgang liegt auf
    // dem AELTESTEN, ein Verkleinern auf 1 nimmt also den juengeren.
    await callAs(f.admin, 'public.admin_set_metering_point_count($1, $2)', [f.projectId, 2])
    const points = await meteringPointsOf(f.projectId)
    expect(points[0]!.id).toBe(f.pointId)

    // Lastgang auf den JUENGSTEN umhaengen, damit das Verkleinern blockiert.
    const zweites = await createDocumentFor(f.kunde, f.projectId, 'zweiter.csv')
    await callAs(
      f.kunde,
      'public.set_metering_point_load_profile($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)',
      [points[1]!.id, zweites, 15, '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', JSON.stringify([])],
    )
    expect(
      await callAs(f.admin, 'public.admin_set_metering_point_count($1, $2)', [f.projectId, 1]),
    ).toMatchObject({ status: 'has_load_profile' })

    await callAs(f.admin, 'public.admin_reset_metering_point_load_profile($1)', [points[1]!.id])

    expect(
      await callAs(f.admin, 'public.admin_set_metering_point_count($1, $2)', [f.projectId, 1]),
    ).toMatchObject({ status: 'ok', removed: 1 })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Lastgang entfernen — admin_delete_metering_point_document', () => {
  async function eingelesen(label: string) {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `${label} ${randomUUID()}`)
    const documentId = await createDocumentFor(kunde, projectId, 'lastgang.csv')
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1])
    const [point] = await meteringPointsOf(projectId)
    await callAs(
      kunde,
      'public.set_metering_point_load_profile($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)',
      [point!.id, documentId, 15, '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', JSON.stringify([])],
    )
    return { admin, kunde, projectId, documentId, pointId: point!.id }
  }

  async function documentCount(projectId: string): Promise<number> {
    const rows = await sql<{ n: string }>(
      `select count(*) as n from platform.project_documents where project_id = $1`,
      [projectId],
    )
    return Number(rows[0]!.n)
  }

  it('entfernt die Zeile, nachdem der Zaehlpunkt sie losgelassen hat', async () => {
    const f = await eingelesen('B24 Zeile weg')
    await callAs(f.admin, 'public.admin_reset_metering_point_load_profile($1)', [f.pointId])

    expect(
      await callAs(f.admin, 'public.admin_delete_metering_point_document($1, $2)', [
        f.pointId,
        f.documentId,
      ]),
    ).toEqual({ status: 'ok', document_id: f.documentId, project_id: f.projectId })

    expect(await documentCount(f.projectId)).toBe(0)
    // Der Zaehlpunkt ist geblieben — entfernt wird der LASTGANG, nicht die Struktur.
    expect(await meteringPointsOf(f.projectId)).toHaveLength(1)
  })

  it('⚠ DIE GEFORDERTE POSITIV-KONTROLLE: ein noch verwiesenes Dokument wird abgewiesen', async () => {
    /*
     * Ohne den Guard liefe das DELETE durch — `on delete set null` nimmt dem Zaehlpunkt still die
     * Quelle und laesst Zeitraum und Luecken als Aussage ueber eine Datei stehen, die es nicht mehr
     * gibt. Geprueft wird BEIDES: der Status UND dass wirklich nichts verschwunden ist.
     */
    const f = await eingelesen('B24 In Benutzung')

    expect(
      await callAs(f.admin, 'public.admin_delete_metering_point_document($1, $2)', [
        f.pointId,
        f.documentId,
      ]),
    ).toEqual({ status: 'in_use' })

    expect(await documentCount(f.projectId)).toBe(1)
    const [row] = await meteringPointsOf(f.projectId)
    expect(row!.source_document_id).toBe(f.documentId)
    expect(row!.interval_minutes).toBe(15)
  })

  it('⚠ ein Dokument aus einem ANDEREN Projekt wird abgewiesen — der Fremdschluessel sagt das nicht', async () => {
    const f = await eingelesen('B24 Fremddokument loeschen')
    await callAs(f.admin, 'public.admin_reset_metering_point_load_profile($1)', [f.pointId])

    // Zweites Projekt DESSELBEN Kunden: kein Zugriffsproblem, aber eine falsche Zugehoerigkeit.
    const anderes = await createProjectFor(f.kunde, `B24 Anderes ${randomUUID()}`)
    const fremdesDokument = await createDocumentFor(f.kunde, anderes, 'fremd.csv')

    expect(
      await callAs(f.admin, 'public.admin_delete_metering_point_document($1, $2)', [
        f.pointId,
        fremdesDokument,
      ]),
    ).toEqual({ status: 'unknown_document' })
    expect(await documentCount(anderes)).toBe(1)

    // Ein gar nicht existierendes Dokument liefert denselben Status.
    expect(
      await callAs(f.admin, 'public.admin_delete_metering_point_document($1, $2)', [
        f.pointId,
        randomUUID(),
      ]),
    ).toEqual({ status: 'unknown_document' })
  })

  it('ein unbekannter Zaehlpunkt liefert not_found — VOR der Dokumentpruefung', async () => {
    const f = await eingelesen('B24 Unbekannter Zaehlpunkt')
    expect(
      await callAs(f.admin, 'public.admin_delete_metering_point_document($1, $2)', [
        randomUUID(),
        f.documentId,
      ]),
    ).toEqual({ status: 'not_found' })
    expect(await documentCount(f.projectId)).toBe(1)
  })

  it('⚠ ein NICHT-Admin wird abgewiesen — auch der Eigentuemer des Projekts', async () => {
    const f = await eingelesen('B24 Loeschen kein Admin')
    await callAs(f.admin, 'public.admin_reset_metering_point_load_profile($1)', [f.pointId])

    await expect(
      callAs(f.kunde, 'public.admin_delete_metering_point_document($1, $2)', [
        f.pointId,
        f.documentId,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    expect(await documentCount(f.projectId)).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Lastgang entfernen — Grants der zwei neuen Wrapper', () => {
  it('⚠ nur authenticated — anon und service_role bekommen NIRGENDS ein EXECUTE', async () => {
    // Arbeitsregel 5: has_function_privilege statt eines Aufrufs als Rolle ohne Grant.
    for (const fn of [
      'public.admin_reset_metering_point_load_profile(uuid)',
      'public.admin_delete_metering_point_document(uuid, uuid)',
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

  it('beide sind SECURITY DEFINER mit leerem search_path', async () => {
    const rows = await sql<{ proname: string; prosecdef: boolean; config: string[] | null }>(
      `select p.proname, p.prosecdef, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_reset_metering_point_load_profile',
                            'admin_delete_metering_point_document')
        order by p.proname`,
    )
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(true)
      expect(row.config?.join('|'), row.proname).toContain('search_path=')
    }
  })

  it('⚠ es entsteht KEIN allgemeiner delete_project_document', async () => {
    /*
     * TEIL 9 der Migration 20260910090000 haelt fest, dass es ihn bewusst nicht gibt — der Weg hier
     * ist an den Zaehlpunkt gebunden. Ein spaeter „zur Vereinfachung" danebengestellter allgemeiner
     * Wrapper waere in keinem Build sichtbar.
     */
    const rows = await sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'delete_project_document'`,
    )
    expect(rows).toEqual([])
  })

  it('⚠ die Tabellen-Rechteflaeche von project_documents bleibt leer', async () => {
    // Der Loeschweg laeuft ausschliesslich ueber den Wrapper — kein Grant, auch nicht fuer
    // service_role (deren Weg zu den Dateien ist die Storage-API).
    const rows = await sql(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'project_documents'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    )
    expect(rows).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 set_metering_point_standard_profile', () => {
  /** Projekt und EIN Zählpunkt — ohne Dokument, denn genau darum geht es hier. */
  async function fixture(label: string) {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `${label} ${randomUUID()}`)
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1])
    const [point] = await meteringPointsOf(projectId)
    return { admin, kunde, projectId, pointId: point!.id }
  }

  const FROM = '2024-12-31T23:00:00.000Z'
  const TO = '2025-12-31T23:00:00.000Z'

  async function save(user: TestUser, pointId: string, from = FROM, to = TO, interval = 15) {
    return callAs<{ status: string }>(
      user,
      'public.set_metering_point_standard_profile($1, $2, $3, $4)',
      [pointId, interval, from, to],
    )
  }

  it('schreibt Intervall und Zeitraum — echt aufgerufen, nicht introspiziert', async () => {
    const { kunde, projectId, pointId } = await fixture('B24 Standardprofil')

    expect(await save(kunde, pointId)).toMatchObject({ status: 'ok' })

    const [row] = await meteringPointsOf(projectId)
    expect(row!.interval_minutes).toBe(15)
    expect(new Date(row!.covered_from!).toISOString()).toBe(FROM)
    expect(new Date(row!.covered_to!).toISOString()).toBe(TO)
    // ⚠ `gaps` ist KEIN Parameter — ein synthetisches Profil ist per Konstruktion lückenlos.
    expect(row!.gaps).toEqual([])
    /*
     * ⚠ Dass die Quelle hier `null` IST, ist an diesem Zählpunkt trivial — er hatte nie eine.
     * Die Zusage „setzt sie ausdrücklich auf null" prüft der Test darunter, an einem Zählpunkt mit
     * einem tatsächlich gesetzten Dokument. Gemessen: nimmt man die Zeile aus dem Wrapper, bleibt
     * DIESER Test grün und nur jener wird rot.
     */
    expect(row!.source_document_id).toBeNull()
  })

  it('⚠ ein gelesener Lastgang wird dabei ERSETZT, nicht ergänzt', async () => {
    /*
     * Der Zählpunkt trägt GENAU EINE Verbrauchsgrundlage. Bliebe die alte Quelle stehen, stünde ein
     * Zeitraum aus dem Generator neben einem Dokument, aus dem er nicht stammt — und die Herkunft
     * wäre für niemanden mehr auflösbar.
     */
    const { admin, kunde, projectId, pointId } = await fixture('B24 Ersetzt')
    const documentId = await createDocumentFor(kunde, projectId, 'lastgang.csv')
    await callAs(admin, 'public.set_metering_point_load_profile($1, $2, $3, $4, $5, $6)', [
      pointId,
      documentId,
      60,
      '2023-01-01T00:00:00Z',
      '2023-02-01T00:00:00Z',
      JSON.stringify([{ from: '2023-01-05T00:00:00Z', to: '2023-01-06T00:00:00Z' }]),
    ])
    const [before] = await meteringPointsOf(projectId)
    expect(before!.source_document_id).toBe(documentId)
    expect(before!.gaps).toHaveLength(1)

    expect(await save(kunde, pointId)).toMatchObject({ status: 'ok' })

    const [after] = await meteringPointsOf(projectId)
    expect(after!.source_document_id).toBeNull()
    expect(after!.interval_minutes).toBe(15)
    expect(after!.gaps).toEqual([])
  })

  it('⚠ das Dokument selbst bleibt in der Ablage stehen', async () => {
    /*
     * Der Wrapper löst nur den VERWEIS. Die Zeile in `project_documents` zu entfernen wäre ein
     * zweiter, unumkehrbarer Vorgang, den niemand ausgelöst hat — dafür gibt es den ausdrücklichen
     * Rückweg (`admin_delete_metering_point_document`).
     */
    const { admin, kunde, projectId, pointId } = await fixture('B24 Dokument bleibt')
    const documentId = await createDocumentFor(kunde, projectId, 'lastgang.csv')
    await callAs(admin, 'public.set_metering_point_load_profile($1, $2, $3, $4, $5, $6)', [
      pointId,
      documentId,
      15,
      FROM,
      TO,
      JSON.stringify([]),
    ])

    await save(kunde, pointId)

    const rows = await sql(`select id from platform.project_documents where id = $1`, [documentId])
    expect(rows).toHaveLength(1)
  })

  it.each([
    ['unbekannter Zählpunkt', () => randomUUID()],
  ])('%s → not_found', async (_name, id) => {
    const { kunde } = await fixture('B24 Unbekannt')
    expect(await save(kunde, id())).toEqual({ status: 'not_found' })
  })

  it('⚠ ein FREMDER Zählpunkt liefert denselben Status wie ein unbekannter', async () => {
    // Ein eigener Status verriete, dass die Kennung existiert.
    const { pointId } = await fixture('B24 Fremd')
    const fremder = await newUser()
    expect(await save(fremder, pointId)).toEqual({ status: 'not_found' })
  })

  it('ein Admin darf schreiben — project_accessible trägt beide', async () => {
    const { admin, pointId } = await fixture('B24 Adminschreibweg')
    expect(await save(admin, pointId)).toMatchObject({ status: 'ok' })
  })

  it.each([0, 1, 5, 30, 45, 61, -15])('Intervall %p → invalid_interval', async (interval) => {
    const { kunde, projectId, pointId } = await fixture('B24 Intervall')
    expect(await save(kunde, pointId, FROM, TO, interval)).toEqual({ status: 'invalid_interval' })
    // Nichts geschrieben — eine abgewiesene Angabe darf keinen halben Stand hinterlassen.
    expect((await meteringPointsOf(projectId))[0]!.covered_from).toBeNull()
  })

  it('60 Minuten sind zulässig — der CHECK der Tabelle kennt zwei Werte', async () => {
    const { kunde, pointId } = await fixture('B24 Stundenwerte')
    expect(await save(kunde, pointId, FROM, TO, 60)).toMatchObject({ status: 'ok' })
  })

  it('⚠ Ende vor oder auf dem Beginn → invalid_range', async () => {
    const { kunde, projectId, pointId } = await fixture('B24 Zeitraum')
    expect(await save(kunde, pointId, TO, FROM)).toEqual({ status: 'invalid_range' })
    expect(await save(kunde, pointId, FROM, FROM)).toEqual({ status: 'invalid_range' })
    expect((await meteringPointsOf(projectId))[0]!.covered_from).toBeNull()
  })

  it('⚠ die Zugriffsfrage kommt VOR der Form der Argumente', async () => {
    /*
     * Sonst verriete eine Argument-Fehlermeldung, dass die Kennung existiert — dieselbe Reihenfolge
     * wie überall in diesem Schema.
     */
    const fremder = await newUser()
    const { pointId } = await fixture('B24 Reihenfolge')
    expect(await save(fremder, pointId, TO, FROM, 7)).toEqual({ status: 'not_found' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 list_metering_points liefert den Entwurf mit', () => {
  it('⚠ der Entwurf reist mit — sonst stünde ein Zeitraum ohne seine Grundlage da', async () => {
    /*
     * Ein erzeugtes Standardprofil weist einen ZEITRAUM aus; die Zahl, aus der er entstand
     * (`annualConsumptionKwh` samt Herkunftsvermerk), steht ausschliesslich im Entwurf. Ohne sie
     * könnte die Station eine Schätzung nicht von einer abgelesenen Rechnungszahl unterscheiden.
     */
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Entwurf ${randomUUID()}`)
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1])
    const [point] = await meteringPointsOf(projectId)

    const draft = {
      annualConsumptionKwh: 3650,
      _provenance: { annualConsumptionKwh: { source: 'assumed', note: 'Geschätzt aus 2 Personen' } },
    }
    await callAs(kunde, 'public.update_metering_point_draft($1, $2)', [
      point!.id,
      JSON.stringify(draft),
    ])

    const out = await readAs<{
      status: string
      metering_points: { draft: Record<string, unknown> }[]
    }>(kunde, 'public.list_metering_points($1)', [projectId])

    expect(out.status).toBe('ok')
    expect(out.metering_points[0]!.draft).toEqual(draft)
  })

  it('ein leerer Entwurf kommt als leeres Objekt, nicht als null', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, `B24 Leerer Entwurf ${randomUUID()}`)
    await callAs(admin, 'public.admin_set_metering_point_count($1, $2)', [projectId, 1])

    const out = await readAs<{ metering_points: { draft: unknown }[] }>(
      kunde,
      'public.list_metering_points($1)',
      [projectId],
    )
    expect(out.metering_points[0]!.draft).toEqual({})
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Standardprofil — Grants und Form des neuen Wrappers', () => {
  const FN = 'public.set_metering_point_standard_profile(uuid, integer, timestamptz, timestamptz)'

  it('⚠ nur authenticated — anon und service_role bekommen KEIN EXECUTE', async () => {
    // Arbeitsregel 5: has_function_privilege statt eines Aufrufs als Rolle ohne Grant.
    const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role',  $1, 'execute') as svc`,
      [FN],
    )
    expect(row).toEqual({ anon: false, auth: true, svc: false })
  })

  it('SECURITY DEFINER mit leerem search_path', async () => {
    const [row] = await sql<{ prosecdef: boolean; config: string[] | null }>(
      `select p.prosecdef, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_metering_point_standard_profile'`,
    )
    expect(row!.prosecdef).toBe(true)
    expect(row!.config?.join('|')).toContain('search_path=')
  })

  it('⚠ es gibt GENAU EINE Fassung — kein DROP+CREATE hat eine Überladung hinterlassen', async () => {
    const rows = await sql(
      `select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_metering_point_standard_profile'`,
    )
    expect(rows).toHaveLength(1)
  })

  it('⚠ list_metering_points liefert `draft` im WIRKSAMEN Rumpf — nicht bloss in einer Migration', async () => {
    /*
     * Die Station zeigt den Jahresverbrauch aus dem Entwurf; ohne `draft` im Wrapper stünde dort ein
     * Zeitraum ohne seine Grundlage. Beim Bauen wurde die Spaltenliste in der ÄLTESTEN der drei
     * Migrationen nachgesehen (20260911120000, ohne `draft`) — und die Erweiterung beinahe ein
     * zweites Mal geschrieben, als `create or replace`, das eine neuere Fassung mit einer älteren
     * überschrieben hätte.
     *
     * Der Test fragt deshalb den TATSÄCHLICHEN Rumpf, nicht eine Datei: dieselbe Lehre wie
     * Arbeitsregel 1 (plpgsql prüft Rümpfe nicht beim Anlegen), nur eine Ebene früher.
     */
    const [row] = await sql<{ def: string }>(
      `select pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'list_metering_points'`,
    )
    expect(row!.def).toContain('mp.draft')
  })

  it('⚠ die Tabellen-Rechtefläche bleibt leer — der Schreibweg läuft NUR über die Wrapper', async () => {
    const rows = await sql(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'metering_points'
          and grantee in ('anon', 'authenticated', 'service_role')`,
    )
    expect(rows).toEqual([])
  })
})
