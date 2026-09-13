// DB-Gate für den Schreibweg des Lieferanten-Tarifkatalogs
// (Migration 20260913120100_create_retail_tariff_write_path.sql).
//
// Geprüft wird der ECHTE Weg — `public.create_retail_tariff` unter `set local role service_role`,
// also genau der Aufruf, den das Admin-UI absetzen wird. Introspektion allein genügt nicht: die
// Funktion trifft in EINER Transaktion eine Lese-Entscheidung und zwei Schreibvorgänge, und ob die
// zusammen halten, sagt nur der Aufruf (Arbeitsregel 2).
//
// ── (1) DIE MINDEST-RECHTEFLÄCHE IST GEMESSEN — UND SIE STEHT HIER ALS TEST, NICHT NUR ALS NOTIZ ─
//     Bei `create_grid_tariff` (B21-2b) war die Stufenmessung eine einmalige Messung, die als
//     Tabelle im Kopf der Testdatei festgehalten wurde. Hier ist sie ein laufender Test: Jeder der
//     drei Grants wird EINZELN entzogen und der Aufruf muss scheitern, danach läuft er mit der
//     vollen Fläche durch. Der Unterschied ist nicht Fleiss, sondern Reichweite — eine Notiz belegt
//     einen Zustand von damals, der Test belegt ihn bei jedem Lauf. Er wird auch dann rot, wenn ein
//     künftiger Umbau die Funktion so ändert, dass sie eines der Rechte NICHT mehr braucht: dann
//     steht ein Grant da, den niemand mehr verlangt.
//
//     Gemessen gegen PostgreSQL 17.6, in zurückgerollten Transaktionen, mit einer bereits offenen
//     Vorgängerzeile (nur so läuft der UPDATE-Zweig überhaupt an):
//
//       kein Grant                                → 42501 retail_tariffs
//       insert                                    → 42501 retail_tariffs
//       insert + select        (ohne UPDATE)      → 42501 retail_tariffs
//       insert + update        (ohne SELECT)      → 42501 retail_tariffs
//       select + update        (ohne INSERT)      → 42501 retail_tariffs
//       insert + select + update                  → OK, closed_count 1
//       zusätzlich delete                         → OK, kein Unterschied
//
//     ⚠ NEBENBEFUND, DER DIE BEGRÜNDUNG SCHÄRFT: UPDATE wird NICHT nur fürs Schliessen der
//     Vorgängerin gebraucht. Ohne offene Vorgängerzeile — also auf einem Weg, der gar keine
//     UPDATE-Anweisung ausführt — scheitert `insert + select` ebenfalls mit 42501. Isoliert
//     nachgemessen: derselbe SELECT läuft OHNE `for update` durch und scheitert MIT. PostgreSQL
//     verlangt für eine Zeilensperre das Schreibrecht, auch wenn nichts geschrieben wird. Wer das
//     `for update` je entfernt, weil der Advisory-Lock ohnehin serialisiert, braucht das Recht
//     trotzdem — für das Schliessen.
//
// ── (2) HIER WIRD ALS `service_role` GELESEN, NICHT ALS EIGENTÜMER ────────────────────────────
//     `grid-tariff-write-path.test.ts` muss für seine Nachlese auf `reset role` ausweichen, weil
//     `service_role` auf `grid_tariff_rate_windows` nur INSERT hat. Diesen Zwang gibt es hier nicht:
//     Der Weg braucht SELECT ohnehin, und damit liest der Test durch exakt die Fläche, die auch der
//     Schreibweg hat. Was er sieht, sieht auch das Admin-UI.
//
// ── (3) DIE EFFEKTIV-DATIERUNG IST DIE EIGENTLICHE ZUSAGE ─────────────────────────────────────
//     Ein neuer Stand schliesst die offene Zeile derselben Kombination auf `valid_from - 1`.
//     Lückenlos UND überlappungsfrei folgt daraus von selbst; beides wird unten an echten Zeilen
//     NACHGERECHNET, nicht aus der Funktionsdefinition abgelesen. Dazu die Gegenprobe, die leicht
//     ausbleibt: dass das Schliessen `checked_at` der Vorgängerin NICHT anfasst — Ablösen ist keine
//     Neuprüfung.
//
// ── (4) ANONYME UND ANGEMELDETE ROLLEN BLEIBEN AUSSEN VOR ─────────────────────────────────────
//     Die EXECUTE-Prüfung läuft über `has_function_privilege` und NICHT über einen Aufruf: eine
//     SECURITY-Funktion durch eine Rolle ohne Grant aufzurufen hat in B16-4a den Postgres-Prozess
//     abgeschossen (Arbeitsregel 5).
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`) — die
// Tabelle bleibt auch während des Laufs leer, und parallel laufende Testdateien sehen nichts.

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Eindeutig je Datei, damit parallele Testdateien einander nicht in die Quere kommen. */
const PROVIDER = 'gate-retail-write'

const SIGNATURE = 'text, text, text, numeric, numeric, text, text, date, text'

type Args = {
  provider?: string
  segment?: string
  priceBasis?: string
  sourceUrl?: string
  energyPrice?: number
  validFrom: string
}

/** Der Aufruf, den auch das Admin-UI absetzen wird — benannte Argumente, wie PostgREST sie schickt. */
function callSql(a: Args): { text: string; values: unknown[] } {
  return {
    text: `select public.create_retail_tariff(
             p_provider_id             => $1,
             p_provider_name           => 'Gate Energie',
             p_segment                 => $2,
             p_energy_price_ct_per_kwh => $3,
             p_base_fee_eur_per_month  => 3.9,
             p_price_basis             => $4,
             p_source_url              => $5,
             p_valid_from              => $6::date,
             p_created_by              => 'gate@test.local'
           ) as r`,
    values: [
      a.provider ?? PROVIDER,
      a.segment ?? 'privat',
      a.energyPrice ?? 24.1,
      a.priceBasis ?? 'net',
      a.sourceUrl ?? 'https://example.invalid/preise',
      a.validFrom,
    ],
  }
}

type Outcome = {
  status: string
  id?: string
  closed_count?: number
  closed_valid_until?: string | null
  open_valid_from?: string | null
}

async function call(c: PoolClient, a: Args): Promise<Outcome> {
  const { text, values } = callSql(a)
  const res = await c.query(text, values)
  return (res.rows[0] as { r: Outcome }).r
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('create_retail_tariff — ein Stand entsteht vollständig', () => {
  it('ein erster Stand entsteht ohne Vorgänger', async () => {
    const out = await runAs({ role: 'service_role' }, (c) => call(c, { validFrom: '2026-01-01' }))
    expect(out.status).toBe('created')
    expect(out.closed_count).toBe(0)
    expect(out.closed_valid_until).toBeNull()
  })

  it('die Zeile steht anschliessend wirklich da — mit allen übergebenen Werten', async () => {
    const row = await runAs({ role: 'service_role' }, async (c) => {
      const out = await call(c, {
        validFrom: '2026-01-01',
        segment: 'betrieb',
        priceBasis: 'gross',
        energyPrice: 21.5,
        sourceUrl: 'https://example.invalid/betrieb',
      })
      const res = await c.query(
        `select provider_id, provider_name, segment,
                energy_price_ct_per_kwh::float8 ep, base_fee_eur_per_month::float8 bf,
                price_basis, source_url, valid_from::text, valid_until, created_by,
                checked_at is not null ca
           from public.retail_tariffs where id = $1`,
        [out.id],
      )
      return res.rows[0] as Record<string, unknown>
    })

    expect(row).toMatchObject({
      provider_id: PROVIDER,
      provider_name: 'Gate Energie',
      segment: 'betrieb',
      ep: 21.5,
      bf: 3.9,
      price_basis: 'gross',
      source_url: 'https://example.invalid/betrieb',
      valid_from: '2026-01-01',
      valid_until: null,
      created_by: 'gate@test.local',
      // Ein frisch eingetragener Stand ist „gerade eben bestätigt" — der Default trägt das.
      ca: true,
    })
  })

  it('`checked_at` ist bewusst KEIN Parameter der Funktion', async () => {
    // Ein Parameter dafür wäre eine Einladung, ein älteres Prüfdatum zu behaupten. Die Spalte sagt
    // ihre Wahrheit nur, wenn sie aus der Uhr kommt und nicht aus dem Aufruf.
    const rows = await sql<{ names: string[] }>(
      `select p.proargnames names
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_retail_tariff'`,
    )
    expect(rows[0]?.names).toEqual([
      'p_provider_id',
      'p_provider_name',
      'p_segment',
      'p_energy_price_ct_per_kwh',
      'p_base_fee_eur_per_month',
      'p_price_basis',
      'p_source_url',
      'p_valid_from',
      'p_created_by',
    ])
  })

  it('kein einziger Parameter hat einen Vorgabewert — alle Felder sind Pflicht', async () => {
    // Sobald EIN Parameter einen Vorgabewert trägt, verlangt PostgreSQL ihn für alle weiteren — und
    // dann liefe ein Aufruf ohne Gültigkeitsbeginn durch. Das ist die Falle, die `create_grid_tariff`
    // zwingt, `p_metering_variant` ans Ende zu stellen; hier gibt es sie nicht, und das bleibt so.
    const rows = await sql<{ n: number }>(
      `select p.pronargdefaults n
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = 'create_retail_tariff'`,
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })
})

describe('create_retail_tariff — Effektiv-Datierung: lückenlos und ohne Überschneidung', () => {
  it('ein zweiter Stand schliesst den ersten am Vortag — die Kette ist dicht', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2026-01-01', energyPrice: 24.1 })
      const second = await call(c, { validFrom: '2027-01-01', energyPrice: 26.9 })
      const res = await c.query(
        `select valid_from::text vf, valid_until::text vu, energy_price_ct_per_kwh::float8 ep
           from public.retail_tariffs where provider_id = $1 order by valid_from`,
        [PROVIDER],
      )
      return { second, rows: res.rows as { vf: string; vu: string | null; ep: number }[] }
    })

    expect(out.second.status).toBe('created')
    expect(out.second.closed_count).toBe(1)
    expect(out.second.closed_valid_until).toBe('2026-12-31')

    expect(out.rows).toHaveLength(2)
    expect(out.rows[0]).toMatchObject({ vf: '2026-01-01', vu: '2026-12-31', ep: 24.1 })
    expect(out.rows[1]).toMatchObject({ vf: '2027-01-01', vu: null, ep: 26.9 })

    // Hier ausgerechnet, nicht aus der Funktion abgelesen: kein gemeinsamer Tag (Überschneidung)
    // und kein Tag dazwischen (Lücke).
    const ende = new Date(`${out.rows[0]!.vu}T00:00:00Z`).getTime()
    const start = new Date(`${out.rows[1]!.vf}T00:00:00Z`).getTime()
    expect((start - ende) / 86_400_000).toBe(1)
  })

  it('das Schliessen fasst `checked_at` der Vorgängerin NICHT an', async () => {
    /*
     * Ablösen ist keine Neuprüfung. Schriebe der UPDATE `checked_at` mit, sähe ein abgelöster Stand
     * aus, als hätte ihn jemand am Tag seiner Ablösung noch einmal bestätigt — und die
     * Staleness-Anzeige des nächsten Schritts stützte sich auf eine Prüfung, die nie stattfand.
     *
     * ⚠ EIN VORHER/NACHHER-VERGLEICH GENÜGT DAFÜR NICHT, und das ist gemessen: `now()` liefert den
     * Zeitpunkt des TRANSAKTIONSBEGINNS, nicht die Uhr. Innerhalb dieser einen Transaktion ist der
     * Wert für den INSERT-Default der Vorgängerin und für ein `checked_at = now()` im UPDATE
     * derselbe — die erste Fassung dieses Tests blieb deshalb GRÜN, obwohl die Probe das UPDATE
     * nachweislich mitschreiben liess.
     *
     * Die Vorgängerin bekommt deshalb ein erkennbar ALTES Prüfdatum: genau der Zustand, den die
     * Staleness-Anzeige meint, und der einzige, an dem ein Überschreiben auffällt.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const first = await call(c, { validFrom: '2026-01-01' })
      await c.query(
        `update public.retail_tariffs set checked_at = '2020-03-01T08:00:00Z' where id = $1`,
        [first.id],
      )
      await call(c, { validFrom: '2027-01-01' })
      const res = await c.query(
        `select checked_at, valid_until::text vu from public.retail_tariffs where id = $1`,
        [first.id],
      )
      const row = res.rows[0] as { checked_at: Date; vu: string }
      return { checkedAt: row.checked_at.toISOString(), vu: row.vu }
    })
    // Die Gegenprobe im selben Zug: geschlossen wurde die Zeile sehr wohl.
    expect(out).toEqual({ checkedAt: '2020-03-01T08:00:00.000Z', vu: '2026-12-31' })
  })

  it('ein RÜCKWÄRTS datierter Stand wird abgewiesen — und verändert nichts', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2027-01-01' })
      const rejected = await call(c, { validFrom: '2026-01-01' })
      const res = await c.query(
        `select count(*)::int n, count(*) filter (where valid_until is null)::int offen
           from public.retail_tariffs where provider_id = $1`,
        [PROVIDER],
      )
      return { rejected, ...(res.rows[0] as { n: number; offen: number }) }
    })
    expect(out.rejected.status).toBe('invalid_valid_from')
    expect(out.rejected.open_valid_from).toBe('2027-01-01')
    // Eine abgelehnte Anlage darf die bestehende Lage nicht angefasst haben.
    expect(out.n).toBe(1)
    expect(out.offen).toBe(1)
  })

  it('derselbe Tag wie der offene Stand wird ebenfalls abgewiesen (kein Null-Tage-Stand)', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2026-01-01' })
      return call(c, { validFrom: '2026-01-01' })
    })
    expect(out.status).toBe('invalid_valid_from')
  })

  it('das ANDERE Segment desselben Anbieters bleibt unberührt', async () => {
    // Ohne `segment` im Schlüssel und in der Suche schlösse ein neuer Privat-Preis den
    // Betriebs-Preis desselben Anbieters mit — und niemandem fiele es auf, weil beide Zeilen
    // plausibel aussehen.
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { segment: 'betrieb', validFrom: '2026-01-01' })
      await call(c, { segment: 'privat', validFrom: '2027-01-01' })
      const res = await c.query(
        `select segment, valid_until from public.retail_tariffs
          where provider_id = $1 order by segment`,
        [PROVIDER],
      )
      return res.rows as { segment: string; valid_until: unknown }[]
    })
    expect(rows).toEqual([
      { segment: 'betrieb', valid_until: null },
      { segment: 'privat', valid_until: null },
    ])
  })

  it('ein ANDERER Anbieter bleibt ebenfalls unberührt', async () => {
    const rows = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { provider: `${PROVIDER}-a`, validFrom: '2026-01-01' })
      await call(c, { provider: `${PROVIDER}-b`, validFrom: '2027-01-01' })
      const res = await c.query(
        `select provider_id, valid_until from public.retail_tariffs
          where provider_id like $1 order by provider_id`,
        [`${PROVIDER}-%`],
      )
      return res.rows as { provider_id: string; valid_until: unknown }[]
    })
    expect(rows).toEqual([
      { provider_id: `${PROVIDER}-a`, valid_until: null },
      { provider_id: `${PROVIDER}-b`, valid_until: null },
    ])
  })

  it('ein bereits ARCHIVIERTER Stand mit demselben Beginn meldet duplicate_valid_from', async () => {
    /*
     * ⚠ Dieser Zweig ist NUR erreichbar, wenn es gar keinen offenen Stand gibt — sonst greift die
     * Ordnungsprüfung vorher und antwortet `invalid_valid_from` (dieselbe Beobachtung wie bei
     * `create_grid_tariff`). Über den regulären Weg entsteht so ein Bestand nie: jede Anlage
     * hinterlässt genau eine offene Zeile.
     *
     * Hergestellt wird er deshalb so, wie er real entstünde — an der Funktion vorbei, mit dem
     * Schreibrecht, das `service_role` ohnehin hat.
     */
    const message = await runAs({ role: 'service_role' }, async (c) => {
      await call(c, { validFrom: '2026-01-01' })
      await c.query(
        `update public.retail_tariffs set valid_until = '2026-06-30'
          where provider_id = $1 and valid_until is null`,
        [PROVIDER],
      )
      await c.query('savepoint sp')
      try {
        await call(c, { validFrom: '2026-01-01' })
        return null
      } catch (e) {
        await c.query('rollback to savepoint sp')
        return (e as { message?: string }).message ?? null
      }
    })
    expect(message).toBe('duplicate_valid_from')
  })
})

describe('create_retail_tariff — die CHECKs der Tabelle kommen als invalid_input zurück', () => {
  for (const [label, args] of [
    ['ein unbekanntes Segment', { segment: 'gewerbe' }],
    ['eine unbekannte Preisbasis', { priceBasis: 'brutto' }],
    ['ein leerer Quellenbeleg', { sourceUrl: '' }],
  ] as const) {
    it(`${label} wird als invalid_input gemeldet — und schreibt nichts`, async () => {
      const out = await runAs({ role: 'service_role' }, async (c) => {
        await c.query('savepoint sp')
        let message: string | undefined
        try {
          await call(c, { validFrom: '2026-01-01', ...args })
        } catch (e) {
          message = (e as { message?: string }).message
          await c.query('rollback to savepoint sp')
        }
        const res = await c.query(
          `select count(*)::int n from public.retail_tariffs where provider_id = $1`,
          [PROVIDER],
        )
        return { message, n: (res.rows[0] as { n: number }).n }
      })
      // Ein roher 23514 trägt keinen Feldbezug, mit dem die Oberfläche etwas anfangen könnte;
      // `invalid_input` ist der Name, den die Migration ihm gibt.
      expect(out.message).toBe('invalid_input')
      expect(out.n).toBe(0)
    })
  }

  it('ein Freitext-Beleg statt einer URL läuft dagegen durch', async () => {
    // Die Gegenprobe zum leeren Beleg: geprüft wird „nicht leer", NICHT „sieht aus wie eine URL".
    const out = await runAs({ role: 'service_role' }, (c) =>
      call(c, { validFrom: '2026-01-01', sourceUrl: 'Preisblatt per E-Mail vom 12.09.2026' }),
    )
    expect(out.status).toBe('created')
  })
})

describe('create_retail_tariff — die Rechtefläche ist genau so gross wie der Weg', () => {
  /**
   * Eine Stufe der Messung: in einer zurückgerollten Transaktion die Fläche von `service_role`
   * neu setzen, eine offene Vorgängerzeile anlegen (damit der UPDATE-Zweig anläuft) und die
   * Funktion ECHT aufrufen.
   *
   * Grants werden hier absichtlich angefasst und sofort zurückgerollt. Die Transaktionen sind
   * kurz; parallele Testdateien fassen `public.retail_tariffs` nicht schreibend an.
   */
  async function stage(grants: readonly string[]): Promise<string> {
    return runAs({ role: 'postgres' }, async (c) => {
      await c.query('revoke all on table public.retail_tariffs from service_role')
      if (grants.length > 0) {
        await c.query(`grant ${grants.join(', ')} on table public.retail_tariffs to service_role`)
      }
      await c.query(
        `insert into public.retail_tariffs
           (provider_id, provider_name, segment, energy_price_ct_per_kwh, base_fee_eur_per_month,
            price_basis, source_url, valid_from, created_by)
         values ($1, 'Gate Energie', 'privat', 24.1, 3.9, 'net',
                 'https://example.invalid/alt', '2026-01-01', 'gate@test.local')`,
        [PROVIDER],
      )
      await c.query('set local role service_role')
      try {
        const out = await call(c, { validFrom: '2027-01-01' })
        return out.status
      } catch (e) {
        return (e as { code?: string }).code ?? 'unbekannt'
      }
    })
  }

  it('mit INSERT + SELECT + UPDATE läuft der Aufruf durch — die Positivkontrolle', async () => {
    expect(await stage(['insert', 'select', 'update'])).toBe('created')
  })

  for (const [fehlt, grants] of [
    ['INSERT', ['select', 'update']],
    ['SELECT', ['insert', 'update']],
    ['UPDATE', ['insert', 'select']],
  ] as const) {
    it(`ohne ${fehlt} scheitert er mit 42501 — das Recht trägt also wirklich`, async () => {
      expect(await stage(grants)).toBe('42501')
    })
  }

  it('ganz ohne Grant scheitert er ebenfalls', async () => {
    expect(await stage([])).toBe('42501')
  })

  it('ein zusätzliches DELETE ändert NICHTS — es wäre ein falscher Beleg', async () => {
    // Der Grund, warum es nicht vergeben wird: Ein Grant „vorsichtshalber" behauptete, dieser Weg
    // lösche etwas, und der nächste Umbau nähme das als gegeben.
    expect(await stage(['insert', 'select', 'update', 'delete'])).toBe('created')
  })

  it('UPDATE wird vom `for update` verlangt, nicht erst vom Schliessen', async () => {
    /*
     * Der Nebenbefund aus dem Kopf, hier gemessen statt behauptet: Derselbe SELECT läuft OHNE
     * Zeilensperre durch und scheitert MIT — bei unveränderten Grants (insert + select). UPDATE
     * hängt also an der Sperre, nicht nur am Schliessen der Vorgängerin.
     */
    const out = await runAs({ role: 'postgres' }, async (c) => {
      await c.query('revoke all on table public.retail_tariffs from service_role')
      await c.query('grant insert, select on table public.retail_tariffs to service_role')
      await c.query('set local role service_role')

      const probe = async (q: string): Promise<string> => {
        await c.query('savepoint sp')
        try {
          await c.query(q)
          await c.query('release savepoint sp')
          return 'OK'
        } catch (e) {
          await c.query('rollback to savepoint sp')
          return (e as { code?: string }).code ?? 'unbekannt'
        }
      }

      return {
        ohne: await probe('select id from public.retail_tariffs where valid_until is null'),
        mit: await probe(
          'select id from public.retail_tariffs where valid_until is null for update',
        ),
      }
    })
    expect(out).toEqual({ ohne: 'OK', mit: '42501' })
  })

  it('service_role hat auf retail_tariffs exakt INSERT, SELECT, UPDATE', async () => {
    // EXAKT, nicht „enthält": Ein zusätzliches Recht, das der Weg nachweislich nicht braucht
    // (s. die Stufen darüber), soll rot werden.
    const rows = await sql<{ privs: string }>(
      `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(keine)') privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'retail_tariffs'
          and grantee = 'service_role'`,
    )
    expect(rows[0]?.privs).toBe('INSERT,SELECT,UPDATE')
  })

  it('DELETE auf public.retail_tariffs wird auch für service_role abgewiesen', async () => {
    // Es gibt keinen Weg, einen einmal eingetragenen Vergleichspreis verschwinden zu lassen.
    const err = await runAs({ role: 'service_role' }, async (c) => {
      try {
        await c.query('delete from public.retail_tariffs where false')
        return null
      } catch (e) {
        return e as { code?: string }
      }
    })
    expect(err?.code).toBe('42501')
  })

  it('anon und authenticated dürfen die Funktion nicht einmal AUFRUFEN', async () => {
    // Über `has_function_privilege`, NICHT über einen Aufruf (Arbeitsregel 5).
    const rows = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role',  p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_retail_tariff'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true })
  })

  it('die Funktion ist SECURITY INVOKER und existiert genau einmal', async () => {
    // SECURITY INVOKER ist die tragende Eigenschaft: Sie verschafft niemandem Rechte, die er nicht
    // schon hat. Auf DEFINER umgestellt liefe sie unter ihrem Eigentümer — und der EXECUTE-Grant
    // allein entschiede dann über den Schreibzugriff.
    const rows = await sql<{ n: number; secdef: boolean; sig: string }>(
      `select count(*)::int n, bool_or(p.prosecdef) secdef,
              string_agg(pg_get_function_arguments(p.oid), ' | ') sig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_retail_tariff'`,
    )
    expect(rows[0]?.n).toBe(1)
    expect(rows[0]?.secdef).toBe(false)
    // Die Signatur, auf die `revoke`/`grant execute` in der Migration lauten. Wandert sie, ohne dass
    // beide mitwandern, stünde die Funktion wieder jedem Browser-Client offen.
    expect(rows[0]?.sig.replace(/p_\w+ /g, '')).toBe(SIGNATURE)
  })

  it('anon und authenticated können weiterhin nicht in retail_tariffs schreiben (42501)', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const err = await runAs({ role }, async (c) => {
        try {
          await c.query(
            `insert into public.retail_tariffs
               (provider_id, provider_name, segment, energy_price_ct_per_kwh,
                base_fee_eur_per_month, price_basis, source_url, valid_from, created_by)
             values ('gate-retail-probe', 'Probe', 'privat', 1, 1, 'net',
                     'https://example.invalid/p', '2026-01-01', 'gate')`,
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
