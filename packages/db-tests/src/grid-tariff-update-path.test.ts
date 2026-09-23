// DB-Gate für den Bearbeitungsweg der Netzbetreiber-Tarife
// (Migration 20260923230000_create_grid_tariff_update_path.sql).
//
// Jeder Fall läuft in einer zurückgerollten Transaktion als `authenticated` mit echtem Konto —
// die Adminprüfung sitzt im Rumpf (Arbeitsregel 5: für anon/service_role nur has_function_privilege).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, createUser, deleteUser, pool, runAs, type TestUser } from './client'

const OP = 'gate-grid-update'
const SIG =
  'public.update_grid_tariff(uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text)'

let admin: TestUser
let plain: TestUser

beforeAll(async () => {
  await assertStackReachable()
  admin = await createUser()
  plain = await createUser()
})

afterAll(async () => {
  for (const u of [admin, plain]) if (u) await deleteUser(u.id).catch(() => undefined)
  await pool.end()
})

type Result = { status: string; conflict_valid_from?: string }
type Snapshot = {
  netzverlust_ct_per_kwh: number
  messpreis_unit: string | null
  rate_windows: { note: string | null; ct_per_kwh: number }[]
}
type Change = { tariff_id: string; changed_by: string; old_row: Snapshot; new_row: Snapshot }

/** Zwei aufeinanderfolgende Stände derselben Kombination, als Eigentümer angelegt; Rolle danach: authenticated. */
async function seed(
  c: PoolClient,
  userId: string,
  asAdmin = true,
): Promise<{ older: string; open: string }> {
  await c.query('reset role')
  if (asAdmin) {
    await c.query(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [userId])
  }
  const ids: string[] = []
  for (const [from, until] of [
    ['2025-01-01', '2025-12-31'],
    ['2026-01-01', null],
  ] as const) {
    const r = await c.query<{ id: string }>(
      `insert into public.grid_tariffs
         (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
          grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, valid_until, created_by)
       values ($1, 'Gate Netz', 5, null, 38.52, 'eur_per_kw_year', 1.23, 'net', $2, $3, 'gate@test.local')
       returning id`,
      [OP, from, until],
    )
    const id = r.rows[0]!.id
    await c.query(
      `insert into public.grid_tariff_rate_windows
         (grid_tariff_id, label, time_from, time_to, ct_per_kwh, note)
       values ($1, 'normal', '00:00', '24:00', 4.5, 'Preisblatt S. 2')`,
      [id],
    )
    ids.push(id)
  }
  await c.query('set local role authenticated')
  return { older: ids[0]!, open: ids[1]! }
}

const WINDOWS = JSON.stringify([
  {
    label: 'normal',
    time_from: '00:00',
    time_to: '24:00',
    ct_per_kwh: 4.5,
    note: 'Preisblatt S. 2',
  },
])

async function update(
  c: PoolClient,
  id: string,
  over: Record<string, unknown> = {},
): Promise<Result> {
  const args: Record<string, unknown> = {
    p_tariff_id: id,
    p_reason: 'Tippfehler im Netzverlust',
    p_operator_name: 'Gate Netz',
    p_grundpreis_amount: 38.52,
    p_grundpreis_unit: 'eur_per_kw_year',
    p_netzverlust_ct_per_kwh: 1.23,
    p_price_basis: 'net',
    p_valid_from: '2026-01-01',
    p_valid_until: null,
    p_windows: WINDOWS,
    p_messpreis_amount: null,
    p_messpreis_unit: null,
    ...over,
  }
  const keys = Object.keys(args)
  const res = await c.query<{ r: Result }>(
    `select public.update_grid_tariff(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`,
    keys.map((k) => args[k]),
  )
  return res.rows[0]!.r
}

async function changeCount(c: PoolClient): Promise<number> {
  const res = await c.query<{ r: unknown[] }>('select public.admin_list_grid_tariff_changes() as r')
  return (res.rows[0]!.r as { tariff_id: string }[]).length
}

describe('update_grid_tariff', () => {
  it('ändert Zeile + Fenster und protokolliert alt/neu; ein zweiter identischer Aufruf protokolliert nichts', async () => {
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      const { open } = await seed(c, admin.id)
      const before = await changeCount(c)

      const over = {
        p_netzverlust_ct_per_kwh: 1.5,
        p_messpreis_amount: 2.4,
        p_messpreis_unit: 'eur_per_month',
        p_windows: JSON.stringify([
          {
            label: 'normal',
            time_from: '00:00',
            time_to: '24:00',
            ct_per_kwh: 4.7,
            note: 'korrigiert',
          },
        ]),
      }
      expect((await update(c, open, over)).status).toBe('updated')

      const log = (
        await c.query<{ r: Change[] }>('select public.admin_list_grid_tariff_changes() as r')
      ).rows[0]!.r
      expect(log.length).toBe(before + 1)
      const entry = log[0]!
      expect(entry.tariff_id).toBe(open)
      expect(entry.changed_by).toBe(admin.email)
      expect(entry.old_row.netzverlust_ct_per_kwh).toBe(1.23)
      expect(entry.new_row.netzverlust_ct_per_kwh).toBe(1.5)
      expect(entry.new_row.messpreis_unit).toBe('eur_per_month')
      expect(entry.old_row.rate_windows[0]!.note).toBe('Preisblatt S. 2')
      expect(entry.new_row.rate_windows[0]!.ct_per_kwh).toBe(4.7)

      expect((await update(c, open, over)).status).toBe('unchanged')
      expect(await changeCount(c)).toBe(before + 1)
    })
  })

  it('weist halbes Messpreis-Paar, Überlappung und fehlenden Grund ab — ohne Protokolleintrag', async () => {
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      const { older, open } = await seed(c, admin.id)
      const before = await changeCount(c)

      await c.query('savepoint s')
      await expect(update(c, open, { p_messpreis_amount: 2.4 })).rejects.toMatchObject({
        code: 'P0001',
        message: 'invalid_input',
      })
      await c.query('rollback to savepoint s')

      const overlap = await update(c, older, {
        p_valid_from: '2025-01-01',
        p_valid_until: '2026-01-15',
      })
      expect(overlap.status).toBe('overlap')
      expect(overlap.conflict_valid_from).toBe('2026-01-01')

      await expect(update(c, open, { p_reason: '   ' })).rejects.toMatchObject({
        code: 'P0001',
        message: 'reason_required',
      })
      await c.query('rollback to savepoint s')

      expect(await changeCount(c)).toBe(before)
      const row = await c.query(
        'select messpreis_amount, valid_until from public.grid_tariffs where id = $1',
        [older],
      )
      expect(row.rows[0]).toEqual({ messpreis_amount: null, valid_until: expect.any(Date) })
    })
  })

  it('Nicht-Admin bekommt 42501; anon und service_role haben kein EXECUTE', async () => {
    await runAs({ role: 'authenticated', userId: plain.id }, async (c) => {
      const { open } = await seed(c, plain.id, false)
      await expect(update(c, open)).rejects.toMatchObject({ code: '42501' })
    })
    const priv = await pool.query<{ role: string; upd: boolean; list: boolean }>(
      `select r as role,
              has_function_privilege(r, '${SIG}', 'execute') upd,
              has_function_privilege(r, 'public.admin_list_grid_tariff_changes()', 'execute') list
         from unnest(array['anon', 'service_role', 'authenticated']) r`,
    )
    expect(priv.rows).toEqual([
      { role: 'anon', upd: false, list: false },
      { role: 'service_role', upd: false, list: false },
      { role: 'authenticated', upd: true, list: true },
    ])
  })
})
