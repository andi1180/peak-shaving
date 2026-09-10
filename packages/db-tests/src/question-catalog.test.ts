// DB-Gate für den Fragenkatalog und die System-Prompt-Erweiterung (B24, Teil 2)
// (Migration 20260910120000_create_question_catalog.sql, fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §4 und §3.2).
//
// Dieser Schritt legt die erste admin-gepflegte REFERENZstruktur des Kalkulators an, die der Chat
// später als Pflichtfragen-Baseline liest. Zwei Fehlerarten wären hier beim Klicken unsichtbar:
//
//   * EINE ORDNUNGSVERLETZUNG. Die Datierung ist die ganze Reproduzierbarkeit dieses Bereichs
//     (Delta §4.2: „eine 2026 geführte Konversation muss 2028 noch sagen können, welcher
//     Fragenkatalog-Stand ihr zugrunde lag"). Ein Stand, der vor dem offenen beginnt, erzeugte eine
//     Zeile, deren Ende vor ihrem Anfang liegt — und eine Kette mit Loch oder Überlappung sieht in
//     einer Liste völlig normal aus.
//   * EIN LOCH IM ADMIN-SCHUTZ. Der Katalog bestimmt, was JEDER Kunde gefragt wird; ein
//     Schreibzugriff eines gewöhnlichen Kontos fiele erst auf, wenn jemand die Fragen liest.
//
// Das Gate beweist deshalb sechs Dinge:
//
//   (1) DIE ORDNUNGSPFLICHT TRÄGT — ein Stand vor dem Beginn des offenen wird abgewiesen UND
//       hinterlässt keinen Schreibvorgang; ein Stand danach schliesst die Vorgängerin exakt am
//       Vortag (nachgerechnet, nicht als Zeichenkette verglichen); derselbe Tag ersetzt in place.
//   (2) DER ADMIN-SCHUTZ TRÄGT IN BEIDE RICHTUNGEN — alle fünf `admin_*`-Wrapper werfen für ein
//       eingeloggtes NICHT-Admin-Konto 42501 (ECHT aufgerufen), und keiner davon schreibt dabei.
//   (3) DAS LÖSCHPROTOKOLL IST VOLLSTÄNDIG — der Abzug trägt den Wortlaut der gelöschten Frage und
//       die Adresse des Löschenden; ohne ihn wäre ein gelöschter Stand von einem nie angelegten
//       nicht unterscheidbar.
//   (4) `list_question_catalog` LIEFERT GENAU DIE GELTENDEN — Baseline allein ohne Branche,
//       Baseline + Zusatz mit Branche, kein fremder Pool, kein archivierter und kein künftiger
//       Stand, und `valid_until` INKLUSIV gelesen.
//   (5) `nulls not distinct` GREIFT — zwei Baseline-Stände (industry null) mit demselben
//       `valid_from` werden abgewiesen; mit einem gewöhnlichen `unique` liefen sie durch.
//   (6) DIE RECHTEFLÄCHE IST EXAKT — kein Tabellen-Grant für irgendeine Rolle, RLS aktiv ohne
//       Policy, EXECUTE ausschliesslich `authenticated`.
//
// ── JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ──────────────────────────────────────────────
// Arbeitsregel 2: Introspektion beweist nur die Existenz einer Funktion, plpgsql prüft
// Funktionsrümpfe nicht beim Anlegen. Alle sieben werden hier echt ausgeführt, die schreibenden auch
// auf ihren Abweisungspfaden.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ─────────────────────────────────────
// Arbeitsregel 5: das gepinnte Postgres-Image beendet sich bei einem Nicht-Owner-Aufruf einer
// public-Funktion OHNE Execute-Grant mit Signal 11. `has_function_privilege` ist dieselbe Wahrheit
// ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten NICHT-Admins wird
// dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und die Ablehnung IN der Funktion ist
// genau die zu beweisende Eigenschaft.
//
// ── WIE AUFGERÄUMT WIRD (vitest fährt Testdateien PARALLEL gegen dieselbe Datenbank) ────────────
// Jede Zähl-Assertion filtert auf die eigenen Zeilen; `question_key` trägt dafür ein zufälliges
// Suffix. `platform.system_prompt_extensions` hat allerdings nur EINE globale Kette und keinen
// Identitäts-Schlüssel — sie wird ausschliesslich von dieser Datei angefasst (gemessen), und
// aufgeräumt wird über die gemerkten Kennungen.

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
const WRAPPER_SIGNATURES = {
  admin_create_question_catalog_entry:
    'public.admin_create_question_catalog_entry(text, text, text, date, boolean, text)',
  admin_delete_question_catalog_entry: 'public.admin_delete_question_catalog_entry(uuid)',
  admin_list_question_catalog: 'public.admin_list_question_catalog(text, integer, integer)',
  list_question_catalog: 'public.list_question_catalog(text, text)',
  admin_set_system_prompt_extension: 'public.admin_set_system_prompt_extension(text, date)',
  admin_get_system_prompt_extension: 'public.admin_get_system_prompt_extension()',
  get_system_prompt_extension: 'public.get_system_prompt_extension()',
} as const

/** Die fünf, die bei fehlender Adminrolle WERFEN müssen — mit einem gültigen Beispielaufruf. */
const ADMIN_ONLY_CALLS: Array<[string, string, unknown[]]> = [
  [
    'admin_create_question_catalog_entry',
    "public.admin_create_question_catalog_entry('betrieb', 'x', 'y', current_date)",
    [],
  ],
  [
    'admin_delete_question_catalog_entry',
    'public.admin_delete_question_catalog_entry($1::uuid)',
    ['00000000-0000-0000-0000-000000000000'],
  ],
  ['admin_list_question_catalog', 'public.admin_list_question_catalog()', []],
  ['admin_set_system_prompt_extension', "public.admin_set_system_prompt_extension('x')", []],
  ['admin_get_system_prompt_extension', 'public.admin_get_system_prompt_extension()', []],
]

const createdUsers: string[] = []
const createdKeys: string[] = []
const createdExtensions: string[] = []

/** Ein Schlüssel, der zum Format-CHECK passt (Kleinbuchstaben/Ziffern/Unterstrich) und eindeutig ist. */
function newKey(prefix = 'gate'): string {
  const key = `${prefix}_${randomUUID().replaceAll('-', '')}`
  createdKeys.push(key)
  return key
}

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

interface CatalogEntry {
  id: string
  segment: string
  industry: string | null
  question_key: string
  question_text: string
  required: boolean
  valid_from: string
  valid_until?: string | null
}

/** Die Stände EINER Identität, direkt aus der Tabelle — für die Ketten-Assertions. */
async function chainOf(questionKey: string) {
  return sql<{ id: string; valid_from: string; valid_until: string | null; question_text: string }>(
    `select id, valid_from::text, valid_until::text, question_text
       from platform.question_catalog_entries
      where question_key = $1
      order by valid_from`,
    [questionKey],
  )
}

/** Abstand zweier Kalendertage in Tagen — nachgerechnet statt als Zeichenkette verglichen. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** `current_date` der DATENBANK plus Versatz — die Testzeitzone darf die Kette nicht verschieben. */
async function dbDate(offsetDays: number): Promise<string> {
  const [row] = await sql<{ d: string }>(`select (current_date + $1::int)::text as d`, [offsetDays])
  return row!.d
}

beforeAll(assertStackReachable)

afterEach(async () => {
  if (createdKeys.length > 0) {
    // Erst das Protokoll (es hat bewusst KEINEN Fremdschlüssel, räumt sich also nicht selbst ab),
    // dann die Einträge — und ausschliesslich die eigenen.
    await sql(
      `delete from platform.question_catalog_deletions
        where entry_snapshot->>'question_key' = any($1::text[])`,
      [createdKeys],
    )
    await sql(`delete from platform.question_catalog_entries where question_key = any($1::text[])`, [
      createdKeys,
    ])
    createdKeys.length = 0
  }
  if (createdExtensions.length > 0) {
    await sql(`delete from platform.system_prompt_extensions where id = any($1::uuid[])`, [
      createdExtensions,
    ])
    createdExtensions.length = 0
  }
  for (const id of createdUsers.splice(0)) await deleteUser(id)
})

afterAll(async () => {
  await pool.end()
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Fragenkatalog — Schema und Rechtefläche', () => {
  it('alle drei Tabellen existieren mit RLS und OHNE Policy', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean; policies: number }>(
      `select c.relname,
              c.relrowsecurity,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'platform' and p.tablename = c.relname) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform'
          and c.relname in ('question_catalog_entries', 'question_catalog_deletions',
                            'system_prompt_extensions')
        order by c.relname`,
    )
    expect(rows.map((r) => r.relname)).toEqual([
      'question_catalog_deletions',
      'question_catalog_entries',
      'system_prompt_extensions',
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
          and table_name in ('question_catalog_entries', 'question_catalog_deletions',
                             'system_prompt_extensions')
          and grantee in ('anon', 'authenticated', 'service_role')`,
    )
    expect(rows).toEqual([])
  })

  it('EXECUTE auf den sieben Wrappern: exakt authenticated', async () => {
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

  it('platform.projects.industry ist nullable text mit Format-CHECK — und bricht die Anlage nicht', async () => {
    const [col] = await sql<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable
         from information_schema.columns
        where table_schema = 'platform' and table_name = 'projects' and column_name = 'industry'`,
    )
    expect(col).toEqual({ data_type: 'text', is_nullable: 'YES' })

    const [check] = await sql<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'projects_industry_format'`,
    )
    expect(check?.def).toContain('a-z0-9')

    // Arbeitsregel 1 in ihrer Umkehrung: die neue Spalte darf den bestehenden Anlageweg nicht
    // brechen. Ein Projekt entsteht weiterhin, und `industry` ist dabei NULL — es gibt in diesem
    // Bauschritt bewusst noch keinen Schreibweg dafür (Migration TEIL 7).
    const user = await newUser()
    const out = await callAs<{ status: string; project_id: string }>(
      user,
      'public.create_my_project($1)',
      [`B24 Katalog-Gate ${randomUUID()}`],
    )
    expect(out.status).toBe('ok')
    const [proj] = await sql<{ industry: string | null }>(
      `select industry from platform.projects where id = $1`,
      [out.project_id],
    )
    expect(proj?.industry).toBeNull()
    await sql(`delete from platform.projects where id = $1`, [out.project_id])
    await sql(`delete from platform.accounts where user_id = $1`, [user.id])
  })

  it('⚠ der Identitäts-Constraint ist `nulls not distinct` — sonst wäre die Baseline ungeschützt', async () => {
    const [row] = await sql<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'question_catalog_entries_unique_stand'`,
    )
    // Die Zeichenkette ist hier die Aussage: mit einem gewöhnlichen `unique` liesse Postgres für
    // industry = NULL (also für die Baseline jedes Segments) beliebig viele Stände mit demselben
    // valid_from zu, und welcher Wortlaut im Chat erschiene, entschiede die Sortierreihenfolge.
    expect(row?.def).toContain('NULLS NOT DISTINCT')
    expect(row?.def).toContain('segment')
    expect(row?.def).toContain('question_key')
    expect(row?.def).toContain('valid_from')
  })

  it('⚠ und er greift auch wirklich: zwei Baseline-Stände mit gleichem valid_from werden abgewiesen', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const from = await dbDate(-3)
    const first = await callAs<{ status: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)',
      ['betrieb', key, 'Erste Fassung', from],
    )
    expect(first.status).toBe('created')

    // Am Wrapper vorbei — der ersetzt beim gleichen Tag ja bewusst in place. Geprüft wird hier der
    // Rückhalt im Schema, nicht die Regel im Rumpf.
    await expect(
      sql(
        `insert into platform.question_catalog_entries (segment, question_key, question_text, valid_from)
         values ('betrieb', $1, 'Zweite Fassung', $2::date)`,
        [key, from],
      ),
    ).rejects.toThrow(/duplicate key|unique/i)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Fragenkatalog — Admin-Schutz', () => {
  it('ein eingeloggtes NICHT-Admin-Konto scheitert an allen fünf admin_*-Wrappern mit 42501', async () => {
    const user = await newUser()
    for (const [name, call, params] of ADMIN_ONLY_CALLS) {
      await expect(
        readAs(user, call, params),
        `${name} muss werfen, nicht leer antworten`,
      ).rejects.toThrow(/Adminrolle erforderlich/)
    }
  })

  it('und schreibt dabei nichts — der Katalog bleibt leer', async () => {
    const user = await newUser()
    const key = newKey()
    await expect(
      readAs(user, 'public.admin_create_question_catalog_entry($1, $2, $3, current_date)', [
        'betrieb',
        key,
        'Darf nicht entstehen',
      ]),
    ).rejects.toThrow(/Adminrolle erforderlich/)
    expect(await chainOf(key)).toEqual([])
  })

  it('ein Admin darf dieselben Aufrufe', async () => {
    const admin = await newAdmin()
    const out = await readAs<{ status: string; total: number }>(
      admin,
      'public.admin_list_question_catalog()',
    )
    expect(out.status).toBe('ok')
    expect(typeof out.total).toBe('number')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Fragenkatalog — Ordnungspflicht (Delta §4.2)', () => {
  it('⚠ WÄCHTER: ein Stand VOR dem Beginn des offenen wird abgewiesen — und hinterlässt NICHTS', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const open = await dbDate(-5)
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      key,
      'Der offene Stand',
      open,
    ])

    const rejected = await callAs<{ status: string; open_valid_from: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)',
      ['betrieb', key, 'Zu früh', await dbDate(-6)],
    )
    expect(rejected.status).toBe('invalid_valid_from')
    expect(rejected.open_valid_from).toBe(open)

    // Der eigentliche Beweis: die bestehende Lage ist unverändert. Eine abgelehnte Anlage, die die
    // Vorgängerin trotzdem geschlossen hätte, wäre der teuerste Ausgang — sie hinterliesse einen
    // Zeitraum ganz ohne geltenden Stand.
    const chain = await chainOf(key)
    expect(chain).toHaveLength(1)
    expect(chain[0]!.valid_until).toBeNull()
    expect(chain[0]!.question_text).toBe('Der offene Stand')
  })

  it('ein Stand DANACH schliesst die Vorgängerin am Vortag — Abstand exakt 1 Tag, nachgerechnet', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const first = await dbDate(-10)
    const second = await dbDate(-2)
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      key,
      'Alt',
      first,
    ])
    const out = await callAs<{ status: string; closed_count: number; closed_valid_until: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)',
      ['betrieb', key, 'Neu', second],
    )
    expect(out.status).toBe('created')
    expect(out.closed_count).toBe(1)

    const chain = await chainOf(key)
    expect(chain).toHaveLength(2)
    expect(chain[0]!.valid_until).not.toBeNull()
    expect(chain[1]!.valid_until).toBeNull()
    // Nachgerechnet statt als Zeichenkette verglichen: ein Test auf ein festes Datum bliebe auch
    // dann grün, wenn `valid_from - 1` versehentlich durch eine Konstante ersetzt würde. Weniger
    // als 1 wäre eine Überschneidung, mehr als 1 eine Lücke.
    expect(daysBetween(chain[0]!.valid_until!, chain[1]!.valid_from)).toBe(1)
  })

  it('derselbe Tag ERSETZT den Stand in place — er wird kein zweiter', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const from = await dbDate(-4)
    const created = await callAs<{ status: string; id: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)',
      ['betrieb', key, 'Mit Tipfehler', from],
    )
    expect(created.status).toBe('created')

    const replaced = await callAs<{ status: string; id: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date, false)',
      ['betrieb', key, 'Ohne Tippfehler', from],
    )
    expect(replaced.status).toBe('replaced')
    // Dieselbe Kennung: es ist derselbe Stand, kein Nachfolger. Genau das unterscheidet die
    // Korrektur am selben Tag vom Anhängen — und genau deshalb muss ein Tippfehler nicht über den
    // Löschweg gehen, dessen Protokoll dadurch aussagekräftig bleibt.
    expect(replaced.id).toBe(created.id)

    const chain = await chainOf(key)
    expect(chain).toHaveLength(1)
    expect(chain[0]!.question_text).toBe('Ohne Tippfehler')
    expect(chain[0]!.valid_until).toBeNull()

    const [row] = await sql<{ required: boolean }>(
      `select required from platform.question_catalog_entries where id = $1`,
      [created.id],
    )
    expect(row?.required).toBe(false)
  })

  it('Identitätsfelder werden bei der Ersetzung NICHT verändert', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const from = await dbDate(-4)
    await callAs(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date, true, $5)',
      ['betrieb', key, 'Hotel-Zusatzfrage', from, 'hotel'],
    )
    await callAs(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date, true, $5)',
      ['betrieb', key, 'Hotel-Zusatzfrage, klarer', from, 'hotel'],
    )
    const [row] = await sql<{ segment: string; industry: string; question_key: string }>(
      `select segment, industry, question_key from platform.question_catalog_entries where question_key = $1`,
      [key],
    )
    expect(row).toEqual({ segment: 'betrieb', industry: 'hotel', question_key: key })
  })

  it('Baseline und Branchen-Pool sind getrennte Ketten — dieselbe question_key kollidiert nicht', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const from = await dbDate(-3)
    const a = await callAs<{ status: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)',
      ['betrieb', key, 'Baseline-Fassung', from],
    )
    const b = await callAs<{ status: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date, true, $5)',
      ['betrieb', key, 'Hotel-Fassung', from, 'hotel'],
    )
    // Beide `created`: `industry` ist Teil der Identität, es sind zwei unabhängige Stände. Wäre es
    // das nicht, hätte der zweite Aufruf den ersten ERSETZT — und der Hotel-Pool trüge still den
    // Wortlaut der Baseline.
    expect([a.status, b.status]).toEqual(['created', 'created'])
    expect(await chainOf(key)).toHaveLength(2)
  })

  it('Abweisungen kommen als benannter Status, nicht als roher Constraint-Fehler', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const cases: Array<[string, string, unknown[]]> = [
      [
        'invalid_segment',
        'public.admin_create_question_catalog_entry($1, $2, $3, current_date)',
        ['gewerbe', key, 'x'],
      ],
      [
        'invalid_question_key',
        'public.admin_create_question_catalog_entry($1, $2, $3, current_date)',
        ['betrieb', 'Grossbuchstabe', 'x'],
      ],
      [
        'invalid_question_text',
        'public.admin_create_question_catalog_entry($1, $2, $3, current_date)',
        ['betrieb', key, '   '],
      ],
      [
        'invalid_industry',
        'public.admin_create_question_catalog_entry($1, $2, $3, current_date, true, $4)',
        ['betrieb', key, 'x', 'Hotel Wien'],
      ],
      [
        'invalid_valid_from',
        'public.admin_create_question_catalog_entry($1, $2, $3, null::date)',
        ['betrieb', key, 'x'],
      ],
    ]
    for (const [expected, call, params] of cases) {
      const out = await readAs<{ status: string }>(admin, call, params)
      expect({ expected, got: out.status }).toEqual({ expected, got: expected })
    }
    // Kein einziger dieser Aufrufe darf eine Zeile hinterlassen haben.
    expect(await chainOf(key)).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Fragenkatalog — Löschprotokoll (Delta §4.2, offener Punkt 9)', () => {
  it('der Abzug trägt den Wortlaut und die Adresse des Löschenden', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const created = await callAs<{ id: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, current_date, false, $4)',
      ['betrieb', key, 'Wie viele Betten?', 'hotel'],
    )

    const out = await callAs<{ status: string; id: string }>(
      admin,
      'public.admin_delete_question_catalog_entry($1::uuid)',
      [created.id],
    )
    expect(out).toEqual({ status: 'deleted', id: created.id })

    // Die Zeile ist weg …
    expect(await chainOf(key)).toEqual([])

    // … und der Abzug ist vollständig. Ohne ihn wäre ein gelöschter Stand von einem nie angelegten
    // nicht unterscheidbar.
    const [log] = await sql<{
      entry_id: string
      deleted_by: string
      deleted_by_email: string
      snapshot: Record<string, unknown>
    }>(
      `select entry_id, deleted_by, deleted_by_email, entry_snapshot as snapshot
         from platform.question_catalog_deletions
        where entry_snapshot->>'question_key' = $1`,
      [key],
    )
    expect(log?.entry_id).toBe(created.id)
    expect(log?.deleted_by).toBe(admin.id)
    expect(log?.deleted_by_email).toBe(admin.email)
    expect(log?.snapshot.question_text).toBe('Wie viele Betten?')
    expect(log?.snapshot.industry).toBe('hotel')
    expect(log?.snapshot.required).toBe(false)
  })

  it('eine unbekannte Kennung liefert not_found und schreibt KEINEN Protokolleintrag', async () => {
    const admin = await newAdmin()
    const before = await sql<{ n: number }>(
      `select count(*)::int as n from platform.question_catalog_deletions`,
    )
    const out = await callAs<{ status: string }>(
      admin,
      'public.admin_delete_question_catalog_entry($1::uuid)',
      [randomUUID()],
    )
    expect(out.status).toBe('not_found')
    const after = await sql<{ n: number }>(
      `select count(*)::int as n from platform.question_catalog_deletions`,
    )
    // Delta gemessen, nicht absolut: vitest fährt Testdateien parallel gegen dieselbe Datenbank.
    expect(after[0]!.n).toBe(before[0]!.n)
  })

  it('⚠ das Löschen des OFFENEN Standes lässt die Vorgängerin GESCHLOSSEN — die Frage ist zurückgezogen', async () => {
    const admin = await newAdmin()
    const key = newKey()
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      key,
      'Alt',
      await dbDate(-10),
    ])
    const second = await callAs<{ id: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)',
      ['betrieb', key, 'Neu', await dbDate(-2)],
    )
    await callAs(admin, 'public.admin_delete_question_catalog_entry($1::uuid)', [second.id])

    const chain = await chainOf(key)
    expect(chain).toHaveLength(1)
    // Die Vorgängerin wird NICHT automatisch wieder geöffnet: sie hat den Zeitraum danach
    // nachweislich nicht bestimmt, und das nachträglich zu behaupten wäre ein Umschreiben der
    // Geschichte. Folge: die Frage hat danach keinen geltenden Stand mehr.
    expect(chain[0]!.valid_until).not.toBeNull()
    const current = await readAs<{ entries: CatalogEntry[] }>(
      admin,
      "public.list_question_catalog('betrieb')",
    )
    expect(current.entries.filter((e) => e.question_key === key)).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Fragenkatalog — list_question_catalog', () => {
  /** Legt Baseline + zwei Branchen-Zusätze an und gibt die Schlüssel zurück. */
  async function seedPools(admin: TestUser) {
    const baseline = newKey('base')
    const hotel = newKey('hotel')
    const baeckerei = newKey('baeck')
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, current_date)', [
      'betrieb',
      baseline,
      'Welche Branche?',
    ])
    await callAs(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, current_date, true, $4)',
      ['betrieb', hotel, 'Wie viele Betten?', 'hotel'],
    )
    await callAs(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, current_date, true, $4)',
      ['betrieb', baeckerei, 'Wie viele Öfen?', 'baeckerei'],
    )
    return { baseline, hotel, baeckerei }
  }

  it('ohne Branche: NUR die Baseline des Segments', async () => {
    const admin = await newAdmin()
    const { baseline, hotel, baeckerei } = await seedPools(admin)
    const out = await readAs<{ status: string; entries: CatalogEntry[] }>(
      admin,
      "public.list_question_catalog('betrieb')",
    )
    expect(out.status).toBe('ok')
    const mine = out.entries.filter((e) => createdKeys.includes(e.question_key))
    expect(mine.map((e) => e.question_key)).toEqual([baseline])
    expect(mine.map((e) => e.question_key)).not.toContain(hotel)
    expect(mine.map((e) => e.question_key)).not.toContain(baeckerei)
  })

  it("mit Branche 'hotel': Baseline + Hotel-Zusatz, und KEIN fremder Pool", async () => {
    const admin = await newAdmin()
    const { baseline, hotel, baeckerei } = await seedPools(admin)
    const out = await readAs<{ entries: CatalogEntry[] }>(
      admin,
      "public.list_question_catalog('betrieb', 'hotel')",
    )
    const mine = out.entries.filter((e) => createdKeys.includes(e.question_key))
    // Baseline zuerst — sie gilt für jedes Projekt des Segments, die Zusatzfrage ergänzt nur.
    expect(mine.map((e) => e.question_key)).toEqual([baseline, hotel])
    expect(mine.map((e) => e.question_key)).not.toContain(baeckerei)
    expect(mine.find((e) => e.question_key === hotel)?.industry).toBe('hotel')
    expect(mine.find((e) => e.question_key === baseline)?.industry).toBeNull()
  })

  it('das Segment trennt: eine Betrieb-Frage erscheint nicht bei Privat', async () => {
    const admin = await newAdmin()
    const { baseline } = await seedPools(admin)
    const out = await readAs<{ entries: CatalogEntry[] }>(
      admin,
      "public.list_question_catalog('privat')",
    )
    expect(out.entries.map((e) => e.question_key)).not.toContain(baseline)
  })

  it('ein unbekanntes Segment liefert invalid_segment und NICHT eine leere Liste', async () => {
    const admin = await newAdmin()
    // Eine leere Liste sähe aus wie „für dieses Segment ist nichts gepflegt" — der Chat liefe
    // dann ohne Pflichtfragen weiter, statt den Tippfehler zu melden.
    const out = await readAs<{ status: string }>(
      admin,
      "public.list_question_catalog('kleingewerbe')",
    )
    expect(out.status).toBe('invalid_segment')
  })

  it('⚠ nur GELTENDE Stände: archivierte fehlen, künftige fehlen, `valid_until` ist INKLUSIV', async () => {
    const admin = await newAdmin()
    const archived = newKey('arch')
    const future = newKey('fut')
    const endsToday = newKey('today')

    // (a) Ein Stand, der abgelöst wurde: nur der Nachfolger darf erscheinen.
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      archived,
      'Alte Fassung',
      await dbDate(-20),
    ])
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      archived,
      'Geltende Fassung',
      await dbDate(-1),
    ])
    // (b) Ein Stand, der erst morgen beginnt.
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      future,
      'Gilt ab morgen',
      await dbDate(1),
    ])
    // (c) Ein Stand, dessen letzter Gültigkeitstag HEUTE ist — am Wrapper vorbei gesetzt, weil es
    // dafür bewusst keinen gibt (Migration TEIL 7). Er MUSS erscheinen: `valid_until` ist der
    // letzte gültige Tag, nicht der erste ungültige. Halboffen gelesen verlöre jeder Stand seinen
    // letzten Tag.
    await sql(
      `insert into platform.question_catalog_entries
         (segment, question_key, question_text, valid_from, valid_until)
       values ('betrieb', $1, 'Endet heute', current_date - 5, current_date)`,
      [endsToday],
    )

    const out = await readAs<{ entries: CatalogEntry[] }>(
      admin,
      "public.list_question_catalog('betrieb')",
    )
    const mine = out.entries.filter((e) => createdKeys.includes(e.question_key))
    const texts = Object.fromEntries(mine.map((e) => [e.question_key, e.question_text]))

    expect(texts[archived]).toBe('Geltende Fassung')
    expect(texts[future]).toBeUndefined()
    expect(texts[endsToday]).toBe('Endet heute')
  })

  it('trägt id und valid_from mit — die Grundlage des später denormalisierten Katalog-Standes', async () => {
    const admin = await newAdmin()
    const key = newKey()
    const created = await callAs<{ id: string }>(
      admin,
      'public.admin_create_question_catalog_entry($1, $2, $3, current_date)',
      ['privat', key, 'Wie hoch ist Ihr Jahresverbrauch?'],
    )
    const out = await readAs<{ entries: CatalogEntry[] }>(
      admin,
      "public.list_question_catalog('privat')",
    )
    const mine = out.entries.find((e) => e.question_key === key)
    // Delta §4.2 verlangt, dass Projekt/Analyse den Katalog-Stand denormalisiert mitführen. Ohne
    // die Kennung im Leseergebnis müsste der Verdrahtungs-Schritt sie separat nachschlagen.
    expect(mine?.id).toBe(created.id)
    expect(mine?.valid_from).toBeTruthy()
    expect(mine?.required).toBe(true)
  })

  it('admin_list_question_catalog zeigt AUCH die archivierten Stände samt Urheber-Adresse', async () => {
    const admin = await newAdmin()
    const key = newKey()
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      key,
      'Alt',
      await dbDate(-9),
    ])
    await callAs(admin, 'public.admin_create_question_catalog_entry($1, $2, $3, $4::date)', [
      'betrieb',
      key,
      'Neu',
      await dbDate(-1),
    ])
    const out = await readAs<{
      status: string
      total: number
      entries: Array<CatalogEntry & { created_by_email: string }>
    }>(admin, "public.admin_list_question_catalog('betrieb', 200)")
    const mine = out.entries.filter((e) => e.question_key === key)
    // Beide Stände, neuester zuerst — ohne die Geschichte liesse sich eine Kette nicht
    // nachvollziehen, und genau darauf beruht die Reproduzierbarkeit aus Delta §4.2.
    expect(mine.map((e) => e.question_text)).toEqual(['Neu', 'Alt'])
    expect(mine[0]!.created_by_email).toBe(admin.email)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 — System-Prompt-Erweiterung', () => {
  /** Setzt einen Stand und merkt sich die Kennung fürs Aufräumen. */
  async function setExtension(admin: TestUser, text: string, validFrom?: string) {
    const out = await callAs<{ status: string; id: string; closed_count: number }>(
      admin,
      validFrom
        ? 'public.admin_set_system_prompt_extension($1, $2::date)'
        : 'public.admin_set_system_prompt_extension($1)',
      validFrom ? [text, validFrom] : [text],
    )
    if (out.id) createdExtensions.push(out.id)
    return out
  }

  it('ohne gepflegte Erweiterung: {status: none} und KEIN Fehler', async () => {
    const admin = await newAdmin()
    // Der Kern-Prompt trägt das Verhalten auch allein — „es gibt keine Erweiterung" ist der
    // Normalzustand und darf im Anwendungscode nicht wie ein Problem aussehen.
    const active = await sql<{ n: number }>(
      `select count(*)::int as n from platform.system_prompt_extensions
        where valid_from <= current_date and (valid_until is null or valid_until >= current_date)`,
    )
    if (active[0]!.n === 0) {
      const out = await readAs<{ status: string }>(admin, 'public.get_system_prompt_extension()')
      expect(out.status).toBe('none')
    }
  })

  it('setzen, lesen, am selben Tag korrigieren — die Korrektur ist KEIN zweiter Stand', async () => {
    const admin = await newAdmin()
    const from = await dbDate(-3)
    const created = await setExtension(admin, 'Sei freundlich.', from)
    expect(created.status).toBe('created')

    const replaced = await setExtension(admin, 'Sei sehr freundlich.', from)
    expect(replaced.status).toBe('replaced')
    // Diese Tabelle hat bewusst KEINEN Löschweg — ohne die Ersetzung am selben Tag säse ein Admin
    // nach einem Tippfehler in einer Sackgasse.
    expect(replaced.id).toBe(created.id)

    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.system_prompt_extensions where id = any($1::uuid[])`,
      [createdExtensions],
    )
    expect(rows[0]!.n).toBe(1)

    const read = await readAs<{ status: string; id: string; extension_text: string }>(
      admin,
      'public.get_system_prompt_extension()',
    )
    expect(read.status).toBe('ok')
    expect(read.id).toBe(created.id)
    expect(read.extension_text).toBe('Sei sehr freundlich.')
  })

  it('⚠ WÄCHTER: ein Stand VOR dem offenen wird abgewiesen und ändert nichts', async () => {
    const admin = await newAdmin()
    const from = await dbDate(-3)
    await setExtension(admin, 'Der offene Stand.', from)

    const rejected = await callAs<{ status: string; open_valid_from: string }>(
      admin,
      'public.admin_set_system_prompt_extension($1, $2::date)',
      ['Zu früh.', await dbDate(-4)],
    )
    expect(rejected.status).toBe('invalid_valid_from')
    expect(rejected.open_valid_from).toBe(from)

    const rows = await sql<{ valid_until: string | null; extension_text: string }>(
      `select valid_until::text, extension_text from platform.system_prompt_extensions
        where id = any($1::uuid[])`,
      [createdExtensions],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.valid_until).toBeNull()
    expect(rows[0]!.extension_text).toBe('Der offene Stand.')
  })

  it('ein neuer Stand schliesst den Vorgänger am Vortag — genau EIN offener Eintrag bleibt', async () => {
    const admin = await newAdmin()
    const first = await dbDate(-8)
    await setExtension(admin, 'Erste Fassung.', first)
    const second = await setExtension(admin, 'Zweite Fassung.', await dbDate(-2))
    expect(second.status).toBe('created')
    expect(second.closed_count).toBe(1)

    const rows = await sql<{ valid_from: string; valid_until: string | null }>(
      `select valid_from::text, valid_until::text from platform.system_prompt_extensions
        where id = any($1::uuid[]) order by valid_from`,
      [createdExtensions],
    )
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.valid_until === null)).toHaveLength(1)
    expect(daysBetween(rows[0]!.valid_until!, rows[1]!.valid_from)).toBe(1)
  })

  it('ein leerer Text ist KEINE Abschaltung, sondern invalid_text', async () => {
    const admin = await newAdmin()
    const before = await setExtension(admin, 'Bleibt stehen.')
    const out = await readAs<{ status: string }>(
      admin,
      "public.admin_set_system_prompt_extension('   ')",
    )
    // „Ich will keine Erweiterung mehr" und „ich habe versehentlich ein leeres Feld abgeschickt"
    // sähen sonst identisch aus, und der Unterschied wäre nachträglich nicht feststellbar.
    expect(out.status).toBe('invalid_text')
    const read = await readAs<{ id: string }>(admin, 'public.get_system_prompt_extension()')
    expect(read.id).toBe(before.id)
  })

  it('⚠ admin_get liest den OFFENEN Stand, get_ den HEUTE geltenden — bei Zukunftsdatum verschieden', async () => {
    const admin = await newAdmin()
    // Ein Stand, der erst morgen beginnt: der Admin muss ihn bearbeiten können, der Chat darf ihn
    // noch nicht bekommen.
    const future = await setExtension(admin, 'Gilt ab morgen.', await dbDate(1))
    expect(future.status).toBe('created')

    const adminView = await readAs<{ status: string; extension: { id: string } }>(
      admin,
      'public.admin_get_system_prompt_extension()',
    )
    expect(adminView.status).toBe('ok')
    expect(adminView.extension.id).toBe(future.id)

    const chatView = await readAs<{ status: string; id?: string }>(
      admin,
      'public.get_system_prompt_extension()',
    )
    expect(chatView.id).not.toBe(future.id)
  })
})
