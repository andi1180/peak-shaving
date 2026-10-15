// DB-Gate für die Benutzungsdauer-Stufen (Migration 20261015120000_grid_tariff_usage_tiers.sql).
//
// CHECKs in beide Richtungen, echte Aufrufe aller vier Wrapper (Arbeitsregel 2), Rechtefläche über
// has_function_privilege (Arbeitsregel 5). Alles in zurückgerollten Transaktionen.

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

const OP = 'gate-tiers'
const FULL = { label: 'normal', time_from: '00:00', time_to: '24:00', ct_per_kwh: 6.1 }
const SNAP = { label: 'snap', time_from: '10:00', time_to: '16:00', ct_per_kwh: 3.2 }
const SEASON = { ...FULL, month_day_from: '04-01', month_day_to: '09-30' }
const TIERS = {
  p_tier_threshold_hours: 2500,
  p_tier2_leistungspreis_eur_per_kw_year: 110.4,
  p_tier2_arbeitspreis_ct_per_kwh: 1.9,
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

type Result = { status: string; id?: string }

async function call(c: PoolClient, fn: string, args: Record<string, unknown>): Promise<Result> {
  const keys = Object.keys(args)
  const res = await c.query<{ r: Result }>(
    `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`,
    keys.map((k) => args[k]),
  )
  return res.rows[0]!.r
}

function createArgs(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    p_operator_id: OP,
    p_operator_name: 'Gate Netz DE',
    p_netzebene: 5,
    p_grundpreis_amount: 20.5,
    p_grundpreis_unit: 'eur_per_kw_year',
    p_netzverlust_ct_per_kwh: 0,
    p_price_basis: 'net',
    p_valid_from: '2026-01-01',
    p_created_by: 'gate@test.local',
    p_windows: JSON.stringify([FULL]),
    p_country: 'DE',
    ...over,
  }
}

/** Führt `fn` in einem Savepoint aus und liefert den Fehlercode samt Meldung (oder null). */
async function failure(
  c: PoolClient,
  fn: () => Promise<unknown>,
): Promise<{ code?: string; message?: string; constraint?: string } | null> {
  await c.query('savepoint sp')
  try {
    await fn()
    await c.query('release savepoint sp')
    return null
  } catch (e) {
    await c.query('rollback to savepoint sp')
    return e as { code?: string; message?: string; constraint?: string }
  }
}

async function rowCount(c: PoolClient): Promise<number> {
  const r = await c.query<{ n: number }>(
    'select count(*)::int n from public.grid_tariffs where operator_id = $1',
    [OP],
  )
  return r.rows[0]!.n
}

describe('CHECKs auf public.grid_tariffs — beide Richtungen', () => {
  async function insert(c: PoolClient, unit: string, tiers: (number | null)[], from: string) {
    await c.query(
      `insert into public.grid_tariffs
         (operator_id, operator_name, netzebene, grundpreis_amount, grundpreis_unit,
          netzverlust_ct_per_kwh, price_basis, valid_from, created_by, country,
          tier_threshold_hours, tier2_leistungspreis_eur_per_kw_year, tier2_arbeitspreis_ct_per_kwh)
       values ($1, 'Gate', 5, 20, $2, 0, 'net', $3, 'gate', 'DE', $4, $5, $6)`,
      [OP, unit, from, ...tiers],
    )
  }

  it('0 und 3 Felder sind zulässig; 1 und 2 Felder, eur_per_year, negative Werte und Schwelle 0 nicht', async () => {
    await runAs({ role: 'postgres' }, async (c) => {
      expect(
        await failure(c, () => insert(c, 'eur_per_kw_year', [null, null, null], '2020-01-01')),
      ).toBeNull()
      expect(
        await failure(c, () => insert(c, 'eur_per_kw_year', [2500, 110, 1.9], '2021-01-01')),
      ).toBeNull()

      const cases: [string, (number | null)[], string][] = [
        ['eur_per_kw_year', [2500, null, null], 'grid_tariffs_tiers_all_or_none'],
        ['eur_per_kw_year', [2500, 110, null], 'grid_tariffs_tiers_all_or_none'],
        ['eur_per_year', [2500, 110, 1.9], 'grid_tariffs_tiers_require_kw_price'],
        ['eur_per_kw_year', [2500, -1, 1.9], 'grid_tariffs_tier2_leistungspreis_check'],
        ['eur_per_kw_year', [2500, 110, -0.1], 'grid_tariffs_tier2_arbeitspreis_check'],
        ['eur_per_kw_year', [0, 110, 1.9], 'grid_tariffs_tier_threshold_check'],
      ]
      for (const [i, [unit, tiers, constraint]] of cases.entries()) {
        const err = await failure(c, () => insert(c, unit, tiers, `202${2 + i}-01-01`))
        expect(err?.code).toBe('23514')
        expect(err?.constraint).toBe(constraint)
      }
    })
  })
})

describe('create_grid_tariff / backfill_grid_tariff mit Stufen', () => {
  it('legt mit und ohne Stufen an; ein zweites Fenster oder eine Saison wird abgewiesen, ohne Zeile', async () => {
    await runAs({ role: 'service_role' }, async (c) => {
      const without = await call(
        c,
        'create_grid_tariff',
        createArgs({ p_valid_from: '2025-01-01' }),
      )
      expect(without.status).toBe('created')

      const withTiers = await call(c, 'create_grid_tariff', createArgs(TIERS))
      expect(withTiers.status).toBe('created')
      const row = await c.query(
        `select tier_threshold_hours::float t, tier2_leistungspreis_eur_per_kw_year::float kw,
                tier2_arbeitspreis_ct_per_kwh::float ct
           from public.grid_tariffs where id = any($1::uuid[]) order by valid_from`,
        [[without.id, withTiers.id]],
      )
      expect(row.rows).toEqual([
        { t: null, kw: null, ct: null },
        { t: 2500, kw: 110.4, ct: 1.9 },
      ])

      const before = await rowCount(c)
      for (const windows of [[FULL, SNAP], [SEASON], [{ ...FULL, time_to: '22:00' }]]) {
        const r = await call(
          c,
          'create_grid_tariff',
          createArgs({ ...TIERS, p_valid_from: '2027-01-01', p_windows: JSON.stringify(windows) }),
        )
        expect(r.status).toBe('tiers_require_single_window')
      }
      expect(await rowCount(c)).toBe(before)
    })
  })

  it('backfill trägt Stufen ein und weist mit Stufen ein zweites Fenster ab', async () => {
    await runAs({ role: 'service_role' }, async (c) => {
      expect((await call(c, 'create_grid_tariff', createArgs())).status).toBe('created')
      // backfill übernimmt den Anzeigenamen aus dem Bestand und hat dafür keinen Parameter.
      const base = createArgs()
      delete base.p_operator_name

      const bad = await call(c, 'backfill_grid_tariff', {
        ...base,
        ...TIERS,
        p_valid_from: '2025-01-01',
        p_windows: JSON.stringify([FULL, SNAP]),
      })
      expect(bad.status).toBe('tiers_require_single_window')

      const ok = await call(c, 'backfill_grid_tariff', {
        ...base,
        ...TIERS,
        p_valid_from: '2025-01-01',
      })
      expect(ok.status).toBe('backfilled')
      const r = await c.query(
        'select tier_threshold_hours::float t from public.grid_tariffs where id = $1',
        [ok.id],
      )
      expect(r.rows[0]).toEqual({ t: 2500 })
    })
  })
})

describe('add_grid_tariff_rate_window an einer Zeile mit Stufen', () => {
  it('weist das zweite Fenster ab — an einer Zeile ohne Stufen geht es weiterhin', async () => {
    await runAs({ role: 'service_role' }, async (c) => {
      const tiers = await call(c, 'create_grid_tariff', createArgs(TIERS))
      const plain = await call(
        c,
        'create_grid_tariff',
        createArgs({ p_operator_id: `${OP}-plain` }),
      )
      const add = (id: string) =>
        call(c, 'add_grid_tariff_rate_window', {
          p_tariff_id: id,
          p_label: 'snap',
          p_time_from: '10:00',
          p_time_to: '16:00',
          p_ct_per_kwh: 3.2,
        })

      const err = await failure(c, () => add(tiers.id!))
      expect(err?.code).toBe('P0001')
      expect(err?.message).toBe('tiers_require_single_window')
      expect((await add(plain.id!)).status).toBe('added')
    })
  })
})

describe('update_grid_tariff mit Stufen', () => {
  it('setzt Stufen, protokolliert sie in old_row/new_row und weist ein zweites Fenster ab', async () => {
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      await c.query('reset role')
      await c.query(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [
        admin.id,
      ])
      const created = await call(c, 'create_grid_tariff', createArgs())
      await c.query('set local role authenticated')

      const updateArgs = (over: Record<string, unknown>) => ({
        p_tariff_id: created.id,
        p_reason: 'Stufen nachgetragen',
        p_operator_name: 'Gate Netz DE',
        p_grundpreis_amount: 20.5,
        p_grundpreis_unit: 'eur_per_kw_year',
        p_netzverlust_ct_per_kwh: 0,
        p_price_basis: 'net',
        p_valid_from: '2026-01-01',
        p_valid_until: null,
        p_windows: JSON.stringify([FULL]),
        ...over,
      })

      const bad = await call(
        c,
        'update_grid_tariff',
        updateArgs({ ...TIERS, p_windows: JSON.stringify([FULL, SNAP]) }),
      )
      expect(bad.status).toBe('tiers_require_single_window')

      expect((await call(c, 'update_grid_tariff', updateArgs(TIERS))).status).toBe('updated')

      const log = await c.query<{ r: { tariff_id: string; old_row: object; new_row: object }[] }>(
        'select public.admin_list_grid_tariff_changes() as r',
      )
      const entry = log.rows[0]!.r.find((e) => e.tariff_id === created.id)
      expect(entry?.old_row).toMatchObject({
        tier_threshold_hours: null,
        tier2_leistungspreis_eur_per_kw_year: null,
        tier2_arbeitspreis_ct_per_kwh: null,
      })
      expect(entry?.new_row).toMatchObject({
        tier_threshold_hours: 2500,
        tier2_leistungspreis_eur_per_kw_year: 110.4,
        tier2_arbeitspreis_ct_per_kwh: 1.9,
      })
    })
  })
})

describe('Rechtefläche der vier Wrapper — wie vorher', () => {
  it('create/backfill/add_window nur service_role, update nur authenticated, je genau eine Fassung', async () => {
    const rows = await sql<{
      fn: string
      anon: boolean
      auth: boolean
      svc: boolean
      pub: boolean
    }>(
      `select p.proname fn,
              has_function_privilege('anon',          p.oid, 'execute') anon,
              has_function_privilege('authenticated', p.oid, 'execute') auth,
              has_function_privilege('service_role',  p.oid, 'execute') svc,
              has_function_privilege('public',        p.oid, 'execute') pub
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_grid_tariff', 'backfill_grid_tariff', 'update_grid_tariff',
                            'add_grid_tariff_rate_window')
        order by 1`,
    )
    expect(rows).toEqual([
      { fn: 'add_grid_tariff_rate_window', anon: false, auth: false, svc: true, pub: false },
      { fn: 'backfill_grid_tariff', anon: false, auth: false, svc: true, pub: false },
      { fn: 'create_grid_tariff', anon: false, auth: false, svc: true, pub: false },
      { fn: 'update_grid_tariff', anon: false, auth: true, svc: false, pub: false },
    ])
  })
})
