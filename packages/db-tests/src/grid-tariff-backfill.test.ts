// DB-Gate für den Backfill-Weg (Migration 20260903090000_backfill_grid_tariff.sql, B21-2e).
//
// Geprüft wird der ECHTE Weg — `public.backfill_grid_tariff` unter `set local role service_role`,
// also genau der Aufruf, den die Server Action absetzt. Introspektion allein genügt nicht: plpgsql
// prüft Funktionsrümpfe NICHT beim Anlegen (Arbeitsregel 1/2), eine Migration läuft sauber durch
// und die Funktion bricht erst beim ersten Aufruf — also im Betrieb, nicht im CI.
//
// ── ⚠ DER FALL, UM DEN HERUM DIESE DATEI GEBAUT IST: „NUR GESCHLOSSENE ZEILEN" ─────────────────
//     Die naheliegende Umsetzung kopiert die Abfrage aus `create_grid_tariff` und filtert damit
//     auf `valid_until is null` — den OFFENEN Stand. Es gibt aber Kombinationen, die keinen mehr
//     haben: der offene wurde über `delete_grid_tariff` (B21-2c) entfernt, die abgelösten stehen
//     weiter da. Auf den offenen gefiltert fände die Funktion nichts und legte die neue Zeile OHNE
//     `valid_until` an — ein OFFENER Stand in der VERGANGENHEIT, unter dem eine Analyse fortan
//     jeden Zeitraum bis heute mit einem historischen Preisblatt rechnete. Das ist der zentrale
//     Wächter dieser Datei (Szenario 7 unten), und er misst BEIDE Hälften: dass `valid_until`
//     gesetzt ist UND welchen Wert es trägt.
//
// ── DIE RECHTEFLÄCHE IST GEMESSEN, NICHT ANGENOMMEN ────────────────────────────────────────────
//     Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe,
//     je Stufe GENAU EIN Recht entzogen und die Funktion echt aufgerufen:
//
//       volle Grants (Stand nach B21-2b/2c/2d)     → OK, status backfilled
//       ohne INSERT auf grid_tariffs               → 42501 grid_tariffs
//       ohne SELECT auf grid_tariffs               → 42501 grid_tariffs   ← Suche nach dem Ältesten
//       ohne UPDATE auf grid_tariffs               → 42501 grid_tariffs   ← das `for update`
//       ohne INSERT auf grid_tariff_rate_windows   → 42501 grid_tariff_rate_windows
//       ohne SELECT auf grid_tariff_rate_windows   → OK, kein Unterschied
//       ohne DELETE auf grid_tariffs               → OK, kein Unterschied
//
//     ⇒ vier Rechte, alle seit B21-2b vergeben; diese Migration braucht KEIN neues Tabellenrecht.
//     ⚠ Anders als `add_grid_tariff_rate_window` braucht dieser Weg KEIN SELECT auf den
//     Zeitfenstern: er fügt sie ohne `returning` ein und zählt über `get diagnostics`.
//
// ── ANONYME UND ANGEMELDETE ROLLEN BLEIBEN AUSSEN VOR ──────────────────────────────────────────
//     Die Prüfung des EXECUTE-Rechts läuft über `has_function_privilege` und NICHT über einen
//     Aufruf: eine SECURITY-Funktion durch eine Rolle ohne Grant aufzurufen hat in B16-4a den
//     Postgres-Prozess abgeschossen (Arbeitsregel 5).
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`).

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Eindeutig je Datei, damit parallele Testdateien einander nicht in die Quere kommen. */
const OP = 'gate-b21-2e'

type Result = {
  status: string
  id?: string
  window_count?: number
  new_valid_until?: string
  preceded_id?: string
  preceded_valid_from?: string
  /** Nur im Ablehnungsfall `not_before_oldest`: der Beginn des bisher ÄLTESTEN Stands. */
  min_valid_from?: string
}

type Stand = { valid_from: string; valid_until: string | null; backfilled: boolean }

/**
 * Legt eine Tarifzeile mit EINEM ganztägigen Fenster an — als EIGENTÜMER, nicht über
 * `public.create_grid_tariff`.
 *
 * Absicht: Diese Datei misst den BACKFILL. Käme das Fixture aus dem Anlageweg, prüfte ein
 * fehlgeschlagener Anlageweg hier ebenfalls rot, und der Befund zeigte auf die falsche Migration.
 * (Der Anlageweg wird als Regression trotzdem eigens gefahren — Szenario 5.)
 */
async function seed(
  c: PoolClient,
  opts: { netzebene?: number; validFrom?: string; validUntil?: string | null } = {},
): Promise<string> {
  const { netzebene = 5, validFrom = '2026-01-01', validUntil = null } = opts
  await c.query('reset role')
  const t = await c.query(
    `insert into public.grid_tariffs
       (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
        grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, valid_until, created_by)
     values ($1, 'Gate Netz', $2::smallint, null, 38.52, 'eur_per_kw_year', 1.23, 'net',
             $3::date, $4::date, 'gate@test.local')
     returning id`,
    [OP, netzebene, validFrom, validUntil],
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
async function backfill(
  c: PoolClient,
  opts: {
    netzebene?: number
    validFrom?: string
    windows?: unknown
    meteringVariant?: string | null
    operatorId?: string
  } = {},
): Promise<Result> {
  const {
    netzebene = 5,
    validFrom = '2025-01-01',
    windows = [{ label: 'normal', time_from: '00:00', time_to: '24:00', ct_per_kwh: 6.5 }],
    meteringVariant = null,
    operatorId = OP,
  } = opts
  const res = await c.query(
    `select public.backfill_grid_tariff(
              p_operator_id            => $1,
              p_netzebene              => $2::smallint,
              p_grundpreis_amount      => 30.00,
              p_grundpreis_unit        => 'eur_per_kw_year',
              p_netzverlust_ct_per_kwh => 1.00,
              p_price_basis            => 'net',
              p_valid_from             => $3::date,
              p_created_by             => 'gate@test.local',
              p_windows                => $4::jsonb,
              p_metering_variant       => $5
            ) as r`,
    [operatorId, netzebene, validFrom, JSON.stringify(windows), meteringVariant],
  )
  return (res.rows[0] as { r: Result }).r
}

/** Alle Stände einer Kombination, älteste zuerst — die Kette, die lückenlos sein muss. */
async function kette(c: PoolClient, netzebene = 5): Promise<Stand[]> {
  await c.query('reset role')
  const r = await c.query(
    `select valid_from::text, valid_until::text, (backfilled_at is not null) as backfilled
       from public.grid_tariffs
      where operator_id = $1 and netzebene = $2::smallint
      order by valid_from asc`,
    [OP, netzebene],
  )
  await c.query('set local role service_role')
  return r.rows as Stand[]
}

/**
 * Die Abstände zwischen aufeinanderfolgenden Ständen, in Tagen.
 *
 * Genau `1` heisst lückenlos UND überlappungsfrei: `0` oder weniger wäre eine Überschneidung, mehr
 * als `1` eine Lücke. Bewusst ÜBER DIE DATEN gerechnet und nicht über `backfilled_at` — sonst wäre
 * dieser Wächter auch dann rot, wenn nur der Vermerk fehlt, und zeigte damit auf die falsche Stelle.
 */
function abstaende(k: readonly Stand[]): number[] {
  const tag = 24 * 60 * 60 * 1000
  return k.slice(0, -1).map((s, i) => {
    const ende = Date.parse(`${s.valid_until}T00:00:00Z`)
    const start = Date.parse(`${k[i + 1]!.valid_from}T00:00:00Z`)
    return Math.round((start - ende) / tag)
  })
}

/**
 * Wie viele fremde Verbindungen hängen gerade an einem Lock, während sie `needle` ausführen?
 *
 * Gemessen über `pg_stat_activity`, mit einer kurzen Frist davor: ohne sie ist der wartende Aufruf
 * womöglich noch gar nicht am Lock angekommen, und die Messung wäre ein Zufallstreffer.
 */
async function wartetAufLock(needle: string): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 300))
  const rows = await sql<{ n: number }>(
    `select count(*)::int n from pg_stat_activity
      where wait_event_type = 'Lock' and query like '%' || $1 || '%'
        and pid <> pg_backend_pid()`,
    [needle],
  )
  return rows[0]?.n ?? 0
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('B21-2e — Szenario 1: vor einem OFFENEN Stand einfügen', () => {
  it('die neue Zeile endet am Vortag, die bestehende bleibt Zeichen für Zeichen unangetastet', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const anchorId = await seed(c, { validFrom: '2026-01-01', validUntil: null })

      // Der Zustand VOR dem Eingriff — ohne ihn bewiese „danach unverändert" nichts.
      await c.query('reset role')
      const before = await c.query(
        `select valid_from::text, valid_until::text, created_at, operator_name
           from public.grid_tariffs where id = $1`,
        [anchorId],
      )
      await c.query('set local role service_role')

      const res = await backfill(c, { validFrom: '2025-01-01' })

      await c.query('reset role')
      const after = await c.query(
        `select valid_from::text, valid_until::text, created_at, operator_name
           from public.grid_tariffs where id = $1`,
        [anchorId],
      )
      await c.query('set local role service_role')

      return {
        res,
        anchorId,
        before: before.rows[0] as Record<string, unknown>,
        after: after.rows[0] as Record<string, unknown>,
        kette: await kette(c),
      }
    })

    expect(out.res.status).toBe('backfilled')
    expect(out.res.window_count).toBe(1)
    expect(out.res.new_valid_until).toBe('2025-12-31')
    expect(out.res.preceded_id).toBe(out.anchorId)
    expect(out.res.preceded_valid_from).toBe('2026-01-01')

    /*
     * ⚠ Der bestehende Stand wird NICHT angefasst — kein UPDATE, auch nicht auf `valid_until`.
     * Das unterscheidet den Backfill vom Anlegen (dort wird die Vorgängerin geschlossen): Hier ist
     * die Nachbarzeile bereits korrekt datiert, und ihr offenes Ende ist genau richtig.
     */
    expect(out.after).toEqual(out.before)
    expect(out.after.valid_until).toBeNull()

    expect(out.kette).toEqual([
      { valid_from: '2025-01-01', valid_until: '2025-12-31', backfilled: true },
      { valid_from: '2026-01-01', valid_until: null, backfilled: false },
    ])
  })

  it('die Kette ist LÜCKENLOS und überlappungsfrei — nachgerechnet, nicht abgelesen', async () => {
    /*
     * Der Abstand zwischen dem Ende der neuen und dem Beginn der bestehenden Zeile muss EXAKT ein
     * Tag sein. Auf die Zeichenkette `2025-12-31` zu prüfen genügte nicht: sie wäre auch dann
     * grün, wenn `valid_from - 1` versehentlich durch ein festes Datum ersetzt würde.
     */
    const tage = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { validFrom: '2026-03-15' })
      await backfill(c, { validFrom: '2024-07-01' })
      return abstaende(await kette(c))
    })
    // Genau EIN Übergang, und der ist exakt einen Tag breit.
    expect(tage).toEqual([1])
  })

  it('mehrere Zeitfenster kommen vollständig mit, samt Saison und Notiz', async () => {
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c)
      const res = await backfill(c, {
        windows: [
          { label: 'normal', time_from: '00:00', time_to: '24:00', ct_per_kwh: 6.98 },
          {
            label: 'snap',
            month_day_from: '04-01',
            month_day_to: '09-30',
            time_from: '10:00',
            time_to: '16:00',
            ct_per_kwh: 5.58,
            note: 'gilt nur NE 7',
          },
        ],
      })
      expect(res.window_count).toBe(2)
      await c.query('reset role')
      const r = await c.query(
        `select w.label, w.month_day_from, w.time_from::text, w.ct_per_kwh::text, w.note
           from public.grid_tariff_rate_windows w
          where w.grid_tariff_id = $1 order by w.label`,
        [res.id],
      )
      return r.rows as Record<string, unknown>[]
    })
    expect(rows).toEqual([
      { label: 'normal', month_day_from: null, time_from: '00:00:00', ct_per_kwh: '6.98', note: null },
      {
        label: 'snap',
        month_day_from: '04-01',
        time_from: '10:00:00',
        ct_per_kwh: '5.58',
        note: 'gilt nur NE 7',
      },
    ])
  })

  it('der Anzeigename kommt aus dem Bestand, nicht aus dem Aufruf', async () => {
    // `p_operator_name` ist bewusst kein Parameter: derselbe `operator_id` mit zwei Anzeigenamen
    // stünde in der Liste als zwei Gruppen, die es nicht gibt.
    const namen = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c)
      await backfill(c)
      await c.query('reset role')
      const r = await c.query(
        `select distinct operator_name from public.grid_tariffs where operator_id = $1`,
        [OP],
      )
      return r.rows.map((x) => (x as { operator_name: string }).operator_name)
    })
    expect(namen).toEqual(['Gate Netz'])
  })
})

describe('B21-2e — Szenarien 2/3/4: der Guard misst gegen das MINIMUM, nicht gegen den offenen Stand', () => {
  it('Szenario 2 — dasselbe `valid_from` wie der älteste Stand wird abgewiesen', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { validFrom: '2026-01-01' })
      const res = await backfill(c, { validFrom: '2026-01-01' })
      return { res, kette: await kette(c) }
    })
    expect(out.res.status).toBe('not_before_oldest')
    expect(out.res.min_valid_from).toBe('2026-01-01')
    // Eine abgelehnte Anlage darf die bestehende Lage nicht verändert haben.
    expect(out.kette).toHaveLength(1)
  })

  it('Szenario 3 — NACH dem ältesten, aber VOR dem offenen Stand: ebenfalls abgewiesen', async () => {
    /*
     * ⚠ Der eigentliche Grund, warum der Guard über ALLE Zeilen läuft. Gegen den OFFENEN Stand
     * geprüft (die Abfrage aus `create_grid_tariff`) liefe dieser Aufruf durch — und die neue Zeile
     * überschnitte sich mit der bereits bestehenden von 2026. Welcher Leistungspreis in eine
     * Analyse einginge, entschiede dann die Sortierreihenfolge einer Abfrage.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { validFrom: '2026-01-01', validUntil: '2026-12-31' })
      await seed(c, { validFrom: '2027-01-01', validUntil: null })
      const res = await backfill(c, { validFrom: '2026-06-01' })
      return { res, kette: await kette(c) }
    })
    expect(out.res.status).toBe('not_before_oldest')
    expect(out.res.min_valid_from).toBe('2026-01-01')
    expect(out.kette).toEqual([
      { valid_from: '2026-01-01', valid_until: '2026-12-31', backfilled: false },
      { valid_from: '2027-01-01', valid_until: null, backfilled: false },
    ])
  })

  it('Szenario 4 — eine Lücke MITTEN in der Historie bleibt unmöglich', async () => {
    /*
     * Zwei Stände mit einer echten Lücke dazwischen (2026 endet, 2028 beginnt — 2027 fehlt). Ein
     * Aufruf, der genau diese Lücke füllen will, wird abgewiesen: `2027-01-01` ist nicht kleiner
     * als das Minimum `2026-01-01`. Das ist keine Nebenfolge, sondern die Zusage dieses Wegs — er
     * kann einen bereits gerechneten Zeitraum nicht von innen verändern.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { validFrom: '2026-01-01', validUntil: '2026-12-31' })
      await seed(c, { validFrom: '2028-01-01', validUntil: null })
      const res = await backfill(c, { validFrom: '2027-01-01' })
      return { res, kette: await kette(c) }
    })
    expect(out.res.status).toBe('not_before_oldest')
    expect(out.kette).toHaveLength(2)
    // Die Lücke besteht unverändert fort — und das ist der richtige Zustand: für 2027 gibt es
    // keine Berechnungsgrundlage, und das ist eine ehrliche Aussage (B21-1).
    expect(out.kette.map((s) => s.valid_from)).toEqual(['2026-01-01', '2028-01-01'])
  })
})

describe('B21-2e — Szenario 5: der Anlageweg bleibt unberührt', () => {
  it('`create_grid_tariff` hängt weiterhin nach vorne an — und setzt `backfilled_at` NICHT', async () => {
    /*
     * Regression in zwei Richtungen: die Vorwärts-Anlage funktioniert unverändert, UND die neue
     * Spalte bleibt dort `null`. Ein Default auf der Spalte machte aus „nicht nachgetragen" ein
     * „am Tag der Migration nachgetragen" — also aus einer wahren Aussage eine falsche.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { netzebene: 6, validFrom: '2026-01-01' })
      const res = await c.query(
        `select public.create_grid_tariff(
                  p_operator_id            => $1,
                  p_operator_name          => 'Gate Netz',
                  p_netzebene              => 6::smallint,
                  p_metering_variant       => null,
                  p_grundpreis_amount      => 44.00,
                  p_grundpreis_unit        => 'eur_per_kw_year',
                  p_netzverlust_ct_per_kwh => 1.23,
                  p_price_basis            => 'net',
                  p_valid_from             => '2027-01-01'::date,
                  p_created_by             => 'gate@test.local',
                  p_windows                => $2::jsonb
                ) as r`,
        [OP, JSON.stringify([{ label: 'n', time_from: '00:00', time_to: '24:00', ct_per_kwh: 7 }])],
      )
      return {
        res: (res.rows[0] as { r: { status: string; closed_count: number } }).r,
        kette: await kette(c, 6),
      }
    })

    expect(out.res.status).toBe('created')
    expect(out.res.closed_count).toBe(1)
    expect(out.kette).toEqual([
      { valid_from: '2026-01-01', valid_until: '2026-12-31', backfilled: false },
      { valid_from: '2027-01-01', valid_until: null, backfilled: false },
    ])
  })

  it('beide Wege an derselben Kombination ergeben eine durchgehende Kette', async () => {
    // Erst rückwärts, dann vorwärts — die Reihenfolge darf keine Rolle spielen.
    const k = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { netzebene: 4, validFrom: '2026-01-01' })
      await backfill(c, { netzebene: 4, validFrom: '2025-01-01' })
      await c.query(
        `select public.create_grid_tariff(
                  p_operator_id => $1, p_operator_name => 'Gate Netz', p_netzebene => 4::smallint,
                  p_metering_variant => null, p_grundpreis_amount => 44, p_grundpreis_unit => 'eur_per_kw_year',
                  p_netzverlust_ct_per_kwh => 1.23, p_price_basis => 'net',
                  p_valid_from => '2027-01-01'::date, p_created_by => 'gate@test.local',
                  p_windows => $2::jsonb)`,
        [OP, JSON.stringify([{ label: 'n', time_from: '00:00', time_to: '24:00', ct_per_kwh: 7 }])],
      )
      return await kette(c, 4)
    })
    expect(k).toEqual([
      { valid_from: '2025-01-01', valid_until: '2025-12-31', backfilled: true },
      { valid_from: '2026-01-01', valid_until: '2026-12-31', backfilled: false },
      { valid_from: '2027-01-01', valid_until: null, backfilled: false },
    ])
  })
})

describe('B21-2e — Szenario 6: eine Kombination, die es gar nicht gibt', () => {
  it('meldet `no_existing_stand` und legt NICHTS an', async () => {
    /*
     * Kein stilles Anlegen einer ersten Zeile: dafür ist `create_grid_tariff` da. Hier
     * durchgelassen entstünde eine Zeile mit `valid_until` aus dem Nichts (es gäbe keinen
     * Nachfolger, an dem sie enden könnte) oder eine offene Zeile in der Vergangenheit.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const res = await backfill(c, { operatorId: `${OP}-leer` })
      await c.query('reset role')
      const n = await c.query(`select count(*)::int n from public.grid_tariffs where operator_id = $1`, [
        `${OP}-leer`,
      ])
      return { res, n: (n.rows[0] as { n: number }).n }
    })
    expect(out.res.status).toBe('no_existing_stand')
    expect(out.n).toBe(0)
  })

  it('die Messvariante gehört zur Identität — dieselbe Ebene mit anderer Variante ist eine andere Kombination', async () => {
    /*
     * `metering_variant is not distinct from` statt `=`: bei NE 3–6 steht dort `null`, und ein
     * gewöhnliches `=` fände die Zeile nie. Umgekehrt darf ein Backfill für
     * `mit_leistungsmessung` sich NICHT an einer Zeile ohne Variante orientieren — sonst schriebe
     * er eine Zeile in eine Kombination, die es nicht gibt.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { netzebene: 7 }) // metering_variant = null
      const res = await backfill(c, { netzebene: 7, meteringVariant: 'mit_leistungsmessung' })
      return { res, kette: await kette(c, 7) }
    })
    expect(out.res.status).toBe('no_existing_stand')
    expect(out.kette).toHaveLength(1)
  })
})

describe('B21-2e — Szenario 7: NUR geschlossene Zeilen (der zentrale Wächter)', () => {
  it('⚠ die nachgetragene Zeile bekommt ein `valid_until` — sie bleibt NICHT offen', async () => {
    /*
     * Der Fall entsteht real: der offene Stand wurde über `delete_grid_tariff` (B21-2c) entfernt,
     * die abgelösten stehen weiter da. Eine Umsetzung, die den ÄLTESTEN Stand über
     * `valid_until is null` sucht (die Abfrage aus `create_grid_tariff`), fände hier nichts —
     * und liesse die neue Zeile OFFEN. Dann rechnete eine Analyse jeden Zeitraum bis heute mit
     * einem historischen Preisblatt, ohne dass irgendetwas danach aussähe.
     *
     * Geprüft werden BEIDE Hälften: dass `valid_until` überhaupt gesetzt ist, und welchen Wert es
     * trägt. Nur „nicht null" bliebe grün, wenn dort ein falsches Datum stünde.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { validFrom: '2026-01-01', validUntil: '2026-12-31' })
      const res = await backfill(c, { validFrom: '2025-01-01' })
      return { res, kette: await kette(c) }
    })

    expect(out.res.status).toBe('backfilled')
    expect(out.res.new_valid_until).toBe('2025-12-31')
    expect(out.kette).toEqual([
      { valid_from: '2025-01-01', valid_until: '2025-12-31', backfilled: true },
      { valid_from: '2026-01-01', valid_until: '2026-12-31', backfilled: false },
    ])
    // Ausdrücklich: KEINE offene Zeile in dieser Kombination — es gab vorher keine, und es
    // entsteht auch keine.
    expect(out.kette.filter((s) => s.valid_until === null)).toHaveLength(0)
  })

  it('bei MEHREREN geschlossenen Zeilen gilt die älteste als Bezugspunkt', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c, { validFrom: '2026-01-01', validUntil: '2026-12-31' })
      await seed(c, { validFrom: '2027-01-01', validUntil: '2027-12-31' })
      const res = await backfill(c, { validFrom: '2025-01-01' })
      return { res, kette: await kette(c) }
    })
    expect(out.res.new_valid_until).toBe('2025-12-31')
    expect(out.res.preceded_valid_from).toBe('2026-01-01')
    expect(out.kette.map((s) => s.valid_from)).toEqual(['2025-01-01', '2026-01-01', '2027-01-01'])
  })
})

describe('B21-2e — Szenario 8: gleichzeitige Aufrufe auf derselben Kombination', () => {
  it('der Advisory-Lock serialisiert Backfill UND Anlage — der zweite liest einen konsistenten Zustand', async () => {
    /*
     * ⚠ DERSELBE Schlüssel wie in `create_grid_tariff` ist Bedingung, nicht Kosmetik: ein eigener
     * liesse beide gleichzeitig laufen, und jeder läse einen Bestand, den der andere gerade ändert.
     *
     * Gemessen wird über ZWEI echte Verbindungen: A hält den Lock (Transaktion offen), B läuft in
     * denselben Schlüssel und MUSS warten. Dass B blockiert, wird über eine kurze Frist und
     * `pg_stat_activity` nachgewiesen; anschliessend gibt A frei, und B sieht die von A angelegte
     * Zeile — er meldet also `not_before_oldest` statt eine zweite Zeile mit demselben Beginn
     * anzulegen.
     */
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      // Fixture ausserhalb beider Transaktionen, damit A und B es gemeinsam sehen.
      await sql(
        `insert into public.grid_tariffs
           (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
            grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, created_by)
         values ($1, 'Gate Netz', 3::smallint, null, 38.52, 'eur_per_kw_year', 1.23, 'net',
                 '2026-01-01', 'gate@test.local')`,
        [`${OP}-lock`],
      )

      const call = (validFrom: string) =>
        `select public.backfill_grid_tariff(
                  p_operator_id => '${OP}-lock', p_netzebene => 3::smallint,
                  p_grundpreis_amount => 30, p_grundpreis_unit => 'eur_per_kw_year',
                  p_netzverlust_ct_per_kwh => 1, p_price_basis => 'net',
                  p_valid_from => '${validFrom}'::date, p_created_by => 'gate@test.local',
                  p_windows => '[{"label":"n","time_from":"00:00","time_to":"24:00","ct_per_kwh":6.5}]'::jsonb
                ) as r`

      await a.query('begin')
      await a.query('set local role service_role')
      const first = (await a.query(call('2025-01-01'))).rows[0] as { r: Result }

      // B startet, während A noch offen ist — und muss am Advisory-Lock hängen bleiben.
      await b.query('begin')
      await b.query('set local role service_role')
      const pending = b.query(call('2024-01-01'))

      const blocked = await wartetAufLock('backfill_grid_tariff')

      await a.query('commit')
      const second = (await pending).rows[0] as { r: Result }
      await b.query('rollback')

      expect(first.r.status).toBe('backfilled')
      // B hat gewartet — ohne gemeinsamen Schlüssel wäre er sofort durchgelaufen.
      expect(blocked).toBeGreaterThanOrEqual(1)
      /*
       * ⚠ Der eigentliche Beleg steht in `preceded_valid_from`: B rechnet gegen A's inzwischen
       * angelegte Zeile (2025-01-01) und NICHT gegen die 2026er, die er beim Start gesehen hätte.
       * Ohne gemeinsamen Lock hätte er das Minimum von VOR A's Schreibvorgang gelesen und sein
       * `valid_until` auf 2025-12-31 gesetzt — also GENAU auf den Zeitraum, den A gerade belegt
       * hat. Zwei überlappende Stände, und der Unique-Constraint griffe nicht (verschiedene
       * `valid_from`).
       */
      expect(second.r.status).toBe('backfilled')
      expect(second.r.new_valid_until).toBe('2024-12-31')
      expect(second.r.preceded_valid_from).toBe('2025-01-01')
    } finally {
      await a.query('rollback').catch(() => undefined)
      await b.query('rollback').catch(() => undefined)
      a.release()
      b.release()
      await sql(`delete from public.grid_tariffs where operator_id = $1`, [`${OP}-lock`])
    }
  })

  it('gegen `create_grid_tariff` gehalten: der zweite wartet, und die Kette bleibt lückenlos', async () => {
    /*
     * Der von der Aufgabenstellung verlangte Fall — die zwei VERSCHIEDENEN Funktionen gleichzeitig
     * auf derselben Kombination.
     *
     * ⚠ DER AUFBAU IST GENAU SO GEWÄHLT, DASS ER DEN GEMEINSAMEN SCHLÜSSEL ISOLIERT.
     * Die Kombination trägt ZWEI Stände: einen abgelösten (2026, der ÄLTESTE) und einen offenen
     * (2027). A legt vorwärts an und fasst dabei nur den OFFENEN an; der Bezugspunkt des Backfills
     * — die älteste Zeile — bleibt von A unberührt. Damit greift das zeilenweise `for update`
     * NICHT, und übrig bleibt als einziger Grund zu warten der Advisory-Lock.
     *
     * Ohne diesen Aufbau misst die Zusicherung etwas anderes: Läge nur EIN (offener) Stand da,
     * wäre er zugleich der älteste, A sperrte ihn per UPDATE, und B wartete auch mit einem
     * separaten Schlüssel — nachgemessen und deshalb hier festgehalten.
     *
     * ⚠ WAS DER SCHLÜSSEL NICHT LEISTET, ebenso offen: Das ERGEBNIS hängt nicht an ihm. Die beiden
     * Funktionen können ihre Entscheidungen gar nicht gegenseitig verschieben
     * (`create_grid_tariff` fügt nie eine ältere Zeile ein, der Backfill nie eine offene). Deshalb
     * steht hier beides nebeneinander: die Wartezusage UND die Kette.
     */
    const a = await pool.connect()
    const b = await pool.connect()
    const op = `${OP}-mix`
    try {
      // ZWEI Stände: der abgelöste 2026 ist der ÄLTESTE (Bezugspunkt von B), der offene 2027 ist
      // der, den A anfasst. Nur so sind die beiden Zeilen verschieden (s. Kopf).
      await sql(
        `insert into public.grid_tariffs
           (operator_id, operator_name, netzebene, metering_variant, grundpreis_amount,
            grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, valid_until, created_by)
         values ($1, 'Gate Netz', 3::smallint, null, 38.52, 'eur_per_kw_year', 1.23, 'net',
                 '2026-01-01', '2026-12-31', 'gate@test.local'),
                ($1, 'Gate Netz', 3::smallint, null, 38.52, 'eur_per_kw_year', 1.23, 'net',
                 '2027-01-01', null, 'gate@test.local')`,
        [op],
      )

      // A legt VORWÄRTS an (schliesst die 2027er Zeile) und hält die Transaktion offen.
      await a.query('begin')
      await a.query('set local role service_role')
      const created = (
        await a.query(
          `select public.create_grid_tariff(
                    p_operator_id => $1, p_operator_name => 'Gate Netz', p_netzebene => 3::smallint,
                    p_metering_variant => null, p_grundpreis_amount => 44,
                    p_grundpreis_unit => 'eur_per_kw_year', p_netzverlust_ct_per_kwh => 1.23,
                    p_price_basis => 'net', p_valid_from => '2028-01-01'::date,
                    p_created_by => 'gate@test.local', p_windows => $2::jsonb) as r`,
          [op, JSON.stringify([{ label: 'n', time_from: '00:00', time_to: '24:00', ct_per_kwh: 7 }])],
        )
      ).rows[0] as { r: { status: string } }

      // B backfillt RÜCKWÄRTS — und muss am gemeinsamen Schlüssel hängen bleiben.
      await b.query('begin')
      await b.query('set local role service_role')
      const pending = b.query(
        `select public.backfill_grid_tariff(
                  p_operator_id => $1, p_netzebene => 3::smallint, p_grundpreis_amount => 30,
                  p_grundpreis_unit => 'eur_per_kw_year', p_netzverlust_ct_per_kwh => 1,
                  p_price_basis => 'net', p_valid_from => '2025-01-01'::date,
                  p_created_by => 'gate@test.local', p_windows => $2::jsonb) as r`,
        [op, JSON.stringify([{ label: 'n', time_from: '00:00', time_to: '24:00', ct_per_kwh: 6.5 }])],
      )
      const blocked = await wartetAufLock('backfill_grid_tariff')

      await a.query('commit')
      const backfilled = (await pending).rows[0] as { r: Result }
      await b.query('commit')

      const k = await sql<Stand>(
        `select valid_from::text, valid_until::text, (backfilled_at is not null) as backfilled
           from public.grid_tariffs where operator_id = $1 order by valid_from asc`,
        [op],
      )

      expect(created.r.status).toBe('created')
      expect(blocked).toBeGreaterThanOrEqual(1)
      expect(backfilled.r.status).toBe('backfilled')
      expect(k.map((x) => [x.valid_from, x.valid_until])).toEqual([
        ['2025-01-01', '2025-12-31'],
        ['2026-01-01', '2026-12-31'],
        ['2027-01-01', '2027-12-31'],
        ['2028-01-01', null],
      ])
      // Alle drei Übergänge exakt einen Tag breit — keine Lücke, keine Überschneidung.
      expect(abstaende(k)).toEqual([1, 1, 1])
    } finally {
      await a.query('rollback').catch(() => undefined)
      await b.query('rollback').catch(() => undefined)
      a.release()
      b.release()
      await sql(`delete from public.grid_tariffs where operator_id = $1`, [op])
    }
  })
})

describe('B21-2e — Ablehnungen ohne Schreibvorgang', () => {
  it('ohne Zeitfenster wird gar nichts angelegt', async () => {
    for (const windows of [[], null]) {
      const out = await runAs({ role: 'service_role' }, async (c) => {
        await seed(c)
        const res = await backfill(c, { windows: windows as unknown })
        return { res, kette: await kette(c) }
      })
      expect(out.res.status).toBe('no_windows')
      expect(out.kette).toHaveLength(1)
    }
  })

  it('ein unbrauchbares Zeitfenster nimmt die bereits angelegte Zeile mit', async () => {
    // Die Klammer um beide INSERTs ist der Grund, warum es diese Funktion gibt: sonst bliebe eine
    // Tarifzeile OHNE Arbeitspreis stehen, die die Engine als vollständig läse.
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c)
      await c.query('savepoint sp')
      let message: string | undefined
      try {
        await backfill(c, {
          windows: [{ label: 'n', time_from: 'nicht-eine-uhrzeit', time_to: '24:00', ct_per_kwh: 6.5 }],
        })
      } catch (e) {
        message = (e as { message?: string }).message
        await c.query('rollback to savepoint sp')
      }
      return { message, kette: await kette(c) }
    })
    expect(out.message).toBe('invalid_window')
    expect(out.kette).toHaveLength(1)
  })
})

describe('B21-2e — die Funktion ist so verschlossen wie ihre Geschwister', () => {
  it('sie ist SECURITY INVOKER und existiert genau einmal', async () => {
    // Auf DEFINER umgestellt liefe sie unter ihrem Eigentümer — dann entschiede der EXECUTE-Grant
    // allein über einen Schreibzugriff auf veröffentlichte Preisdaten.
    const rows = await sql<{ n: number; secdef: boolean }>(
      `select count(*)::int n, bool_or(p.prosecdef) secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'backfill_grid_tariff'`,
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
        where n.nspname = 'public' and p.proname = 'backfill_grid_tariff'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true })
  })

  it('nur `p_metering_variant` trägt einen Vorgabewert, und es steht am ENDE', async () => {
    /*
     * PostgreSQL verlangt, dass alle Parameter NACH einem mit Vorgabewert ebenfalls einen tragen.
     * Rutschte es nach vorn, müssten auch `p_valid_from` und `p_windows` optional werden — ein
     * Aufruf ohne Gültigkeitsbeginn liefe dann durch. Dieselbe Anordnung wie in `create_grid_tariff`.
     *
     * ⚠ `p_operator_name` fehlt hier bewusst: der Anzeigename kommt aus dem Bestand (s. Migration).
     */
    const rows = await sql<{ names: string[]; defaults: number }>(
      `select p.proargnames::text[] as names, p.pronargdefaults as defaults
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'backfill_grid_tariff'`,
    )
    expect(rows[0]?.names).toEqual([
      'p_operator_id',
      'p_netzebene',
      'p_grundpreis_amount',
      'p_grundpreis_unit',
      'p_netzverlust_ct_per_kwh',
      'p_price_basis',
      'p_valid_from',
      'p_created_by',
      'p_windows',
      'p_metering_variant',
    ])
    expect(Number(rows[0]?.defaults)).toBe(1)
  })

  it('KEIN neues Tabellenrecht — die Rechtefläche ist unverändert die aus B21-2b/2c', async () => {
    // Ein Grant „vorsichtshalber" wäre kein harmloser Überschuss, sondern ein falscher Beleg. Der
    // Backfill braucht insbesondere KEIN SELECT auf den Zeitfenstern (anders als B21-2d) und KEIN
    // DELETE auf `grid_tariffs` (B21-2c) — beides steht trotzdem und wird hier nur festgehalten.
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

  it('`backfilled_at` ist nullable, ohne Default und ohne CHECK', async () => {
    /*
     * Kein Default: `null` heisst „regulär vorwärts angehängt" und ist für jede vor dieser
     * Migration entstandene Zeile bereits die zutreffende Aussage. Ein Default (etwa `now()`)
     * machte daraus „am Tag der Migration nachgetragen" — aus einer wahren Aussage eine falsche.
     */
    const col = await sql<{ is_nullable: string; column_default: string | null; data_type: string }>(
      `select is_nullable, column_default, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = 'grid_tariffs'
          and column_name = 'backfilled_at'`,
    )
    expect(col[0]).toEqual({
      is_nullable: 'YES',
      column_default: null,
      data_type: 'timestamp with time zone',
    })
  })

  it('anon und authenticated können auch direkt keine Tarifzeile anlegen (42501)', async () => {
    // Eine neue `public`-SPALTE bringt keine neuen Rechte mit (eine neue Tabelle sehr wohl, B21-1).
    // Diese Prüfung hält fest, dass die Spalte daran nichts geändert hat.
    for (const role of ['anon', 'authenticated'] as const) {
      const err = await runAs({ role }, async (c) => {
        try {
          await c.query(
            `insert into public.grid_tariffs
               (operator_id, operator_name, netzebene, grundpreis_amount, grundpreis_unit,
                netzverlust_ct_per_kwh, price_basis, valid_from, created_by, backfilled_at)
             values ('probe', 'Probe', 5, 1, 'eur_per_kw_year', 1, 'net', '2020-01-01', 'x', now())`,
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
