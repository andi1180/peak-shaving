// DB-Gate für `platform.projects.created_by` (B24-Nachtrag)
// (Migration 20260909150000_add_project_created_by.sql; die Lücke steht wörtlich in TEIL 7 der
// Vorgänger-Migration 20260909120000_create_account_project_foundation.sql).
//
// ── WAS HIER ZU BEWEISEN IST, UND WARUM EIN „ES IST GESETZT"-TEST NICHT REICHT ──────────────────
// Die Spalte trägt einen Urheber. Ein Test, der nur prüft, dass sie NICHT null ist, bliebe auch dann
// grün, wenn beide Erzeugerwege denselben oder einen beliebigen anderen Wert schrieben — und genau
// das wäre der teure Fehler: ein admin-geführtes Projekt, das den Kunden als Urheber nennt (oder
// umgekehrt), sieht in jeder Ansicht vollständig aus und ist trotzdem falsch. Jede Assertion hier
// vergleicht deshalb gegen die KENNUNG DES AUFRUFENDEN KONTOS, und in beiden Erzeugerwegen ist ein
// ZWEITES Konto im Spiel, damit „hat irgendeine Kennung" nicht durchgeht.
//
// Bewiesen werden fünf Dinge:
//   (1) `admin_create_project` setzt den handelnden ADMIN — auch dann, wenn das Projekt einem
//       fremden Kunden-Account zugeordnet wird (der Fall, in dem sich Urheber und Eigentümer
//       unterscheiden und eine Verwechslung unsichtbar bliebe).
//   (2) `create_my_project` setzt den aufrufenden KUNDEN, nicht etwa null.
//   (3) `ON DELETE SET NULL` mit ECHTEM Löschen: das Konto verschwindet, das Projekt bleibt mit
//       `created_by = null` und SONST unverändert bestehen.
//   (4) Die Spalte erscheint im ADMIN-Weg (mit aufgelöster Adresse) und ausdrücklich NICHT im
//       Kunden-Weg.
//   (5) Die Rechtefläche hat sich durch das `create or replace` NICHT verschoben.
//
// ── WARUM `created_by_email` ÜBERHAUPT GEPRÜFT WIRD ─────────────────────────────────────────────
// `auth.users` ist für keine Client-Rolle lesbar (im ersten Test dieser Datei gemessen). Ohne die
// Auflösung IM Wrapper wäre die Kennung im Admin-Bereich nicht in einen Menschen übersetzbar, und
// die Lücke wäre „in der Spalte vorhanden" und für jeden Leser trotzdem geschlossen.
//
// ── WIE AUFGERÄUMT WIRD ─────────────────────────────────────────────────────────────────────────
// Wie im Gate der Vorgänger-Migration: vitest fährt Testdateien parallel gegen dieselbe Datenbank,
// jede Assertion filtert deshalb auf die eigenen Zeilen-IDs, und die Fixtures werden am Ende wieder
// entfernt (diese Tabellen sind ausdrücklich NICHT append-only).

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

/** Liest die Spalte direkt aus der Tabelle — unabhängig davon, was ein Wrapper zurückgibt. */
async function createdByOf(projectId: string): Promise<string | null> {
  const [row] = await sql<{ created_by: string | null }>(
    `select created_by from platform.projects where id = $1`,
    [projectId],
  )
  expect(row).toBeDefined()
  return row!.created_by
}

beforeAll(assertStackReachable)

afterEach(async () => {
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
describe('B24-Nachtrag — die Spalte selbst', () => {
  it('created_by ist nullable und hängt per ON DELETE SET NULL an auth.users', async () => {
    const [col] = await sql<{ is_nullable: string; data_type: string }>(
      `select is_nullable, data_type
         from information_schema.columns
        where table_schema = 'platform' and table_name = 'projects' and column_name = 'created_by'`,
    )
    // `not null` ginge gar nicht: ON DELETE SET NULL widerspräche ihm unmittelbar und machte jedes
    // Konto unlöschbar, das je ein Projekt angelegt hat (in B16-3 real mit 23502 gemessen).
    expect(col).toBeDefined()
    expect(col!.is_nullable).toBe('YES')
    expect(col!.data_type).toBe('uuid')

    const [fk] = await sql<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'platform.projects'::regclass
          and c.contype = 'f'
          and c.conkey = array[
                (select attnum from pg_attribute
                  where attrelid = 'platform.projects'::regclass and attname = 'created_by')
              ]::smallint[]`,
    )
    expect(fk).toBeDefined()
    expect(fk!.def).toContain('auth.users')
    expect(fk!.def).toContain('ON DELETE SET NULL')
  })

  it('platform.projects trägt weiterhin KEINEN Unveränderlichkeits-Trigger', async () => {
    // Der Grund, warum hier keine asymmetrische Ausnahme nötig ist (anders als bei
    // analyses.created_by): es gibt keinen Trigger, den das referentielle UPDATE abweisen könnte.
    // Wer je einen ergänzt, macht diesen Test rot — und muss die Ausnahme für BEIDE Fremdschlüssel
    // mitbauen.
    const rows = await sql<{ tgname: string }>(
      `select tgname from pg_trigger
        where tgrelid = 'platform.projects'::regclass and not tgisinternal
        order by tgname`,
    )
    expect(rows.map((r) => r.tgname)).toEqual(['projects_set_updated_at'])
  })

  it('auth.users ist für KEINE Client-Rolle lesbar — daher löst der Wrapper selbst auf', async () => {
    const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_table_privilege('anon', 'auth.users', 'SELECT') as anon,
              has_table_privilege('authenticated', 'auth.users', 'SELECT') as auth,
              has_table_privilege('service_role', 'auth.users', 'SELECT') as svc`,
    )
    // Diese Zeile ist die Begründung für created_by_email: ohne Auflösung IM Wrapper gäbe es keinen
    // Weg, die Kennung im Admin-Bereich in einen Menschen zu übersetzen.
    expect(row).toEqual({ anon: false, auth: false, svc: false })
  })

  it('das `create or replace` hat die Rechtefläche NICHT verschoben', async () => {
    for (const sig of [
      'public.create_my_project(text)',
      'public.admin_create_project(text, uuid)',
      'public.admin_list_projects(integer, integer, uuid)',
      'public.admin_get_project(uuid)',
    ]) {
      const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
        [sig],
      )
      // DROP+CREATE hätte die Grants verloren; `create or replace` bei unveränderter Signatur
      // erhält sie. Der Unterschied fiele sonst erst beim ersten echten Aufruf auf.
      expect({ sig, ...row }).toEqual({ sig, anon: false, auth: true, svc: false })
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24-Nachtrag — wer als Urheber eingetragen wird', () => {
  it('admin_create_project trägt den handelnden ADMIN ein, nicht null', async () => {
    const admin = await newAdmin()

    const created = await callAs<{ status: string; project_id: string; account_id: string | null }>(
      admin,
      'public.admin_create_project($1)',
      ['Internes COOLiN-Projekt'],
    )
    expect(created.status).toBe('ok')
    createdProjects.push(created.project_id)

    // Genau die Lücke aus TEIL 7: ein admin-geführtes Projekt hat weder Account noch Login, an dem
    // sich seine Herkunft sonst ablesen liesse.
    expect(created.account_id).toBeNull()
    expect(await createdByOf(created.project_id)).toBe(admin.id)
  })

  it('… auch dann, wenn das Projekt einem FREMDEN Kunden-Account zugeordnet wird', async () => {
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
    createdProjects.push(created.project_id)

    // Der eigentliche Nachweis: Urheber und Eigentümer sind hier VERSCHIEDENE Konten. Ein Wrapper,
    // der versehentlich den Kontoinhaber des Ziel-Accounts einträgt, käme sonst durch — die Zeile
    // sähe vollständig aus und wäre falsch.
    expect(created.account_id).toBe(acc.account_id)
    expect(await createdByOf(created.project_id)).toBe(admin.id)
    expect(await createdByOf(created.project_id)).not.toBe(customer.id)
  })

  it('create_my_project trägt den aufrufenden KUNDEN ein', async () => {
    const customer = await newUser()
    const stranger = await newUser()

    const created = await callAs<{ status: string; project_id: string; account_id: string }>(
      customer,
      'public.create_my_project($1)',
      ['Bäckerei Gruber GmbH'],
    )
    expect(created.status).toBe('ok')
    createdProjects.push(created.project_id)
    createdAccounts.push(created.account_id)

    expect(await createdByOf(created.project_id)).toBe(customer.id)
    // Ein zweites Konto ist im Spiel, damit „irgendeine Kennung" nicht als Beweis durchgeht.
    expect(await createdByOf(created.project_id)).not.toBe(stranger.id)
  })

  it('der Urheber überlebt das Löschen des ACCOUNTS — das ist der Grund für die Zeile im Kundenweg', async () => {
    const customer = await newUser()
    const created = await callAs<{ project_id: string; account_id: string }>(
      customer,
      'public.create_my_project($1)',
      ['Kunde bleibt erkennbar'],
    )
    createdProjects.push(created.project_id)

    await sql(`delete from platform.accounts where id = $1`, [created.account_id])

    const [row] = await sql<{ account_id: string | null; created_by: string | null }>(
      `select account_id, created_by from platform.projects where id = $1`,
      [created.project_id],
    )
    // account_id ist weg — das Projekt sähe ohne created_by aus wie ein admin-geführtes.
    expect(row!.account_id).toBeNull()
    expect(row!.created_by).toBe(customer.id)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24-Nachtrag — ON DELETE SET NULL, mit echtem Löschen', () => {
  it('ein gelöschtes Konto lässt das Projekt bestehen — created_by null, sonst unverändert', async () => {
    const admin = await newAdmin()
    const created = await callAs<{ project_id: string }>(admin, 'public.admin_create_project($1)', [
      'Überlebt seinen Urheber',
    ])
    createdProjects.push(created.project_id)

    const [before] = await sql<{
      account_id: string | null
      customer_label: string
      created_at: string
      created_by: string | null
    }>(
      `select account_id, customer_label, created_at, created_by
         from platform.projects where id = $1`,
      [created.project_id],
    )
    expect(before!.created_by).toBe(admin.id)

    // ECHTES Löschen über denselben Weg, den die Anwendung ginge — nicht ein simuliertes UPDATE.
    await deleteUser(admin.id)
    createdUsers.splice(createdUsers.indexOf(admin.id), 1)

    const [after] = await sql<{
      account_id: string | null
      customer_label: string
      created_at: string
      created_by: string | null
    }>(
      `select account_id, customer_label, created_at, created_by
         from platform.projects where id = $1`,
      [created.project_id],
    )
    // Ein CASCADE machte das Löschen eines Admin-Kontos zum stillen Löschen fremder Projekte.
    expect(after).toBeDefined()
    expect(after!.created_by).toBeNull()
    // „sonst unverändert" wird gemessen, nicht behauptet: die referentielle Aktion IST ein UPDATE
    // und darf ausser dieser einen Spalte nichts anfassen.
    expect(after!.account_id).toBe(before!.account_id)
    expect(after!.customer_label).toBe(before!.customer_label)
    expect(after!.created_at).toEqual(before!.created_at)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24-Nachtrag — wo die Spalte erscheint und wo nicht', () => {
  it('admin_get_project liefert created_by UND die aufgelöste Adresse', async () => {
    const admin = await newAdmin()
    const created = await callAs<{ project_id: string }>(admin, 'public.admin_create_project($1)', [
      'Sichtbar im Admin-Weg',
    ])
    createdProjects.push(created.project_id)

    const out = await readAs<{
      status: string
      project: { created_by: string | null; created_by_email: string | null }
    }>(admin, 'public.admin_get_project($1)', [created.project_id])

    expect(out.status).toBe('ok')
    expect(out.project.created_by).toBe(admin.id)
    // Ohne die Auflösung wäre die Lücke „in der Spalte vorhanden" und für jeden Leser trotzdem
    // geschlossen — auth.users ist für keine Client-Rolle lesbar (s. o.).
    expect(out.project.created_by_email).toBe(admin.email)
  })

  it('admin_list_projects führt beide Felder in der ausgelieferten Seite', async () => {
    const admin = await newAdmin()
    const created = await callAs<{ project_id: string }>(admin, 'public.admin_create_project($1)', [
      'Sichtbar in der Liste',
    ])
    createdProjects.push(created.project_id)

    const out = await readAs<{
      status: string
      projects: { id: string; created_by: string | null; created_by_email: string | null }[]
    }>(admin, 'public.admin_list_projects($1, $2)', [200, 0])

    expect(out.status).toBe('ok')
    const row = out.projects.find((p) => p.id === created.project_id)
    expect(row).toBeDefined()
    expect(row!.created_by).toBe(admin.id)
    expect(row!.created_by_email).toBe(admin.email)
  })

  it('die Kunden-Wrapper zeigen den Urheber NICHT — auch nicht beim eigenen Projekt', async () => {
    const customer = await newUser()
    const created = await callAs<{ project_id: string; account_id: string }>(
      customer,
      'public.create_my_project($1)',
      ['Eigenes Projekt'],
    )
    createdProjects.push(created.project_id)
    createdAccounts.push(created.account_id)

    const one = await readAs<{ project: Record<string, unknown> }>(
      customer,
      'public.get_my_project($1)',
      [created.project_id],
    )
    const list = await readAs<{ projects: Record<string, unknown>[] }>(
      customer,
      'public.list_my_projects()',
    )
    const fromList = list.projects.find((p) => p.id === created.project_id)

    // Der Wrapper entscheidet, WELCHE Spalten herauskommen (B16-2/B16-4b) — was eine Server
    // Component liest, kann im ausgelieferten HTML landen, auch wenn niemand es rendert. Die
    // Kennung eines internen Kontos gehört nicht in das Browser-Bündel eines Kunden.
    expect(fromList).toBeDefined()
    for (const row of [one.project, fromList!]) {
      expect(Object.keys(row).sort()).toEqual([
        'account_id',
        'created_at',
        'customer_label',
        'id',
        'updated_at',
      ])
    }
  })

  it('ein Projekt eines gelöschten Kontos meldet created_by null und KEINE Adresse', async () => {
    const admin = await newAdmin()
    const other = await newAdmin()
    const created = await callAs<{ project_id: string }>(other, 'public.admin_create_project($1)', [
      'Urheber gelöscht',
    ])
    createdProjects.push(created.project_id)

    await deleteUser(other.id)
    createdUsers.splice(createdUsers.indexOf(other.id), 1)

    const out = await readAs<{
      status: string
      project: { created_by: string | null; created_by_email: string | null }
    }>(admin, 'public.admin_get_project($1)', [created.project_id])

    expect(out.status).toBe('ok')
    // Kein Absturz und keine erfundene Adresse: der Unterabfrage-Join läuft ins Leere, und das ist
    // die richtige Antwort — „das Konto gibt es nicht mehr", nicht „von niemandem angelegt".
    expect(out.project.created_by).toBeNull()
    expect(out.project.created_by_email).toBeNull()
  })

  it('ein unbekanntes Projekt bleibt not_found — die neue Spalte ändert daran nichts', async () => {
    const admin = await newAdmin()
    const out = await readAs<{ status: string }>(admin, 'public.admin_get_project($1)', [
      randomUUID(),
    ])
    expect(out).toEqual({ status: 'not_found' })
  })
})
