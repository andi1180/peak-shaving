// DB-Gate für die Referenzdaten-Tabellen der Tarif- & Ladeoptimierung
// (Migration 20260827120000_create_grid_tariffs_and_spot_prices.sql, B21-1).
//
// Diese drei Tabellen sind die ERSTEN, die dieses Repo im `public`-Schema anlegt — bisher stehen
// dort ausschliesslich Funktionen. Damit gilt hier zum ersten Mal eine Falle, die für Funktionen
// seit T4-2 in einem Dutzend Migrationen dokumentiert ist:
//
// ── (1) DIE RECHTEFLÄCHE ENTSTEHT VON SELBST, UND ZWAR FALSCH ──────────────────────────────────
//     Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE Tabellen im `public`-Schema
//     automatisch ALLE Tabellenrechte an `anon`, `authenticated` UND `service_role` — INSERT,
//     UPDATE, DELETE und TRUNCATE eingeschlossen. „Kein Schreib-Grant" ist also NICHT dadurch
//     erfüllt, dass die Migration keinen schreibt; es verlangt ein ausdrückliches `revoke all`.
//     Vergisst eine künftige Migration das beim Anlegen einer weiteren public-Tabelle, entsteht ein
//     öffentlich beschreibbarer Datenbestand — und zwar lautlos: der Lesepfad funktioniert
//     unverändert, und keine Oberfläche zeigt einen Unterschied.
//     Deshalb wird die Rechtefläche hier auf `information_schema.role_table_grants` GEMESSEN, nicht
//     aus der Migration abgelesen.
//
// ── (2) RLS ALLEIN GENÜGT NICHT, UND GRANTS ALLEIN AUCH NICHT ──────────────────────────────────
//     Beide Schichten werden getrennt geprüft: dass RLS aktiv ist (sonst hinge alles am Grant), und
//     dass ein echter Schreibversuch der beiden Client-Rollen tatsächlich abgewiesen wird.
//     Der Schreibversuch ist hier gefahrlos möglich — Arbeitsregel 5 (Segfault-Vermeidung) betrifft
//     den DIREKTEN Aufruf einer SECURITY-DEFINER-FUNKTION ohne EXECUTE-Grant; ein Tabellenzugriff
//     ohne Grant wird von PostgreSQL regulär mit 42501 abgelehnt.
//
// ── (3) `nulls not distinct` IST DIE EINZIGE SICHERUNG GEGEN DOPPELTE TARIFZEILEN ──────────────
//     Bei NE 3–6 ist `metering_variant` laut Delta 5 null — und ein GEWÖHNLICHES `unique` wertet
//     NULL nie als gleich zu NULL. Es liesse also ausgerechnet für den heute belegten Regelfall
//     beliebig viele Duplikate derselben Kombination zu, und welcher Leistungspreis in eine Analyse
//     einginge, entschiede die Sortierreihenfolge einer Abfrage. Der Test misst beide Richtungen:
//     Duplikat mit null wird abgewiesen, dieselbe Kombination zu einem ANDEREN Stand ist erlaubt.
//
// ── (4) DIE TABELLEN SIND UND BLEIBEN IN DIESEM SCHRITT LEER ───────────────────────────────────
//     Es gibt bewusst keinen Schreibweg (kein Wrapper, kein Cron, kein Admin-UI). Ein Lesezugriff,
//     der ein LEERES Ergebnis liefert, ist deshalb das erwartete Verhalten — und muss vom Fall
//     „Zugriff verweigert" unterscheidbar sein. Genau das prüfen die Lesetests: leeres Array,
//     KEIN Fehler.
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`) — die
// Tabellen bleiben auch während des Laufs leer, und parallel laufende Testdateien sehen nichts.

import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import { assertStackReachable, pool, runAs, sql } from './client'

const TABLES = ['grid_tariffs', 'grid_tariff_rate_windows', 'spot_prices'] as const

/** Rechte, deren Vorhandensein an einer dieser Tabellen ein Fehler wäre. */
const WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const

/**
 * Die Tabellen, die für ALLE drei Client-Rollen verschlossen bleiben.
 *
 * B21-1 hat alle drei so angelegt. B21-2a (Migration 20260827160000) öffnet `spot_prices` gezielt
 * für `service_role` — der tägliche aWATTar-Abruf schreibt dorthin, und das Upsert braucht dafür
 * INSERT, UPDATE und SELECT. Die beiden Tarif-Tabellen bleiben unangetastet: ihr Schreibweg ist das
 * Admin-Pflege-UI und damit ein eigener PR.
 *
 * Die beiden Grant-Prüfungen laufen deshalb nur noch über diese Teilmenge — nicht, weil die Regel
 * für `spot_prices` entfallen wäre, sondern weil sie dort jetzt eine ANDERE ist und in
 * `spot-prices-write-access.test.ts` ausdrücklich und vollständig gemessen wird (exakt
 * `INSERT,SELECT,UPDATE` für `service_role`, weiterhin nur `SELECT` für `anon`/`authenticated`,
 * weiterhin kein DELETE für irgendwen). Diese Liste hier zu kürzen, ohne sie dort zu ersetzen, wäre
 * ein stiller Verlust der Absicherung.
 *
 * Alle übrigen Prüfungen dieser Datei — RLS aktiv, ausschliesslich eine SELECT-Policy, Lesbarkeit
 * für anon/authenticated, Abweisung ihrer Schreibversuche — gelten unverändert für alle drei.
 */
const WRITE_CLOSED_TABLES = ['grid_tariffs', 'grid_tariff_rate_windows'] as const

/** Ein vollständiger, gültiger INSERT je Tabelle — der Schreibversuch soll an RECHTEN scheitern. */
const INSERT_SQL: Record<(typeof TABLES)[number], string> = {
  grid_tariffs: `insert into public.grid_tariffs
      (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
       grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by)
    values ('probe', 'Probe', 5, null, 1, 'eur_per_kw_year', 1, 'net', '2026-01-01', 'gate')`,
  grid_tariff_rate_windows: `insert into public.grid_tariff_rate_windows
      (grid_tariff_id, label, time_from, time_to, ct_per_kwh)
    values (gen_random_uuid(), 'normal', '00:00', '24:00', 1)`,
  spot_prices: `insert into public.spot_prices (provider, ts_start, ts_end, ct_per_kwh)
    values ('probe', now(), now() + interval '1 hour', 1)`,
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('B21-1 — Lesezugriff: anon und authenticated dürfen lesen (leer, KEIN Fehler)', () => {
  for (const table of TABLES) {
    it(`anon liest public.${table} — leeres Ergebnis statt 42501`, async () => {
      const rows = await runAs({ role: 'anon' }, async (c) => {
        const res = await c.query(`select * from public.${table}`)
        return res.rows
      })
      expect(rows).toEqual([])
    })

    it(`authenticated liest public.${table} — leeres Ergebnis statt 42501`, async () => {
      const rows = await runAs({ role: 'authenticated' }, async (c) => {
        const res = await c.query(`select * from public.${table}`)
        return res.rows
      })
      expect(rows).toEqual([])
    })
  }
})

describe('B21-1 — Schreibzugriff: anon und authenticated werden abgewiesen', () => {
  for (const table of TABLES) {
    it(`anon INSERT auf public.${table} scheitert mit 42501`, async () => {
      const err = await runAs({ role: 'anon' }, async (c) => {
        try {
          await c.query(INSERT_SQL[table])
          return null
        } catch (e) {
          return e as { code?: string }
        }
      }).catch((e: { code?: string }) => e)
      expect(err?.code).toBe('42501')
    })

    it(`authenticated INSERT auf public.${table} scheitert mit 42501`, async () => {
      const err = await runAs({ role: 'authenticated' }, async (c) => {
        try {
          await c.query(INSERT_SQL[table])
          return null
        } catch (e) {
          return e as { code?: string }
        }
      }).catch((e: { code?: string }) => e)
      expect(err?.code).toBe('42501')
    })
  }
})

describe('B21-1 — Rechtefläche: KEIN Schreib-Grant für irgendeine Rolle', () => {
  for (const table of TABLES) {
    it(`public.${table} hat RLS aktiv`, async () => {
      const rows = await sql<{ relrowsecurity: boolean }>(
        `select c.relrowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`,
        [table],
      )
      expect(rows[0]?.relrowsecurity).toBe(true)
    })

    it(`public.${table} trägt AUSSCHLIESSLICH eine SELECT-Policy`, async () => {
      const rows = await sql<{ cmd: string }>(
        `select cmd from pg_policies where schemaname = 'public' and tablename = $1`,
        [table],
      )
      expect(rows.map((r) => r.cmd)).toEqual(['SELECT'])
    })
  }

  // Die zwei Grant-Prüfungen laufen nur über die Tabellen, die verschlossen BLEIBEN — s. die
  // Begründung an `WRITE_CLOSED_TABLES`. Für `spot_prices` misst `spot-prices-write-access.test.ts`
  // die neue Rechtefläche vollständig; RLS und Policy oben gelten weiterhin für alle drei.
  for (const table of WRITE_CLOSED_TABLES) {
    it(`public.${table} vergibt an keine Client-Rolle INSERT/UPDATE/DELETE/TRUNCATE`, async () => {
      const rows = await sql<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1
            and privilege_type = any($2::text[])
          order by grantee, privilege_type`,
        [table, WRITE_PRIVILEGES as unknown as string[]],
      )
      // `postgres` ist der Eigentümer und behält seine Rechte — geprüft wird die Rechtefläche der
      // drei Supabase-Client-Rollen. Ein Treffer hier heisst: die Migration hat das `revoke all`
      // vergessen (oder eine spätere Migration hat es zurückgenommen).
      const clientRoles = rows.filter((r) =>
        ['anon', 'authenticated', 'service_role'].includes(r.grantee),
      )
      expect(clientRoles).toEqual([])
    })

    it(`public.${table} gibt SELECT genau an anon und authenticated (service_role NICHT)`, async () => {
      const rows = await sql<{ grantee: string }>(
        `select grantee
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1 and privilege_type = 'SELECT'
            and grantee in ('anon', 'authenticated', 'service_role')
          order by grantee`,
        [table],
      )
      expect(rows.map((r) => r.grantee)).toEqual(['anon', 'authenticated'])
    })
  }
})

describe('B21-1 — grid_tariffs: `nulls not distinct` verhindert Duplikate bei NE 3–6', () => {
  const base = (validFrom: string) =>
    `insert into public.grid_tariffs
       (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
        grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by)
     values ('gate-op', 'Gate', 5, null, 38.52, 'eur_per_kw_year', 1.5, 'net', '${validFrom}', 'gate')`

  it('zweite Zeile mit identischer Kombination UND metering_variant = null wird abgewiesen (23505)', async () => {
    const code = await runAs({ role: 'postgres' }, async (c) => {
      await c.query(base('2026-01-01'))
      try {
        await c.query(base('2026-01-01'))
        return null
      } catch (e) {
        return (e as { code?: string }).code ?? null
      }
    })
    // Ohne `nulls not distinct` liefe der zweite INSERT durch — genau der Fehler, den dieser
    // Constraint verhindert. Der Test ist damit die Messung, nicht die Behauptung.
    expect(code).toBe('23505')
  })

  it('dieselbe Kombination zu einem ANDEREN Stand (valid_from) bleibt erlaubt', async () => {
    const inserted = await runAs({ role: 'postgres' }, async (c) => {
      await c.query(base('2026-01-01'))
      await c.query(base('2027-01-01'))
      const res = await c.query(`select count(*)::int as n from public.grid_tariffs`)
      return (res.rows[0] as { n: number }).n
    })
    // Effektiv-datierte Zeilen sind der ganze Zweck des Entwurfs: ein neuer Stand ist eine NEUE
    // Zeile, kein UPDATE. Verböte der Constraint das, wäre die Nachfolge unmöglich.
    expect(inserted).toBe(2)
  })
})
