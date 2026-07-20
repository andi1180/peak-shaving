// DB-Gate für die Gutscheincode-Einlösung
// (Migration 20260720120000_create_redemption_codes.sql).
//
// Beweist auf DB-Ebene: ein gültiger Code erzeugt ein aktives Entitlement (source=manual,
// valid_until=NULL — genau der vom T4-2-CHECK erlaubte Fall), jeder Ablehnungsgrund liefert seinen
// eigenen sprechenden Status statt einer Exception, ein bestehendes aktives Entitlement wird NIE
// überschrieben, und der Wrapper ist ausschließlich an authenticated gegrantet.
//
// ── WARUM die anon-Ablehnung per Katalog-Introspektion statt per Aufruf geprüft wird ──────────────
// Dasselbe wie bei den T4-2-/T4-3-Wrappern: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant (statt sauberem „permission denied").
// Die Sicherheitseigenschaft wird deshalb über has_function_privilege (die Autorisierungs-Wahrheit)
// geprüft — nicht durch einen Aufruf, der den Backend-Prozess umbringt.
//
// Die Testcodes werden je Test frisch angelegt (zufälliger Codetext) und am Ende wieder entfernt:
// redemption_codes ist NICHT user-gebunden, der auth.users-Cascade räumt sie also nicht mit ab.

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

const PRODUCT = 'monitor'

const spawnedUsers: string[] = []
const spawnedCodes: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/** Legt einen Testcode an (privilegiert — die Codeverwaltung hat bewusst keine App-Rolle). */
async function newCode(
  opts: {
    maxRedemptions?: number | null
    expiresAt?: string | null
    isActive?: boolean
    product?: string
  } = {},
): Promise<{ id: string; code: string }> {
  const code = `test-${randomUUID()}`
  const rows = await sql<{ id: string }>(
    `insert into platform.redemption_codes
       (code, product_key, max_redemptions, expires_at, is_active, note)
     values ($1, $2, $3, $4, $5, 'db-gate')
     returning id`,
    [
      code,
      opts.product ?? PRODUCT,
      opts.maxRedemptions ?? null,
      opts.expiresAt ?? null,
      opts.isActive ?? true,
    ],
  )
  const id = rows[0]!.id
  spawnedCodes.push(id)
  return { id, code }
}

/** Ruft den Wrapper so auf, wie ihn die Server Action aufruft: als authenticated MIT JWT-Claims. */
async function redeem(user: TestUser, code: string): Promise<string> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: string }>('select public.redeem_code($1) as r', [code])
    return rows[0]!.r
  })
}

async function entitlementRow(userId: string) {
  const rows = await sql<{ is_active: boolean; valid_until: number | null; source: string }>(
    `select is_active, extract(epoch from valid_until)::float8 as valid_until, source
       from platform.entitlements where user_id = $1 and product = $2`,
    [userId, PRODUCT],
  )
  return rows[0]
}

async function codeRow(id: string) {
  const rows = await sql<{ redemption_count: number }>(
    'select redemption_count from platform.redemption_codes where id = $1',
    [id],
  )
  return rows[0]
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

beforeAll(async () => {
  await assertStackReachable()
})
afterEach(async () => {
  for (const id of spawnedUsers.splice(0)) await deleteUser(id)
  for (const id of spawnedCodes.splice(0)) {
    await sql('delete from platform.redemption_codes where id = $1', [id])
  }
})
afterAll(async () => {
  await pool.end()
})

describe('redeem_code — Erfolgsfall', () => {
  it('gültiger Code → "redeemed", Entitlement aktiv mit source=manual und valid_until NULL', async () => {
    const user = await newUser()
    const { id, code } = await newCode()

    expect(await redeem(user, code)).toBe('redeemed')

    const ent = await entitlementRow(user.id)
    expect(ent?.is_active).toBe(true)
    expect(ent?.source).toBe('manual')
    // Unbefristet — genau der Fall, den entitlements_stripe_active_requires_valid_until für
    // source=manual ausdrücklich offen lässt (und für source=stripe verbietet).
    expect(ent?.valid_until).toBeNull()

    // Ledger + Zähler.
    const led = await sql<{ n: number }>(
      'select count(*)::int as n from platform.code_redemptions where code_id = $1 and user_id = $2',
      [id, user.id],
    )
    expect(led[0]?.n).toBe(1)
    expect((await codeRow(id))?.redemption_count).toBe(1)
  })

  it('der Code wird case-insensitiv und mit umgebenden Leerzeichen erkannt', async () => {
    const user = await newUser()
    const { code } = await newCode()
    // Wie aus einer E-Mail kopiert: Großschreibung + Leerzeichen.
    expect(await redeem(user, `  ${code.toUpperCase()}  `)).toBe('redeemed')
    expect((await entitlementRow(user.id))?.is_active).toBe(true)
  })

  it('der Seed-Code coolin2026 ist vorhanden, aktiv, unbegrenzt und einlösbar', async () => {
    const rows = await sql<{
      id: string
      product_key: string
      max_redemptions: number | null
      is_active: boolean
      expires_at: number | null
    }>(
      `select id, product_key, max_redemptions, is_active,
              extract(epoch from expires_at)::float8 as expires_at
         from platform.redemption_codes where lower(code) = 'coolin2026'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.product_key).toBe('monitor')
    expect(rows[0]?.max_redemptions).toBeNull()
    expect(rows[0]?.is_active).toBe(true)
    expect(rows[0]?.expires_at).toBeNull()

    // Wirklich einlösbar (nicht nur „Zeile da"). Die Zeile selbst bleibt bestehen (kein spawnedCodes-
    // Eintrag) — der Nutzer-Cascade räumt Ledger-Zeile + Entitlement ab, den Zähler bewusst nicht.
    const user = await newUser()
    expect(await redeem(user, 'COOLIN2026')).toBe('redeemed')
    expect((await entitlementRow(user.id))?.source).toBe('manual')
  })
})

describe('redeem_code — Ablehnungsgründe (je eigener Status, keine Exception)', () => {
  it('unbekannter Code → "invalid_code", kein Entitlement', async () => {
    const user = await newUser()
    expect(await redeem(user, `gibtsnicht-${randomUUID()}`)).toBe('invalid_code')
    expect(await entitlementRow(user.id)).toBeUndefined()
  })

  it('deaktivierter Code → "invalid_code" (nicht unterscheidbar von „gibt es nicht")', async () => {
    const user = await newUser()
    const { code } = await newCode({ isActive: false })
    expect(await redeem(user, code)).toBe('invalid_code')
    expect(await entitlementRow(user.id)).toBeUndefined()
  })

  it('abgelaufener Code → "expired"', async () => {
    const user = await newUser()
    const { code } = await newCode({ expiresAt: new Date(Date.now() - 864e5).toISOString() })
    expect(await redeem(user, code)).toBe('expired')
    expect(await entitlementRow(user.id)).toBeUndefined()
  })

  it('ein Code mit Ablaufdatum in der ZUKUNFT ist einlösbar (Gegenprobe)', async () => {
    const user = await newUser()
    const { code } = await newCode({ expiresAt: new Date(Date.now() + 864e5).toISOString() })
    expect(await redeem(user, code)).toBe('redeemed')
  })

  it('ausgeschöpfter Code → "exhausted": der zweite Nutzer kommt bei max_redemptions=1 nicht durch', async () => {
    const first = await newUser()
    const second = await newUser()
    const { id, code } = await newCode({ maxRedemptions: 1 })

    expect(await redeem(first, code)).toBe('redeemed')
    expect(await redeem(second, code)).toBe('exhausted')

    // Der Zähler ist NICHT über das Limit gelaufen und der zweite Nutzer hat keinen Zugang.
    expect((await codeRow(id))?.redemption_count).toBe(1)
    expect(await entitlementRow(second.id)).toBeUndefined()
  })

  it('zweite Einlösung DESSELBEN Codes durch denselben Nutzer → "already_redeemed", Zähler unverändert', async () => {
    const user = await newUser()
    const { id, code } = await newCode()

    expect(await redeem(user, code)).toBe('redeemed')
    expect(await redeem(user, code)).toBe('already_redeemed')

    // Der Zähler zählt Einlösungen, keine Versuche.
    expect((await codeRow(id))?.redemption_count).toBe(1)
    const led = await sql<{ n: number }>(
      'select count(*)::int as n from platform.code_redemptions where code_id = $1',
      [id],
    )
    expect(led[0]?.n).toBe(1)
  })

  it('Nutzer mit bestehendem aktivem Entitlement → "already_active"; die Zeile wird NICHT überschrieben', async () => {
    const user = await newUser()
    const { id, code } = await newCode()

    // Ein aktives Stripe-Entitlement herstellen — über den echten Weg (subscriptions + Sync-Trigger,
    // I2), nicht per direktem Insert: source=stripe ist für Anwendungscode hart gesperrt.
    const periodEnd = new Date(Date.now() + 30 * 864e5)
    await sql(
      `insert into platform.subscriptions
         (stripe_subscription_id, user_id, product, status, current_period_end, stripe_event_created_at)
       values ($1, $2, $3, 'active', $4, now())`,
      [`sub_${randomUUID()}`, user.id, PRODUCT, periodEnd.toISOString()],
    )
    const before = await entitlementRow(user.id)
    expect(before?.is_active).toBe(true)
    expect(before?.source).toBe('stripe')

    expect(await redeem(user, code)).toBe('already_active')

    // Unverändert stripe-basiert und mit demselben Ablaufdatum — kein stiller Tausch gegen ein
    // unbefristetes manuelles Entitlement (das die Zeile aus dem Stripe-Sync herauslösen würde).
    const after = await entitlementRow(user.id)
    expect(after?.source).toBe('stripe')
    expect(after?.valid_until).toBeCloseTo(periodEnd.getTime() / 1000, 0)

    // Und die Einlösung hat auch sonst nichts angefasst.
    expect((await codeRow(id))?.redemption_count).toBe(0)
  })

  it('ein ABGELAUFENES Entitlement blockiert die Einlösung nicht (has_entitlement zählt Zeitablauf)', async () => {
    const user = await newUser()
    const { code } = await newCode()

    // Gekündigt/abgelaufen: is_active=true, aber valid_until in der Vergangenheit → has_entitlement
    // liefert false (I1/T11). Genau dieser Nutzer soll einen Code einlösen dürfen.
    await sql(
      `insert into platform.subscriptions
         (stripe_subscription_id, user_id, product, status, current_period_end, stripe_event_created_at)
       values ($1, $2, $3, 'active', $4, now())`,
      [`sub_${randomUUID()}`, user.id, PRODUCT, new Date(Date.now() - 864e5).toISOString()],
    )
    expect(await redeem(user, code)).toBe('redeemed')
    expect((await entitlementRow(user.id))?.source).toBe('manual')
  })
})

describe('redeem_code — Rechte und Grenzen', () => {
  it('nur authenticated darf ausführen — nicht anon, nicht service_role, nicht PUBLIC', async () => {
    expect(await canExecute('authenticated', 'redeem_code')).toBe(true)
    expect(await canExecute('anon', 'redeem_code')).toBe(false)
    // service_role hat keine auth.uid() — der Wrapper wäre dort funktionslos, also kein Grant.
    expect(await canExecute('service_role', 'redeem_code')).toBe(false)
    expect(await canExecute('public', 'redeem_code')).toBe(false)
  })

  it('weder anon noch authenticated haben ein Tabellen-Grant auf die beiden neuen Tabellen', async () => {
    for (const table of ['redemption_codes', 'code_redemptions']) {
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const rows = await sql<{ can: boolean }>(
            `select has_table_privilege($1, 'platform.' || $2, $3) as can`,
            [role, table, priv],
          )
          expect(
            rows[0]?.can,
            `${role} sollte kein ${priv.toUpperCase()} auf platform.${table} haben`,
          ).toBe(false)
        }
      }
    }
  })

  it('derselbe Nutzer kann denselben Code auch am Wrapper vorbei nicht zweimal einlösen (UNIQUE)', async () => {
    const user = await newUser()
    const { id } = await newCode()
    await sql('insert into platform.code_redemptions (code_id, user_id) values ($1, $2)', [
      id,
      user.id,
    ])
    await expect(
      sql('insert into platform.code_redemptions (code_id, user_id) values ($1, $2)', [
        id,
        user.id,
      ]),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  it('zwei Codes, die sich nur in der Groß-/Kleinschreibung unterscheiden, sind nicht anlegbar', async () => {
    const { code } = await newCode()
    await expect(
      sql(`insert into platform.redemption_codes (code, product_key) values ($1, $2)`, [
        code.toUpperCase(),
        PRODUCT,
      ]),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  it('das Löschen eines Nutzers räumt seine Einlösungen ab (I8), der Zähler bleibt stehen', async () => {
    const user = await createUser()
    const { id, code } = await newCode()
    expect(await redeem(user, code)).toBe('redeemed')

    await deleteUser(user.id)

    const led = await sql<{ n: number }>(
      'select count(*)::int as n from platform.code_redemptions where code_id = $1',
      [id],
    )
    expect(led[0]?.n).toBe(0)
    // Bewusst: eine Kontolöschung füllt einen begrenzten Code nicht rückwirkend wieder auf.
    expect((await codeRow(id))?.redemption_count).toBe(1)
  })
})
