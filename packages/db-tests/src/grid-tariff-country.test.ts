// DB-Gate für das Land an den Netzentgelten (Migration 20261015090000_grid_tariff_country.sql).
//
// Echte Aufrufe der Wrapper als service_role bzw. authenticated (Arbeitsregel 2); die Rechtefläche
// über has_function_privilege, nie per Aufruf als Rolle ohne Grant (Arbeitsregel 5). Alles läuft in
// zurückgerollten Transaktionen.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

const OP = 'gate-country'

const CREATE_SIG =
  'public.create_grid_tariff(text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text, numeric, numeric, numeric)'
const BACKFILL_SIG =
  'public.backfill_grid_tariff(text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text, numeric, numeric, numeric)'

const WINDOWS = JSON.stringify([
  { label: 'normal', time_from: '00:00', time_to: '24:00', ct_per_kwh: 5.1 },
])

type Outcome = { status: string; id?: string }

async function create(
  c: PoolClient,
  a: { validFrom: string; country?: string; operator?: string },
): Promise<Outcome> {
  const withCountry = a.country !== undefined
  const res = await c.query(
    `select public.create_grid_tariff(
       p_operator_id            => $1,
       p_operator_name          => 'Gate Netz',
       p_netzebene              => 5::smallint,
       p_grundpreis_amount      => 38.52,
       p_grundpreis_unit        => 'eur_per_kw_year',
       p_netzverlust_ct_per_kwh => 1.23,
       p_price_basis            => 'net',
       p_valid_from             => $2::date,
       p_created_by             => 'gate@test.local',
       p_windows                => $3::jsonb
       ${withCountry ? ', p_country => $4' : ''}
     ) as r`,
    withCountry
      ? [a.operator ?? OP, a.validFrom, WINDOWS, a.country]
      : [a.operator ?? OP, a.validFrom, WINDOWS],
  )
  return (res.rows[0] as { r: Outcome }).r
}

async function backfill(
  c: PoolClient,
  a: { validFrom: string; country: string },
): Promise<Outcome> {
  const res = await c.query(
    `select public.backfill_grid_tariff(
       p_operator_id            => $1,
       p_netzebene              => 5::smallint,
       p_grundpreis_amount      => 30,
       p_grundpreis_unit        => 'eur_per_kw_year',
       p_netzverlust_ct_per_kwh => 1.1,
       p_price_basis            => 'net',
       p_valid_from             => $2::date,
       p_created_by             => 'gate@test.local',
       p_windows                => $3::jsonb,
       p_country                => $4
     ) as r`,
    [OP, a.validFrom, WINDOWS, a.country],
  )
  return (res.rows[0] as { r: Outcome }).r
}

async function countryOf(c: PoolClient, id: string): Promise<string> {
  await c.query('reset role')
  const res = await c.query<{ country: string }>(
    'select country from public.grid_tariffs where id = $1',
    [id],
  )
  return res.rows[0]!.country
}

let admin: TestUser

beforeAll(async () => {
  await assertStackReachable()
  admin = await createUser()
})
afterAll(async () => {
  if (admin) await deleteUser(admin.id).catch(() => undefined)
  await pool.end()
})

describe('grid_tariffs.country — Spalte und Anlage', () => {
  it('ist NOT NULL mit Vorgabe AT und kennt genau AT und DE', async () => {
    const rows = await sql<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'grid_tariffs' and column_name = 'country'`,
    )
    expect(rows[0]).toEqual({ is_nullable: 'NO', column_default: "'AT'::text" })

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(
          `insert into public.grid_tariffs (operator_id, operator_name, netzebene, grundpreis_amount,
             grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by, country)
           values ($1, 'X', 5, 1, 'eur_per_year', 1, 'net', '2026-01-01', 'gate', 'CH')`,
          [`${OP}-ch`],
        ),
      ),
    ).rejects.toThrow(/grid_tariffs_country_check/)
  })

  it('create_grid_tariff legt mit Land an; ohne Parameter gilt die Rückwärts-Vorgabe AT', async () => {
    await runAs({ role: 'service_role' }, async (c) => {
      const de = await create(c, { validFrom: '2026-01-01', country: 'DE', operator: `${OP}-de` })
      expect(de.status).toBe('created')
      const at = await create(c, { validFrom: '2026-01-01', operator: `${OP}-at` })
      expect(at.status).toBe('created')
      expect(await countryOf(c, de.id!)).toBe('DE')
      expect(await countryOf(c, at.id!)).toBe('AT')
    })
  })

  it('ein unbekanntes Land wird benannt abgewiesen, ohne zu schreiben', async () => {
    const out = await runAs({ role: 'service_role' }, (c) =>
      create(c, { validFrom: '2026-01-01', country: 'CH' }),
    )
    expect(out.status).toBe('invalid_country')
  })

  it('backfill_grid_tariff trägt im Land der Kombination nach', async () => {
    await runAs({ role: 'service_role' }, async (c) => {
      expect((await create(c, { validFrom: '2026-01-01', country: 'DE' })).status).toBe('created')
      const out = await backfill(c, { validFrom: '2025-01-01', country: 'DE' })
      expect(out.status).toBe('backfilled')
      expect(await countryOf(c, out.id!)).toBe('DE')
    })
  })
})

describe('eine operator_id gehört genau einem Land', () => {
  it('create mit zweitem Land scheitert (P0001 operator_country_mismatch)', async () => {
    await expect(
      runAs({ role: 'service_role' }, async (c) => {
        expect((await create(c, { validFrom: '2026-01-01', country: 'AT' })).status).toBe('created')
        await c.query(
          `select public.create_grid_tariff(
             p_operator_id => $1, p_operator_name => 'Gate Netz', p_netzebene => 7::smallint,
             p_metering_variant => 'mit_leistungsmessung', p_grundpreis_amount => 1,
             p_grundpreis_unit => 'eur_per_kw_year', p_netzverlust_ct_per_kwh => 1,
             p_price_basis => 'net', p_valid_from => '2026-01-01'::date,
             p_created_by => 'gate', p_windows => $2::jsonb, p_country => 'DE')`,
          [OP, WINDOWS],
        )
      }),
    ).rejects.toThrow('operator_country_mismatch')
  })

  it('backfill mit zweitem Land scheitert ebenso', async () => {
    await expect(
      runAs({ role: 'service_role' }, async (c) => {
        expect((await create(c, { validFrom: '2026-01-01', country: 'AT' })).status).toBe('created')
        await backfill(c, { validFrom: '2025-01-01', country: 'DE' })
      }),
    ).rejects.toThrow('operator_country_mismatch')
  })

  it('das Land ist ab Anlage fest — auch am Wrapper vorbei als postgres', async () => {
    await expect(
      runAs({ role: 'service_role' }, async (c) => {
        const out = await create(c, { validFrom: '2026-01-01', country: 'AT' })
        await c.query('reset role')
        await c.query(`update public.grid_tariffs set country = 'DE' where id = $1`, [out.id])
      }),
    ).rejects.toThrow('country_immutable')
  })
})

describe('update_grid_tariff ändert das Land nicht und protokolliert es', () => {
  it('Land bleibt, old_row und new_row tragen es', async () => {
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      await c.query('reset role')
      await c.query(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [
        admin.id,
      ])
      const ins = await c.query<{ id: string }>(
        `insert into public.grid_tariffs (operator_id, operator_name, netzebene, grundpreis_amount,
           grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by, country)
         values ($1, 'Gate Netz', 5, 38.52, 'eur_per_kw_year', 1.23, 'net', '2026-01-01', 'gate', 'DE')
         returning id`,
        [OP],
      )
      const id = ins.rows[0]!.id
      await c.query('set local role authenticated')
      const res = await c.query<{ r: { status: string } }>(
        `select public.update_grid_tariff(
           p_tariff_id => $1, p_reason => 'Gate', p_operator_name => 'Gate Netz',
           p_grundpreis_amount => 40, p_grundpreis_unit => 'eur_per_kw_year',
           p_netzverlust_ct_per_kwh => 1.23, p_price_basis => 'net',
           p_valid_from => '2026-01-01'::date, p_valid_until => null, p_windows => $2::jsonb) as r`,
        [id, WINDOWS],
      )
      expect(res.rows[0]!.r.status).toBe('updated')
      expect(await countryOf(c, id)).toBe('DE')
      const log = await c.query<{ old_c: string; new_c: string }>(
        `select old_row->>'country' as old_c, new_row->>'country' as new_c
           from platform.grid_tariff_changes where tariff_id = $1`,
        [id],
      )
      expect(log.rows).toEqual([{ old_c: 'DE', new_c: 'DE' }])
    })
  })
})

describe('Rechtefläche der geänderten Wrapper — wie vor der Migration', () => {
  it('create/backfill: genau eine Überladung, nur service_role, kein PUBLIC/anon/authenticated', async () => {
    for (const [name, sig] of [
      ['create_grid_tariff', CREATE_SIG],
      ['backfill_grid_tariff', BACKFILL_SIG],
    ] as const) {
      const overloads = await sql<{ n: number }>(
        `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name],
      )
      expect(overloads[0]!.n).toBe(1)
      const rows = await sql<Record<string, boolean>>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as svc,
                exists (select 1 from aclexplode((select proacl from pg_proc where oid = $1::regprocedure)) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec`,
        [sig],
      )
      expect(rows[0]).toEqual({ anon: false, auth: false, svc: true, public_exec: false })
    }
  })

  it('die Trigger-Funktion ist für keine Rolle aufrufbar', async () => {
    const rows = await sql<Record<string, boolean>>(
      `select has_function_privilege('anon', 'public.guard_grid_tariff_country()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.guard_grid_tariff_country()', 'execute') as auth,
              has_function_privilege('service_role', 'public.guard_grid_tariff_country()', 'execute') as svc`,
    )
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: false })
  })
})
