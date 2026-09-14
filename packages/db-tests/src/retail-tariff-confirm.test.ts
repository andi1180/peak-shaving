// DB-Gate für die Neuprüfung eines Lieferanten-Tarifstands
// (Migration 20260913130000_create_retail_tariff_confirm.sql).
//
// Geprüft wird der ECHTE Weg — `public.confirm_retail_tariff` unter `set local role service_role`,
// also genau der Aufruf, den das Admin-UI absetzt. Introspektion allein genügt nicht (Arbeitsregel 2).
//
// ── (1) ⚠ DIE MINDEST-RECHTEFLÄCHE IST GEMESSEN — UND DIE ERWARTUNG WAR FALSCH ────────────────
//     Die Aufgabenstellung ging davon aus, dieser Weg brauche NUR `update`: „die id kommt vom
//     Aufrufer, es gibt nichts zu suchen". Die Stufenmessung unten sagt etwas anderes:
//
//       kein Grant                  → 42501 retail_tariffs
//       update                      → 42501 retail_tariffs
//       select                      → 42501 retail_tariffs
//       select + update             → OK, status confirmed
//       insert + select + update    → OK, kein Unterschied
//
//     Der Grund steht in der UPDATE-Dokumentation: Wer schreibt, braucht SELECT auf jede Spalte,
//     deren Wert in einer BEDINGUNG gelesen wird — und `where id = p_id` liest `id`. Der Test misst
//     das zusätzlich isoliert: eine Fassung OHNE `returning` scheitert genauso. Es hängt an der
//     WHERE-Bedingung, nicht am Rückgabewert.
//
//     ⇒ Die Migration vergibt deshalb GAR KEIN neues Tabellen-Grant: `service_role` hat seit dem
//       Schreibweg bereits `insert, select, update`, und dieser Weg passt vollständig darunter.
//       Die Auflage aus jener Migration ist trotzdem erfüllt — sie verlangt eine eigene FUNKTION
//       statt einer `.update()`-Zeile im Anwendungscode, nicht eine kleinere Rechtefläche.
//
// ── (2) DIE EIGENTLICHE ZUSAGE: ES ÄNDERT SICH NICHTS AUSSER `checked_at` ─────────────────────
//     Genau die Lücke, für die es diese Funktion gibt. Über PostgREST könnte `service_role` mit
//     seinem UPDATE-Recht JEDE Spalte überschreiben, auch den Preis. Unten wird die Zeile vorher
//     und nachher Spalte für Spalte verglichen — nicht „sieht gleich aus", sondern jeder Wert
//     einzeln.
//
//     ⚠ EIN VORHER/NACHHER-VERGLEICH AUF `checked_at` ALLEIN GENÜGT NICHT, und das ist im
//     Nachbar-Gate bereits teuer gemessen worden: `now()` liefert den Zeitpunkt des
//     TRANSAKTIONSBEGINNS, nicht die Uhr. Eine frisch angelegte Zeile und ein `checked_at = now()`
//     in derselben Transaktion tragen denselben Wert — die Bestätigung wäre nicht von ihrem
//     Ausbleiben zu unterscheiden. Die Fixture-Zeile bekommt deshalb ein erkennbar ALTES Prüfdatum.
//
// ── (3) EIN NICHT-TREFFER IST EIN STATUS UND ÄNDERT 0 ZEILEN ──────────────────────────────────
//     Nicht bloss behauptet: die Zahl der Zeilen mit verändertem `checked_at` wird nachgezählt.
//
// ── (4) ANONYME UND ANGEMELDETE ROLLEN BLEIBEN AUSSEN VOR ────────────────────────────────────
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
const PROVIDER = 'gate-retail-confirm'

/** Ein erkennbar ALTES Prüfdatum — genau der Zustand, den die Staleness-Anzeige meint (s. Kopf). */
const ALT = '2020-03-01T08:00:00.000Z'

type Outcome = { status: string; checked_at?: string }

/** Legt eine Zeile an und setzt ihr das alte Prüfdatum. Gibt die Kennung zurück. */
async function seed(c: PoolClient, validFrom = '2026-01-01'): Promise<string> {
  const res = await c.query(
    `insert into public.retail_tariffs
       (provider_id, provider_name, segment, energy_price_ct_per_kwh, base_fee_eur_per_month,
        price_basis, source_url, valid_from, created_by, checked_at)
     values ($1, 'Gate Energie', 'privat', 24.1, 3.9, 'net',
             'https://example.invalid/preise', $2::date, 'gate@test.local', $3::timestamptz)
     returning id`,
    [PROVIDER, validFrom, ALT],
  )
  return (res.rows[0] as { id: string }).id
}

async function confirm(c: PoolClient, id: string): Promise<Outcome> {
  const res = await c.query('select public.confirm_retail_tariff($1) as r', [id])
  return (res.rows[0] as { r: Outcome }).r
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('confirm_retail_tariff — der Gutfall', () => {
  it('meldet `confirmed` und liefert den gesetzten Zeitpunkt mit', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      return confirm(c, id)
    })
    expect(out.status).toBe('confirmed')
    expect(out.checked_at).toBeTypeOf('string')
    // Das alte Prüfdatum ist nachweislich weg — sonst wäre „confirmed" eine Behauptung.
    expect(new Date(out.checked_at!).getTime()).toBeGreaterThan(new Date(ALT).getTime())
  })

  it('⚠ ES ÄNDERT SICH NICHTS AUSSER `checked_at` — Spalte für Spalte verglichen', async () => {
    /*
     * Die Lücke, für die diese Funktion überhaupt existiert. `service_role` hat auf der Tabelle
     * UPDATE (der Schreibweg braucht es fürs Schliessen der Vorgängerin und für die Zeilensperre) —
     * über PostgREST liesse sich damit jede Spalte überschreiben, auch der Preis. Was diese
     * Funktion zusichert, wird hier nachgezählt und nicht geglaubt.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      const cols = `provider_id, provider_name, segment,
                    energy_price_ct_per_kwh::text ep, base_fee_eur_per_month::text bf,
                    price_basis, source_url, valid_from::text vf, valid_until::text vu,
                    created_by, created_at::text ca, id::text`
      const before = await c.query(`select ${cols} from public.retail_tariffs where id = $1`, [id])
      await confirm(c, id)
      const after = await c.query(`select ${cols} from public.retail_tariffs where id = $1`, [id])
      const checked = await c.query(
        `select checked_at::text ct from public.retail_tariffs where id = $1`,
        [id],
      )
      return {
        before: before.rows[0] as Record<string, unknown>,
        after: after.rows[0] as Record<string, unknown>,
        checked: (checked.rows[0] as { ct: string }).ct,
      }
    })

    // ⚠ `toEqual` über das GANZE Zeilenobjekt, nicht ein `toMatchObject` über eine Auswahl: eine
    // Auswahl liesse ausgerechnet die Spalte aus, die jemand später versehentlich mitschreibt.
    expect(out.after).toEqual(out.before)
    // Die Positivkontrolle im selben Zug: die eine Spalte, die sich ändern DARF, hat sich geändert.
    expect(out.checked).not.toContain('2020-03-01')
  })

  it('zweimal bestätigen ist zulässig — die Funktion ist wiederholbar', async () => {
    // Ein Admin, der zweimal klickt, soll keine Ausnahme bekommen: „nochmal nachgesehen" ist eine
    // gültige Aussage, so oft sie jemand macht.
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      await confirm(c, id)
      return confirm(c, id)
    })
    expect(out.status).toBe('confirmed')
  })

  it('auch ein ABGELÖSTER Stand lässt sich bestätigen — die Funktion urteilt darüber nicht', async () => {
    /*
     * Absicht, nicht Auslassung: WELCHE Zeile bestätigt werden darf, ist eine fachliche Frage der
     * Oberfläche (der Knopf steht dort nur am offenen Stand). Eine zweite, hier erfundene Regel
     * könnte von ihr abweichen. Was die Funktion zusichert, ist enger und dafür absolut: es ändert
     * sich nichts ausser `checked_at`.
     */
    const out = await runAs({ role: 'service_role' }, async (c) => {
      const id = await seed(c)
      await c.query(`update public.retail_tariffs set valid_until = '2026-06-30' where id = $1`, [
        id,
      ])
      return confirm(c, id)
    })
    expect(out.status).toBe('confirmed')
  })
})

describe('confirm_retail_tariff — ein Nicht-Treffer ändert NICHTS', () => {
  it('eine unbekannte Kennung meldet `not_found` und fasst 0 Zeilen an', async () => {
    const out = await runAs({ role: 'service_role' }, async (c) => {
      await seed(c)
      const result = await confirm(c, '11111111-2222-4333-8444-555555555555')
      // Nachgezählt, nicht behauptet: keine Zeile hat ihr altes Prüfdatum verloren.
      const res = await c.query(
        `select count(*)::int n,
                count(*) filter (where checked_at = $2::timestamptz)::int alt
           from public.retail_tariffs where provider_id = $1`,
        [PROVIDER, ALT],
      )
      return { result, ...(res.rows[0] as { n: number; alt: number }) }
    })
    expect(out.result).toEqual({ status: 'not_found' })
    expect(out.n).toBe(1)
    expect(out.alt).toBe(1)
  })

  it('`not_found` ist ein STATUS und keine Ausnahme', async () => {
    // Anders als `delete_grid_tariff`, das per `raise` meldet. Hier ist der Nicht-Treffer der
    // Alltag zweier offener Browser-Fenster; eine Ausnahme müsste durch PostgREST und die Server
    // Action getragen werden, um dieselbe Auskunft zu geben.
    const thrown = await runAs({ role: 'service_role' }, async (c) => {
      try {
        await confirm(c, '99999999-8888-4777-8666-555555555555')
        return null
      } catch (e) {
        return (e as { message?: string }).message ?? 'unbekannt'
      }
    })
    expect(thrown).toBeNull()
  })
})

describe('confirm_retail_tariff — die Rechtefläche ist genau so gross wie der Weg', () => {
  /**
   * Eine Stufe der Messung: in einer zurückgerollten Transaktion die Fläche von `service_role`
   * neu setzen, eine echte Zeile anlegen und die Funktion ECHT aufrufen.
   */
  async function stage(grants: readonly string[]): Promise<string> {
    return runAs({ role: 'postgres' }, async (c) => {
      const id = await seed(c)
      await c.query('revoke all on table public.retail_tariffs from service_role')
      if (grants.length > 0) {
        await c.query(`grant ${grants.join(', ')} on table public.retail_tariffs to service_role`)
      }
      await c.query('set local role service_role')
      try {
        const out = await confirm(c, id)
        return out.status
      } catch (e) {
        return (e as { code?: string }).code ?? 'unbekannt'
      }
    })
  }

  it('mit SELECT + UPDATE läuft der Aufruf durch — die Positivkontrolle', async () => {
    expect(await stage(['select', 'update'])).toBe('confirmed')
  })

  it('⚠ mit NUR UPDATE scheitert er — die naheliegende Erwartung ist falsch', async () => {
    /*
     * Der Befund, der die Migration bestimmt hat. `where id = p_id` LIEST die Spalte `id`, und
     * PostgreSQL verlangt dafür SELECT — auch auf einem Weg, der nur schreibt.
     */
    expect(await stage(['update'])).toBe('42501')
  })

  it('mit NUR SELECT scheitert er ebenfalls', async () => {
    expect(await stage(['select'])).toBe('42501')
  })

  it('ganz ohne Grant scheitert er ebenfalls', async () => {
    expect(await stage([])).toBe('42501')
  })

  it('ein zusätzliches INSERT ändert NICHTS — dieser Weg legt nichts an', async () => {
    expect(await stage(['insert', 'select', 'update'])).toBe('confirmed')
  })

  it('SELECT hängt an der WHERE-Bedingung, nicht am `returning`', async () => {
    /*
     * Die Ursache isoliert: dieselbe Anweisung OHNE Rückgabewert scheitert mit `update` allein
     * genauso. Wer das `returning` je entfernt, weil der Status genügt, braucht SELECT trotzdem —
     * und ein Test, der das nicht misst, liesse die Migration mit einer falschen Begründung stehen.
     */
    const out = await runAs({ role: 'postgres' }, async (c) => {
      const id = await seed(c)
      await c.query('revoke all on table public.retail_tariffs from service_role')
      await c.query('grant update on table public.retail_tariffs to service_role')
      await c.query('set local role service_role')

      const probe = async (q: string): Promise<string> => {
        await c.query('savepoint sp')
        try {
          await c.query(q, [id])
          await c.query('release savepoint sp')
          return 'OK'
        } catch (e) {
          await c.query('rollback to savepoint sp')
          return (e as { code?: string }).code ?? 'unbekannt'
        }
      }

      return {
        mitWhere: await probe(
          'update public.retail_tariffs set checked_at = now() where id = $1',
        ),
        ohneWhere: await probe(
          'update public.retail_tariffs set checked_at = now() where $1::uuid is null',
        ),
      }
    })
    // Ohne gelesene Spalte genügt UPDATE — der direkte Beleg, dass es die Bedingung ist.
    expect(out).toEqual({ mitWhere: '42501', ohneWhere: 'OK' })
  })

  it('service_role hat auf retail_tariffs weiterhin exakt INSERT, SELECT, UPDATE', async () => {
    // ⚠ UNVERÄNDERT zum Schreibweg: diese Migration vergibt kein Tabellen-Grant. Der Test steht
    // trotzdem hier — er wird rot, wenn jemand die Fläche „für die Bestätigung" vergrössert.
    const rows = await sql<{ privs: string }>(
      `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(keine)') privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'retail_tariffs'
          and grantee = 'service_role'`,
    )
    expect(rows[0]?.privs).toBe('INSERT,SELECT,UPDATE')
  })

  it('anon und authenticated dürfen die Funktion nicht einmal AUFRUFEN', async () => {
    // Über `has_function_privilege`, NICHT über einen Aufruf (Arbeitsregel 5).
    const rows = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role',  p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'confirm_retail_tariff'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true })
  })

  it('die Funktion ist SECURITY INVOKER, existiert genau einmal und nimmt NUR die Kennung', async () => {
    /*
     * Die Parameterliste ist die Zusage: Ein zweiter Parameter wäre entweder ein behauptbares
     * Prüfdatum oder eine zweite änderbare Spalte — beides hebt die Auflage aus dem Schreibweg auf.
     */
    const rows = await sql<{ secdef: boolean; sig: string; names: string[] }>(
      `select p.prosecdef secdef, pg_get_function_arguments(p.oid) sig, p.proargnames names
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'confirm_retail_tariff'`,
    )
    // Genau EINE Zeile heisst: genau eine Fassung — eine zweite Überladung mit abweichender
    // Signatur fiele weder unter den `revoke` noch unter den `grant execute` der Migration.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.secdef).toBe(false)
    expect(rows[0]?.sig).toBe('p_id uuid')
    expect(rows[0]?.names).toEqual(['p_id'])
  })
})
