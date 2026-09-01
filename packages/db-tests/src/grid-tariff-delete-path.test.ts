// DB-Gate für den Löschweg der Netzbetreiber-Tarife
// (Migration 20260901120000_create_grid_tariff_delete_path.sql, B21-2c).
//
// Geprüft wird der ECHTE Weg — `public.delete_grid_tariff` unter `set local role service_role`,
// also genau der Aufruf, den die Server Action absetzt. Introspektion allein genügt hier nicht: die
// Funktion trifft in EINER Transaktion zwei Schreibvorgänge und verlässt sich für einen dritten
// (die Zeitfenster) auf die Kaskade aus B21-1. Ob das zusammen hält, sagt nur der Aufruf.
//
// ── (1) DIE KASKADE BRAUCHT KEIN DELETE AUF DER KIND-TABELLE ───────────────────────────────────
//     Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe
//     nachgemessen, mit einem echten `delete` auf der Elternzeile als `service_role`:
//
//       kein DELETE-Grant                     → 42501 (grid_tariffs)  ← Stand vor der Migration
//       NUR grid_tariffs: delete              → OK, Eltern 0 UND Kinder 0
//       grid_tariffs + rate_windows: delete   → OK (kein Unterschied)
//       NUR rate_windows: delete              → 42501 (grid_tariffs)
//
//     Die referentielle Aktion läuft im systemeigenen Constraint-Trigger mit den Rechten des
//     Eigentümers. Deshalb bleibt der 42501-Nachweis für `grid_tariff_rate_windows` unten stehen —
//     er belegt jetzt etwas Schärferes als vorher: Die Kind-Zeilen verschwinden, OHNE dass dieser
//     Weg sie löschen dürfte.
//
// ── (2) DIE MINDEST-RECHTEFLÄCHE IST GEMESSEN, NICHT ANGENOMMEN ────────────────────────────────
//     Dieselbe Technik, je Stufe GENAU EIN Recht entzogen, die Funktion echt aufgerufen:
//
//       volle Grants der Migration                     → OK: Eltern 0, Kinder 0, Protokoll 1
//       ohne DELETE auf grid_tariffs                   → 42501 grid_tariffs
//       ohne SELECT auf grid_tariff_rate_windows       → 42501 grid_tariff_rate_windows
//       ohne INSERT auf grid_tariff_deletions          → 42501 grid_tariff_deletions
//       ohne SELECT auf grid_tariffs                   → 42501 grid_tariffs
//       ohne UPDATE auf grid_tariffs                   → 42501 grid_tariffs   ← `for update`
//       ZUSÄTZLICH DELETE auf grid_tariff_rate_windows → OK (kein Unterschied)
//
//     `grid_tariff_rate_windows` bekommt in B21-2c SELECT dazu — nicht „vorsichtshalber" (das hatte
//     B21-2b ausdrücklich verworfen), sondern weil der Abzug die Zeitfenster enthalten MUSS und die
//     Funktion sie dafür liest.
//
// ── (3) DER ABZUG IST DER GANZE ZWECK ──────────────────────────────────────────────────────────
//     Die ct/kWh-Sätze stehen NICHT auf der Elternzeile, sondern in den Zeitfenstern. Ein Protokoll
//     ohne sie sähe vollständig aus und wäre es nicht. Unten wird deshalb nicht nur geprüft, DASS
//     eine Protokollzeile entsteht, sondern dass ihr Snapshot die Arbeitspreise trägt.
//
// ── (4) ANONYME UND ANGEMELDETE ROLLEN BLEIBEN AUSSEN VOR ──────────────────────────────────────
//     Die Prüfung des EXECUTE-Rechts läuft über `has_function_privilege` und NICHT über einen
//     Aufruf: eine SECURITY-Funktion durch eine Rolle ohne Grant aufzurufen hat in B16-4a den
//     Postgres-Prozess abgeschossen (Arbeitsregel 5). Der Tabellenzugriff ohne Grant ist dagegen
//     gefahrlos und wird regulär mit 42501 abgewiesen.
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`) — die
// Tabellen bleiben auch während des Laufs leer, und parallel laufende Testdateien sehen nichts.

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Eindeutig je Datei, damit parallele Testdateien einander nicht in die Quere kommen. */
const OP = 'gate-b21-2c'

type Deleted = {
  status: string
  id?: string
  window_count?: number
  deleted_count?: number
}

/**
 * Legt eine Tarifzeile samt zwei Zeitfenstern an — als EIGENTÜMER, nicht über
 * `public.create_grid_tariff`.
 *
 * Absicht: Dieser Test misst das LÖSCHEN. Käme das Fixture aus dem Anlageweg, prüfte ein
 * fehlgeschlagener Anlageweg hier ebenfalls rot, und der Befund zeigte auf die falsche Migration.
 */
async function seed(c: PoolClient, netzebene = 5): Promise<string> {
  await c.query('reset role')
  const t = await c.query(
    `insert into public.grid_tariffs
       (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
        grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by)
     values ($1, 'Gate Netz', $2::smallint, null, 38.52, 'eur_per_kw_year', 1.23, 'net',
             '2026-01-01', 'gate@test.local')
     returning id`,
    [OP, netzebene],
  )
  const id = (t.rows[0] as { id: string }).id
  await c.query(
    `insert into public.grid_tariff_rate_windows
       (grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh)
     values ($1, 'normal', null, null, '00:00', '24:00', 4.5),
            ($1, 'snap', '10-01', '03-31', '17:00', '20:00', 9.9)`,
    [id],
  )
  await c.query('set local role service_role')
  return id
}

/** Der Aufruf, den auch die Server Action absetzt — benannte Argumente, wie PostgREST sie schickt. */
async function call(c: PoolClient, id: string): Promise<Deleted> {
  const res = await c.query(
    `select public.delete_grid_tariff(p_tariff_id => $1::uuid, p_deleted_by => $2) as r`,
    [id, 'gate-loeschung@test.local'],
  )
  return (res.rows[0] as { r: Deleted }).r
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('B21-2c — der Löschweg entfernt Zeile und Zeitfenster und hinterlässt eine Spur', () => {
  it('die Elternzeile UND ihre Zeitfenster sind danach weg (Kaskade), das Protokoll trägt eine Zeile', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)

      // Gegenprobe VOR dem Löschen: ohne sie bewiese „danach 0 Zeilen" nichts — es könnte auch
      // vorher schon nichts dagewesen sein.
      await c.query('reset role')
      const before = await c.query(
        `select (select count(*)::int from public.grid_tariffs where id = $1) parent,
                (select count(*)::int from public.grid_tariff_rate_windows where grid_tariff_id = $1) kinder`,
        [id],
      )
      await c.query('set local role service_role')

      const res = await call(c, id)

      await c.query('reset role')
      const after = await c.query(
        `select (select count(*)::int from public.grid_tariffs where id = $1) parent,
                (select count(*)::int from public.grid_tariff_rate_windows where grid_tariff_id = $1) kinder,
                (select count(*)::int from public.grid_tariff_deletions where grid_tariff_id = $1) log`,
        [id],
      )
      return {
        res,
        before: before.rows[0] as { parent: number; kinder: number },
        after: after.rows[0] as { parent: number; kinder: number; log: number },
      }
    })

    expect(out.before).toEqual({ parent: 1, kinder: 2 })
    expect(out.res.status).toBe('deleted')
    expect(out.res.window_count).toBe(2)
    expect(out.res.deleted_count).toBe(1)
    expect(out.after).toEqual({ parent: 0, kinder: 0, log: 1 })
  })

  it('der Abzug enthält die Elternzeile UND die Arbeitspreise aus den Zeitfenstern', async () => {
    // Der eigentliche Zweck des Protokolls: Die ct/kWh-Sätze stehen nur in den Zeitfenstern. Ein
    // Snapshot ohne sie hielte den Grundpreis fest und verlöre genau das, womit gerechnet wurde.
    const row = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      await call(c, id)
      await c.query('reset role')
      const r = await c.query(
        `select deleted_by, tariff_snapshot,
                (tariff_snapshot -> 'rate_windows') windows
           from public.grid_tariff_deletions where grid_tariff_id = $1`,
        [id],
      )
      return r.rows[0] as {
        deleted_by: string
        tariff_snapshot: Record<string, unknown>
        windows: Record<string, unknown>[]
      }
    })

    expect(row.deleted_by).toBe('gate-loeschung@test.local')
    expect(row.tariff_snapshot).toMatchObject({
      operator_id: OP,
      operator_name: 'Gate Netz',
      netzebene: 5,
      metering_variant: null,
      grundpreis_unit: 'eur_per_kw_year',
      price_basis: 'net',
      valid_from: '2026-01-01',
      valid_until: null,
      created_by: 'gate@test.local',
    })
    // `numeric` reist als Zeichenkette durch jsonb — die Zahl ist damit exakt erhalten, nicht als
    // Fliesskomma gerundet.
    expect(String(row.tariff_snapshot.grundpreis_amount)).toBe('38.52')

    expect(row.windows).toHaveLength(2)
    expect(row.windows.map((w) => [w.label, String(w.ct_per_kwh)])).toEqual([
      ['normal', '4.5'],
      ['snap', '9.9'],
    ])
    expect(row.windows[1]).toMatchObject({
      month_day_from: '10-01',
      month_day_to: '03-31',
      time_from: '17:00:00',
      time_to: '20:00:00',
    })
  })

  it('eine unbekannte id wirft `not_found` — und schreibt KEINE Protokollzeile', async () => {
    // Ein stiller No-op sähe an der Oberfläche wie ein Erfolg aus: „gelöscht" für eine Zeile, die
    // längst jemand anderes entfernt hat.
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await c.query('savepoint sp')
      let message: string | undefined
      try {
        await call(c, '00000000-0000-4000-8000-000000000000')
      } catch (e) {
        message = (e as { message?: string }).message
        await c.query('rollback to savepoint sp')
      }
      await c.query('reset role')
      const n = await c.query(
        `select count(*)::int n from public.grid_tariff_deletions
          where grid_tariff_id = '00000000-0000-4000-8000-000000000000'`,
      )
      return { message, n: (n.rows[0] as { n: number }).n }
    })
    expect(out.message).toBe('not_found')
    expect(out.n).toBe(0)
  })

  it('eine ANDERE Tarifzeile bleibt unberührt — gelöscht wird genau eine', async () => {
    // Ohne diese Bindung nähme ein Löschen die ganze Kombination mit, und niemandem fiele es auf:
    // die Liste sähe danach schlicht kürzer aus.
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const keep = await seed(c, 4)
      const drop = await seed(c, 5)
      await call(c, drop)
      await c.query('reset role')
      const r = await c.query(
        `select (select count(*)::int from public.grid_tariffs where id = $1) keep_parent,
                (select count(*)::int from public.grid_tariff_rate_windows where grid_tariff_id = $1) keep_kinder,
                (select count(*)::int from public.grid_tariff_deletions where grid_tariff_id = $1) keep_log`,
        [keep],
      )
      return r.rows[0] as { keep_parent: number; keep_kinder: number; keep_log: number }
    })
    expect(out).toEqual({ keep_parent: 1, keep_kinder: 2, keep_log: 0 })
  })

  it('die Kombination ist danach wieder frei — ein neuer Stand mit demselben Beginn läuft durch', async () => {
    /*
     * Der eigentliche Anlass dieses Bauabschnitts: Ein vertippter Probeeintrag belegte die
     * Kombination (`unique nulls not distinct`, B21-1) und liess jeden echten Stand mit demselben
     * oder früherem Beginn auf `invalid_valid_from` laufen. Erst wenn DIESER Fall nach dem Löschen
     * durchläuft, hat das Löschen sein Ziel erreicht.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      await call(c, id)
      const res = await c.query(
        `select public.create_grid_tariff(
                  p_operator_id            => $1,
                  p_operator_name          => 'Gate Netz',
                  p_netzebene              => 5::smallint,
                  p_metering_variant       => null,
                  p_grundpreis_amount      => 40.00,
                  p_grundpreis_unit        => 'eur_per_kw_year',
                  p_netzverlust_ct_per_kwh => 1.23,
                  p_price_basis            => 'net',
                  p_valid_from             => '2026-01-01'::date,
                  p_created_by             => 'gate@test.local',
                  p_windows                => $2::jsonb
                ) as r`,
        [
          OP,
          JSON.stringify([
            { label: 'normal', time_from: '00:00', time_to: '24:00', ct_per_kwh: 5.1 },
          ]),
        ],
      )
      return (res.rows[0] as { r: { status: string; closed_count?: number } }).r
    })
    expect(out.status).toBe('created')
    expect(out.closed_count).toBe(0)
  })
})

describe('B21-2c — das Löschprotokoll ist selbst nicht angreifbar', () => {
  it('service_role hat auf grid_tariff_deletions exakt INSERT — kein SELECT, kein UPDATE, kein DELETE', async () => {
    // Ein Protokoll, das sein Urheber lesen, ändern oder entfernen kann, belegt nichts. INSERT ist
    // die vollständige Fläche des Schreibwegs — gemessen (s. Kopf), nicht angenommen.
    const rows = await sql<{ privs: string }>(
      `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(keine)') privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'grid_tariff_deletions'
          and grantee = 'service_role'`,
    )
    expect(rows[0]?.privs).toBe('INSERT')
  })

  it('anon und authenticated haben auf grid_tariff_deletions GAR KEIN Recht', async () => {
    // Anders als die drei Referenzdaten-Tabellen aus B21-1 ist dieses Protokoll auch nicht LESBAR:
    // es ist kein veröffentlichtes Preisblatt, sondern eine Betriebsaufzeichnung mit einer Adresse
    // darin.
    const rows = await sql<{ grantee: string; privs: string }>(
      `select grantee, string_agg(privilege_type, ',' order by privilege_type) privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'grid_tariff_deletions'
          and grantee in ('anon', 'authenticated')
        group by grantee`,
    )
    expect(rows).toEqual([])
  })

  it('grid_tariff_deletions hat RLS aktiv und trägt KEINE Policy', async () => {
    // Muster platform.admin_exports/job_runs: RLS an, keine Policy — für anon/authenticated die
    // zweite Sperre. Für service_role ist es KEINE (die Rolle trägt rolbypassrls, unten gemessen);
    // dort wirkt allein der enge Grant.
    const rls = await sql<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'grid_tariff_deletions'`,
    )
    expect(rls[0]?.relrowsecurity).toBe(true)

    const policies = await sql<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'grid_tariff_deletions'`,
    )
    expect(policies).toEqual([])
  })

  it('service_role trägt rolbypassrls — deshalb ist der Grant die einzige wirksame Sperre', async () => {
    // Ohne diese Eigenschaft wäre „RLS an, keine Policy" auch für service_role eine Sperre, und der
    // Schreibweg liefe nicht. Sie ist der Grund, warum das Muster aus platform hier überhaupt
    // trägt — und der Grund, warum der Grant so eng sein muss.
    const rows = await sql<{ rolname: string; rolbypassrls: boolean }>(
      `select rolname, rolbypassrls from pg_roles
        where rolname in ('anon', 'authenticated', 'service_role') order by rolname`,
    )
    expect(rows).toEqual([
      { rolname: 'anon', rolbypassrls: false },
      { rolname: 'authenticated', rolbypassrls: false },
      { rolname: 'service_role', rolbypassrls: true },
    ])
  })

  it('anon und authenticated können nicht in grid_tariff_deletions schreiben (42501)', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const err = await runAs({ role }, async (c) => {
        try {
          await c.query(
            `insert into public.grid_tariff_deletions (grid_tariff_id, deleted_by, tariff_snapshot)
             values (gen_random_uuid(), 'probe', '{}'::jsonb)`,
          )
          return null
        } catch (e) {
          return e as { code?: string }
        }
      })
      expect(err?.code).toBe('42501')
    }
  })

  it('anon und authenticated können das Protokoll nicht einmal LESEN (42501)', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const err = await runAs({ role }, async (c) => {
        try {
          await c.query('select count(*) from public.grid_tariff_deletions')
          return null
        } catch (e) {
          return e as { code?: string }
        }
      })
      expect(err?.code).toBe('42501')
    }
  })
})

describe('B21-2c — die Funktion ist so verschlossen wie create_grid_tariff', () => {
  it('sie ist SECURITY INVOKER und existiert genau einmal', async () => {
    // Dieselbe tragende Eigenschaft wie bei create_grid_tariff: Sie verschafft niemandem Rechte, die
    // er nicht schon hat. Auf DEFINER umgestellt liefe sie unter ihrem Eigentümer — und der
    // EXECUTE-Grant allein entschiede dann über einen LÖSCHzugriff.
    const rows = await sql<{ n: number; secdef: boolean }>(
      `select count(*)::int n, bool_or(p.prosecdef) secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'delete_grid_tariff'`,
    )
    expect(rows[0]).toEqual({ n: 1, secdef: false })
  })

  it('anon und authenticated dürfen sie nicht einmal AUFRUFEN', async () => {
    // Über `has_function_privilege`, NICHT über einen Aufruf (Arbeitsregel 5).
    const rows = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role',  p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'delete_grid_tariff'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true })
  })

  it('anon und authenticated können auch direkt nicht in grid_tariffs löschen (42501)', async () => {
    // Der neue DELETE-Grant gilt AUSSCHLIESSLICH service_role. Ohne diese Prüfung bliebe offen, ob
    // die Erweiterung versehentlich breiter ausgefallen ist als beabsichtigt.
    for (const role of ['anon', 'authenticated'] as const) {
      const err = await runAs({ role }, async (c) => {
        try {
          await c.query('delete from public.grid_tariffs where false')
          return null
        } catch (e) {
          return e as { code?: string }
        }
      })
      expect(err?.code).toBe('42501')
    }
  })
})
