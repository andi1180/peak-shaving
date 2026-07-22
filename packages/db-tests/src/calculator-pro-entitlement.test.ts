// DB-Gate für den Produktschlüssel `calculator_pro` im Entitlement-System (Fahrplan B10, Schritt 1).
//
// ── WARUM DIESE DATEI KEINE MIGRATION BEGLEITET ──────────────────────────────────────────────────
// `platform.product_key` trägt `calculator_pro` seit T4-1 (20260718093043_create_platform_schema.sql
// Zeile 32) — der Wert wurde von Anfang an mitangelegt, weil das `platform`-Schema ausdrücklich für
// BEIDE Produkte gebaut wurde. Es gibt hier deshalb nichts zu erweitern: weder ein
// `ALTER TYPE ... ADD VALUE` noch eine Änderung an `platform.has_entitlement` oder
// `public.get_my_entitlement` — beide nehmen das Produkt als PARAMETER entgegen und sind auf keinen
// einzelnen Schlüssel verdrahtet.
//
// Was FEHLTE, ist der Nachweis. Bis hierher wurde jede Entitlement-Invariante ausschließlich mit
// `monitor` geprüft (platform.test.ts, auth-rpc-wrappers.test.ts). „Der Parameter trägt den zweiten
// Wert schon mit" ist eine Behauptung über eine Funktion, die nie mit ihm aufgerufen wurde — und
// genau die Art Behauptung, die erst im Betrieb scheitert (Arbeitsregel 2 der Root-CLAUDE.md:
// Introspektion beweist Existenz, nicht Lauffähigkeit). Diese Datei ruft beide Funktionen mit
// `calculator_pro` ECHT auf.
//
// ── DIE EIGENTLICHE NEUE GEFAHR: ZWEI PRODUKTE IN EINER TABELLE ──────────────────────────────────
// Solange nur `monitor` existierte, konnte eine vergessene `product`-Bedingung nirgends auffallen —
// jede Zeile in platform.entitlements gehörte demselben Produkt. Ab dem zweiten Produkt ist genau
// das ein stilles Verschenken: ein Monitor-Abonnent bekäme den Kalkulator gratis, und niemand
// bemerkte es, weil beide Zugänge „funktionieren". Der Isolationstest unten ist deshalb der
// wichtigste dieser Datei, nicht ein Randfall.
//
// KEIN Stripe-Fall: `calculator_pro` hat weder Price noch Checkout-Pfad und bleibt vorerst
// `source='manual'` (Grant durch einen Admin, kein Selfservice). Das ist Absicht — die offene
// Geschäftsfrage „Kalkulator kostenlos oder verkauft" (OP#1) blockiert diesen Schritt nicht.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

const PRODUCT = 'calculator_pro'
const OTHER_PRODUCT = 'monitor'

const spawned: string[] = []
async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawned.push(u.id)
  return u
}

// Als ISO-Zeitstempel, nicht als SQL-Ausdruck: ein `now() + interval '30 days'` als Parameterwert
// käme in der timestamptz-Spalte als LITERALE Zeichenkette an und scheiterte am Parsen.
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

// Manueller Grant wie in Produktion: über service_role, committed. `valid_until = null` bedeutet
// unbefristet (bei source='manual' ausdrücklich erlaubt — der Fail-open-Constraint aus T4-2 greift
// nur für source='stripe').
async function grant(
  userId: string,
  product: string,
  opts: { isActive?: boolean; validUntil?: string | null } = {},
): Promise<void> {
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `insert into platform.entitlements (user_id, product, is_active, valid_until, source)
       values ($1, $2, $3, $4, 'manual')`,
      [userId, product, opts.isActive ?? true, opts.validUntil ?? null],
    ),
  )
}

async function hasEntitlement(userId: string, product: string): Promise<boolean | undefined> {
  const rows = await sql<{ granted: boolean }>(
    'select platform.has_entitlement($1, $2) as granted',
    [userId, product],
  )
  return rows[0]?.granted
}

// Der Weg, den der künftige Kalkulator-Portalteil geht: der EINGELOGGTE Nutzer fragt seinen eigenen
// Zustand über den public-Wrapper ab (platform ist nicht über REST exponiert). Kein user_id-Argument
// — die Identität kommt aus auth.uid().
async function myEntitlementAs(userId: string, product: string): Promise<boolean | undefined> {
  return runAs({ role: 'authenticated', userId }, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>('select public.get_my_entitlement($1) as ok', [
      product,
    ])
    return rows[0]?.ok
  })
}

beforeAll(async () => {
  await assertStackReachable()
})
afterEach(async () => {
  for (const id of spawned.splice(0)) await deleteUser(id)
})
afterAll(async () => {
  await pool.end()
})

describe('platform.product_key trägt calculator_pro', () => {
  // Pinnt den Wert, statt ihn vorauszusetzen: er stammt aus T4-1 und ist damit älter als jeder
  // Konsument. Ein späteres Aufräumen des Enums („den benutzt ja niemand") bräche den Zugang zum
  // Kalkulator-Portalteil erst beim ersten Login eines zahlenden Kunden.
  it('der Enum-Wert existiert (Grundlage von B10, nicht mit diesem Schritt entstanden)', async () => {
    const rows = await sql<{ enumlabel: string }>(
      `select e.enumlabel
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'platform' and t.typname = 'product_key'
        order by e.enumsortorder`,
    )
    const labels = rows.map((r) => r.enumlabel)
    expect(labels).toContain(PRODUCT)
    expect(labels).toContain(OTHER_PRODUCT)
  })
})

describe('platform.has_entitlement mit calculator_pro (I1/I9 — dieselben Regeln wie monitor)', () => {
  it('ohne Grant: false', async () => {
    const user = await newUser()
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(false)
  })

  it('aktiver manueller Grant mit valid_until in der Zukunft: true', async () => {
    const user = await newUser()
    await grant(user.id, PRODUCT, { validUntil: daysFromNow(30) })
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(true)
  })

  it('aktiver manueller Grant OHNE valid_until (unbefristet): true', async () => {
    const user = await newUser()
    await grant(user.id, PRODUCT, { validUntil: null })
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(true)
  })

  // T11: der Zeitablauf sperrt ALLEIN — is_active bleibt dabei ausdrücklich true. Das ist die
  // Invariante, an der ein abgelaufener Testzugang tatsächlich endet.
  it('abgelaufener Grant sperrt, obwohl is_active = true', async () => {
    const user = await newUser()
    await grant(user.id, PRODUCT, { isActive: true })
    await sql(
      `update platform.entitlements set valid_until = now() - interval '1 day'
        where user_id = $1 and product = $2`,
      [user.id, PRODUCT],
    )
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(false)

    // Gegenprobe: in die Zukunft geschoben lebt derselbe Grant wieder — es lag am Datum, nicht am Flag.
    await sql(
      `update platform.entitlements set valid_until = now() + interval '1 day'
        where user_id = $1 and product = $2`,
      [user.id, PRODUCT],
    )
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(true)
  })

  it('is_active = false sperrt, obwohl valid_until in der Zukunft liegt', async () => {
    const user = await newUser()
    await grant(user.id, PRODUCT, { isActive: false })
    await sql(
      `update platform.entitlements set valid_until = now() + interval '30 days'
        where user_id = $1 and product = $2`,
      [user.id, PRODUCT],
    )
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(false)
  })
})

describe('Produkt-Isolation — der Grund, warum das Produkt ein Parameter ist', () => {
  it('ein monitor-Grant öffnet NICHT den Kalkulator', async () => {
    const user = await newUser()
    await grant(user.id, OTHER_PRODUCT)
    expect(await hasEntitlement(user.id, OTHER_PRODUCT)).toBe(true)
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(false)
  })

  it('ein calculator_pro-Grant öffnet NICHT den Monitor', async () => {
    const user = await newUser()
    await grant(user.id, PRODUCT)
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(true)
    expect(await hasEntitlement(user.id, OTHER_PRODUCT)).toBe(false)
  })

  // Das gemeinsame Konto über beide Produkte (Root-CLAUDE.md: „gemeinsames Konto über beide
  // Produkte") — zwei Zeilen, ein Nutzer, unabhängig gültig. Der Primärschlüssel (user_id, product)
  // lässt genau das zu; hier steht es als Verhalten, nicht nur als Schema-Eigenschaft.
  it('beide Produkte nebeneinander: unabhängig gültig, unabhängig abgelaufen', async () => {
    const user = await newUser()
    await grant(user.id, OTHER_PRODUCT)
    await grant(user.id, PRODUCT)
    expect(await hasEntitlement(user.id, OTHER_PRODUCT)).toBe(true)
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(true)

    await sql(
      `update platform.entitlements set valid_until = now() - interval '1 day'
        where user_id = $1 and product = $2`,
      [user.id, PRODUCT],
    )
    expect(await hasEntitlement(user.id, PRODUCT)).toBe(false)
    expect(await hasEntitlement(user.id, OTHER_PRODUCT)).toBe(true) // unberührt
  })
})

describe('public.get_my_entitlement(calculator_pro) — der Wrapper wird ECHT aufgerufen', () => {
  // Arbeitsregel 2 (Root-CLAUDE.md): Introspektion beweist, dass eine Funktion da ist, nicht dass sie
  // mit diesem Wert läuft. Der Wrapper ist unverändert (das Produkt ist sein Parameter) — geprüft
  // wird, dass er den zweiten Enum-Wert trägt.
  it('false ohne Grant, true nach aktivem manuellem Grant', async () => {
    const user = await newUser()
    expect(await myEntitlementAs(user.id, PRODUCT)).toBe(false)
    await grant(user.id, PRODUCT)
    expect(await myEntitlementAs(user.id, PRODUCT)).toBe(true)
  })

  it('sieht NICHT den Kalkulator-Zugang eines anderen Nutzers (kein user_id-Parameter)', async () => {
    const a = await newUser()
    const b = await newUser()
    await grant(b.id, PRODUCT)
    expect(await myEntitlementAs(a.id, PRODUCT)).toBe(false)
    expect(await myEntitlementAs(b.id, PRODUCT)).toBe(true)
  })

  it('ein monitor-Grant liefert über den Wrapper KEINEN Kalkulator-Zugang', async () => {
    const user = await newUser()
    await grant(user.id, OTHER_PRODUCT)
    expect(await myEntitlementAs(user.id, OTHER_PRODUCT)).toBe(true)
    expect(await myEntitlementAs(user.id, PRODUCT)).toBe(false)
  })

  it('ein abgelaufener Grant sperrt auch über den Wrapper (I1 bis in den Portalpfad)', async () => {
    const user = await newUser()
    await grant(user.id, PRODUCT)
    expect(await myEntitlementAs(user.id, PRODUCT)).toBe(true)
    await sql(
      `update platform.entitlements set valid_until = now() - interval '1 day'
        where user_id = $1 and product = $2`,
      [user.id, PRODUCT],
    )
    expect(await myEntitlementAs(user.id, PRODUCT)).toBe(false)
  })
})
