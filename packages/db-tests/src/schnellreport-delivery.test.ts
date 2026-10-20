// DB-Gate für den Schnellreport per E-Mail (Leadgen 3b-2): herkunftsgebundene Einwilligungstexte,
// `capture_lead` archiviert den richtigen Wortlaut, `record_schnellreport_request` sperrt den
// Doppelversand. Jeder neue/geänderte Wrapper wird echt aufgerufen (Arbeitsregel 2), in einer
// Transaktion mit rollback.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool, runAs, sql } from './client'
import {
  LEAD_SOURCE_KEYS_WITHOUT_FORM,
  isLeadCaptureFormKey,
} from '../../../apps/web/lib/leads/registry'

const SOURCE = 'schnellreport'

beforeAll(async () => {
  await assertStackReachable()
})

afterAll(async () => {
  await pool.end()
})

async function capture(client: PoolClient, email: string, source: string, purpose: string) {
  const { rows } = await client.query<{ outcome: string; lead_id: string; consent_id: string }>(
    `select r ->> 'outcome' as outcome, r ->> 'lead_id' as lead_id, r ->> 'consent_id' as consent_id
       from public.capture_lead(
              p_email => $1, p_source_key => $2, p_purpose => $3::platform.consent_purpose,
              p_token_hash => 'hash', p_token_expires_at => now() + interval '7 days'
            ) as r`,
    [email, source, purpose],
  )
  return rows[0]!
}

async function archivedBody(client: PoolClient, consentId: string): Promise<string> {
  const { rows } = await client.query<{ body: string }>(
    `select ct.body from platform.consents c
       join platform.consent_texts ct on ct.id = c.consent_text_id where c.id = $1`,
    [consentId],
  )
  return rows[0]!.body
}

describe('Herkunft', () => {
  it('steht aktiv in platform.lead_sources, ohne Formular in der Registry', async () => {
    const rows = await sql<{ is_active: boolean }>(
      `select is_active from platform.lead_sources where key = $1`,
      [SOURCE],
    )
    expect(rows[0]?.is_active).toBe(true)
    expect([...LEAD_SOURCE_KEYS_WITHOUT_FORM]).toContain(SOURCE)
    expect(isLeadCaptureFormKey(SOURCE)).toBe(false)
  })
})

describe('herkunftsgebundene Einwilligungstexte', () => {
  it('capture_lead archiviert für den Schnellreport dessen Wortlaut, für andere Herkünfte den allgemeinen', async () => {
    await runAs({ role: 'service_role' }, async (client) => {
      const delivery = await capture(client, 'sr-gate-1@example.invalid', SOURCE, 'result_delivery')
      expect(delivery.outcome).toBe('consent_confirmed')
      expect(await archivedBody(client, delivery.consent_id)).toBe(
        'Mit dem Absenden erhalten Sie Ihren Schnellreport per E-Mail.',
      )

      const tips = await capture(client, 'sr-gate-1@example.invalid', SOURCE, 'marketing_email')
      expect(tips.outcome).toBe('consent_created')
      expect(await archivedBody(client, tips.consent_id)).toMatch(/^Ja, schicken Sie mir/)

      const call = await capture(client, 'sr-gate-1@example.invalid', SOURCE, 'offer_contact')
      expect(await archivedBody(client, call.consent_id)).toBe(
        'Sollen wir Ihnen in 15 Minuten am Telefon erklären, was das für Ihren Betrieb bedeutet?',
      )

      // Der Report-Download in apps/website bekommt weiter die allgemeine Fassung.
      const gate = await capture(
        client,
        'sr-gate-2@example.invalid',
        'rechner-report',
        'offer_contact',
      )
      expect(await archivedBody(client, gate.consent_id)).toMatch(
        /^Ich willige ein, dass die COOLiN/,
      )
    })
  })

  it('get_active_consent_text bleibt allgemein, get_source_consent_text liefert die gebundene Fassung', async () => {
    await runAs({ role: 'service_role' }, async (client) => {
      const { rows } = await client.query<{ general: string; bound: string; fallback: string }>(
        `select public.get_active_consent_text('offer_contact', 'de') ->> 'body' as general,
                public.get_source_consent_text('offer_contact', $1, 'de') ->> 'body' as bound,
                public.get_source_consent_text('offer_contact', 'rechner-report', 'de') ->> 'body' as fallback`,
        [SOURCE],
      )
      expect(rows[0]!.general).toMatch(/^Ich willige ein/)
      expect(rows[0]!.bound).toMatch(/^Sollen wir Ihnen/)
      expect(rows[0]!.fallback).toBe(rows[0]!.general)
    })
  })
})

describe('record_schnellreport_request', () => {
  async function record(client: PoolClient, leadId: string, windowSeconds: number) {
    const { rows } = await client.query<{ status: string }>(
      `select public.record_schnellreport_request(
                p_lead_id => $1, p_country => 'AT', p_branche => 'produktion', p_annual_kwh => 250000,
                p_peak_kw => 180, p_peak_kw_entered => true, p_demand_price_eur_per_kw => 67,
                p_peak_cost_eur => 12100, p_tips_requested => false, p_window_seconds => $2,
                p_bill_eur => 65000
              ) ->> 'status' as status`,
      [leadId, windowSeconds],
    )
    return rows[0]!.status
  }

  it('legt an und meldet innerhalb des Fensters duplicate', async () => {
    await runAs({ role: 'service_role' }, async (client) => {
      const { lead_id } = await capture(
        client,
        'sr-gate-3@example.invalid',
        SOURCE,
        'result_delivery',
      )
      expect(await record(client, lead_id, 900)).toBe('created')
      expect(await record(client, lead_id, 900)).toBe('duplicate')
      // Fenster 0: die bestehende Zeile liegt nicht mehr darin.
      expect(await record(client, lead_id, 0)).toBe('created')
    })
  })

  it('nur service_role darf aufrufen; die Tabelle ist für keine API-Rolle lesbar', async () => {
    const rows = await sql<{ role: string; exec: boolean; tbl: boolean }>(
      `select r.role,
              has_function_privilege(r.role,
                'public.record_schnellreport_request(uuid, text, text, integer, numeric, boolean, numeric, integer, boolean, integer, integer)',
                'execute') as exec,
              has_table_privilege(r.role, 'platform.schnellreport_requests', 'select') as tbl
         from (values ('anon'), ('authenticated'), ('service_role')) as r(role)`,
    )
    expect(rows).toEqual([
      { role: 'anon', exec: false, tbl: false },
      { role: 'authenticated', exec: false, tbl: false },
      { role: 'service_role', exec: true, tbl: false },
    ])
  })
})
