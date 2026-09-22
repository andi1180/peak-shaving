// DB-Gate fuer den Batteriekatalog (Migration 20260922130000_create_battery_catalog.sql, K1).
//
// Was diese Datei absichert — und warum jede Zeile davon GEMESSEN und nicht abgelesen wird:
//
// (1) DIE POLICY TRAEGT EINE BEDINGUNG. `battery_catalog_public_read` gibt nur `active` frei. Ein
//     Fehler darin ist nach beiden Seiten teuer: gibt sie zu viel frei, sieht der oeffentliche
//     Rechner halbfertige Geraete und rankt sie; gibt sie zu wenig frei, findet er gar keine. Der
//     Test prueft deshalb BEIDE Richtungen an EINEM Lauf (Positiv- und Negativkontrolle).
//
// (2) DIE RECHTEFLAECHE ENTSTEHT VON SELBST, UND ZWAR FALSCH. Supabase vergibt auf neue
//     public-Tabellen per ALTER DEFAULT PRIVILEGES alle Rechte an anon/authenticated/service_role.
//     „Kein Schreib-Grant" ist nicht dadurch erfuellt, dass die Migration keinen schreibt.
//
// (3) DER EINKAUFSPREIS IST DIE EINE ZAHL, DIE NIEMAND AUSSER COOLiN SEHEN DARF. Die Absenz wird
//     mit Positiv-Kontrolle gemessen: dieselbe Zeile, die anon/authenticated nicht erreichen, holt
//     der Admin-Wrapper im selben Test hervor.
//
// (4) ARBEITSREGEL 2 — jeder neue public-Wrapper wird mindestens einmal tatsaechlich AUFGERUFEN.
//     Introspektion beweist nur, dass eine Funktion da ist; plpgsql prueft Funktionsrumpfe nicht
//     beim Anlegen.
//
// (5) ARBEITSREGEL 5 — kein Aufruf einer SECURITY-DEFINER-Funktion als Rolle OHNE EXECUTE-Grant
//     (Segfault-Gefahr). Fuer anon/service_role wird `has_function_privilege` gemessen; der echte
//     Aufruf laeuft nur als `authenticated`, die einen Grant HAT und im Rumpf mit 42501 abgelehnt
//     wird.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

const spawnedUsers: string[] = []
const spawnedBatteries: string[] = []

beforeAll(assertStackReachable)

afterAll(async () => {
  // Die Katalogzeilen entstehen ueber COMMIT (der Wrapper-Weg ist der echte Weg) und muessen
  // deshalb auch echt wieder weg — sonst stuenden Testgeraete im Bestand.
  for (const id of spawnedBatteries) {
    await sql('delete from public.battery_catalog where id = $1', [id]).catch(() => undefined)
  }
  for (const id of spawnedUsers) await deleteUser(id).catch(() => undefined)
  await pool.end()
})

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

async function newPlainUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

async function callNamed<T = Record<string, unknown>>(
  user: TestUser,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(
      `select ${fn}(${named}) as r`,
      keys.map((k) => args[k]),
    )
    return rows[0]!.r
  })
}

/** Legt ein Geraet ueber den ECHTEN Wrapper an (kein direkter INSERT) und merkt es zum Aufraeumen. */
async function createBattery(admin: TestUser, args: Record<string, unknown> = {}): Promise<string> {
  const res = await callNamed<{ status: string; id?: string }>(
    admin,
    'public.admin_create_battery',
    {
      p_kategorie: 'gewerbe',
      p_hersteller: 'Gate Hersteller',
      p_bezeichnung: `Gate ${randomUUID()}`,
      ...args,
    },
  )
  expect(res.status).toBe('created')
  spawnedBatteries.push(res.id!)
  return res.id!
}

/** Die Kenndaten, ohne die eine Zeile nicht aktivierbar ist — hier vollstaendig. */
const COMPLETE = {
  p_usable_capacity_kwh: 60,
  p_max_power_kw: 30,
  p_round_trip_efficiency: 0.9,
  p_list_price_net: 24000,
  p_inverter_included: true,
  p_requires_foundation: false,
}

describe('K1 — Rechtefläche', () => {
  it('anon/authenticated haben auf public.battery_catalog NUR select, service_role gar nichts', async () => {
    const rows = await sql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'battery_catalog'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    )
    const byRole = new Map<string, string[]>()
    for (const r of rows)
      byRole.set(r.grantee, [...(byRole.get(r.grantee) ?? []), r.privilege_type])

    expect(byRole.get('anon')).toEqual(['SELECT'])
    expect(byRole.get('authenticated')).toEqual(['SELECT'])
    expect(byRole.get('service_role')).toBeUndefined()
    expect(byRole.get('PUBLIC')).toBeUndefined()

    const [rls] = await sql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.battery_catalog'::regclass`,
    )
    expect(rls?.relrowsecurity).toBe(true)
  })

  it('platform.battery_purchase_prices hat RLS, KEINE Policy und für KEINE Rolle ein Grant', async () => {
    const [rls] = await sql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class
        where oid = 'platform.battery_purchase_prices'::regclass`,
    )
    expect(rls?.relrowsecurity).toBe(true)

    const policies = await sql(
      `select policyname from pg_policies
        where schemaname = 'platform' and tablename = 'battery_purchase_prices'`,
    )
    expect(policies).toHaveLength(0)

    const grants = await sql(
      `select grantee from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'battery_purchase_prices'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    )
    expect(grants).toHaveLength(0)
  })

  it('die sieben Wrapper sind authenticated-only (anon und service_role ohne EXECUTE)', async () => {
    // Arbeitsregel 5: gemessen über has_function_privilege, NICHT über einen Aufruf.
    const signatures = [
      'public.admin_list_battery_catalog(text, boolean)',
      'public.admin_get_battery(uuid)',
      'public.admin_create_battery(text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean, numeric, numeric, date, text, text, text, text)',
      'public.admin_update_battery(uuid, text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean, numeric, numeric, date, text, text, text, text)',
      'public.admin_set_battery_active(uuid, boolean)',
      'public.admin_delete_battery(uuid)',
      'public.admin_set_battery_purchase_price(uuid, numeric, date)',
    ]
    for (const sig of signatures) {
      const [row] = await sql<{ a: boolean; s: boolean; auth: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as a,
                has_function_privilege('service_role', $1, 'execute') as s,
                has_function_privilege('authenticated', $1, 'execute') as auth`,
        [sig],
      )
      expect({ sig, ...row }).toEqual({ sig, a: false, s: false, auth: true })
    }
  })

  it('ein angemeldeter Nicht-Admin wird mit 42501 abgewiesen', async () => {
    // Echter Aufruf, weil die Rolle den Grant BESITZT und die Ablehnung im Rumpf erfolgt
    // (Arbeitsregel 5) — genau der Fall, den ein Kunde in der App auslösen könnte.
    const plain = await newPlainUser()
    await expect(callNamed(plain, 'public.admin_list_battery_catalog')).rejects.toMatchObject({
      code: '42501',
    })
  })
})

describe('K1 — nur aktive Zeilen sind öffentlich lesbar', () => {
  it('anon sieht die aktive Zeile und die inaktive NICHT', async () => {
    const admin = await newAdmin()
    const activeId = await createBattery(admin, {
      ...COMPLETE,
      p_bezeichnung: `Gate aktiv ${randomUUID()}`,
    })
    const draftId = await createBattery(admin, { p_bezeichnung: `Gate entwurf ${randomUUID()}` })

    const activated = await callNamed<{ status: string }>(
      admin,
      'public.admin_set_battery_active',
      {
        p_id: activeId,
        p_active: true,
      },
    )
    expect(activated.status).toBe('activated')

    const visible = await runAs({ role: 'anon' }, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'select id from public.battery_catalog where id = any($1)',
        [[activeId, draftId]],
      )
      return rows.map((r) => r.id)
    })

    // Positivkontrolle und Negativkontrolle in EINER Abfrage: die aktive Zeile beweist, dass der
    // Lesepfad überhaupt trägt — ohne sie wäre „nichts gefunden" auch mit kaputter Policy grün.
    expect(visible).toEqual([activeId])
  })

  it('anon und authenticated können auf battery_catalog nicht schreiben', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin)

    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        runAs({ role }, (c) =>
          c.query('update public.battery_catalog set active = true where id = $1', [id]),
        ),
      ).rejects.toMatchObject({ code: '42501' })
    }
  })
})

describe('K1 — Aktivieren verlangt Vollständigkeit', () => {
  it('eine unvollständige Zeile wird mit BENANNTEN Feldern abgelehnt und bleibt inaktiv', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin, {
      p_usable_capacity_kwh: 10,
      p_inverter_included: false, // ⇒ der Wechselrichter-Aufpreis wird zur Pflicht
      p_requires_foundation: true, // ⇒ die Fundamentkosten ebenso
    })

    const res = await callNamed<{ status: string; missing: string[] }>(
      admin,
      'public.admin_set_battery_active',
      { p_id: id, p_active: true },
    )

    expect(res.status).toBe('incomplete')
    expect(res.missing).toEqual([
      'max_power_kw',
      'round_trip_efficiency',
      'list_price_net',
      'extra_inverter_cost_net',
      'foundation_cost_net',
    ])

    const [row] = await sql<{ active: boolean }>(
      'select active from public.battery_catalog where id = $1',
      [id],
    )
    expect(row?.active).toBe(false)
  })

  it('der CHECK greift auch an der Datenbank vorbei — gegen postgres', async () => {
    // Die Zusage gilt nicht nur für den Wrapper: `battery_catalog_active_complete` ist eine
    // Tabellenbedingung und damit auch gegen service_role und postgres wirksam.
    const admin = await newAdmin()
    const id = await createBattery(admin)

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query('update public.battery_catalog set active = true where id = $1', [id]),
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('eine vollständige Zeile lässt sich aktivieren und wieder zurücknehmen', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin, COMPLETE)

    expect(
      (
        await callNamed<{ status: string }>(admin, 'public.admin_set_battery_active', {
          p_id: id,
          p_active: true,
        })
      ).status,
    ).toBe('activated')

    expect(
      (
        await callNamed<{ status: string }>(admin, 'public.admin_set_battery_active', {
          p_id: id,
          p_active: false,
        })
      ).status,
    ).toBe('deactivated')
  })
})

describe('K1 — Einkaufspreis', () => {
  it('anon/authenticated erreichen die EK-Tabelle nicht, der Admin-Wrapper liefert die Zeile', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin, COMPLETE)

    const saved = await callNamed<{ status: string }>(
      admin,
      'public.admin_set_battery_purchase_price',
      { p_battery_id: id, p_purchase_price_net: 17500, p_as_of: '2026-09-22' },
    )
    expect(saved.status).toBe('saved')

    // Absenz-Beweis …
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        runAs({ role }, (c) => c.query('select * from platform.battery_purchase_prices')),
      ).rejects.toMatchObject({ code: '42501' })
    }

    // … mit Positiv-Kontrolle: dieselbe Zeile, über den geprüften Weg.
    const list = await callNamed<Array<Record<string, unknown>>>(
      admin,
      'public.admin_list_battery_catalog',
      {},
    )
    const entry = list.find((r) => r.id === id)
    expect(entry?.purchase_price_net).toBe(17500)
    expect(entry?.purchase_price_as_of).toBe('2026-09-22')
  })

  it('ein null-Preis entfernt den Eintrag; der Katalog-Eintrag bleibt', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin)

    await callNamed(admin, 'public.admin_set_battery_purchase_price', {
      p_battery_id: id,
      p_purchase_price_net: 900,
      p_as_of: '2026-09-22',
    })
    const cleared = await callNamed<{ status: string }>(
      admin,
      'public.admin_set_battery_purchase_price',
      { p_battery_id: id },
    )
    expect(cleared.status).toBe('cleared')

    const got = await callNamed<{ status: string; battery: Record<string, unknown> }>(
      admin,
      'public.admin_get_battery',
      { p_id: id },
    )
    expect(got.status).toBe('ok')
    expect(got.battery.purchase_price_net).toBeNull()
  })

  it('das Löschen eines Geräts nimmt seinen Einkaufspreis mit', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin)
    await callNamed(admin, 'public.admin_set_battery_purchase_price', {
      p_battery_id: id,
      p_purchase_price_net: 500,
      p_as_of: '2026-09-22',
    })

    const deleted = await callNamed<{ status: string }>(admin, 'public.admin_delete_battery', {
      p_id: id,
    })
    expect(deleted.status).toBe('deleted')

    const left = await sql('select 1 from platform.battery_purchase_prices where battery_id = $1', [
      id,
    ])
    expect(left).toHaveLength(0)
  })
})

describe('K1 — Bearbeiten', () => {
  it('admin_update_battery schreibt vollständig neu: null löscht ein Feld', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin, { ...COMPLETE, p_notes: 'vorläufig' })

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_battery', {
      p_id: id,
      p_kategorie: 'heim',
      p_hersteller: 'Gate Hersteller',
      p_bezeichnung: 'Gate umbenannt',
      p_usable_capacity_kwh: 12,
    })
    expect(res.status).toBe('updated')

    const [row] = await sql<{
      kategorie: string
      notes: string | null
      max_power_kw: string | null
    }>('select kategorie, notes, max_power_kw from public.battery_catalog where id = $1', [id])
    expect(row?.kategorie).toBe('heim')
    // Nicht übergeben heisst hier GELÖSCHT — anders als bei capture_lead. Begründet im Wrapper.
    expect(row?.notes).toBeNull()
    expect(row?.max_power_kw).toBeNull()
  })

  it('einer AKTIVEN Zeile lässt sich kein Pflichtwert wegnehmen', async () => {
    const admin = await newAdmin()
    const id = await createBattery(admin, COMPLETE)
    await callNamed(admin, 'public.admin_set_battery_active', { p_id: id, p_active: true })

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_battery', {
      p_id: id,
      p_kategorie: 'gewerbe',
      p_hersteller: 'Gate Hersteller',
      p_bezeichnung: 'Gate ohne Preis',
      // list_price_net fehlt ⇒ battery_catalog_active_complete greift
      p_usable_capacity_kwh: 60,
      p_max_power_kw: 30,
      p_round_trip_efficiency: 0.9,
      p_inverter_included: true,
      p_requires_foundation: false,
    })
    expect(res.status).toBe('invalid_values')
  })

  it('unmögliche Kenndaten werden benannt statt als 23514 durchzuschlagen', async () => {
    const admin = await newAdmin()
    const res = await callNamed<{ status: string }>(admin, 'public.admin_create_battery', {
      p_kategorie: 'heim',
      p_hersteller: 'Gate',
      p_bezeichnung: `Gate unmoeglich ${randomUUID()}`,
      p_round_trip_efficiency: 1.5,
    })
    expect(res.status).toBe('invalid_values')
  })
})
