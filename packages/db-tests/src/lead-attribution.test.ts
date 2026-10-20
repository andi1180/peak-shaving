// DB-Gate für die Herkunft (Leadgen 5): first touch bleibt beim ersten Wert, jede Absendung trägt
// ihre eigene Herkunft, utm_source filtert Liste und Ausfuhr. Alle neuen/geänderten Wrapper echt
// aufgerufen (Arbeitsregel 2); fehlende Rechte per has_function_privilege (Arbeitsregel 5).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, createUser, deleteUser, pool, runAs, sql } from './client'

const SOURCE = 'profi-report-anfrage'

beforeAll(async () => {
  await assertStackReachable()
  // Reste eines abgebrochenen Laufs (committete Leads) würden den first touch vorwegnehmen.
  await sql(`delete from platform.leads where email like 'attr-gate-%@example.invalid'`)
})

afterAll(async () => {
  await pool.end()
})

async function captureLeadId(client: PoolClient, email: string): Promise<string> {
  const { rows } = await client.query<{ lead_id: string }>(
    `select public.capture_lead(p_email => $1, p_source_key => $2) ->> 'lead_id' as lead_id`,
    [email, SOURCE],
  )
  return rows[0]!.lead_id
}

async function record(
  client: PoolClient,
  leadId: string,
  channel: string,
  utm: { source?: string; campaign?: string; path?: string; host?: string } = {},
) {
  const { rows } = await client.query<{ r: { status: string; first_touch: boolean } }>(
    `select public.record_lead_attribution(
              p_lead_id => $1, p_channel => $2, p_utm_source => $3, p_utm_campaign => $4,
              p_landing_path => $5, p_referrer_host => $6) as r`,
    [leadId, channel, utm.source ?? null, utm.campaign ?? null, utm.path ?? null, utm.host ?? null],
  )
  return rows[0]!.r
}

describe('Leadgen 5: Herkunft', () => {
  it('first touch bleibt beim ersten Wert, jede Absendung bekommt ihre eigene Zeile', async () => {
    const admin = await createUser()
    const plain = await createUser()
    await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [admin.id])
    try {
      const leadId = await runAs({ role: 'service_role', commit: true }, async (client) => {
        const id = await captureLeadId(client, 'attr-gate-1@example.invalid')
        expect(
          await record(client, id, 'schnellreport', {
            source: 'linkedin',
            campaign: 'test',
            path: '/',
            host: 'WWW.LinkedIn.com',
          }),
        ).toEqual({ status: 'created', first_touch: true })
        expect(
          await record(client, id, 'profi_report', { source: 'newsletter', path: '/profi-report' }),
        ).toEqual({ status: 'created', first_touch: false })
        return id
      })
      await runAs({ role: 'service_role' }, async (client) => {
        await expect(record(client, leadId, 'telefon')).rejects.toThrow(/check/i)
      })

      const attribution = await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
        const { rows } = await c.query<{ r: Record<string, unknown> }>(
          `select public.admin_get_lead_attribution($1) as r`,
          [leadId],
        )
        return rows[0]!.r as {
          first_touch: Record<string, unknown>
          touches: Record<string, unknown>[]
        }
      })
      expect(attribution.first_touch).toMatchObject({
        utm_source: 'linkedin',
        utm_campaign: 'test',
        landing_path: '/',
        referrer_host: 'www.linkedin.com',
      })
      // Beide Zeilen entstehen in einer Transaktion (gleiches now()), daher ohne Reihenfolge.
      expect(attribution.touches.map((t) => [t.channel, t.utm_source]).sort()).toEqual([
        ['profi_report', 'newsletter'],
        ['schnellreport', 'linkedin'],
      ])

      // Filter: Liste und Ausfuhr treffen denselben Lead über den first touch, nicht über spätere.
      const listed = await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
        const hit = await c.query<{ ids: string[]; source: string }>(
          `select array(select x ->> 'id' from jsonb_array_elements(r -> 'leads') x) as ids,
                  r -> 'leads' -> 0 ->> 'first_utm_source' as source
             from public.admin_list_leads(p_utm_source => 'LINKED', p_limit => 200) r`,
        )
        const miss = await c.query<{ ids: string[] }>(
          `select array(select x ->> 'id' from jsonb_array_elements(r -> 'leads') x) as ids
             from public.admin_list_leads(p_utm_source => 'newsletter', p_limit => 200) r`,
        )
        const exported = await c.query<{ ids: string[]; summary: string }>(
          `select array(select x ->> 'id' from jsonb_array_elements(r -> 'rows') x) as ids,
                  r ->> 'filter_summary' as summary
             from public.admin_export_leads(p_utm_source => 'linked') r`,
        )
        return { hit: hit.rows[0]!, miss: miss.rows[0]!, exported: exported.rows[0]! }
      })
      expect(listed.hit.ids).toContain(leadId)
      expect(listed.miss.ids).not.toContain(leadId)
      expect(listed.exported.ids).toContain(leadId)
      expect(listed.exported.summary).toContain('utm_source enthält: linked')

      await expect(
        runAs({ role: 'authenticated', userId: plain.id }, (c) =>
          c.query(`select public.admin_get_lead_attribution($1)`, [leadId]),
        ),
      ).rejects.toMatchObject({ code: '42501' })

      await sql(`delete from platform.admin_exports where filter_summary like '%utm_source%'`)
      await sql(`delete from platform.leads where id = $1`, [leadId])
    } finally {
      await deleteUser(admin.id)
      await deleteUser(plain.id)
    }
  })

  it('ohne Herkunft entsteht „direkt" als first touch; ein anonymisierter Lead bleibt unberührt', async () => {
    await runAs({ role: 'service_role' }, async (client) => {
      const direct = await captureLeadId(client, 'attr-gate-2@example.invalid')
      expect(await record(client, direct, 'kontakt')).toMatchObject({ first_touch: true })
      const { rows } = await client.query<{ at: string | null; source: string | null }>(
        `select first_touch_at as at, first_utm_source as source from platform.leads where id = $1`,
        [direct],
      )
      expect(rows[0]!.at).not.toBeNull()
      expect(rows[0]!.source).toBeNull()
    })

    const anonymized = await runAs({ role: 'service_role', commit: true }, (client) =>
      captureLeadId(client, 'attr-gate-3@example.invalid'),
    )
    try {
      await sql(`select platform.anonymize_lead($1, null, true)`, [anonymized])
      await runAs({ role: 'service_role' }, async (client) => {
        expect(await record(client, anonymized, 'kontakt', { source: 'x' })).toMatchObject({
          first_touch: false,
        })
      })
    } finally {
      await sql(`delete from platform.leads where id = $1`, [anonymized])
    }
  })

  it('Profi-Report-Anfragen mit Lastgang-Angabe für den Admin lesbar', async () => {
    const admin = await createUser()
    await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [admin.id])
    try {
      const leadId = await runAs({ role: 'service_role', commit: true }, async (client) => {
        const id = await captureLeadId(client, 'attr-gate-4@example.invalid')
        await client.query(
          `select public.record_profi_report_request(p_lead_id => $1, p_has_load_profile => 'unsicher',
                                                     p_window_seconds => 0)`,
          [id],
        )
        return id
      })
      const rows = await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
        const { rows } = await c.query<{ r: Record<string, unknown>[] }>(
          `select public.admin_list_profi_report_requests($1) as r`,
          [leadId],
        )
        return rows[0]!.r
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ has_load_profile: 'unsicher' })
      await sql(`delete from platform.leads where id = $1`, [leadId])
    } finally {
      await deleteUser(admin.id)
    }
  })

  it('Rechte: Schreiben nur service_role, Lesen nur authenticated, Tabelle für keine API-Rolle', async () => {
    const rows = await sql<{ role: string; rec: boolean; get: boolean; pr: boolean; tbl: boolean }>(
      `select r.role,
              has_function_privilege(r.role, 'public.record_lead_attribution(uuid, text, text, text, text, text, text, text, text)', 'execute') as rec,
              has_function_privilege(r.role, 'public.admin_get_lead_attribution(uuid)', 'execute') as get,
              has_function_privilege(r.role, 'public.admin_list_profi_report_requests(uuid)', 'execute') as pr,
              has_table_privilege(r.role, 'platform.lead_attributions', 'select') as tbl
         from (values ('anon'), ('authenticated'), ('service_role')) as r(role)`,
    )
    expect(rows).toEqual([
      { role: 'anon', rec: false, get: false, pr: false, tbl: false },
      { role: 'authenticated', rec: false, get: true, pr: true, tbl: false },
      { role: 'service_role', rec: true, get: false, pr: false, tbl: false },
    ])
  })
})
