// DB-Gate für die Anfrage zum Profi-Report (Leadgen 4b): Herkunft, `record_profi_report_request`
// sperrt die Doppelabsendung (echt aufgerufen, Arbeitsregel 2), Rechte nur für service_role.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool, runAs, sql } from './client'
import {
  LEAD_SOURCE_KEYS_WITHOUT_FORM,
  isLeadCaptureFormKey,
} from '../../../apps/web/lib/leads/registry'

const SOURCE = 'profi-report-anfrage'

beforeAll(async () => {
  await assertStackReachable()
})

afterAll(async () => {
  await pool.end()
})

async function record(client: PoolClient, leadId: string, answer: string, windowSeconds: number) {
  const { rows } = await client.query<{ status: string }>(
    `select public.record_profi_report_request(
              p_lead_id => $1, p_has_load_profile => $2, p_window_seconds => $3
            ) ->> 'status' as status`,
    [leadId, answer, windowSeconds],
  )
  return rows[0]!.status
}

describe('Profi-Report-Anfrage', () => {
  it('Herkunft steht aktiv in platform.lead_sources, ohne Formular in der Registry', async () => {
    const rows = await sql<{ is_active: boolean }>(
      `select is_active from platform.lead_sources where key = $1`,
      [SOURCE],
    )
    expect(rows[0]?.is_active).toBe(true)
    expect([...LEAD_SOURCE_KEYS_WITHOUT_FORM]).toContain(SOURCE)
    expect(isLeadCaptureFormKey(SOURCE)).toBe(false)
  })

  it('legt Lead ohne Einwilligung an und meldet innerhalb des Fensters duplicate', async () => {
    await runAs({ role: 'service_role' }, async (client) => {
      const { rows } = await client.query<{ outcome: string; lead_id: string }>(
        `select r ->> 'outcome' as outcome, r ->> 'lead_id' as lead_id
           from public.capture_lead(p_email => 'pr-gate-1@example.invalid', p_source_key => $1,
                                    p_thema => 'profiReport') as r`,
        [SOURCE],
      )
      const { outcome, lead_id } = rows[0]!
      expect(outcome).toBe('lead_only')
      expect(await record(client, lead_id, 'ja', 900)).toBe('created')
      expect(await record(client, lead_id, 'nein', 900)).toBe('duplicate')
      expect(await record(client, lead_id, 'unsicher', 0)).toBe('created')
      await expect(record(client, lead_id, 'vielleicht', 0)).rejects.toThrow(/check/i)
    })
  })

  it('nur service_role darf aufrufen; die Tabelle ist für keine API-Rolle lesbar', async () => {
    const rows = await sql<{ role: string; exec: boolean; tbl: boolean }>(
      `select r.role,
              has_function_privilege(r.role,
                'public.record_profi_report_request(uuid, text, integer)', 'execute') as exec,
              has_table_privilege(r.role, 'platform.profi_report_requests', 'select') as tbl
         from (values ('anon'), ('authenticated'), ('service_role')) as r(role)`,
    )
    expect(rows).toEqual([
      { role: 'anon', exec: false, tbl: false },
      { role: 'authenticated', exec: false, tbl: false },
      { role: 'service_role', exec: true, tbl: false },
    ])
  })
})
