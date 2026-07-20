// DB-Gate für die Admin-RPC-Wrapper aus T4-4
// (Migration 20260720140000_create_admin_rpc_wrappers.sql).
//
// Beweist auf DB-Ebene: (1) jeder der neun Wrapper lehnt einen eingeloggten NICHT-Admin mit dem
// Status 'forbidden' ab — keine Exception, kein Datenleck; (2) ein ECHTER Admin (per direktem
// user_roles-Insert hergestellt, nicht über die neue UI — die kann sich nicht selbst verifizieren)
// kann alle drei Bereiche wirklich bedienen; (3) der letzte verbleibende Admin kann sich die Rolle
// NICHT entziehen (Lockout-Schutz); (4) die Grant-Fläche ist exakt `authenticated`.
//
// ── WARUM die Grant-Prüfung per Katalog-Introspektion statt per Aufruf läuft ──────────────────────
// Wie bei den T4-2-/T4-3-/redemption-codes-Wrappern: das gepinnte Postgres-Image segfaultet bei
// einem Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant (statt sauberem „permission
// denied"). Die Autorisierungs-Wahrheit wird deshalb über has_function_privilege geprüft — NICHT
// durch einen anon-Aufruf, der den Backend-Prozess und damit die gemeinsame Test-/CI-DB umbrächte.
// Die is_admin-ABLEHNUNG dagegen wird echt AUFGERUFEN: dort HAT der Aufrufer das Execute-Grant
// (jeder eingeloggte Nutzer darf aufrufen), die Ablehnung passiert in der Funktion — genau das ist
// die zu beweisende Eigenschaft, und der Aufruf ist gefahrlos.
//
// ── ZUSTANDS-HYGIENE ─────────────────────────────────────────────────────────────────────────────
// platform.user_roles ist GLOBALER Zustand: der Lockout-Guard zählt ALLE admin-Zeilen der Tabelle,
// nicht die eines Testnutzers. Die Tests laufen sequenziell (vitest fileParallelism:false) und jeder
// räumt seine Nutzer in afterEach ab (auth.users-Cascade nimmt user_roles mit). Der Lockout-Test
// prüft die Alleinstellung seines Admins zusätzlich explizit, statt sie vorauszusetzen.

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

/** Die neun Wrapper, die INTERN auf platform.is_admin() prüfen (is_admin selbst ist kein Wrapper). */
const ADMIN_WRAPPERS = [
  'admin_list_scrape_targets',
  'admin_upsert_scrape_target',
  'admin_set_scrape_target_active',
  'admin_list_users',
  'admin_grant_role',
  'admin_revoke_role',
  'admin_list_codes',
  'admin_create_code',
  'admin_set_code_active',
] as const

const spawnedUsers: string[] = []
const spawnedTargets: string[] = []
const spawnedCodes: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/** Macht einen Nutzer zum Admin — direkter Insert, bewusst NICHT über admin_grant_role. */
async function makeAdmin(userId: string): Promise<void> {
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [userId])
}

/** Ruft einen Wrapper so auf, wie es die Server Action tut: als authenticated MIT JWT-Claims. */
async function callAs<T = Record<string, unknown>>(
  user: TestUser,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(text, params)
    return rows[0]!.r
  })
}

/** Execute-Recht per Katalog (robust über die OID, keine fragile Signatur-Zeichenkette). */
async function canExecute(role: string, funcName: string): Promise<boolean> {
  const rows = await sql<{ can: boolean }>(
    `select has_function_privilege($1, p.oid, 'execute') as can
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $2`,
    [role, funcName],
  )
  return rows[0]?.can ?? false
}

async function adminCount(): Promise<number> {
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n from platform.user_roles where role = 'admin'`,
  )
  return rows[0]?.n ?? 0
}

/** Ein Scrape-Ziel über den Wrapper anlegen und für die Aufräumung vormerken. */
async function createTarget(
  admin: TestUser,
  slug: string,
  name = 'Testanbieter',
  url = 'https://example.test/tarife',
): Promise<Record<string, unknown>> {
  const res = await callAs<Record<string, unknown>>(
    admin,
    'select public.admin_upsert_scrape_target($1, $2, $3) as r',
    [slug, name, url],
  )
  if (typeof res.id === 'string') spawnedTargets.push(res.id)
  return res
}

beforeAll(async () => {
  await assertStackReachable()
})
afterEach(async () => {
  for (const id of spawnedUsers.splice(0)) await deleteUser(id)
  for (const id of spawnedTargets.splice(0)) {
    await sql('delete from monitor.scrape_targets where id = $1', [id])
  }
  for (const id of spawnedCodes.splice(0)) {
    await sql('delete from platform.redemption_codes where id = $1', [id])
  }
})
afterAll(async () => {
  await pool.end()
})

describe('Zugangsschranke — jeder Wrapper lehnt Nicht-Admins selbst ab', () => {
  it('alle neun Wrapper liefern einem eingeloggten Nicht-Admin "forbidden" (kein Fehler, keine Daten)', async () => {
    const user = await newUser()
    // Gegenprobe zuerst: dieser Nutzer ist wirklich kein Admin.
    expect(await callAs<boolean>(user, 'select public.is_admin() as r')).toBe(false)

    // Jeder Aufruf mit gültigen Argumenten — die Ablehnung darf NICHT davon abhängen, dass die
    // Argumente unbrauchbar sind, sondern muss vor jeder Fachlogik greifen.
    const calls: Array<[string, string, unknown[]]> = [
      ['admin_list_scrape_targets', 'select public.admin_list_scrape_targets() as r', []],
      [
        'admin_upsert_scrape_target',
        'select public.admin_upsert_scrape_target($1, $2, $3) as r',
        ['eindringling', 'Eindringling', 'https://example.test/x'],
      ],
      [
        'admin_set_scrape_target_active',
        'select public.admin_set_scrape_target_active($1, true) as r',
        [randomUUID()],
      ],
      ['admin_list_users', 'select public.admin_list_users() as r', []],
      ['admin_grant_role', 'select public.admin_grant_role($1, $2) as r', [user.id, 'admin']],
      ['admin_revoke_role', 'select public.admin_revoke_role($1, $2) as r', [user.id, 'admin']],
      ['admin_list_codes', 'select public.admin_list_codes() as r', []],
      [
        'admin_create_code',
        'select public.admin_create_code($1, $2) as r',
        [`eindringling-${randomUUID()}`, 'monitor'],
      ],
      ['admin_set_code_active', 'select public.admin_set_code_active($1, false) as r', [randomUUID()]],
    ]

    for (const [name, text, params] of calls) {
      const res = await callAs<Record<string, unknown>>(user, text, params)
      expect(res.status, `${name} muss einen Nicht-Admin ablehnen`).toBe('forbidden')
      // Eine Ablehnung liefert AUSSCHLIESSLICH den Status — keine Nutzdaten als Beifang.
      expect(Object.keys(res), `${name} darf bei Ablehnung nur den Status tragen`).toEqual(['status'])
    }

    // Und die abgelehnten Schreibversuche haben wirklich nichts geschrieben.
    const targets = await sql<{ n: number }>(
      `select count(*)::int as n from monitor.scrape_targets where provider_slug = 'eindringling'`,
    )
    expect(targets[0]?.n).toBe(0)
    expect(await adminCount()).toBe(0)
  })

  it('der Grant-Entzug ist NICHT der Schutz: ein Nicht-Admin DARF aufrufen, bekommt aber nichts', async () => {
    // Genau die Architekturentscheidung aus der Migration — die Ablehnung liegt in der Funktion,
    // nicht im Grant. Wäre es umgekehrt, wäre der Aufruf oben an "permission denied" gescheitert.
    expect(await canExecute('authenticated', 'admin_list_users')).toBe(true)
  })
})

describe('Rechte — Grant-Fläche ist exakt authenticated', () => {
  it('alle neun Wrapper + is_admin: nur authenticated, nicht anon/service_role/PUBLIC', async () => {
    for (const fn of [...ADMIN_WRAPPERS, 'is_admin']) {
      expect(await canExecute('authenticated', fn), `${fn}: authenticated`).toBe(true)
      expect(await canExecute('anon', fn), `${fn}: anon`).toBe(false)
      // service_role hat keine auth.uid() → is_admin() wäre dort immer false, der Wrapper
      // funktionslos. Kein Grant auf Vorrat.
      expect(await canExecute('service_role', fn), `${fn}: service_role`).toBe(false)
      expect(await canExecute('public', fn), `${fn}: PUBLIC`).toBe(false)
    }
  })

  it('weder anon noch authenticated haben ein Tabellen-Grant auf die verwalteten Tabellen', async () => {
    // Der Wrapper exponiert Operationen, nicht Tabellen — das bleibt auch nach T4-4 so.
    const tables: Array<[string, string]> = [
      ['monitor', 'scrape_targets'],
      ['platform', 'user_roles'],
    ]
    for (const [schema, table] of tables) {
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['insert', 'update', 'delete']) {
          const rows = await sql<{ can: boolean }>(
            `select has_table_privilege($1, $2 || '.' || $3, $4) as can`,
            [role, schema, table, priv],
          )
          expect(
            rows[0]?.can,
            `${role} sollte kein ${priv.toUpperCase()} auf ${schema}.${table} haben`,
          ).toBe(false)
        }
      }
    }
  })
})

describe('Teil 1 — Scraper-Ziele', () => {
  it('anlegen, in der Liste sehen, bearbeiten und schalten', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const slug = `test-anbieter-${randomUUID().slice(0, 8)}`

    // Anlegen
    const created = await createTarget(admin, slug, 'Testanbieter', 'https://example.test/tarife')
    expect(created.status).toBe('created')

    // In der Liste sichtbar, mit dem Statuscache (der Grund für die Seite)
    const list = await callAs<{ status: string; targets: Array<Record<string, unknown>> }>(
      admin,
      'select public.admin_list_scrape_targets() as r',
    )
    expect(list.status).toBe('ok')
    const row = list.targets.find((t) => t.provider_slug === slug)
    expect(row).toBeDefined()
    expect(row?.provider_name).toBe('Testanbieter')
    expect(row?.is_active).toBe(true)
    // Noch nie gelaufen → der Statuscache ist leer, nicht erfunden.
    expect(row?.last_scrape_status).toBeNull()

    // Bearbeiten über denselben stabilen Key → 'updated', KEINE zweite Zeile
    const updated = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_upsert_scrape_target($1, $2, $3, $4) as r',
      [slug, 'Testanbieter AG', 'https://example.test/neu', false],
    )
    expect(updated.status).toBe('updated')
    expect(updated.id).toBe(created.id)

    const after = await sql<{ n: number; provider_name: string; is_active: boolean }>(
      `select count(*) over ()::int as n, provider_name, is_active
         from monitor.scrape_targets where provider_slug = $1`,
      [slug],
    )
    expect(after).toHaveLength(1)
    expect(after[0]?.provider_name).toBe('Testanbieter AG')
    expect(after[0]?.is_active).toBe(false)

    // Schnell-Toggle
    const toggled = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_set_scrape_target_active($1, true) as r',
      [created.id],
    )
    expect(toggled.status).toBe('ok')
    const nowActive = await sql<{ is_active: boolean }>(
      'select is_active from monitor.scrape_targets where id = $1',
      [created.id],
    )
    expect(nowActive[0]?.is_active).toBe(true)
  })

  it('der Statuscache des Scrapers ist über den Admin-Pfad NICHT überschreibbar', async () => {
    // Die fachliche Zusage der Migration: last_scrape_* ist Scraper-Output. Ein Admin, der einen
    // fehlgeschlagenen Lauf auf "ok" übermalen könnte, hebelte den Robustheits-Alert (§7) aus.
    const admin = await newUser()
    await makeAdmin(admin.id)
    const slug = `status-test-${randomUUID().slice(0, 8)}`
    const created = await createTarget(admin, slug)

    // Einen fehlgeschlagenen Lauf simulieren (so, wie es der Scraper täte).
    await sql(
      `update monitor.scrape_targets
          set last_scrape_status = 'failed', last_scrape_at = now(), last_scrape_error = 'Zeitüberschreitung'
        where id = $1`,
      [created.id],
    )

    // Voller Upsert über denselben Slug — der Admin ändert Name/URL/Aktiv.
    await callAs(admin, 'select public.admin_upsert_scrape_target($1, $2, $3) as r', [
      slug,
      'Neuer Name',
      'https://example.test/anders',
    ])

    const row = await sql<{
      provider_name: string
      last_scrape_status: string | null
      last_scrape_error: string | null
    }>(
      'select provider_name, last_scrape_status, last_scrape_error from monitor.scrape_targets where id = $1',
      [created.id],
    )
    expect(row[0]?.provider_name).toBe('Neuer Name') // die Bearbeitung griff …
    expect(row[0]?.last_scrape_status).toBe('failed') // … der Statuscache blieb unberührt
    expect(row[0]?.last_scrape_error).toBe('Zeitüberschreitung')
  })

  it('eine bestehende Extraktionsregel überlebt eine Bearbeitung über den Admin-Pfad', async () => {
    // Das Admin-Formular schickt extraction_config gar nicht mit (Entwicklungs-Feld). Ohne das
    // coalesce im Wrapper löschte jede Namens-/URL-Korrektur die Scraper-Regel STILL — der Scraper
    // liefe danach ins Leere, ohne dass es irgendwo sichtbar wäre.
    const admin = await newUser()
    await makeAdmin(admin.id)
    const slug = `config-test-${randomUUID().slice(0, 8)}`
    const created = await createTarget(admin, slug)

    // Regel setzen — über den Wrapper, wie es die Entwicklung täte.
    await callAs(
      admin,
      'select public.admin_upsert_scrape_target($1, $2, $3, true, $4::jsonb) as r',
      [slug, 'Testanbieter', 'https://example.test/tarife', '{"selector": ".tarif-tabelle"}'],
    )
    const mitRegel = await sql<{ extraction_config: Record<string, unknown> | null }>(
      'select extraction_config from monitor.scrape_targets where id = $1',
      [created.id],
    )
    expect(mitRegel[0]?.extraction_config).toEqual({ selector: '.tarif-tabelle' })

    // Jetzt eine ganz normale Bearbeitung OHNE extraction_config (genau das, was das Formular tut).
    await callAs(admin, 'select public.admin_upsert_scrape_target($1, $2, $3) as r', [
      slug,
      'Testanbieter GmbH',
      'https://example.test/andere-seite',
    ])

    const nachher = await sql<{
      provider_name: string
      extraction_config: Record<string, unknown> | null
    }>('select provider_name, extraction_config from monitor.scrape_targets where id = $1', [
      created.id,
    ])
    expect(nachher[0]?.provider_name).toBe('Testanbieter GmbH') // die Bearbeitung griff …
    expect(nachher[0]?.extraction_config).toEqual({ selector: '.tarif-tabelle' }) // … die Regel steht
  })

  it('Pflichtfelder und Slug-Form werden als Status abgelehnt, nicht als Exception', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)

    const leer = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_upsert_scrape_target($1, $2, $3) as r',
      ['ok-slug', '   ', 'https://example.test/x'],
    )
    expect(leer.status).toBe('missing_fields')

    const badSlug = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_upsert_scrape_target($1, $2, $3) as r',
      ['Wien Energie!', 'Wien Energie', 'https://example.test/x'],
    )
    expect(badSlug.status).toBe('invalid_slug')

    const fehlt = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_set_scrape_target_active($1, true) as r',
      [randomUUID()],
    )
    expect(fehlt.status).toBe('not_found')
  })
})

describe('Teil 2 — Nutzer- und Rollenverwaltung', () => {
  it('die Liste zeigt E-Mail, Rollen und die HERKUNFT jedes Entitlements', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const kunde = await newUser()

    // Ein echtes Stripe-Entitlement über den echten Weg (subscriptions + Sync-Trigger, I2).
    await sql(
      `insert into platform.subscriptions
         (stripe_subscription_id, user_id, product, status, current_period_end, stripe_event_created_at)
       values ($1, $2, 'monitor', 'active', now() + interval '30 days', now())`,
      [`sub_${randomUUID()}`, kunde.id],
    )

    const res = await callAs<{
      status: string
      total: number
      truncated: boolean
      users: Array<Record<string, unknown>>
    }>(admin, 'select public.admin_list_users() as r')

    expect(res.status).toBe('ok')
    expect(res.total).toBeGreaterThanOrEqual(2)
    expect(res.truncated).toBe(false)

    const kundeRow = res.users.find((u) => u.user_id === kunde.id)
    expect(kundeRow?.email).toBe(kunde.email) // E-Mail kommt aus auth.users
    expect(kundeRow?.roles).toEqual([])
    const ents = kundeRow?.entitlements as Array<Record<string, unknown>>
    expect(ents).toHaveLength(1)
    expect(ents[0]?.product).toBe('monitor')
    expect(ents[0]?.source).toBe('stripe')
    expect(ents[0]?.currently_active).toBe(true)

    const adminRow = res.users.find((u) => u.user_id === admin.id)
    expect(adminRow?.roles).toEqual(['admin'])
  })

  it('macht den Randfall sichtbar, für den die Herkunft überhaupt angezeigt wird: Code überschreibt abgelaufenes Stripe-Abo', async () => {
    // Genau der in der redemption-codes-Migration beschriebene Fall. Ohne die source-Spalte in der
    // Admin-Liste wäre danach unsichtbar, dass die Zeile dauerhaft aus dem Stripe-Sync gelöst ist.
    const admin = await newUser()
    await makeAdmin(admin.id)
    const kunde = await newUser()

    // Abgelaufenes Stripe-Abo …
    await sql(
      `insert into platform.subscriptions
         (stripe_subscription_id, user_id, product, status, current_period_end, stripe_event_created_at)
       values ($1, $2, 'monitor', 'active', now() - interval '1 day', now())`,
      [`sub_${randomUUID()}`, kunde.id],
    )
    // … und ein eingelöster Code darauf.
    const codeText = `test-${randomUUID()}`
    const codeRows = await sql<{ id: string }>(
      `insert into platform.redemption_codes (code, product_key, note)
       values ($1, 'monitor', 'db-gate T4-4') returning id`,
      [codeText],
    )
    spawnedCodes.push(codeRows[0]!.id)
    expect(await callAs<string>(kunde, 'select public.redeem_code($1) as r', [codeText])).toBe(
      'redeemed',
    )

    const res = await callAs<{ users: Array<Record<string, unknown>> }>(
      admin,
      'select public.admin_list_users() as r',
    )
    const ents = res.users.find((u) => u.user_id === kunde.id)?.entitlements as Array<
      Record<string, unknown>
    >
    expect(ents).toHaveLength(1)
    // Die Zeile ist jetzt manual — das ist die Information, die der Admin sehen muss.
    expect(ents[0]?.source).toBe('manual')
    expect(ents[0]?.valid_until).toBeNull()
    expect(ents[0]?.currently_active).toBe(true)
  })

  it('Rolle vergeben ist idempotent, unbekannte Rolle/Nutzer werden als Status abgelehnt', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const ziel = await newUser()

    expect(
      (await callAs<Record<string, unknown>>(admin, 'select public.admin_grant_role($1, $2) as r', [
        ziel.id,
        'admin',
      ])).status,
    ).toBe('ok')
    // Zweimal klicken ist kein Fehler — und erzeugt keine zweite Zeile.
    expect(
      (await callAs<Record<string, unknown>>(admin, 'select public.admin_grant_role($1, $2) as r', [
        ziel.id,
        'admin',
      ])).status,
    ).toBe('ok')
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.user_roles where user_id = $1`,
      [ziel.id],
    )
    expect(rows[0]?.n).toBe(1)

    expect(
      (await callAs<Record<string, unknown>>(admin, 'select public.admin_grant_role($1, $2) as r', [
        ziel.id,
        'superuser',
      ])).status,
    ).toBe('invalid_role')
    expect(
      (await callAs<Record<string, unknown>>(admin, 'select public.admin_grant_role($1, $2) as r', [
        randomUUID(),
        'admin',
      ])).status,
    ).toBe('unknown_user')
  })

  it('LOCKOUT-SCHUTZ: der letzte verbleibende Admin kann sich die Rolle nicht selbst entziehen', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    // Alleinstellung beweisen, nicht voraussetzen — der Guard zählt die ganze Tabelle.
    expect(await adminCount()).toBe(1)

    const res = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_revoke_role($1, $2) as r',
      [admin.id, 'admin'],
    )
    expect(res.status).toBe('last_admin')
    // Die Rolle ist wirklich noch da — der Bereich bleibt erreichbar.
    expect(await adminCount()).toBe(1)
    expect(await callAs<boolean>(admin, 'select public.is_admin() as r')).toBe(true)
  })

  it('mit zwei Admins ist der Entzug erlaubt — danach greift der Guard für den verbleibenden', async () => {
    const ersterAdmin = await newUser()
    const zweiterAdmin = await newUser()
    await makeAdmin(ersterAdmin.id)
    await makeAdmin(zweiterAdmin.id)
    expect(await adminCount()).toBe(2)

    // Entzug des zweiten durch den ersten: erlaubt.
    expect(
      (await callAs<Record<string, unknown>>(
        ersterAdmin,
        'select public.admin_revoke_role($1, $2) as r',
        [zweiterAdmin.id, 'admin'],
      )).status,
    ).toBe('ok')
    expect(await adminCount()).toBe(1)
    expect(await callAs<boolean>(zweiterAdmin, 'select public.is_admin() as r')).toBe(false)

    // Jetzt ist der erste der letzte → der Guard greift, auch beim Selbst-Entzug.
    expect(
      (await callAs<Record<string, unknown>>(
        ersterAdmin,
        'select public.admin_revoke_role($1, $2) as r',
        [ersterAdmin.id, 'admin'],
      )).status,
    ).toBe('last_admin')
    expect(await adminCount()).toBe(1)
  })

  it('eine nicht vergebene Rolle zu entziehen ist kein Fehler, aber auch kein "ok"', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const ziel = await newUser()

    const res = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_revoke_role($1, $2) as r',
      [ziel.id, 'admin'],
    )
    expect(res.status).toBe('not_assigned')
  })
})

describe('Teil 3 — Gutscheincodes', () => {
  it('anlegen, in der Liste mit Zähler sehen, deaktivieren und reaktivieren', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const codeText = `t44-${randomUUID().slice(0, 8)}`

    const created = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_create_code($1, $2, $3, $4, $5) as r',
      [codeText, 'monitor', 5, null, 'db-gate T4-4'],
    )
    expect(created.status).toBe('created')
    spawnedCodes.push(created.id as string)

    const list = await callAs<{ status: string; codes: Array<Record<string, unknown>> }>(
      admin,
      'select public.admin_list_codes() as r',
    )
    expect(list.status).toBe('ok')
    const row = list.codes.find((c) => c.id === created.id)
    expect(row?.code).toBe(codeText)
    expect(row?.product_key).toBe('monitor')
    expect(row?.max_redemptions).toBe(5)
    expect(row?.redemption_count).toBe(0)
    expect(row?.is_active).toBe(true)

    // Deaktivieren macht ihn sofort uneinlösbar — ohne die Historie zu verlieren (kein Delete).
    expect(
      (await callAs<Record<string, unknown>>(
        admin,
        'select public.admin_set_code_active($1, false) as r',
        [created.id],
      )).status,
    ).toBe('ok')
    const kunde = await newUser()
    expect(await callAs<string>(kunde, 'select public.redeem_code($1) as r', [codeText])).toBe(
      'invalid_code',
    )

    // Reaktivieren
    expect(
      (await callAs<Record<string, unknown>>(
        admin,
        'select public.admin_set_code_active($1, true) as r',
        [created.id],
      )).status,
    ).toBe('ok')
    const kunde2 = await newUser()
    expect(await callAs<string>(kunde2, 'select public.redeem_code($1) as r', [codeText])).toBe(
      'redeemed',
    )
    // Der systemgeführte Zähler ist mitgelaufen, ohne dass ihn jemand setzen konnte.
    const nach = await callAs<{ codes: Array<Record<string, unknown>> }>(
      admin,
      'select public.admin_list_codes() as r',
    )
    expect(nach.codes.find((c) => c.id === created.id)?.redemption_count).toBe(1)
  })

  it('Dubletten (auch nur anders geschrieben) und unsinnige Eingaben werden als Status abgelehnt', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const codeText = `t44-dub-${randomUUID().slice(0, 8)}`

    const created = await callAs<Record<string, unknown>>(
      admin,
      'select public.admin_create_code($1, $2) as r',
      [codeText, 'monitor'],
    )
    expect(created.status).toBe('created')
    spawnedCodes.push(created.id as string)

    // Nur die Groß-/Kleinschreibung unterscheidet sich — für den Nutzer derselbe Code.
    expect(
      (await callAs<Record<string, unknown>>(admin, 'select public.admin_create_code($1, $2) as r', [
        codeText.toUpperCase(),
        'monitor',
      ])).status,
    ).toBe('duplicate_code')

    expect(
      (await callAs<Record<string, unknown>>(admin, 'select public.admin_create_code($1, $2) as r', [
        '   ',
        'monitor',
      ])).status,
    ).toBe('missing_fields')

    expect(
      (await callAs<Record<string, unknown>>(admin, 'select public.admin_create_code($1, $2) as r', [
        'mit leerzeichen',
        'monitor',
      ])).status,
    ).toBe('invalid_code')

    expect(
      (await callAs<Record<string, unknown>>(
        admin,
        'select public.admin_create_code($1, $2, $3) as r',
        [`t44-null-${randomUUID().slice(0, 8)}`, 'monitor', 0],
      )).status,
    ).toBe('invalid_max_redemptions')

    expect(
      (await callAs<Record<string, unknown>>(
        admin,
        'select public.admin_set_code_active($1, false) as r',
        [randomUUID()],
      )).status,
    ).toBe('not_found')
  })
})
