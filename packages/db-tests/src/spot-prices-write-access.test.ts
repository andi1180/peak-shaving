// DB-Gate für den Schreibweg der Spotpreise
// (Migration 20260827160000_grant_service_role_spot_prices_write.sql, B21-2a).
//
// B21-1 hat `public.spot_prices` OHNE jedes Recht für `service_role` angelegt — auch ohne lesendes.
// Dieser Schritt öffnet genau eine Rolle für genau eine Tabelle, damit der tägliche aWATTar-Abruf
// (`apps/web/app/api/cron/spot-price-sync`) und der einmalige Backfill schreiben können.
//
// ── (1) ⚠ DER GRANT MUSS `select` MITFÜHREN, OBWOHL DER SYNC NICHTS LIEST ──────────────────────
//     `INSERT … ON CONFLICT (provider, ts_start) DO UPDATE` verlangt in PostgreSQL zusätzlich zu
//     INSERT und UPDATE das SELECT-Recht — die Konfliktauflösung muss die Arbiter-Spalten lesen.
//     Das ist KEINE PostgREST-Eigenheit: es wurde als rohes SQL unter `set local role service_role`
//     Stufe für Stufe gemessen (insert → 42501, insert+update → 42501, +select → OK), während ein
//     reines INSERT ohne `on conflict` bereits mit dem blossen INSERT-Recht durchläuft.
//     Der Test unten fährt genau den Weg, den der Sync fährt — das Upsert, nicht ein blosses INSERT.
//     Ein Test, der nur ein INSERT prüfte, bliebe bei einem auf `insert, update` verkürzten Grant
//     GRÜN und liesse den Sync in Produktion mit 42501 auflaufen.
//
// ── (2) DIE ÖFFNUNG IST AUF EINE TABELLE BEGRENZT, UND DAS WIRD GEMESSEN ───────────────────────
//     `grid_tariffs` und `grid_tariff_rate_windows` bleiben für `service_role` ohne jedes Recht;
//     ihr Schreibweg ist das Admin-Pflege-UI und damit ein eigener PR. Ein versehentlich zu breiter
//     Grant fiele sonst nirgends auf — der Lesepfad funktioniert unverändert, und keine Oberfläche
//     zeigt einen Unterschied.
//
// ── (3) KEIN `delete`, AUCH NICHT FÜR `service_role` ───────────────────────────────────────────
//     Der Sync überschreibt per Upsert und löscht nie. Ein historischer Marktpreis ist eine Tatsache
//     der Vergangenheit; eine Zeile zu entfernen hiesse, eine bereits gerechnete Simulation
//     nachträglich um ihre Grundlage zu bringen.
//
// ── (4) DIE CLIENT-ROLLEN BLEIBEN UNVERÄNDERT NUR LESEND ───────────────────────────────────────
//     Regressionsprüfung gegen den eigentlichen Unfall dieses Schritts: ein Grant, der versehentlich
//     `anon` oder `authenticated` mit öffnet. `grid-tariffs-schema.test.ts` (B21-1) prüft das für
//     alle drei Tabellen; hier steht es für `spot_prices` noch einmal ausdrücklich neben dem neuen
//     Recht, weil genau diese Tabelle in diesem Schritt angefasst wird.
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`) — die Tabelle
// bleibt auch während des Laufs leer, und parallel laufende Testdateien sehen nichts.

import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Der Weg, den der Sync tatsächlich fährt (`SPOT_PRICES_ON_CONFLICT` in sync.ts). */
const UPSERT_SQL = `insert into public.spot_prices (provider, ts_start, ts_end, ct_per_kwh, price_basis)
  values ('gate-b21-2a', '2020-01-01T00:00:00Z', '2020-01-01T01:00:00Z', 17.797, 'net')
  on conflict (provider, ts_start)
  do update set ct_per_kwh = excluded.ct_per_kwh, ts_end = excluded.ts_end, fetched_at = now()`

async function attempt(role: 'anon' | 'authenticated' | 'service_role', query: string) {
  return runAs({ role }, async (c) => {
    try {
      await c.query(query)
      return null
    } catch (e) {
      return e as { code?: string }
    }
  })
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('B21-2a — service_role darf spot_prices upserten', () => {
  it('das Upsert des Syncs läuft durch — nicht nur ein blosses INSERT', async () => {
    // Der Kern dieses Schritts. Siehe Kopf (1): ein reines INSERT bliebe auch bei einem auf
    // `insert, update` verkürzten Grant grün und beliese den Fehler in Produktion.
    expect(await attempt('service_role', UPSERT_SQL)).toBeNull()
  })

  it('das Upsert ein ZWEITES Mal überschreibt, statt zu verdoppeln', async () => {
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await c.query(UPSERT_SQL)
      await c.query(UPSERT_SQL.replace('17.797', '9.99'))
      const res = await c.query(
        `select count(*)::int n, max(ct_per_kwh)::float v from public.spot_prices where provider = 'gate-b21-2a'`,
      )
      return res.rows[0] as { n: number; v: number }
    })
    // `unique (provider, ts_start)` aus B21-1 macht den wiederholten Abruf desselben Zeitraums
    // gefahrlos — genau darauf beruht das absichtlich zu grosse Fenster des täglichen Laufs.
    expect(rows.n).toBe(1)
    expect(rows.v).toBeCloseTo(9.99, 6)
  })

  it('die Rechtefläche ist exakt INSERT, UPDATE, SELECT — kein DELETE, kein TRUNCATE', async () => {
    const rows = await sql<{ privs: string }>(
      `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(keine)') privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'spot_prices' and grantee = 'service_role'`,
    )
    expect(rows[0]?.privs).toBe('INSERT,SELECT,UPDATE')
  })

  it('DELETE wird auch für service_role abgewiesen', async () => {
    const err = await attempt('service_role', `delete from public.spot_prices where provider = 'gate-b21-2a'`)
    expect(err?.code).toBe('42501')
  })
})

describe('B21-2a — die Öffnung bleibt auf spot_prices begrenzt', () => {
  for (const table of ['grid_tariffs', 'grid_tariff_rate_windows'] as const) {
    it(`service_role hat auf public.${table} weiterhin GAR KEIN Recht`, async () => {
      const rows = await sql<{ privs: string }>(
        `select coalesce(string_agg(privilege_type, ','), '(keine)') privs
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1 and grantee = 'service_role'`,
        [table],
      )
      expect(rows[0]?.privs).toBe('(keine)')
    })
  }

  it('service_role INSERT auf public.grid_tariffs scheitert mit 42501', async () => {
    const err = await attempt(
      'service_role',
      `insert into public.grid_tariffs
         (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
          grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by)
       values ('gate-b21-2a', 'Probe', 5, null, 1, 'eur_per_kw_year', 1, 'net', '2026-01-01', 'gate')`,
    )
    expect(err?.code).toBe('42501')
  })
})

describe('B21-2a — anon und authenticated bleiben unverändert NUR lesend', () => {
  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} liest public.spot_prices weiterhin ohne Fehler`, async () => {
      const rows = await runAs({ role }, async (c) => (await c.query('select * from public.spot_prices')).rows)
      expect(rows).toEqual([])
    })

    it(`${role} darf public.spot_prices weiterhin NICHT upserten (42501)`, async () => {
      expect((await attempt(role, UPSERT_SQL))?.code).toBe('42501')
    })

    it(`${role} hat auf public.spot_prices exakt SELECT und sonst nichts`, async () => {
      const rows = await sql<{ privs: string }>(
        `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(keine)') privs
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'spot_prices' and grantee = $1`,
        [role],
      )
      expect(rows[0]?.privs).toBe('SELECT')
    })
  }
})
