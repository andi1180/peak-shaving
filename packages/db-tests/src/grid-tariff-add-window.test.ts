// DB-Gate für den Anhänge-Weg der Zeitfenster
// (Migration 20260902180000_add_grid_tariff_rate_window.sql, B21-2d).
//
// Geprüft wird der ECHTE Weg — `public.add_grid_tariff_rate_window` unter `set local role
// service_role`, also genau der Aufruf, den die Server Action absetzt. Introspektion allein genügt
// nicht: plpgsql prüft Funktionsrümpfe NICHT beim Anlegen (Arbeitsregel 1/2), eine Migration läuft
// sauber durch und die Funktion bricht erst beim ersten Aufruf — also im Betrieb, nicht im CI.
//
// ── (1) DER GUARD IST DIE EINZIGE DASEINSBERECHTIGUNG DER FUNKTION ─────────────────────────────
//     Ein Fenster HINZUFÜGEN ist genau EIN INSERT; es gibt nichts zu klammern (anders als in
//     B21-2b/2c). Was es ohne Funktion nicht gäbe, ist die Bedingung „nur an einen OFFENEN Stand".
//     Ein abgelöster Stand ist eine abgeschlossene Aussage über einen VERGANGENEN Zeitraum — ein
//     nachträgliches Fenster änderte rückwirkend eine bereits gerechnete Preisgrundlage, und zwar
//     unsichtbar: die Zeile sähe danach lediglich um ein Fenster reicher aus.
//
// ── (2) DIE RECHTEFLÄCHE IST GEMESSEN, NICHT ANGENOMMEN ────────────────────────────────────────
//     Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe
//     nachgemessen, je Stufe GENAU EIN Recht entzogen und die Funktion echt aufgerufen:
//
//       volle Grants (Stand nach B21-2b/2c)              → OK, window_count 1
//       ohne INSERT auf grid_tariff_rate_windows         → 42501 grid_tariff_rate_windows
//       ohne SELECT auf grid_tariff_rate_windows         → 42501 grid_tariff_rate_windows
//       ohne SELECT auf grid_tariffs                     → 42501 grid_tariffs
//       ohne UPDATE auf grid_tariffs                     → 42501 grid_tariffs   ← `for update`
//       ZUSÄTZLICH DELETE auf grid_tariff_rate_windows   → OK, kein Unterschied
//
//     ⇒ Diese Migration braucht KEIN neues Tabellenrecht; alle vier stehen seit B21-2b/2c.
//
//     ⚠ NEBENBEFUND, der beim Messen aufschlug und nicht abgeleitet war: Das SELECT auf
//     `grid_tariff_rate_windows` verlangt schon das `returning id` DES INSERT — der 42501 trifft
//     die INSERT-Anweisung, nicht die Zählabfrage darunter. Wer die Zählung je entfernt, weil sie
//     entbehrlich scheint, braucht das Recht trotzdem.
//
// ── (3) ANONYME UND ANGEMELDETE ROLLEN BLEIBEN AUSSEN VOR ──────────────────────────────────────
//     Die Prüfung des EXECUTE-Rechts läuft über `has_function_privilege` und NICHT über einen
//     Aufruf: eine SECURITY-Funktion durch eine Rolle ohne Grant aufzurufen hat in B16-4a den
//     Postgres-Prozess abgeschossen (Arbeitsregel 5). Der Tabellenzugriff ohne Grant ist dagegen
//     gefahrlos und wird regulär mit 42501 abgewiesen.
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`).

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Eindeutig je Datei, damit parallele Testdateien einander nicht in die Quere kommen. */
const OP = 'gate-b21-2d'

type Added = {
  status: string
  id?: string
  grid_tariff_id?: string
  window_count?: number
}

/**
 * Legt eine Tarifzeile mit EINEM ganztägigen Fenster an — als EIGENTÜMER, nicht über
 * `public.create_grid_tariff`.
 *
 * Absicht: Dieser Test misst das ANHÄNGEN. Käme das Fixture aus dem Anlageweg, prüfte ein
 * fehlgeschlagener Anlageweg hier ebenfalls rot, und der Befund zeigte auf die falsche Migration.
 */
async function seed(
  c: PoolClient,
  opts: { netzebene?: number; validUntil?: string | null } = {},
): Promise<string> {
  const { netzebene = 5, validUntil = null } = opts
  await c.query('reset role')
  const t = await c.query(
    `insert into public.grid_tariffs
       (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
        grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, valid_until, created_by)
     values ($1, 'Gate Netz', $2::smallint, null, 38.52, 'eur_per_kw_year', 1.23, 'net',
             '2026-01-01', $3::date, 'gate@test.local')
     returning id`,
    [OP, netzebene, validUntil],
  )
  const id = (t.rows[0] as { id: string }).id
  await c.query(
    `insert into public.grid_tariff_rate_windows
       (grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh)
     values ($1, 'normal', null, null, '00:00', '24:00', 6.98)`,
    [id],
  )
  await c.query('set local role service_role')
  return id
}

/** Der Aufruf, den auch die Server Action absetzt — benannte Argumente, wie PostgREST sie schickt. */
async function call(
  c: PoolClient,
  id: string,
  window: {
    label?: string
    timeFrom?: string
    timeTo?: string
    ctPerKwh?: number
    monthDayFrom?: string | null
    monthDayTo?: string | null
    note?: string | null
  } = {},
): Promise<Added> {
  const {
    label = 'snap',
    timeFrom = '10:00',
    timeTo = '16:00',
    ctPerKwh = 5.58,
    monthDayFrom = null,
    monthDayTo = null,
    note = null,
  } = window
  const res = await c.query(
    `select public.add_grid_tariff_rate_window(
              p_tariff_id      => $1::uuid,
              p_label          => $2,
              p_time_from      => $3::time,
              p_time_to        => $4::time,
              p_ct_per_kwh     => $5::numeric,
              p_month_day_from => $6,
              p_month_day_to   => $7,
              p_note           => $8
            ) as r`,
    [id, label, timeFrom, timeTo, ctPerKwh, monthDayFrom, monthDayTo, note],
  )
  return (res.rows[0] as { r: Added }).r
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('B21-2d — ein Zeitfenster an einen OFFENEN Stand anhängen', () => {
  it('das Fenster entsteht mit allen Werten und die Zeile trägt danach zwei', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)

      // Gegenprobe VOR dem Anhängen: ohne sie bewiese „danach 2" nichts.
      await c.query('reset role')
      const before = await c.query(
        `select count(*)::int n from public.grid_tariff_rate_windows where grid_tariff_id = $1`,
        [id],
      )
      await c.query('set local role service_role')

      const res = await call(c, id, {
        monthDayFrom: '04-01',
        monthDayTo: '09-30',
        note: 'Fussnote Seite 2',
      })

      await c.query('reset role')
      const rows = await c.query(
        `select label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
           from public.grid_tariff_rate_windows
          where grid_tariff_id = $1 and label = 'snap'`,
        [id],
      )
      return {
        res,
        before: (before.rows[0] as { n: number }).n,
        row: rows.rows[0] as Record<string, unknown>,
      }
    })

    expect(out.before).toBe(1)
    expect(out.res.status).toBe('added')
    expect(out.res.window_count).toBe(2)
    expect(out.row).toMatchObject({
      label: 'snap',
      month_day_from: '04-01',
      month_day_to: '09-30',
      time_from: '10:00:00',
      time_to: '16:00:00',
      note: 'Fussnote Seite 2',
    })
    // `numeric` reist als Zeichenkette — die Zahl ist damit exakt erhalten, nicht gerundet.
    expect(String(out.row.ct_per_kwh)).toBe('5.58')
  })

  it('ohne Saison und ohne Notiz bleiben die drei Spalten null — kein Leerstring', async () => {
    // `null` heisst „ganzjährig" bzw. „keine Notiz"; ein Leerstring hiesse „es wurde etwas
    // eingetragen, nämlich nichts". Die Auswahlregel liest `monthDayFrom == null` als ganzjährig.
    const row = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      await call(c, id, { label: 'ganztags' })
      await c.query('reset role')
      const r = await c.query(
        `select month_day_from, month_day_to, note from public.grid_tariff_rate_windows
          where grid_tariff_id = $1 and label = 'ganztags'`,
        [id],
      )
      return r.rows[0] as Record<string, unknown>
    })
    expect(row).toEqual({ month_day_from: null, month_day_to: null, note: null })
  })

  it('eine Notiz aus lauter Leerzeichen wird zu null, nicht gespeichert', async () => {
    // `nullif(btrim(...), '')` im Rumpf: sonst stünde in der Liste eine leere Notizzeile, und
    // „hat eine Notiz" wäre von „hat keine" nicht mehr unterscheidbar.
    const note = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      await call(c, id, { label: 'leernotiz', note: '   ' })
      await c.query('reset role')
      const r = await c.query(
        `select note from public.grid_tariff_rate_windows
          where grid_tariff_id = $1 and label = 'leernotiz'`,
        [id],
      )
      return (r.rows[0] as { note: string | null }).note
    })
    expect(note).toBeNull()
  })

  it('eine ANDERE Tarifzeile bleibt unberührt', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const keep = await seed(c, { netzebene: 4 })
      const target = await seed(c, { netzebene: 5 })
      await call(c, target)
      await c.query('reset role')
      const r = await c.query(
        `select (select count(*)::int from public.grid_tariff_rate_windows where grid_tariff_id = $1) keep_n,
                (select count(*)::int from public.grid_tariff_rate_windows where grid_tariff_id = $2) target_n`,
        [keep, target],
      )
      return r.rows[0] as { keep_n: number; target_n: number }
    })
    expect(out).toEqual({ keep_n: 1, target_n: 2 })
  })
})

describe('B21-2d — der Guard: nur an einen offenen Stand', () => {
  it('ein ABGELÖSTER Stand wirft `closed_tariff` und bekommt KEIN Fenster', async () => {
    /*
     * Der eigentliche Grund, warum es diese Funktion gibt. Über die Oberfläche ist der Fall nicht
     * erreichbar (das Formular erscheint nur am offenen Stand) — aber „wird nicht angeboten" ist
     * keine Regel, sondern der Zustand einer Ansicht. Dieselbe Tiefenstaffelung wie
     * `duplicate_valid_from` in B21-2b.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c, { validUntil: '2026-12-31' })
      await c.query('savepoint sp')
      let message: string | undefined
      try {
        await call(c, id)
      } catch (e) {
        message = (e as { message?: string }).message
        await c.query('rollback to savepoint sp')
      }
      await c.query('reset role')
      const n = await c.query(
        `select count(*)::int n from public.grid_tariff_rate_windows where grid_tariff_id = $1`,
        [id],
      )
      return { message, n: (n.rows[0] as { n: number }).n }
    })
    expect(out.message).toBe('closed_tariff')
    expect(out.n).toBe(1)
  })

  it('eine unbekannte Kennung wirft `not_found` statt still nichts zu tun', async () => {
    // Ein INSERT gegen eine verschwundene Zeile scheiterte zwar am Fremdschlüssel (23503) — aber
    // mit einer Meldung, aus der die Oberfläche keinen Satz bilden kann.
    const message = await runAs({ role: 'service_role' }, async (c) => {
      await c.query('savepoint sp')
      try {
        await call(c, '00000000-0000-4000-8000-000000000000')
        return null
      } catch (e) {
        await c.query('rollback to savepoint sp')
        return (e as { message?: string }).message
      }
    })
    expect(message).toBe('not_found')
  })

  it('⚠ die Unterscheidung hängt an FOUND, nicht an `valid_until` — beide Fälle sind verschieden', async () => {
    /*
     * Ein offener Stand hat `valid_until is null`, eine fehlende Zeile liefert ebenfalls null in
     * die Variable. Wer nur den Wert prüft, hält eine gelöschte Zeile für einen offenen Stand und
     * läuft in einen rohen 23503. Die zwei Meldungen sind der Beleg, dass beide Fälle getrennt sind.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const open = await seed(c)
      const okStatus = (await call(c, open, { label: 'a' })).status

      await c.query('savepoint sp')
      let missing: string | undefined
      try {
        await call(c, '11111111-1111-4111-8111-111111111111', { label: 'b' })
      } catch (e) {
        missing = (e as { message?: string }).message
        await c.query('rollback to savepoint sp')
      }
      return { okStatus, missing }
    })
    expect(out.okStatus).toBe('added')
    expect(out.missing).toBe('not_found')
  })
})

describe('B21-2d — create_grid_tariff trägt die Notiz mit', () => {
  it('ein Fenster der ERSTEN Stunde kann ebenfalls eine Notiz tragen', async () => {
    /*
     * Ohne diesen Nachtrag könnten NUR nachträglich angehängte Fenster eine Notiz tragen. Zwei
     * Fenster derselben Zeile unterschieden sich dann nach einem Merkmal, das ein Leser nicht sehen
     * kann (WANN sie entstanden sind) — und ein leeres Notizfeld hiesse „keine eingetragen" statt
     * „konnte damals keine tragen".
     */
    const notes = await runAs({ role: 'service_role' }, async (c) => {
      await c.query(
        `select public.create_grid_tariff(
                  p_operator_id            => $1,
                  p_operator_name          => 'Gate Netz',
                  p_netzebene              => 6::smallint,
                  p_metering_variant       => null,
                  p_grundpreis_amount      => 40.00,
                  p_grundpreis_unit        => 'eur_per_kw_year',
                  p_netzverlust_ct_per_kwh => 1.23,
                  p_price_basis            => 'net',
                  p_valid_from             => '2026-01-01'::date,
                  p_created_by             => 'gate@test.local',
                  p_windows                => $2::jsonb
                )`,
        [
          `${OP}-note`,
          JSON.stringify([
            {
              label: 'normal',
              time_from: '00:00',
              time_to: '24:00',
              ct_per_kwh: 6.98,
              note: 'aus dem Preisblatt',
            },
            { label: 'ohne', time_from: '17:00', time_to: '20:00', ct_per_kwh: 9.9 },
          ]),
        ],
      )
      await c.query('reset role')
      const r = await c.query(
        `select w.label, w.note
           from public.grid_tariff_rate_windows w
           join public.grid_tariffs t on t.id = w.grid_tariff_id
          where t.operator_id = $1
          order by w.label`,
        [`${OP}-note`],
      )
      return r.rows as { label: string; note: string | null }[]
    })
    expect(notes).toEqual([
      { label: 'normal', note: 'aus dem Preisblatt' },
      // ⚠ Ein Aufrufer OHNE `note` bleibt gültig: `jsonb_to_recordset` liefert für ein fehlendes
      // Feld null. Genau das macht die Signaturänderung rückwärtskompatibel.
      { label: 'ohne', note: null },
    ])
  })

  it('der Löschabzug nimmt die Notiz automatisch mit — `to_jsonb(w)` zählt keine Spalten auf', async () => {
    // B21-2c schreibt den Abzug über `to_jsonb(w)`; eine ausgeschriebene Spaltenliste hätte beim
    // Schema-Zuwachs still ein Feld verloren. Hier wird genau das gegengeprüft.
    const windows = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      await call(c, id, { label: 'snap', note: 'gilt nur NE 7' })
      await c.query(
        `select public.delete_grid_tariff(p_tariff_id => $1::uuid, p_deleted_by => 'gate@test.local')`,
        [id],
      )
      await c.query('reset role')
      const r = await c.query(
        `select tariff_snapshot -> 'rate_windows' w from public.grid_tariff_deletions
          where grid_tariff_id = $1`,
        [id],
      )
      return (r.rows[0] as { w: Record<string, unknown>[] }).w
    })
    expect(windows.map((w) => [w.label, w.note])).toEqual([
      ['normal', null],
      ['snap', 'gilt nur NE 7'],
    ])
  })
})

describe('B21-2d — die Funktion ist so verschlossen wie ihre Geschwister', () => {
  it('sie ist SECURITY INVOKER und existiert genau einmal', async () => {
    // Auf DEFINER umgestellt liefe sie unter ihrem Eigentümer — dann entschiede der EXECUTE-Grant
    // allein über einen Schreibzugriff auf veröffentlichte Preisdaten.
    const rows = await sql<{ n: number; secdef: boolean }>(
      `select count(*)::int n, bool_or(p.prosecdef) secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'add_grid_tariff_rate_window'`,
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
        where n.nspname = 'public' and p.proname = 'add_grid_tariff_rate_window'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true })
  })

  it('die drei optionalen Parameter stehen AM ENDE und tragen Vorgabewerte', async () => {
    /*
     * Nicht Kosmetik: PostgreSQL verlangt, dass alle Parameter NACH einem mit Vorgabewert ebenfalls
     * einen tragen. Rutschten `p_month_day_from`/`p_month_day_to` wieder nach vorn, müssten
     * Uhrzeiten und Preis ebenfalls optional werden — ein Aufruf ohne Uhrzeit liefe dann durch.
     */
    const rows = await sql<{ names: string[]; defaults: number }>(
      `select p.proargnames::text[] as names, p.pronargdefaults as defaults
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'add_grid_tariff_rate_window'`,
    )
    expect(rows[0]?.names).toEqual([
      'p_tariff_id',
      'p_label',
      'p_time_from',
      'p_time_to',
      'p_ct_per_kwh',
      'p_month_day_from',
      'p_month_day_to',
      'p_note',
    ])
    expect(Number(rows[0]?.defaults)).toBe(3)
  })

  it('KEIN neues Tabellenrecht — die Rechtefläche ist unverändert die aus B21-2b/2c', async () => {
    /*
     * Der Anhänge-Weg kommt mit den bereits vergebenen Rechten aus (Stufenmessung im Kopf). Ein
     * Grant „vorsichtshalber" wäre kein harmloser Überschuss, sondern ein falscher Beleg — er
     * behauptete, dieser Weg täte etwas, das er nicht tut. Insbesondere gibt es weiterhin KEIN
     * DELETE auf den Zeitfenstern: ein hinzugefügtes Fenster ist nicht einzeln zurücknehmbar.
     */
    const rows = await sql<{ table_name: string; privs: string }>(
      `select table_name, string_agg(privilege_type, ',' order by privilege_type) privs
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('grid_tariffs', 'grid_tariff_rate_windows')
          and grantee = 'service_role'
        group by table_name order by table_name`,
    )
    expect(rows).toEqual([
      { table_name: 'grid_tariff_rate_windows', privs: 'INSERT,SELECT' },
      { table_name: 'grid_tariffs', privs: 'DELETE,INSERT,SELECT,UPDATE' },
    ])
  })

  it('anon und authenticated können auch direkt kein Zeitfenster anlegen (42501)', async () => {
    // Ohne diese Prüfung bliebe offen, ob die Notiz-Spalte versehentlich neue Rechte mitgebracht
    // hat — eine neue `public`-SPALTE tut das nicht, eine neue Tabelle sehr wohl (B21-1).
    for (const role of ['anon', 'authenticated'] as const) {
      const err = await runAs({ role }, async (c) => {
        try {
          await c.query(
            `insert into public.grid_tariff_rate_windows
               (grid_tariff_id, label, time_from, time_to, ct_per_kwh)
             values (gen_random_uuid(), 'probe', '00:00', '24:00', 1)`,
          )
          return null
        } catch (e) {
          return e as { code?: string }
        }
      })
      expect(err?.code).toBe('42501')
    }
  })

  it('die Notiz-Spalte ist nullable, ohne Default und ohne CHECK', async () => {
    /*
     * Kein Default: `null` heisst „keine Notiz", ein Leerstring hiesse „es wurde eine leere Notiz
     * eingetragen". Kein Längen-CHECK: der wiese den Eintragenden mit einem rohen 23514 ab; die
     * Grenze steht in `gridTariffWindowSchema` und meldet sich AM FELD.
     */
    const col = await sql<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'grid_tariff_rate_windows'
          and column_name = 'note'`,
    )
    expect(col[0]).toEqual({ is_nullable: 'YES', column_default: null })

    const checks = await sql<{ n: number }>(
      `select count(*)::int n
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'grid_tariff_rate_windows'
          and c.contype = 'c'`,
    )
    expect(checks[0]?.n).toBe(0)
  })
})
