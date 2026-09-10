// DB-Gate für den Chat-Zustand (B24, zweiter Bauschritt)
// (Migration 20260910090000_create_project_chat_state.sql, fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.2, §3.1–§3.3 und §7).
//
// Der Vorgänger-Gate (`account-project-foundation.test.ts`) beweist den BESITZ. Dieser hier beweist,
// was daran hängt — und zwei Dinge, die es im Repo vorher nicht gab:
//
//   (1) DIE ZUSAGE AUS §3.3 IST EINE DATENBANK-EIGENSCHAFT, KEINE KONVENTION. Wählt der Nutzer
//       Weg (b) („der Chat trifft eine Annahme"), bleibt die Rückfrage an Martin OFFEN. Zwei CHECKs
//       machen die widersprüchlichen Kombinationen unmöglich, und beide werden hier mit einem
//       direkten UPDATE angegriffen — nicht bloss über die Wrapper, die sie ohnehin einhalten.
//   (2) DER ERSTE STORAGE-BUCKET DES REPOS IST WIRKLICH ZU. ⚠ Und zwar nur EINFACH gesichert: auf
//       `storage.objects` haben `anon` und `authenticated` die vollen Tabellenrechte (von Supabase
//       vergeben, nicht von uns) — die Abwesenheit einer Policy ist das Einzige, was den Bucket
//       verschliesst. Deshalb prüft dieses Gate nicht die Policy-ZAHL, sondern das VERHALTEN: beide
//       Rollen versuchen echt zu lesen und zu schreiben, mit `service_role` als Positivkontrolle.
//       Ein Test auf „0 Policies" bliebe grün, sobald jemand eine Policy für einen ANDEREN Bucket
//       ohne `bucket_id`-Bedingung ergänzt — genau der Fall, der hier wehtut.
//
// Dazu die Eigenschaften, die dieser Schritt neu einführt und die beim Klicken unsichtbar blieben:
//   (3) CASCADE STATT SET NULL — zum ersten Mal in diesem Schema. Mit ECHTEM Löschen gemessen, in
//       beide Richtungen: ein gelöschtes Projekt nimmt Verlauf, Dokumente und Rückfragen mit; ein
//       gelöschtes KONTO nimmt gar nichts mit (`answered_by`/`uploaded_by` werden genullt).
//   (4) DIE CASCADE-AUFLAGE: auf keiner der drei Tabellen darf ein Trigger sitzen, der DELETE
//       abweist — sonst wäre das Projekt unlöschbar. Gemessen als „0 nicht-interne Trigger".
//   (5) DIE `answered_by`-FALLE (B16-3e): kein CHECK darf die Spalte nennen, sonst ist das Konto des
//       Antwortenden unlöschbar. Mit einem echten `delete from auth.users` nachgewiesen.
//   (6) DER ABGELEITETE PFAD ist ein CHECK und keine Wrapper-Konvention — mit einem direkten INSERT
//       auf einen fremden Projektordner angegriffen.
//
// ── JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ──────────────────────────────────────────────
// Arbeitsregel 2: Introspektion beweist nur die Existenz einer Funktion, plpgsql prüft Funktionsrümpfe
// nicht beim Anlegen. Alle zwölf werden hier echt ausgeführt, die meisten auch auf ihren
// Abweisungspfaden.
//
// ── ARBEITSREGEL 5 ─────────────────────────────────────────────────────────────────────────────
// Fehlende Aufrufbarkeit wird mit `has_function_privilege` geprüft, nicht durch einen Aufruf (im
// CI-Lauf von B16-4a hat ein solcher den Postgres-Prozess mit Signal 11 beendet). Die Ablehnung des
// eingeloggten NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und die
// Ablehnung IM Rumpf ist genau die zu beweisende Eigenschaft. Die Storage-Versuche sind ebenfalls
// echt: dort haben beide Rollen das Tabellen-Grant, die Abweisung kommt von RLS.
//
// ── WIE AUFGERÄUMT WIRD ────────────────────────────────────────────────────────────────────────
// vitest fährt Testdateien parallel gegen dieselbe Datenbank. Jede Zähl-Assertion filtert deshalb auf
// die eigenen Zeilen-IDs oder misst Deltas (Muster B2-2); gelöscht werden am Ende ausschliesslich die
// eigenen Projekte (die drei neuen Tabellen hängen per CASCADE daran), Accounts und Konten.

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

/** Die zwölf public-Wrapper, die dieser Bauschritt neu anlegt. */
const WRAPPER_SIGNATURES = {
  get_project: 'public.get_project(uuid)',
  // ⚠ NACHGEZOGEN (Migration 20260910150000): der vierte Parameter `p_industry` ist per DROP+CREATE
  // dazugekommen. Die exakte Signatur bleibt gepinnt — sie ist die Absicherung dagegen, dass eine
  // zweite Überladung daneben entsteht, die ein Aufruf mit weniger Argumenten still trifft.
  update_project_draft: 'public.update_project_draft(uuid, jsonb, text, text)',
  append_project_message: 'public.append_project_message(uuid, text, jsonb)',
  list_project_messages: 'public.list_project_messages(uuid, integer, integer)',
  append_project_document: 'public.append_project_document(uuid, uuid, text, text)',
  list_project_documents: 'public.list_project_documents(uuid, integer, integer)',
  get_project_document: 'public.get_project_document(uuid)',
  append_open_question: 'public.append_open_question(uuid, text, text, text)',
  list_open_questions: 'public.list_open_questions(uuid, text, integer, integer)',
  resolve_open_question: 'public.resolve_open_question(uuid, text, text, text)',
  admin_list_open_questions: 'public.admin_list_open_questions(text, integer, integer)',
  admin_answer_open_question: 'public.admin_answer_open_question(uuid, text)',
} as const

const BUCKET = 'project-documents'

const createdUsers: string[] = []
const createdProjects: string[] = []
const createdAccounts: string[] = []

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

async function createProjectFor(user: TestUser, label = `B24 Chat ${randomUUID()}`) {
  const out = await callAs<{ status: string; project_id: string; account_id: string }>(
    user,
    'public.create_my_project($1)',
    [label],
  )
  expect(out.status).toBe('ok')
  createdProjects.push(out.project_id)
  createdAccounts.push(out.account_id)
  return { projectId: out.project_id, accountId: out.account_id, label }
}

async function askQuestion(user: TestUser, projectId: string, question = 'Welcher Leistungspreis?') {
  const out = await callAs<{ status: string; question_id: string }>(
    user,
    'public.append_open_question($1, $2)',
    [projectId, question],
  )
  expect(out.status).toBe('ok')
  return out.question_id
}

/** Eine Zeile aus platform.project_open_questions, privilegiert gelesen. */
async function questionRow(id: string) {
  const [row] = await sql<{
    status: string
    resolution_kind: string | null
    resolution_value: string | null
    assumption_note: string | null
    answered_by: string | null
    answered_at: string | null
  }>(
    `select status, resolution_kind, resolution_value, assumption_note, answered_by, answered_at
       from platform.project_open_questions where id = $1`,
    [id],
  )
  return row!
}

beforeAll(assertStackReachable)

afterEach(async () => {
  // Projekte zuerst — Verlauf, Dokumente und Rückfragen hängen per CASCADE daran und verschwinden
  // mit ihnen. Danach Accounts, danach Konten. Ausschliesslich die eigenen.
  if (createdProjects.length > 0) {
    await sql(`delete from platform.projects where id = any($1::uuid[])`, [createdProjects])
    createdProjects.length = 0
  }
  if (createdAccounts.length > 0) {
    await sql(`delete from platform.accounts where id = any($1::uuid[])`, [createdAccounts])
    createdAccounts.length = 0
  }
  for (const id of createdUsers.splice(0)) await deleteUser(id)
})

afterAll(async () => {
  await pool.end()
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — Schema und Rechtefläche', () => {
  it('alle drei Tabellen existieren mit RLS und OHNE Policy', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean; policies: number }>(
      `select c.relname,
              c.relrowsecurity,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'platform' and p.tablename = c.relname) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform'
          and c.relname in ('project_messages', 'project_documents', 'project_open_questions')
        order by c.relname`,
    )
    expect(rows.map((r) => r.relname)).toEqual([
      'project_documents',
      'project_messages',
      'project_open_questions',
    ])
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true)
      expect(r.policies).toBe(0)
    }
  })

  it('KEIN Tabellen-Grant für irgendeine Rolle — auch nicht für service_role', async () => {
    const rows = await sql(
      `select grantee, table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'platform'
          and table_name in ('project_messages', 'project_documents', 'project_open_questions')
          and grantee in ('anon', 'authenticated', 'service_role')`,
    )
    expect(rows).toEqual([])
  })

  it('EXECUTE auf den zwölf Wrappern: exakt authenticated', async () => {
    for (const [name, sig] of Object.entries(WRAPPER_SIGNATURES)) {
      const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
        [sig],
      )
      expect({ name, ...row }).toEqual({ name, anon: false, auth: true, svc: false })
    }
  })

  it('platform.project_accessible ist für keine Client-Rolle aufrufbar', async () => {
    const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', 'platform.project_accessible(uuid)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'platform.project_accessible(uuid)', 'EXECUTE') as auth,
              has_function_privilege('service_role', 'platform.project_accessible(uuid)', 'EXECUTE') as svc`,
    )
    expect(row).toEqual({ anon: false, auth: false, svc: false })
  })

  it('die Fremdschlüssel sind gepinnt: zum Projekt CASCADE, zu auth.users SET NULL', async () => {
    const rows = await sql<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where contype = 'f'
          and conrelid in ('platform.project_messages'::regclass,
                           'platform.project_documents'::regclass,
                           'platform.project_open_questions'::regclass)
        order by conname`,
    )
    // ⚠ Die NAMEN sind gepinnt, nicht bloss die Anzahl (Muster account-project-foundation): ein
    // weiterer Fremdschlüssel soll eine bewusste Entscheidung an dieser Stelle sein — ob er CASCADE
    // oder SET NULL trägt, entscheidet sich beim Anlegen der Spalte, nicht später.
    expect(rows.map((r) => r.conname)).toEqual([
      'project_documents_project_id_fkey',
      'project_documents_uploaded_by_fkey',
      'project_messages_project_id_fkey',
      'project_open_questions_answered_by_fkey',
      'project_open_questions_project_id_fkey',
    ])
    for (const r of rows) {
      const expected = r.conname.includes('project_id_fkey') ? 'ON DELETE CASCADE' : 'ON DELETE SET NULL'
      expect({ conname: r.conname, ok: r.def.includes(expected) }).toEqual({
        conname: r.conname,
        ok: true,
      })
    }
  })

  it('⚠ KEIN nicht-interner Trigger auf den drei Tabellen — sonst bräche das Kaskadenlöschen', async () => {
    // Die Auflage aus TEIL 2 der Migration: ein Append-only-Trigger, der DELETE abweist, machte das
    // Projekt unlöschbar. Interne RI-Trigger (die Fremdschlüssel selbst) sind ausgenommen.
    const rows = await sql<{ relname: string; tgname: string }>(
      `select c.relname, t.tgname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform'
          and c.relname in ('project_messages', 'project_documents', 'project_open_questions')
          and not t.tgisinternal`,
    )
    expect(rows).toEqual([])
  })

  it('platform.projects trägt segment (nullable) und draft (not null, default {})', async () => {
    const cols = await sql<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `select column_name, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'platform' and table_name = 'projects'
          and column_name in ('segment', 'draft')
        order by column_name`,
    )
    expect(cols).toEqual([
      { column_name: 'draft', is_nullable: 'NO', column_default: `'{}'::jsonb` },
      { column_name: 'segment', is_nullable: 'YES', column_default: null },
    ])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — der Storage-Bucket ist zu', () => {
  it('der Bucket existiert, ist PRIVAT und trägt die Grössen-Rücklage', async () => {
    const [row] = await sql<{
      id: string
      public: boolean | null
      file_size_limit: string | null
    }>(`select id, public, file_size_limit from storage.buckets where id = $1`, [BUCKET])
    expect(row).toBeDefined()
    // Ein öffentlicher Bucket hätte je Objekt eine erratbare URL und damit einen Lesepfad an jeder
    // Prüfung vorbei — genau das, was Prinzip 4 für Verbrauchsdaten ausschliesst.
    expect(row!.public).toBe(false)
    expect(Number(row!.file_size_limit)).toBe(20 * 1024 * 1024)
  })

  it('⚠ anon und authenticated können im Bucket weder LESEN noch SCHREIBEN — echt versucht', async () => {
    const user = await newUser()
    const objectName = `${randomUUID()}/${randomUUID()}`

    // ── Positivkontrolle zuerst: mit service_role (rolbypassrls) geht es. Ohne sie bewiese ein
    // fehlgeschlagener Schreibversuch nichts — er könnte auch an einer kaputten Spaltenliste liegen.
    const inserted = await runAs({ role: 'service_role', commit: false }, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into storage.objects (bucket_id, name) values ($1, $2) returning id`,
        [BUCKET, objectName],
      )
      // Im selben (zurückgerollten) Kontext auch lesen — service_role sieht das Objekt.
      const { rows: seen } = await c.query(
        `select 1 from storage.objects where bucket_id = $1 and name = $2`,
        [BUCKET, objectName],
      )
      expect(seen.length).toBe(1)
      return rows[0]!.id
    })
    expect(inserted).toBeTruthy()

    // ── anon und authenticated: beide HABEN das Tabellen-Grant auf storage.objects (von Supabase
    // vergeben). Die Abweisung kommt deshalb von RLS, und genau das wird hier gemessen — kein
    // has_table_privilege, sondern der echte Versuch.
    for (const ctx of [
      { role: 'anon' as const, userId: undefined },
      { role: 'authenticated' as const, userId: user.id },
    ]) {
      await expect(
        runAs(ctx, async (c) => {
          await c.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
            BUCKET,
            `${randomUUID()}/${randomUUID()}`,
          ])
        }),
      ).rejects.toMatchObject({ code: '42501' })

      // Lesen wirft nicht, es liefert einfach nichts — RLS filtert, statt abzulehnen. Beides ist
      // „kein Zugriff", und beide Formen gehören geprüft.
      const visible = await runAs(ctx, async (c) => {
        const { rows } = await c.query<{ n: string }>(
          `select count(*) as n from storage.objects where bucket_id = $1`,
          [BUCKET],
        )
        return Number(rows[0]!.n)
      })
      expect({ role: ctx.role, visible }).toEqual({ role: ctx.role, visible: 0 })
    }

    // ── Auch der BUCKET selbst ist für beide unsichtbar: sonst wäre allein seine Existenz eine
    // Auskunft darüber, dass es Kundendokumente gibt.
    for (const ctx of [
      { role: 'anon' as const, userId: undefined },
      { role: 'authenticated' as const, userId: user.id },
    ]) {
      const seen = await runAs(ctx, async (c) => {
        const { rows } = await c.query<{ n: string }>(
          `select count(*) as n from storage.buckets where id = $1`,
          [BUCKET],
        )
        return Number(rows[0]!.n)
      })
      expect({ role: ctx.role, seen }).toEqual({ role: ctx.role, seen: 0 })
    }
  })

  it('⚠ service_role hat auf KEINEN der zwölf Wrapper Zugriff — sie trägt nur Bytes, sie entscheidet nichts', async () => {
    // Das ist die Kehrseite des Storage-Wegs: der service_role-Schlüssel kommt an die Dateien, aber
    // an keine Zugriffsentscheidung. Jede Ja/Nein-Frage fällt vorher in der Datenbank gegen
    // auth.uid(). Ohne diese Zusage wäre der Schlüssel ein Generalschlüssel über Kundengrenzen.
    for (const sig of Object.values(WRAPPER_SIGNATURES)) {
      const [row] = await sql<{ svc: boolean }>(
        `select has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
        [sig],
      )
      expect({ sig, svc: row!.svc }).toEqual({ sig, svc: false })
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — Eigentum und Fremdzugriff', () => {
  it('get_project: eigenes ok, fremdes und unbekanntes liefern DENSELBEN Status', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const { projectId } = await createProjectFor(owner, 'Sichtbar für den Eigentümer')

    const ok = await readAs<{ status: string; project: Record<string, unknown> }>(
      owner,
      'public.get_project($1)',
      [projectId],
    )
    expect(ok.status).toBe('ok')
    expect(ok.project.id).toBe(projectId)
    // Kundensicht: die Kennung eines internen Kontos hat hier nichts verloren (Vorgabe des
    // Fundaments am Spaltenkommentar von created_by).
    expect(Object.keys(ok.project)).not.toContain('created_by')
    expect(ok.project.draft).toEqual({})
    expect(ok.project.segment).toBeNull()

    expect(await readAs(stranger, 'public.get_project($1)', [projectId])).toEqual({
      status: 'not_found',
    })
    expect(await readAs(owner, 'public.get_project($1)', [randomUUID()])).toEqual({
      status: 'not_found',
    })
  })

  it('ein Admin erreicht ein fremdes Projekt über GENAU DIESELBEN Wrapper', async () => {
    const owner = await newUser()
    const admin = await newAdmin()
    const { projectId } = await createProjectFor(owner, 'Admin sieht mit')

    expect((await readAs<{ status: string }>(admin, 'public.get_project($1)', [projectId])).status).toBe('ok')
    expect(
      (await readAs<{ status: string }>(admin, 'public.list_project_messages($1)', [projectId])).status,
    ).toBe('ok')
    expect(
      (await readAs<{ status: string }>(admin, 'public.list_open_questions($1)', [projectId])).status,
    ).toBe('ok')
  })

  it('ALLE projektbezogenen Wrapper weisen ein fremdes Projekt mit not_found ab', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const { projectId } = await createProjectFor(owner, 'Nur für den Eigentümer')

    const calls: [string, unknown[]][] = [
      ['public.get_project($1)', [projectId]],
      ['public.update_project_draft($1, $2)', [projectId, JSON.stringify({ x: 1 })]],
      ['public.append_project_message($1, $2, $3)', [projectId, 'user', JSON.stringify([{ type: 'text' }])]],
      ['public.list_project_messages($1)', [projectId]],
      ['public.append_project_document($1, $2, $3, $4)', [projectId, randomUUID(), 'x.pdf', 'application/pdf']],
      ['public.list_project_documents($1)', [projectId]],
      ['public.append_open_question($1, $2)', [projectId, 'Fremde Frage']],
      ['public.list_open_questions($1)', [projectId]],
    ]
    for (const [call, params] of calls) {
      expect({ call, out: await readAs(stranger, call, params) }).toEqual({
        call,
        out: { status: 'not_found' },
      })
    }

    // Und es ist nachweislich NICHTS entstanden — die Ablehnung liegt vor jedem Schreibvorgang.
    const [n] = await sql<{ m: number; d: number; q: number }>(
      `select (select count(*)::int from platform.project_messages where project_id = $1) as m,
              (select count(*)::int from platform.project_documents where project_id = $1) as d,
              (select count(*)::int from platform.project_open_questions where project_id = $1) as q`,
      [projectId],
    )
    expect(n).toEqual({ m: 0, d: 0, q: 0 })
  })

  it('get_project_document: fremd und unbekannt liefern denselben Status', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const { projectId } = await createProjectFor(owner)
    const docId = randomUUID()
    await callAs(owner, 'public.append_project_document($1, $2, $3, $4)', [
      projectId,
      docId,
      'Jahresrechnung_2025.pdf',
      'application/pdf',
    ])

    expect((await readAs<{ status: string }>(owner, 'public.get_project_document($1)', [docId])).status).toBe('ok')
    expect(await readAs(stranger, 'public.get_project_document($1)', [docId])).toEqual({
      status: 'not_found',
    })
    expect(await readAs(owner, 'public.get_project_document($1)', [randomUUID()])).toEqual({
      status: 'not_found',
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — Verlauf und Entwurf', () => {
  it('append_project_message: alle vier Rollen, Abweisungen benannt', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)

    for (const role of ['user', 'assistant', 'tool_call', 'tool_result']) {
      const out = await callAs<{ status: string }>(
        user,
        'public.append_project_message($1, $2, $3)',
        [projectId, role, JSON.stringify([{ type: 'text', text: role }])],
      )
      expect({ role, status: out.status }).toEqual({ role, status: 'ok' })
    }

    // `system` ist in der Messages-API kein Rollen-Wert, sondern ein eigener Parameter — ihn hier
    // durchzulassen hiesse, beim Wiedereinspielen einen Fehler zu erzeugen.
    expect(
      await readAs(user, 'public.append_project_message($1, $2, $3)', [
        projectId,
        'system',
        JSON.stringify([{ type: 'text' }]),
      ]),
    ).toEqual({ status: 'invalid_role' })

    // Ein Objekt statt eines Block-Arrays: an der Grenze abgewiesen, nicht später im Iterator.
    expect(
      await readAs(user, 'public.append_project_message($1, $2, $3)', [
        projectId,
        'user',
        JSON.stringify({ type: 'text' }),
      ]),
    ).toEqual({ status: 'invalid_content' })

    expect(
      await readAs(user, 'public.append_project_message($1, $2, $3)', [projectId, 'user', '[]']),
    ).toEqual({ status: 'empty_content' })

    // Genau die vier gültigen sind entstanden, keine der drei Abweisungen.
    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.project_messages where project_id = $1`,
      [projectId],
    )
    expect(n!.n).toBe(4)
  })

  it('⚠ list_project_messages liefert ÄLTESTE ZUERST — der Verlauf wird wiedereingespielt', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)

    for (const text of ['erste', 'zweite', 'dritte']) {
      await callAs(user, 'public.append_project_message($1, $2, $3)', [
        projectId,
        'user',
        JSON.stringify([{ type: 'text', text }]),
      ])
    }

    const out = await readAs<{
      status: string
      total: number
      messages: { content: { text: string }[] }[]
    }>(user, 'public.list_project_messages($1)', [projectId])
    expect(out.status).toBe('ok')
    expect(out.total).toBe(3)
    // Ein Gespräch in umgekehrter Reihenfolge ist kein Gespräch.
    expect(out.messages.map((m) => m.content[0]!.text)).toEqual(['erste', 'zweite', 'dritte'])

    // Die Gesamtzahl ist die Grundlage der „letzte n Turns"-Rechnung und darf nicht die Seitengrösse
    // sein: mit limit 1 bleibt sie 3.
    const page = await readAs<{ total: number; messages: { content: { text: string }[] }[] }>(
      user,
      'public.list_project_messages($1, $2, $3)',
      [projectId, 1, 2],
    )
    expect(page.total).toBe(3)
    expect(page.messages.map((m) => m.content[0]!.text)).toEqual(['dritte'])
  })

  it('list_project_messages deckelt bei 500 und gibt die Gesamtzahl getrennt', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    await callAs(user, 'public.append_project_message($1, $2, $3)', [
      projectId,
      'user',
      JSON.stringify([{ type: 'text', text: 'x' }]),
    ])
    const out = await readAs<{ total: number; messages: unknown[] }>(
      user,
      'public.list_project_messages($1, $2)',
      [projectId, 10_000],
    )
    // Ein durchgereichtes Limit machte die Obergrenze zur Empfehlung; hier ist sie eine Zusage.
    expect(out.messages.length).toBeLessThanOrEqual(500)
    expect(typeof out.total).toBe('number')
  })

  it('update_project_draft ERSETZT den Entwurf, statt ihn zu verschmelzen', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)

    await callAs(user, 'public.update_project_draft($1, $2)', [
      projectId,
      JSON.stringify({ energyPriceCtPerKwh: 25, meteringVariant: 'mit_leistungsmessung' }),
    ])
    let out = await readAs<{ project: { draft: Record<string, unknown> } }>(
      user,
      'public.get_project($1)',
      [projectId],
    )
    expect(out.project.draft).toEqual({
      energyPriceCtPerKwh: 25,
      meteringVariant: 'mit_leistungsmessung',
    })

    // Der eigentliche Nachweis: ein Schlüssel VERSCHWINDET wieder. Eine flache Verschmelzung könnte
    // das nicht — und genau diese Bewegung löst eine Korrektur im Gespräch aus.
    await callAs(user, 'public.update_project_draft($1, $2)', [
      projectId,
      JSON.stringify({ energyPriceCtPerKwh: 30 }),
    ])
    out = await readAs(user, 'public.get_project($1)', [projectId])
    expect(out.project.draft).toEqual({ energyPriceCtPerKwh: 30 })
  })

  it('p_segment null heisst UNVERÄNDERT, nicht löschen', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)

    await callAs(user, 'public.update_project_draft($1, $2, $3)', [projectId, '{}', 'betrieb'])
    await callAs(user, 'public.update_project_draft($1, $2)', [projectId, JSON.stringify({ a: 1 })])

    const out = await readAs<{ project: { segment: string | null } }>(
      user,
      'public.get_project($1)',
      [projectId],
    )
    // Ein einmal bestimmtes Segment verliert man nicht dadurch, dass ein Aufrufer den Parameter
    // weglässt (Lesart capture_lead, nicht admin_update_lead — B2-1).
    expect(out.project.segment).toBe('betrieb')
  })

  it('ungültiger Entwurf und ungültiges Segment werden als STATUS abgewiesen', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)

    // Ein roher 23514 aus dem CHECK trüge keinen Feldbezug, den eine Oberfläche anzeigen könnte.
    expect(
      await readAs(user, 'public.update_project_draft($1, $2)', [projectId, JSON.stringify([1, 2])]),
    ).toEqual({ status: 'invalid_draft' })
    expect(
      await readAs(user, 'public.update_project_draft($1, $2, $3)', [projectId, '{}', 'hotel']),
    ).toEqual({ status: 'invalid_segment' })

    const [row] = await sql<{ draft: unknown; segment: string | null }>(
      `select draft, segment from platform.projects where id = $1`,
      [projectId],
    )
    expect(row).toEqual({ draft: {}, segment: null })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — Dokumente', () => {
  it('der Pfad wird ABGELEITET und ist im Bestand nachprüfbar', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const docId = randomUUID()

    const out = await callAs<{ status: string; document_id: string; storage_path: string }>(
      user,
      'public.append_project_document($1, $2, $3, $4)',
      [projectId, docId, 'Jahresrechnung 2025.pdf', 'application/pdf'],
    )
    expect(out.status).toBe('ok')
    expect(out.document_id).toBe(docId)
    expect(out.storage_path).toBe(`${projectId}/${docId}`)

    const [row] = await sql<{ storage_path: string; uploaded_by: string }>(
      `select storage_path, uploaded_by from platform.project_documents where id = $1`,
      [docId],
    )
    expect(row!.storage_path).toBe(`${projectId}/${docId}`)
    expect(row!.uploaded_by).toBe(user.id)
  })

  it('⚠ der CHECK verhindert einen Pfad in einen FREMDEN Projektordner — direkt angegriffen', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const mine = await createProjectFor(owner, 'Mein Projekt')
    const theirs = await createProjectFor(stranger, 'Fremdes Projekt')
    const docId = randomUUID()

    // Nicht über den Wrapper (der bildet den Pfad ohnehin selbst), sondern als privilegiertes,
    // direktes INSERT — so würde ein künftiger Wrapper aussehen, der den Pfad als Parameter nähme.
    // Der CHECK ist die zweite, unabhängige Schicht darüber.
    await expect(
      sql(
        `insert into platform.project_documents
           (id, project_id, storage_path, original_filename, content_type)
         values ($1, $2, $3, 'x.pdf', 'application/pdf')`,
        [docId, mine.projectId, `${theirs.projectId}/${docId}`],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.project_documents where id = $1`,
      [docId],
    )
    expect(n!.n).toBe(0)
  })

  it('dieselbe Kennung zweimal: duplicate_document statt eines rohen 23505', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const docId = randomUUID()
    const args = [projectId, docId, 'Rechnung.pdf', 'application/pdf']

    expect(
      (await callAs<{ status: string }>(user, 'public.append_project_document($1, $2, $3, $4)', args))
        .status,
    ).toBe('ok')
    // Ein zweiter Aufruf ist ein WIEDERHOLTER Versuch, kein Fehler des Nutzers — und er darf keine
    // zweite Zeile erzeugen.
    expect(
      await readAs(user, 'public.append_project_document($1, $2, $3, $4)', args),
    ).toEqual({ status: 'duplicate_document' })

    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.project_documents where project_id = $1`,
      [projectId],
    )
    expect(n!.n).toBe(1)
  })

  it('leere Metadaten werden abgewiesen und legen NICHTS an', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)

    for (const [file, type] of [
      ['  ', 'application/pdf'],
      ['x.pdf', '   '],
    ]) {
      expect(
        await readAs(user, 'public.append_project_document($1, $2, $3, $4)', [
          projectId,
          randomUUID(),
          file,
          type,
        ]),
      ).toEqual({ status: 'invalid_metadata' })
    }

    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.project_documents where project_id = $1`,
      [projectId],
    )
    expect(n!.n).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — Weg (a) und Weg (b) aus Delta §3.3', () => {
  it('eine frische Rückfrage ist offen und trägt keine Auflösung', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId, 'Wird die Leistung gemessen oder pauschal verrechnet?')

    expect(await questionRow(id)).toEqual({
      status: 'open',
      resolution_kind: null,
      resolution_value: null,
      assumption_note: null,
      answered_by: null,
      answered_at: null,
    })
  })

  it('⚠ WEG (b): eine Annahme lässt die Frage OFFEN — die Zusage des Deltas', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    const out = await callAs<{ status: string; question_status: string; still_open_for_review: boolean }>(
      user,
      'public.resolve_open_question($1, $2, $3, $4)',
      [id, 'assumed', '90', 'Mittelwert der drei Netzbetreiber, mangels Rechnung'],
    )
    expect(out).toEqual({ status: 'ok', question_status: 'open', still_open_for_review: true })

    const row = await questionRow(id)
    // DAS ist der Kern: der Chat rechnet weiter, UND die Frage liegt weiterhin bei Martin.
    expect(row.status).toBe('open')
    expect(row.resolution_kind).toBe('assumed')
    expect(row.resolution_value).toBe('90')
    expect(row.assumption_note).toBe('Mittelwert der drei Netzbetreiber, mangels Rechnung')
    expect(row.answered_at).toBeNull()

    // Und sie steht damit weiterhin in Martins Posteingang.
    const admin = await newAdmin()
    const inbox = await readAs<{ questions: { id: string }[] }>(
      admin,
      'public.admin_list_open_questions($1, $2)',
      ['open', 200],
    )
    expect(inbox.questions.map((q) => q.id)).toContain(id)
  })

  it('⚠ eine Annahme OHNE Begründung wird abgewiesen und ändert nichts', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    // Delta §3.3 verlangt eine „sichtbar gekennzeichnete, BEGRÜNDETE Annahme". Ohne Begründung
    // entstünde genau die stille, unbelegte Annahme, die dieses Projekt sonst überall vermeidet.
    expect(
      await readAs(user, 'public.resolve_open_question($1, $2, $3)', [id, 'assumed', '90']),
    ).toEqual({ status: 'assumption_note_required' })

    const row = await questionRow(id)
    expect(row.resolution_kind).toBeNull()
    expect(row.resolution_value).toBeNull()
  })

  it('WEG (a): eine echte Antwort schliesst die Frage und hält Urheber und Zeitpunkt fest', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    const out = await callAs<{ status: string; question_status: string; still_open_for_review: boolean }>(
      user,
      'public.resolve_open_question($1, $2, $3)',
      [id, 'answered', '82,92 EUR/kW und Jahr'],
    )
    expect(out).toEqual({ status: 'ok', question_status: 'answered', still_open_for_review: false })

    const row = await questionRow(id)
    expect(row.status).toBe('answered')
    expect(row.resolution_kind).toBe('answered')
    expect(row.resolution_value).toBe('82,92 EUR/kW und Jahr')
    expect(row.answered_by).toBe(user.id)
    expect(row.answered_at).not.toBeNull()
  })

  it('eine Antwort ohne Wert und eine unbekannte Handlung werden benannt abgewiesen', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    expect(await readAs(user, 'public.resolve_open_question($1, $2)', [id, 'answered'])).toEqual({
      status: 'resolution_value_required',
    })
    expect(await readAs(user, 'public.resolve_open_question($1, $2)', [id, 'geraten'])).toEqual({
      status: 'invalid_kind',
    })
    expect((await questionRow(id)).status).toBe('open')
  })

  it('dismissed schliesst die Frage und lässt resolution_kind stehen', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    await callAs(user, 'public.resolve_open_question($1, $2, $3, $4)', [
      id,
      'assumed',
      '90',
      'vorläufig, mangels Rechnung',
    ])
    await callAs(user, 'public.resolve_open_question($1, $2)', [id, 'dismissed'])

    const row = await questionRow(id)
    expect(row.status).toBe('dismissed')
    // resolution_kind sagt, WOMIT der Chat weitergelaufen ist — das ändert sich durch das Schliessen
    // nicht, und die Begründung bleibt als Beleg stehen.
    expect(row.resolution_kind).toBe('assumed')
    expect(row.assumption_note).toBe('vorläufig, mangels Rechnung')
  })

  it('eine fremde Rückfrage ist über ihre eigene Kennung nicht auflösbar', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const { projectId } = await createProjectFor(owner)
    const id = await askQuestion(owner, projectId)

    expect(
      await readAs(stranger, 'public.resolve_open_question($1, $2, $3)', [id, 'answered', 'erfunden']),
    ).toEqual({ status: 'not_found' })
    expect(await readAs(owner, 'public.resolve_open_question($1, $2, $3)', [randomUUID(), 'answered', 'x'])).toEqual({
      status: 'not_found',
    })
    expect((await questionRow(id)).status).toBe('open')
  })

  it('⚠ die CHECKs verbieten die widersprüchlichen Kombinationen — direkt angegriffen', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    // Nicht über die Wrapper (die halten die Regel ohnehin ein), sondern als privilegiertes UPDATE:
    // die Invariante soll eine Eigenschaft der TABELLE sein, nicht eine Konvention des Rumpfs.
    const forbidden: [string, unknown[]][] = [
      // „beantwortet" ohne Antwort — behauptete eine Antwort, die nirgends steht.
      [
        `update platform.project_open_questions
            set status = 'answered', resolution_kind = 'assumed', answered_at = now() where id = $1`,
        [id],
      ],
      // „offen" mit Antwort — hielte eine beantwortete Frage künstlich offen.
      [
        `update platform.project_open_questions
            set status = 'open', resolution_kind = 'answered' where id = $1`,
        [id],
      ],
      // „beantwortet" ohne Zeitpunkt.
      [
        `update platform.project_open_questions
            set status = 'answered', resolution_kind = 'answered', answered_at = null where id = $1`,
        [id],
      ],
      // Ein Status, den es nicht gibt.
      [`update platform.project_open_questions set status = 'vielleicht' where id = $1`, [id]],
      // Eine Auflösungsart, die es nicht gibt.
      [`update platform.project_open_questions set resolution_kind = 'geraten' where id = $1`, [id]],
    ]

    for (const [stmt, params] of forbidden) {
      await expect(sql(stmt, params)).rejects.toMatchObject({ code: '23514' })
    }

    // Die erlaubte Kombination — der Kern des Zwei-Wege-Modells — geht durch.
    await sql(
      `update platform.project_open_questions
          set status = 'open', resolution_kind = 'assumed', assumption_note = 'ok' where id = $1`,
      [id],
    )
    expect((await questionRow(id)).resolution_kind).toBe('assumed')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — Martins Weg', () => {
  it('ein eingeloggter NICHT-Admin scheitert an beiden Admin-Wrappern mit 42501', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    // ECHTER Aufruf: der Nicht-Admin HAT das Grant, die Ablehnung IM Rumpf ist die zu beweisende
    // Eigenschaft — eine leere Antwort wäre hier der Fehler.
    await expect(readAs(user, 'public.admin_list_open_questions()')).rejects.toMatchObject({
      code: '42501',
    })
    await expect(
      readAs(user, 'public.admin_answer_open_question($1, $2)', [id, 'unbefugt']),
    ).rejects.toMatchObject({ code: '42501' })

    expect((await questionRow(id)).status).toBe('open')
  })

  it('⚠ Martins Posteingang liefert ÄLTESTE ZUERST und nennt den Kunden', async () => {
    const admin = await newAdmin()
    const a = await newUser()
    const b = await newUser()
    const pa = await createProjectFor(a, 'Bäckerei Gruber GmbH')
    const pb = await createProjectFor(b, 'Hotel Alpenblick')

    const first = await askQuestion(a, pa.projectId, 'Frage eins')
    const second = await askQuestion(b, pb.projectId, 'Frage zwei')

    const out = await readAs<{
      status: string
      total: number
      questions: { id: string; customer_label: string; project_id: string }[]
    }>(admin, 'public.admin_list_open_questions($1, $2)', ['open', 200])
    expect(out.status).toBe('ok')

    const mine = out.questions.filter((q) => [first, second].includes(q.id))
    // Ein Posteingang wird von vorne abgearbeitet: bei `created_at desc` läge die am längsten
    // wartende Frage am Ende der letzten Seite — also ausgerechnet der Kunde, der am längsten hängt.
    expect(mine.map((q) => q.id)).toEqual([first, second])
    // customer_label ist genau dafür denormalisiert (B14-1): Martin muss sehen, WESSEN Frage es ist,
    // und der Account kann bereits verschwunden sein.
    expect(mine.map((q) => q.customer_label)).toEqual(['Bäckerei Gruber GmbH', 'Hotel Alpenblick'])
  })

  it('der Posteingang filtert auf offene Fragen und lehnt einen unbekannten Filter ab', async () => {
    const admin = await newAdmin()
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const offen = await askQuestion(user, projectId, 'Bleibt offen')
    const erledigt = await askQuestion(user, projectId, 'Wird beantwortet')
    await callAs(user, 'public.resolve_open_question($1, $2, $3)', [erledigt, 'answered', '42'])

    const open = await readAs<{ questions: { id: string }[] }>(
      admin,
      'public.admin_list_open_questions($1, $2)',
      ['open', 200],
    )
    const ids = open.questions.map((q) => q.id)
    expect(ids).toContain(offen)
    expect(ids).not.toContain(erledigt)

    // Eine still verworfene Einschränkung zeigte mehr Zeilen als angefordert, und der Admin hielte
    // das Ergebnis für gefiltert (Muster admin_list_analyses, B14-1).
    expect(await readAs(admin, 'public.admin_list_open_questions($1)', ['vielleicht'])).toEqual({
      status: 'invalid_filter',
      filter: 'status',
    })
  })

  it('⚠ Martins Antwort lässt eine getroffene Annahme STEHEN — daran hängt die Korrektur', async () => {
    const admin = await newAdmin()
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    await callAs(user, 'public.resolve_open_question($1, $2, $3, $4)', [
      id,
      'assumed',
      '90',
      'Mittelwert, mangels Rechnung',
    ])
    const out = await callAs<{ status: string; question_id: string }>(
      admin,
      'public.admin_answer_open_question($1, $2)',
      [id, '82,92 EUR/kW und Jahr'],
    )
    expect(out).toEqual({ status: 'ok', question_id: id })

    const row = await questionRow(id)
    expect(row.status).toBe('answered')
    expect(row.resolution_kind).toBe('answered')
    expect(row.resolution_value).toBe('82,92 EUR/kW und Jahr')
    expect(row.answered_by).toBe(admin.id)
    expect(row.answered_at).not.toBeNull()
    // Die Annahme bleibt: an ihr erkennt der nächste Schritt, dass mit 90 gerechnet wurde und die
    // ausgelieferte Analyse über supersedes_id zu korrigieren ist (Delta §3.3).
    expect(row.assumption_note).toBe('Mittelwert, mangels Rechnung')
  })

  it('admin_answer_open_question: leere Antwort und unbekannte Kennung benannt abgewiesen', async () => {
    const admin = await newAdmin()
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const id = await askQuestion(user, projectId)

    expect(await readAs(admin, 'public.admin_answer_open_question($1, $2)', [id, '   '])).toEqual({
      status: 'invalid_answer',
    })
    expect(
      await readAs(admin, 'public.admin_answer_open_question($1, $2)', [randomUUID(), 'egal']),
    ).toEqual({ status: 'not_found' })
    expect((await questionRow(id)).status).toBe('open')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Chat-Zustand — Löschen, mit echtem Löschen gemessen', () => {
  it('ein gelöschtes Projekt nimmt Verlauf, Dokumente und Rückfragen MIT', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user, 'Wird gelöscht')

    await callAs(user, 'public.append_project_message($1, $2, $3)', [
      projectId,
      'user',
      JSON.stringify([{ type: 'text', text: 'hallo' }]),
    ])
    await callAs(user, 'public.append_project_document($1, $2, $3, $4)', [
      projectId,
      randomUUID(),
      'x.pdf',
      'application/pdf',
    ])
    await askQuestion(user, projectId)

    const before = await sql<{ m: number; d: number; q: number }>(
      `select (select count(*)::int from platform.project_messages where project_id = $1) as m,
              (select count(*)::int from platform.project_documents where project_id = $1) as d,
              (select count(*)::int from platform.project_open_questions where project_id = $1) as q`,
      [projectId],
    )
    expect(before[0]).toEqual({ m: 1, d: 1, q: 1 })

    await sql(`delete from platform.projects where id = $1`, [projectId])
    createdProjects.splice(createdProjects.indexOf(projectId), 1)

    const after = await sql<{ m: number; d: number; q: number }>(
      `select (select count(*)::int from platform.project_messages where project_id = $1) as m,
              (select count(*)::int from platform.project_documents where project_id = $1) as d,
              (select count(*)::int from platform.project_open_questions where project_id = $1) as q`,
      [projectId],
    )
    // Eine Nachricht ohne ihr Projekt ist kein Gesprächsverlauf mehr — und es gibt keinen
    // Aufbewahrungsgrund, der sie ihr Projekt überleben liesse (anders als bei leads/analyses).
    expect(after[0]).toEqual({ m: 0, d: 0, q: 0 })
  })

  it('⚠ ein gelöschtes KONTO nimmt NICHTS mit — die Zeilen bleiben, die Zuordnung entfällt', async () => {
    const owner = await newUser()
    const admin = await newAdmin()
    const { projectId } = await createProjectFor(owner, 'Überlebt beide Konten')

    const docId = randomUUID()
    await callAs(owner, 'public.append_project_document($1, $2, $3, $4)', [
      projectId,
      docId,
      'Rechnung.pdf',
      'application/pdf',
    ])
    const questionId = await askQuestion(owner, projectId)
    await callAs(admin, 'public.admin_answer_open_question($1, $2)', [questionId, 'Die Antwort'])

    // ⚠ DIE B16-3(e)-FALLE: hinge an `answered_by` ein CHECK, schlüge dieses Löschen mit 23514 fehl
    // und das Konto des Antwortenden wäre unlöschbar — ausgerechnet gegen ein Löschverlangen.
    await deleteUser(admin.id)
    createdUsers.splice(createdUsers.indexOf(admin.id), 1)
    await deleteUser(owner.id)
    createdUsers.splice(createdUsers.indexOf(owner.id), 1)

    const [q] = await sql<{ status: string; answered_by: string | null; resolution_value: string }>(
      `select status, answered_by, resolution_value from platform.project_open_questions where id = $1`,
      [questionId],
    )
    expect(q!.status).toBe('answered')
    expect(q!.answered_by).toBeNull()
    // Die ANTWORT bleibt — es entfällt die Zuordnung, nicht die Auskunft.
    expect(q!.resolution_value).toBe('Die Antwort')

    const [d] = await sql<{ uploaded_by: string | null; original_filename: string }>(
      `select uploaded_by, original_filename from platform.project_documents where id = $1`,
      [docId],
    )
    expect(d!.uploaded_by).toBeNull()
    expect(d!.original_filename).toBe('Rechnung.pdf')
  })
})
