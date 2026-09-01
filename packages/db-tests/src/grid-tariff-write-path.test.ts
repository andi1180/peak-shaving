// DB-Gate für den Admin-Pflegeweg der Netzbetreiber-Tarife
// (Migration 20260828090000_create_grid_tariff_write_path.sql, B21-2b).
//
// Geprüft wird der ECHTE Schreibweg — `public.create_grid_tariff` unter `set local role service_role`,
// also genau der Aufruf, den die Server Action absetzt. Isolierte Grant-Introspektion allein genügt
// hier nicht: die Funktion trifft in EINER Transaktion drei Schreibvorgänge, und ob sie zusammen
// halten, sagt nur der Aufruf.
//
// ── (1) DIE MINDEST-RECHTEFLÄCHE IST GEMESSEN, NICHT ANGENOMMEN ────────────────────────────────
//     Vorgesehen war `grant insert, update, select` auf BEIDE Tabellen. Gegen den lokalen Stack
//     (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe nachgemessen, indem die
//     Funktion mit einer bereits offenen Vorgängerzeile tatsächlich aufgerufen wurde (nur so läuft
//     der UPDATE-Zweig überhaupt an):
//
//       kein Grant                                    → 42501 (grid_tariffs)
//       tariffs: insert                               → 42501 (grid_tariffs)
//       tariffs: insert + select                      → 42501 (grid_tariffs)   ← UPDATE fehlt
//       tariffs: insert + update (ohne select)        → 42501 (grid_tariffs)   ← SELECT fehlt
//       tariffs: insert + select + update             → 42501 (rate_windows)
//       tariffs: i+s+u · windows: insert              → OK
//       tariffs: i+s+u · windows: insert+select+update → OK (kein Unterschied)
//
//     Ergebnis: `grid_tariffs` braucht INSERT + SELECT + UPDATE, `grid_tariff_rate_windows` braucht
//     NUR INSERT. Ein SELECT-Grant „vorsichtshalber" wäre dort kein harmloser Überschuss, sondern
//     ein falscher Beleg — er behauptete, der Schreibweg lese diese Tabelle.
//
//     ⚠ DAS IST DIE FLÄCHE DIESES WEGES, NICHT MEHR DIE DER TABELLE. B21-2c (Migration
//     20260901120000) legt einen zweiten Weg daneben — `public.delete_grid_tariff` — und der
//     braucht auf `grid_tariffs` zusätzlich DELETE und auf `grid_tariff_rate_windows` zusätzlich
//     SELECT (er liest die Zeitfenster für den Abzug ins Löschprotokoll). Die Erwartungen unten
//     sind deshalb nachgezogen; die Stufenmessung dazu steht im Kopf von
//     `grid-tariff-delete-path.test.ts`.
//
// ── (2) DIE EFFEKTIV-DATIERUNG IST DIE EIGENTLICHE ZUSAGE ─────────────────────────────────────
//     Ein neuer Stand schliesst die bisher offene Zeile derselben Kombination auf `valid_from - 1`.
//     Lückenlos UND überlappungsfrei folgt daraus von selbst; beides wird unten an echten Zeilen
//     nachgerechnet, nicht aus der Funktionsdefinition abgelesen.
//
// ── (3) ANONYME UND ANGEMELDETE ROLLEN BLEIBEN AUSSEN VOR ─────────────────────────────────────
//     Weder `anon` noch `authenticated` bekommen ein Schreibrecht oder ein EXECUTE auf die Funktion.
//     Die Prüfung läuft über `has_function_privilege` und NICHT über einen Aufruf: eine
//     SECURITY-Funktion durch eine Rolle ohne Grant aufzurufen hat in B16-4a den Postgres-Prozess
//     abgeschossen (Arbeitsregel 5).
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`) — die
// Tabellen bleiben auch während des Laufs leer, und parallel laufende Testdateien sehen nichts.

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Eindeutig je Lauf, damit parallele Testdateien einander nicht in die Quere kommen. */
const OP = 'gate-b21-2b'

type Args = {
  netzebene?: number
  variant?: string | null
  validFrom: string
  grundpreis?: number
  windows?: unknown[]
  operator?: string
}

/** Der Aufruf, den auch die Server Action absetzt — benannte Argumente, wie PostgREST sie schickt. */
function callSql(a: Args): { text: string; values: unknown[] } {
  return {
    text: `select public.create_grid_tariff(
             p_operator_id            => $1,
             p_operator_name          => 'Gate Netz',
             p_netzebene              => $2::smallint,
             p_metering_variant       => $3,
             p_grundpreis_amount      => $4,
             p_grundpreis_unit        => 'eur_per_kw_year',
             p_netzverlust_ct_per_kwh => 1.23,
             p_price_basis            => 'net',
             p_valid_from             => $5::date,
             p_created_by             => 'gate@test.local',
             p_windows                => $6::jsonb
           ) as r`,
    values: [
      a.operator ?? OP,
      a.netzebene ?? 7,
      a.variant === undefined ? 'mit_leistungsmessung' : a.variant,
      a.grundpreis ?? 82.92,
      a.validFrom,
      JSON.stringify(
        a.windows ?? [
          { label: 'normal', time_from: '00:00', time_to: '24:00', ct_per_kwh: 5.1 },
          {
            label: 'snap',
            month_day_from: '04-01',
            month_day_to: '09-30',
            time_from: '11:00',
            time_to: '15:00',
            ct_per_kwh: 0,
          },
        ],
      ),
    ],
  }
}

type Outcome = {
  status: string
  id?: string
  window_count?: number
  closed_count?: number
  closed_valid_until?: string | null
  open_valid_from?: string | null
}

/**
 * Wechselt innerhalb der laufenden Transaktion zurück auf die Sitzungsrolle (`postgres`), um die
 * geschriebenen Zeilen NACHZULESEN.
 *
 * ⚠ Das ist keine Bequemlichkeit, sondern eine Folge der gemessenen Mindest-Rechtefläche:
 * `service_role` hat auf `grid_tariff_rate_windows` NUR `insert` und kann dort nichts lesen. Beim
 * ersten Lauf dieser Datei ist genau das aufgeschlagen (`permission denied for table
 * grid_tariff_rate_windows`) — die Einschränkung wirkt also, und zwar auch gegen den Test, der sie
 * belegt. Gelesen wird deshalb als Eigentümer, im SELBEN Transaktionskontext (eine zweite Verbindung
 * sähe die noch nicht festgeschriebenen Zeilen nicht).
 */
async function readAsOwner(c: PoolClient): Promise<void> {
  await c.query('reset role')
}

/** Ruft die Funktion als `service_role` innerhalb einer bereits offenen Transaktion auf. */
async function call(c: PoolClient, a: Args): Promise<Outcome> {
  const { text, values } = callSql(a)
  const res = await c.query(text, values)
  return (res.rows[0] as { r: Outcome }).r
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('B21-2b — der Schreibweg legt Tarifzeile und Zeitfenster ATOMAR an', () => {
  it('ein erster Stand entsteht mit allen Zeitfenstern und ohne Vorgänger', async () => {
    const out = await runAs({ role: 'service_role' }, (c) => call(c, { validFrom: '2026-01-01' }))
    expect(out.status).toBe('created')
    expect(out.window_count).toBe(2)
    expect(out.closed_count).toBe(0)
    expect(out.closed_valid_until).toBeNull()
  })

  it('die Zeilen stehen anschliessend wirklich da — Tarifzeile UND ihre zwei Fenster', async () => {
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      const out = await call(c, { validFrom: '2026-01-01' })
      await readAsOwner(c)
      const t = await c.query(
        `select operator_id, netzebene, metering_variant, grundpreis_amount::float8 gp,
                grundpreis_unit, price_basis, valid_from::text, valid_until, created_by
           from public.grid_tariffs where id = $1`,
        [out.id],
      )
      const w = await c.query(
        `select label, month_day_from, month_day_to, time_from::text, time_to::text,
                ct_per_kwh::float8 ct
           from public.grid_tariff_rate_windows where grid_tariff_id = $1 order by label`,
        [out.id],
      )
      return {
        tariff: t.rows[0] as Record<string, unknown>,
        windows: w.rows as Record<string, unknown>[],
      }
    })

    expect(rows.tariff).toMatchObject({
      operator_id: OP,
      netzebene: 7,
      metering_variant: 'mit_leistungsmessung',
      gp: 82.92,
      grundpreis_unit: 'eur_per_kw_year',
      price_basis: 'net',
      valid_from: '2026-01-01',
      valid_until: null,
      created_by: 'gate@test.local',
    })
    expect(rows.windows).toHaveLength(2)
    // `24:00` ist ein gültiger `time`-Wert und der Grund, warum die Oberfläche dafür ein Textfeld
    // hat: der Zeitwähler des Browsers kommt nur bis 23:59.
    expect(rows.windows[0]).toMatchObject({
      label: 'normal',
      time_from: '00:00:00',
      time_to: '24:00:00',
    })
    expect(rows.windows[1]).toMatchObject({
      label: 'snap',
      month_day_from: '04-01',
      month_day_to: '09-30',
      ct: 0,
    })
  })

  it('ohne Zeitfenster entsteht GAR NICHTS — auch keine Tarifzeile', async () => {
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      const out = await call(c, { validFrom: '2026-01-01', windows: [] })
      const n = await c.query(
        `select count(*)::int n from public.grid_tariffs where operator_id = $1`,
        [OP],
      )
      return { out, n: (n.rows[0] as { n: number }).n }
    })
    expect(rows.out.status).toBe('no_windows')
    expect(rows.n).toBe(0)
  })

  it('ein unbrauchbares Zeitfenster nimmt die ganze Anlage mit — die Vorgängerin bleibt offen', async () => {
    /*
     * Der Kern der Atomaritäts-Zusage: Der erste Stand steht, der zweite scheitert am LETZTEN
     * Schritt. Bliebe die Vorgängerin dabei geschlossen zurück, gäbe es für den Zeitraum danach eine
     * Zeile ohne Arbeitspreis — schlimmer als gar keine (B21-1: „keine Berechnungsgrundlage" ist ein
     * sicherer Zustand, „eine halbe" nicht).
     *
     * Der Sicherungspunkt bildet die Grenze nach, die in Produktion ohnehin besteht: über PostgREST
     * ist JEDER RPC-Aufruf seine eigene Transaktion, eine geworfene Ausnahme nimmt ihn vollständig
     * zurück. Hier laufen beide Aufrufe in EINER Testtransaktion, deshalb der Sicherungspunkt
     * dazwischen.
     */
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2026-01-01' })
      await c.query('savepoint sp')
      let code: string | undefined
      let message: string | undefined
      try {
        await call(c, {
          validFrom: '2027-01-01',
          windows: [{ label: 'kaputt', time_from: '25:99', time_to: '24:00', ct_per_kwh: 1 }],
        })
      } catch (e) {
        code = (e as { code?: string }).code
        message = (e as { message?: string }).message
        await c.query('rollback to savepoint sp')
      }
      await readAsOwner(c)
      const t = await c.query(
        `select count(*)::int n, count(*) filter (where valid_until is null)::int offen
           from public.grid_tariffs where operator_id = $1`,
        [OP],
      )
      const w = await c.query(
        `select count(*)::int n from public.grid_tariff_rate_windows w
           join public.grid_tariffs t on t.id = w.grid_tariff_id where t.operator_id = $1`,
        [OP],
      )
      return {
        code,
        message,
        windows: (w.rows[0] as { n: number }).n,
        ...(t.rows[0] as { n: number; offen: number }),
      }
    })
    expect(rows.code).toBe('P0001')
    expect(rows.message).toBe('invalid_window')
    // Genau EINE Tarifzeile, und sie ist weiterhin OFFEN: der zweite Aufruf hat nichts hinterlassen.
    expect(rows.n).toBe(1)
    expect(rows.offen).toBe(1)
    expect(rows.windows).toBe(2)
  })
})

describe('B21-2b — Effektiv-Datierung: lückenlos und ohne Überschneidung', () => {
  it('ein zweiter Stand schliesst den ersten am Vortag — die Kette ist dicht', async () => {
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2026-01-01', grundpreis: 38.52 })
      const second = await call(c, { validFrom: '2027-01-01', grundpreis: 44.1 })
      const t = await c.query(
        `select valid_from::text vf, valid_until::text vu, grundpreis_amount::float8 gp
           from public.grid_tariffs where operator_id = $1 order by valid_from`,
        [OP],
      )
      return { second, rows: t.rows as { vf: string; vu: string | null; gp: number }[] }
    })

    expect(rows.second.status).toBe('created')
    expect(rows.second.closed_count).toBe(1)
    expect(rows.second.closed_valid_until).toBe('2026-12-31')

    expect(rows.rows).toHaveLength(2)
    // Der erste Stand endet am Tag VOR dem Beginn des zweiten: kein gemeinsamer Tag (Überschneidung)
    // und kein Tag dazwischen (Lücke). Hier ausgerechnet, nicht aus der Funktion abgelesen.
    expect(rows.rows[0]).toMatchObject({ vf: '2026-01-01', vu: '2026-12-31', gp: 38.52 })
    expect(rows.rows[1]).toMatchObject({ vf: '2027-01-01', vu: null, gp: 44.1 })

    const ende = new Date(`${rows.rows[0]!.vu}T00:00:00Z`).getTime()
    const start = new Date(`${rows.rows[1]!.vf}T00:00:00Z`).getTime()
    expect((start - ende) / 86_400_000).toBe(1)
  })

  it('die Zeitfenster des abgelösten Stands bleiben erhalten', async () => {
    // Ein abgelöster Stand muss vollständig lesbar bleiben: eine 2026 archivierte Analyse (B14) soll
    // 2028 noch sagen können, welcher Arbeitspreis damals galt.
    const n = await runAs({ role: 'service_role' }, async (c) => {
      const first = await call(c, { validFrom: '2026-01-01' })
      await call(c, { validFrom: '2027-01-01' })
      await readAsOwner(c)
      const w = await c.query(
        `select count(*)::int n from public.grid_tariff_rate_windows where grid_tariff_id = $1`,
        [first.id],
      )
      return (w.rows[0] as { n: number }).n
    })
    expect(n).toBe(2)
  })

  it('ein RÜCKWÄRTS datierter Stand wird abgewiesen — und verändert nichts', async () => {
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2027-01-01' })
      const out = await call(c, { validFrom: '2026-01-01' })
      const t = await c.query(
        `select count(*)::int n, count(*) filter (where valid_until is null)::int offen
           from public.grid_tariffs where operator_id = $1`,
        [OP],
      )
      return { out, ...(t.rows[0] as { n: number; offen: number }) }
    })
    expect(rows.out.status).toBe('invalid_valid_from')
    expect(rows.out.open_valid_from).toBe('2027-01-01')
    // Eine abgelehnte Anlage darf die bestehende Lage nicht angefasst haben.
    expect(rows.n).toBe(1)
    expect(rows.offen).toBe(1)
  })

  it('derselbe Tag wie der offene Stand wird ebenfalls abgewiesen (kein Null-Tage-Stand)', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2026-01-01' })
      return call(c, { validFrom: '2026-01-01' })
    })
    expect(out.status).toBe('invalid_valid_from')
  })

  it('eine ANDERE Kombination bleibt unberührt — die Datierung wirkt je Kombination', async () => {
    // Ohne diese Bindung schlösse ein Stand für NE 7 den Stand für NE 5 mit — und niemandem fiele
    // es auf, weil beide Zeilen plausibel aussehen.
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { netzebene: 5, variant: null, validFrom: '2026-01-01' })
      await call(c, { netzebene: 7, validFrom: '2027-01-01' })
      const t = await c.query(
        `select netzebene, metering_variant, valid_until
           from public.grid_tariffs where operator_id = $1 order by netzebene`,
        [OP],
      )
      return t.rows as {
        netzebene: number
        metering_variant: string | null
        valid_until: unknown
      }[]
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ netzebene: 5, metering_variant: null, valid_until: null })
    expect(rows[1]).toMatchObject({ netzebene: 7, valid_until: null })
  })

  it('bei NE 3–6 steht `null` in der Variante, und ein zweiter Stand schliesst trotzdem korrekt', async () => {
    // Der Fall, für den B21-1 `unique nulls not distinct` gewählt hat: `metering_variant is null`
    // muss als GLEICHE Kombination gelten. Ein gewöhnlicher NULL-Vergleich fände die offene Zeile
    // nicht und liesse zwei gültige Stände nebeneinander stehen.
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { netzebene: 4, variant: null, validFrom: '2026-01-01' })
      const second = await call(c, { netzebene: 4, variant: null, validFrom: '2027-01-01' })
      const t = await c.query(
        `select count(*) filter (where valid_until is null)::int offen
           from public.grid_tariffs where operator_id = $1`,
        [OP],
      )
      return { second, ...(t.rows[0] as { offen: number }) }
    })
    expect(rows.second.closed_count).toBe(1)
    expect(rows.offen).toBe(1)
  })

  it('ein bereits ARCHIVIERTER Stand mit demselben Beginn wird als duplicate_valid_from gemeldet', async () => {
    /*
     * ⚠ DIESER ZWEIG IST NUR ERREICHBAR, WENN ES GAR KEINEN OFFENEN STAND GIBT — gemessen, nicht
     * angenommen: Der erste Anlauf dieses Tests stellte zwei Stände her (2026 geschlossen, 2027
     * offen) und rief dann erneut mit 2026 auf. Das wirft NICHT, sondern liefert
     * `invalid_valid_from` — die Ordnungsprüfung greift vorher.
     *
     * Ein Bestand ohne offene Zeile entsteht über diesen Weg nie (jede Anlage hinterlässt genau eine
     * offene). Er ist das Ergebnis eines Eingriffs von Hand — also genau des Wegs, den die
     * Dokumentation für rückwirkende Korrekturen vorsieht. Genau so wird er hier hergestellt.
     */
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2026-01-01' })

      // Eingriff von Hand: der offene Stand wird geschlossen, ohne dass ein Nachfolger entsteht.
      await readAsOwner(c)
      await c.query(
        `update public.grid_tariffs set valid_until = '2026-06-30'
          where operator_id = $1 and valid_until is null`,
        [OP],
      )
      await c.query('set local role service_role')

      await c.query('savepoint sp')
      let message: string | undefined
      try {
        await call(c, { validFrom: '2026-01-01' })
      } catch (e) {
        message = (e as { message?: string }).message
        await c.query('rollback to savepoint sp')
      }
      return { message }
    })
    expect(rows.message).toBe('duplicate_valid_from')
  })
})

describe('B21-2b — die Rechtefläche ist genau so gross wie der Schreibweg', () => {
  it('service_role hat auf grid_tariffs exakt DELETE, INSERT, SELECT, UPDATE', async () => {
    /*
     * ⚠ B21-2c HAT DIESE ZUSAGE GEÄNDERT, und der Test ist deshalb NACHGEZOGEN statt grün geprügelt:
     * Bis dahin lautete sie „exakt INSERT, SELECT, UPDATE — kein DELETE". Der Löschweg
     * (`public.delete_grid_tariff`, Migration 20260901120000) braucht das DELETE hier tatsächlich;
     * die vollständige Stufenmessung steht im Kopf von `grid-tariff-delete-path.test.ts`.
     *
     * Der Vergleich bleibt EXAKT (kein „enthält"): Ein zusätzliches Recht, das niemand braucht, soll
     * weiterhin rot werden.
     */
    const rows = await sql<{ privs: string }>(
      `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(keine)') privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'grid_tariffs' and grantee = 'service_role'`,
    )
    expect(rows[0]?.privs).toBe('DELETE,INSERT,SELECT,UPDATE')
  })

  it('service_role hat auf grid_tariff_rate_windows exakt INSERT und SELECT — kein DELETE', async () => {
    /*
     * Gemessen (s. Kopf): Der ANLAGEweg liest dort nichts und ändert nichts; auch der Fremdschlüssel
     * braucht zur Laufzeit kein `references`-Recht. Ein SELECT-Grant „vorsichtshalber" wäre ein
     * falscher Beleg über diesen Weg — und genau deshalb stand hier bis B21-2c `INSERT` allein.
     *
     * ⚠ B21-2c fügt SELECT hinzu, und zwar NICHT vorsichtshalber: Der Löschweg schreibt einen
     * vollständigen Abzug der Zeile ins Protokoll, und die ct/kWh-Sätze stehen in den Zeitfenstern —
     * er LIEST diese Tabelle also wirklich. DELETE kommt dabei ausdrücklich NICHT dazu (die Kaskade
     * braucht es nicht, s. der Test weiter unten).
     */
    const rows = await sql<{ privs: string }>(
      `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(keine)') privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'grid_tariff_rate_windows'
          and grantee = 'service_role'`,
    )
    expect(rows[0]?.privs).toBe('INSERT,SELECT')
  })

  it('DELETE auf public.grid_tariff_rate_windows wird auch für service_role abgewiesen', async () => {
    /*
     * ⚠ Diese Zusage galt bis B21-2c für BEIDE Tabellen. Für `grid_tariffs` ist sie mit dem
     * Löschweg entfallen (der Test darüber misst die neue Fläche); für die Kind-Tabelle steht sie
     * weiterhin — und belegt jetzt etwas SCHÄRFERES als vorher: Die Zeitfenster verschwinden über
     * die Kaskade, OHNE dass irgendein Weg sie löschen dürfte. Gemessen im Kopf von
     * `grid-tariff-delete-path.test.ts` (die referentielle Aktion läuft im systemeigenen
     * Constraint-Trigger mit den Rechten des Eigentümers).
     */
    const err = await runAs({ role: 'service_role' }, async (c) => {
      try {
        await c.query('delete from public.grid_tariff_rate_windows where false')
        return null
      } catch (e) {
        return e as { code?: string }
      }
    })
    expect(err?.code).toBe('42501')
  })

  it('der Anlageweg ist umkehrbar: eine angelegte Zeile lässt sich als service_role wieder entfernen', async () => {
    /*
     * Der POSITIVE Gegenbeweis, der den früheren 42501-Test auf `grid_tariffs` ersetzt: Ein Grant
     * allein sagt nur, dass ein Recht dasteht — nicht, dass der Weg läuft. Hier wird eine Zeile über
     * `create_grid_tariff` angelegt und über `delete_grid_tariff` wieder entfernt; geprüft wird, dass
     * die Zeitfenster über die Kaskade mitgehen und eine Protokollzeile entsteht.
     *
     * Die Tiefe (Abzug-Inhalt, not_found, Fremdzeile unberührt, Mindest-Rechtefläche) liegt in
     * `grid-tariff-delete-path.test.ts`; hier steht die Klammer über BEIDE Wege — dass das, was
     * dieser Weg anlegt, auch wieder verschwinden kann.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const created = await call(c, { validFrom: '2026-01-01' })
      const del = await c.query(
        `select public.delete_grid_tariff(p_tariff_id => $1::uuid, p_deleted_by => $2) as r`,
        [created.id, 'gate-loeschung@test.local'],
      )
      await readAsOwner(c)
      const after = await c.query(
        `select (select count(*)::int from public.grid_tariffs where id = $1) parent,
                (select count(*)::int from public.grid_tariff_rate_windows where grid_tariff_id = $1) kinder,
                (select count(*)::int from public.grid_tariff_deletions where grid_tariff_id = $1) log`,
        [created.id],
      )
      return {
        created,
        deleted: (del.rows[0] as { r: { status: string; window_count: number } }).r,
        after: after.rows[0] as { parent: number; kinder: number; log: number },
      }
    })

    expect(out.created.status).toBe('created')
    expect(out.created.window_count).toBe(2)
    expect(out.deleted.status).toBe('deleted')
    expect(out.deleted.window_count).toBe(2)
    expect(out.after).toEqual({ parent: 0, kinder: 0, log: 1 })
  })

  for (const table of ['grid_tariffs', 'grid_tariff_rate_windows'] as const) {
    it(`anon und authenticated haben auf public.${table} weiterhin exakt SELECT`, async () => {
      const rows = await sql<{ grantee: string; privs: string }>(
        `select grantee, string_agg(privilege_type, ',' order by privilege_type) privs
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1
            and grantee in ('anon', 'authenticated')
          group by grantee order by grantee`,
        [table],
      )
      expect(rows).toEqual([
        { grantee: 'anon', privs: 'SELECT' },
        { grantee: 'authenticated', privs: 'SELECT' },
      ])
    })
  }

  it('anon und authenticated dürfen die Funktion nicht einmal AUFRUFEN', async () => {
    // Über `has_function_privilege`, NICHT über einen Aufruf: Arbeitsregel 5 (ein Aufruf durch eine
    // Rolle ohne Grant hat in B16-4a den Postgres-Prozess abgeschossen).
    const rows = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role',  p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_grid_tariff'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true })
  })

  it('die Funktion ist SECURITY INVOKER und existiert genau einmal', async () => {
    // SECURITY INVOKER ist die tragende Eigenschaft: Sie verschafft niemandem Rechte, die er nicht
    // schon hat. Würde sie später auf DEFINER umgestellt, liefe sie unter ihrem Eigentümer — und
    // der EXECUTE-Grant allein entschiede dann über den Schreibzugriff.
    const rows = await sql<{ n: number; secdef: boolean }>(
      `select count(*)::int n, bool_or(p.prosecdef) secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_grid_tariff'`,
    )
    expect(rows[0]).toEqual({ n: 1, secdef: false })
  })

  it('anon und authenticated können weiterhin nicht in grid_tariffs schreiben (42501)', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const err = await runAs({ role }, async (c) => {
        try {
          await c.query(
            `insert into public.grid_tariffs
               (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
                grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by)
             values ('gate-b21-2b-probe', 'Probe', 5, null, 1, 'eur_per_kw_year', 1, 'net',
                     '2026-01-01', 'gate')`,
          )
          return null
        } catch (e) {
          return e as { code?: string }
        }
      })
      expect(err?.code).toBe('42501')
    }
  })
})
