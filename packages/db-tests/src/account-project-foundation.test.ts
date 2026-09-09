// DB-Gate für das Account/Projekt-Fundament (B24, erster Bauschritt)
// (Migration 20260909120000_create_account_project_foundation.sql, fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2 und §7).
//
// Dieser Schritt legt die erste Tabelle des Repos an, deren Zeilen einem KUNDEN gehören und nicht
// einem Admin — bislang war jede personenbezogene `platform`-Tabelle entweder admin-only
// (`analyses`, `admin_exports`) oder ganz ohne Eigentümer-Verweis (`leads`). Ein Fehler in der
// Eigentums-Bedingung wäre damit genau die Sorte Leck, die beim Klicken unsichtbar bleibt: der eigene
// Kunde sieht ja seine Projekte, und dass er auch fremde sähe, fällt erst auf, wenn es zwei Kunden
// gibt. Das Gate beweist deshalb fünf Dinge:
//
//   (1) DIE EIGENTUMS-BEDINGUNG TRÄGT — ein zweites Konto sieht das Projekt des ersten weder in der
//       Liste noch über seine ID, und `get_my_project` gibt für „fremd" denselben Status wie für
//       „gibt es nicht" (keine Auskunft darüber, welche IDs existieren).
//   (2) DER ADMIN-WEG IST EIN ANDERER — er sieht beide, und ein eingeloggter NICHT-Admin scheitert an
//       allen drei Admin-Wrappern mit einem FEHLER (42501), nicht mit einer leeren Antwort.
//   (3) LAZY, ABER GENAU EINMAL — `get_or_create_my_account` legt beim ersten Aufruf an und liefert
//       danach dieselbe Kennung; `list_my_projects` legt NICHTS an (ein Lesezugriff, der schreibt,
//       erzeugte bei jedem Seitenaufruf eine Zeile).
//   (4) `ON DELETE SET NULL` IN BEIDE RICHTUNGEN, mit ECHTEM Löschen — ein gelöschtes Konto lässt
//       Account und Projekt bestehen, ein gelöschter Account lässt das Projekt mit `account_id =
//       null` und UNVERÄNDERTEM `customer_label` zurück (das ist der Zweck der Denormalisierung).
//   (5) DIE RECHTEFLÄCHE IST EXAKT — kein Tabellen-Grant für irgendeine Rolle, RLS aktiv ohne Policy,
//       EXECUTE ausschliesslich `authenticated`.
//
// ── JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ──────────────────────────────────────────────
// Arbeitsregel 2: Introspektion beweist nur die Existenz einer Funktion, plpgsql prüft Funktionsrümpfe
// nicht beim Anlegen. Alle sieben werden hier echt ausgeführt, die vier Kunden-Wrapper auch auf ihren
// Abweisungspfaden.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ─────────────────────────────────────
// Arbeitsregel 5: das gepinnte Postgres-Image beendet sich bei einem Nicht-Owner-Aufruf einer
// public-Funktion OHNE Execute-Grant mit Signal 11. `has_function_privilege` ist dieselbe Wahrheit
// ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten NICHT-Admins wird
// dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und die Ablehnung IN der Funktion ist
// genau die zu beweisende Eigenschaft.
//
// ── WIE AUFGERÄUMT WIRD ─────────────────────────────────────────────────────────────────────────
// Anders als `platform.analyses` sind diese Tabellen NICHT append-only; die Zeilen dieses Gates
// werden am Ende entfernt. vitest fährt Testdateien parallel gegen dieselbe Datenbank — jede
// Zähl-Assertion filtert deshalb auf die eigenen Zeilen-IDs oder misst Deltas (Muster B2-2), und der
// Aufräum-Trigger ist an die eigenen Fixtures gebunden, nicht an die Tabelle.

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

/** Die sieben public-Wrapper, die dieser Bauschritt neu anlegt. */
const B24_WRAPPERS = [
  'get_or_create_my_account',
  'create_my_project',
  'list_my_projects',
  'get_my_project',
  'admin_create_project',
  'admin_list_projects',
  'admin_get_project',
] as const

/** Signaturen für `has_function_privilege` — der Name allein ist bei Defaults mehrdeutig. */
const WRAPPER_SIGNATURES: Record<(typeof B24_WRAPPERS)[number], string> = {
  get_or_create_my_account: 'public.get_or_create_my_account()',
  create_my_project: 'public.create_my_project(text)',
  list_my_projects: 'public.list_my_projects()',
  get_my_project: 'public.get_my_project(uuid)',
  admin_create_project: 'public.admin_create_project(text, uuid)',
  admin_list_projects: 'public.admin_list_projects(integer, integer, uuid)',
  admin_get_project: 'public.admin_get_project(uuid)',
}

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

/** Ruft einen Wrapper als eingeloggtes Konto auf und persistiert (commit), damit Folgeaufrufe ihn sehen. */
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
  user: TestUser | null,
  fnCall: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user?.id }, async (c) => {
    const { rows } = await c.query<{ out: T }>(`select ${fnCall} as out`, params)
    return rows[0]!.out
  })
}

/** Legt Konto + Projekt an und merkt sich beide fürs Aufräumen. */
async function createProjectFor(
  user: TestUser,
  label = `B24 Gate ${randomUUID()}`,
): Promise<{ projectId: string; accountId: string; label: string }> {
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

beforeAll(assertStackReachable)

afterEach(async () => {
  // Projekte zuerst (FK), dann Accounts, dann Konten — und ausschliesslich die eigenen.
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
describe('B24 — Schema und Rechtefläche', () => {
  it('beide Tabellen existieren mit RLS und OHNE Policy', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean; policies: number }>(
      `select c.relname,
              c.relrowsecurity,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'platform' and p.tablename = c.relname) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname in ('accounts', 'projects')
        order by c.relname`,
    )
    expect(rows.map((r) => r.relname)).toEqual(['accounts', 'projects'])
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true)
      // Die zweite unabhängige Schicht: ohne Policy sähe selbst eine Rolle nichts, der jemand
      // später versehentlich ein Tabellenrecht gäbe.
      expect(r.policies).toBe(0)
    }
  })

  it('KEIN Tabellen-Grant für irgendeine Rolle — auch nicht für service_role', async () => {
    const rows = await sql<{ grantee: string; table_name: string; privilege_type: string }>(
      `select grantee, table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'platform'
          and table_name in ('accounts', 'projects')
          and grantee in ('anon', 'authenticated', 'service_role')`,
    )
    expect(rows).toEqual([])
  })

  it('EXECUTE auf den sieben Wrappern: exakt authenticated', async () => {
    for (const name of B24_WRAPPERS) {
      const sig = WRAPPER_SIGNATURES[name]
      const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
        [sig],
      )
      expect({ name, ...row }).toEqual({ name, anon: false, auth: true, svc: false })
    }
  })

  it('platform.ensure_account ist für keine Client-Rolle aufrufbar', async () => {
    const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', 'platform.ensure_account(uuid)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'platform.ensure_account(uuid)', 'EXECUTE') as auth,
              has_function_privilege('service_role', 'platform.ensure_account(uuid)', 'EXECUTE') as svc`,
    )
    expect(row).toEqual({ anon: false, auth: false, svc: false })
  })

  it('accounts.user_id ist nullable UND unique, projects.account_id nullable', async () => {
    const cols = await sql<{ table_name: string; column_name: string; is_nullable: string }>(
      `select table_name, column_name, is_nullable
         from information_schema.columns
        where table_schema = 'platform'
          and (table_name, column_name) in (('accounts', 'user_id'), ('projects', 'account_id'))`,
    )
    expect(cols.map((c) => c.is_nullable)).toEqual(['YES', 'YES'])

    const [unique] = await sql<{ n: number }>(
      `select count(*)::int as n
         from pg_constraint
        where conrelid = 'platform.accounts'::regclass
          and contype = 'u'
          and pg_get_constraintdef(oid) = 'UNIQUE (user_id)'`,
    )
    expect(unique!.n).toBe(1)
  })

  it('ALLE Fremdschlüssel beider Tabellen sind ON DELETE SET NULL, nicht CASCADE', async () => {
    const rows = await sql<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where contype = 'f'
          and conrelid in ('platform.accounts'::regclass, 'platform.projects'::regclass)
        order by conname`,
    )
    // ⚠ Die Namen sind gepinnt, nicht bloss die ANZAHL (09.09.2026 von 2 auf 3 nachgezogen, als der
    // B24-Nachtrag `projects.created_by` ergänzte). Eine blosse Zahl hätte denselben Dienst getan
    // und dabei verschwiegen, WELCHER Fremdschlüssel dazugekommen ist; mit den Namen wird jeder
    // weitere zu einer bewussten Entscheidung an dieser Stelle — und genau das ist er: ob ein neuer
    // Fremdschlüssel `set null` tragen muss, entscheidet sich beim Anlegen der Spalte, nicht später.
    expect(rows.map((r) => r.conname)).toEqual([
      'accounts_user_id_fkey',
      'projects_account_id_fkey',
      'projects_created_by_fkey',
    ])
    for (const r of rows) expect(r.def).toContain('ON DELETE SET NULL')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 — der Weg des angemeldeten Kunden', () => {
  it('get_or_create_my_account legt LAZY an und liefert danach dieselbe Kennung', async () => {
    const user = await newUser()

    const before = await sql<{ n: number }>(
      `select count(*)::int as n from platform.accounts where user_id = $1`,
      [user.id],
    )
    expect(before[0]!.n).toBe(0)

    const first = await callAs<{ status: string; account_id: string }>(
      user,
      'public.get_or_create_my_account()',
    )
    expect(first.status).toBe('ok')
    createdAccounts.push(first.account_id)

    const second = await callAs<{ status: string; account_id: string }>(
      user,
      'public.get_or_create_my_account()',
    )
    // Idempotent: ein zweiter Aufruf darf keinen zweiten Account erzeugen — sonst hinge beim
    // nächsten Projekt die Hälfte der Arbeit an einer anderen Kennung.
    expect(second.account_id).toBe(first.account_id)

    const after = await sql<{ n: number }>(
      `select count(*)::int as n from platform.accounts where user_id = $1`,
      [user.id],
    )
    expect(after[0]!.n).toBe(1)
  })

  it('create_my_project legt Account UND Projekt in einem Aufruf an', async () => {
    const user = await newUser()
    const { projectId, accountId, label } = await createProjectFor(user, 'Bäckerei Gruber GmbH')

    const [row] = await sql<{ account_id: string; customer_label: string }>(
      `select account_id, customer_label from platform.projects where id = $1`,
      [projectId],
    )
    expect(row!.account_id).toBe(accountId)
    expect(row!.customer_label).toBe(label)

    const [acc] = await sql<{ user_id: string }>(
      `select user_id from platform.accounts where id = $1`,
      [accountId],
    )
    expect(acc!.user_id).toBe(user.id)
  })

  it('leere Bezeichnung wird als Status abgewiesen und legt NICHTS an', async () => {
    const user = await newUser()

    for (const label of ['', '   ']) {
      const out = await readAs<{ status: string }>(user, 'public.create_my_project($1)', [label])
      expect(out.status).toBe('invalid_label')
    }

    // Weder Projekt noch Account: der Abbruch liegt VOR ensure_account.
    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.accounts where user_id = $1`,
      [user.id],
    )
    expect(n!.n).toBe(0)
  })

  it('list_my_projects zeigt nur eigene Projekte — das fremde ist nicht dabei', async () => {
    const owner = await newUser()
    const stranger = await newUser()

    const mine = await createProjectFor(owner, 'Eigenes Projekt')
    const theirs = await createProjectFor(stranger, 'Fremdes Projekt')

    const ownerList = await readAs<{ status: string; projects: { id: string }[] }>(
      owner,
      'public.list_my_projects()',
    )
    expect(ownerList.status).toBe('ok')
    const ids = ownerList.projects.map((p) => p.id)
    expect(ids).toContain(mine.projectId)
    // Der eigentliche Nachweis: die Eigentums-Bedingung schliesst das fremde Projekt aus.
    expect(ids).not.toContain(theirs.projectId)
  })

  it('ein Konto ohne Account bekommt eine leere Liste — und es entsteht dabei KEINE Zeile', async () => {
    const user = await newUser()

    const out = await callAs<{ status: string; projects: unknown[] }>(
      user,
      'public.list_my_projects()',
    )
    expect(out).toEqual({ status: 'ok', projects: [] })

    // Ein Lesezugriff, der schreibt, erzeugte bei jedem Seitenaufruf eines Fremden eine Zeile.
    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.accounts where user_id = $1`,
      [user.id],
    )
    expect(n!.n).toBe(0)
  })

  it('get_my_project: eigenes ok — fremdes und unbekanntes liefern DENSELBEN Status', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const mine = await createProjectFor(owner, 'Sichtbar für den Eigentümer')

    const ok = await readAs<{ status: string; project: { id: string; customer_label: string } }>(
      owner,
      'public.get_my_project($1)',
      [mine.projectId],
    )
    expect(ok.status).toBe('ok')
    expect(ok.project.id).toBe(mine.projectId)

    const foreign = await readAs<{ status: string }>(stranger, 'public.get_my_project($1)', [
      mine.projectId,
    ])
    const unknown = await readAs<{ status: string }>(owner, 'public.get_my_project($1)', [
      randomUUID(),
    ])
    // Ein anderer Status für „fremd" wäre eine Auskunft darüber, welche IDs existieren.
    expect(foreign).toEqual({ status: 'not_found' })
    expect(unknown).toEqual({ status: 'not_found' })
  })

  it('ein admin-geführtes Projekt (account_id null) erscheint für keinen Kunden', async () => {
    const admin = await newAdmin()
    const customer = await newUser()

    const created = await callAs<{ status: string; project_id: string }>(
      admin,
      'public.admin_create_project($1)',
      ['Internes COOLiN-Projekt'],
    )
    expect(created.status).toBe('ok')
    createdProjects.push(created.project_id)

    const list = await readAs<{ projects: { id: string }[] }>(customer, 'public.list_my_projects()')
    expect(list.projects.map((p) => p.id)).not.toContain(created.project_id)

    const direct = await readAs<{ status: string }>(customer, 'public.get_my_project($1)', [
      created.project_id,
    ])
    expect(direct.status).toBe('not_found')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 — der Admin-Weg', () => {
  it('ein eingeloggter NICHT-Admin scheitert an allen drei Admin-Wrappern mit 42501', async () => {
    const user = await newUser()
    const calls: [string, unknown[]][] = [
      ['public.admin_create_project($1)', ['Sollte nicht entstehen']],
      ['public.admin_list_projects()', []],
      ['public.admin_get_project($1)', [randomUUID()]],
    ]

    for (const [call, params] of calls) {
      // ECHTER Aufruf: der Nicht-Admin HAT das Grant, die Ablehnung IM Rumpf ist die zu beweisende
      // Eigenschaft — eine leere Antwort wäre hier der Fehler.
      await expect(readAs(user, call, params)).rejects.toMatchObject({ code: '42501' })
    }

    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.projects where customer_label = 'Sollte nicht entstehen'`,
    )
    expect(n!.n).toBe(0)
  })

  it('der Admin sieht BEIDE — sein eigenes und das eines Kunden', async () => {
    const admin = await newAdmin()
    const customer = await newUser()

    const customerProject = await createProjectFor(customer, 'Kundenprojekt')
    const adminProject = await callAs<{ status: string; project_id: string }>(
      admin,
      'public.admin_create_project($1)',
      ['Adminprojekt'],
    )
    createdProjects.push(adminProject.project_id)

    const list = await readAs<{ status: string; total: number; projects: { id: string }[] }>(
      admin,
      'public.admin_list_projects($1, $2)',
      [200, 0],
    )
    expect(list.status).toBe('ok')
    const ids = list.projects.map((p) => p.id)
    expect(ids).toContain(customerProject.projectId)
    expect(ids).toContain(adminProject.project_id)
    // Die Gesamtzahl ist die Grundlage der Kürzungs-Anzeige — sie darf nicht die Seitengrösse sein.
    expect(list.total).toBeGreaterThanOrEqual(ids.length)

    for (const id of [customerProject.projectId, adminProject.project_id]) {
      const one = await readAs<{ status: string; project: { id: string } }>(
        admin,
        'public.admin_get_project($1)',
        [id],
      )
      expect(one.status).toBe('ok')
      expect(one.project.id).toBe(id)
    }
  })

  it('admin_list_projects deckelt bei 200 und liefert die Gesamtzahl getrennt', async () => {
    const admin = await newAdmin()
    const out = await readAs<{ total: number; projects: unknown[] }>(
      admin,
      'public.admin_list_projects($1, $2)',
      [10_000, 0],
    )
    // Ein durchgereichtes Limit machte die Obergrenze zur Empfehlung; hier ist sie eine Zusage.
    expect(out.projects.length).toBeLessThanOrEqual(200)
    expect(typeof out.total).toBe('number')
  })

  it('admin_create_project: unbekannter Account und leeres Label werden BENANNT abgewiesen', async () => {
    const admin = await newAdmin()

    const unknown = await readAs<{ status: string }>(
      admin,
      'public.admin_create_project($1, $2)',
      ['Mit unbekanntem Konto', randomUUID()],
    )
    // Ein roher 23503 sagte dem Admin nicht, WELCHE Angabe falsch war.
    expect(unknown).toEqual({ status: 'unknown_account' })

    const blank = await readAs<{ status: string }>(admin, 'public.admin_create_project($1)', ['  '])
    expect(blank).toEqual({ status: 'invalid_label' })
  })

  it('admin_create_project ordnet einem bestehenden Account zu — der Kunde sieht es danach', async () => {
    const admin = await newAdmin()
    const customer = await newUser()

    const acc = await callAs<{ account_id: string }>(customer, 'public.get_or_create_my_account()')
    createdAccounts.push(acc.account_id)

    const created = await callAs<{ status: string; project_id: string; account_id: string }>(
      admin,
      'public.admin_create_project($1, $2)',
      ['Stellvertretend angelegt', acc.account_id],
    )
    expect(created.status).toBe('ok')
    expect(created.account_id).toBe(acc.account_id)
    createdProjects.push(created.project_id)

    const list = await readAs<{ projects: { id: string }[] }>(
      customer,
      'public.list_my_projects()',
    )
    expect(list.projects.map((p) => p.id)).toContain(created.project_id)
  })

  it('admin_get_project liefert für eine unbekannte Kennung not_found, nicht 42501', async () => {
    const admin = await newAdmin()
    const out = await readAs<{ status: string }>(admin, 'public.admin_get_project($1)', [
      randomUUID(),
    ])
    expect(out).toEqual({ status: 'not_found' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 — ON DELETE SET NULL, mit echtem Löschen', () => {
  it('ein gelöschtes Konto lässt Account UND Projekt bestehen', async () => {
    const user = await newUser()
    const { projectId, accountId } = await createProjectFor(user, 'Überlebt das Konto')

    await deleteUser(user.id)
    createdUsers.splice(createdUsers.indexOf(user.id), 1)

    const [acc] = await sql<{ user_id: string | null }>(
      `select user_id from platform.accounts where id = $1`,
      [accountId],
    )
    // Ein CASCADE machte das Löschen eines Kontos zum stillen Löschen bezahlter Arbeit.
    expect(acc).toBeDefined()
    expect(acc!.user_id).toBeNull()

    const [proj] = await sql<{ account_id: string }>(
      `select account_id from platform.projects where id = $1`,
      [projectId],
    )
    expect(proj!.account_id).toBe(accountId)
  })

  it('ein gelöschter Account lässt das Projekt mit account_id null und UNVERÄNDERTEM Namen zurück', async () => {
    const user = await newUser()
    const { projectId, accountId, label } = await createProjectFor(user, 'Zuordenbar ohne Konto')

    await sql(`delete from platform.accounts where id = $1`, [accountId])
    createdAccounts.splice(createdAccounts.indexOf(accountId), 1)

    const [proj] = await sql<{ account_id: string | null; customer_label: string }>(
      `select account_id, customer_label from platform.projects where id = $1`,
      [projectId],
    )
    expect(proj!.account_id).toBeNull()
    // Genau dafür ist customer_label denormalisiert: ohne den Namen wäre das Projekt danach nicht
    // mehr zuordenbar — ein Join auf den entfallenen Account liefert nichts.
    expect(proj!.customer_label).toBe(label)
  })

  it('das verwaiste Projekt ist danach über den Admin-Weg erreichbar', async () => {
    const admin = await newAdmin()
    const user = await newUser()
    const { projectId, accountId } = await createProjectFor(user, 'Verwaist, aber auffindbar')

    await sql(`delete from platform.accounts where id = $1`, [accountId])
    createdAccounts.splice(createdAccounts.indexOf(accountId), 1)

    const out = await readAs<{ status: string; project: { account_id: string | null } }>(
      admin,
      'public.admin_get_project($1)',
      [projectId],
    )
    expect(out.status).toBe('ok')
    expect(out.project.account_id).toBeNull()
  })
})
