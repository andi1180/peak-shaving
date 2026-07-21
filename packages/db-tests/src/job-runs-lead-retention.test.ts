// DB-Gate für die Scheduling-Infrastruktur und die automatische Fristdurchsetzung (B4-1)
// (Migration 20260722120000_create_job_runs_and_lead_retention.sql).
//
// Mit dieser Migration handelt das System erstmals VON SELBST: ein zeitgesteuerter Lauf löst einen
// unumkehrbaren Massenvorgang aus, zu einer Zeit, zu der niemand zusieht. Das Gate beweist deshalb
// genau vier Dinge:
//
//   (1) AUSWAHL — „fällig" heisst genau: Frist erreicht UND noch nicht anonymisiert. Ein Lead mit
//       Frist in der Zukunft und ein bereits anonymisierter tauchen NICHT auf.
//   (2) MENGENBEGRENZUNG — oberhalb von p_refuse_above wird NICHT die erste Teilmenge abgearbeitet,
//       sondern gar nichts. Das ist die einzige Sicherung, die es gibt: Anonymisierung ist seit
//       B1-3 endgültig, auch für service_role und postgres.
//   (3) URHEBERSCHAFT — ein Systemlauf ist als solcher erkennbar (anonymized_by_system = true,
//       anonymized_by = null), die Kombination „System UND Konto" ist per CHECK unmöglich, und die
//       Kennzeichnung ist nachträglich nicht mehr änderbar.
//   (4) PROTOKOLL — JEDER Lauf hinterlässt genau eine Zeile, auch der verweigerte. Ohne das wäre
//       ein ausgebliebener Job von einem Job ohne Arbeit nicht zu unterscheiden.
//
// ── WARUM JEDER TEST IN EINER EIGENEN TRANSAKTION MIT ROLLBACK LÄUFT ─────────────────────────────
// `run_lead_retention` arbeitet BESTANDSWEIT — es gibt keinen Parameter, mit dem sich der Lauf auf
// die eigenen Fixtures einschränken liesse (und es soll ihn auch nicht geben). Ein Lauf in einer
// Datenbank, in der noch fällige Leads eines anderen Tests liegen, würde diese mit anonymisieren —
// unumkehrbar, und der andere Test wäre danach kaputt. Deshalb dasselbe Muster wie
// `inIsolatedAdminWorld` im T4-4-/B1-3-Gate: EINE Transaktion, in der fremde fällige Leads und
// bestehende Laufdatensätze entfernt sind, alle Fixtures uncommitted entstehen — und ein `rollback`
// am Ende, der den Bestand vollständig wiederherstellt.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ──────────────────────────────────────
// Wie in allen bisherigen Wrapper-Gates: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant. `has_function_privilege` ist dieselbe
// Wahrheit, nur ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten
// NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und genau die
// Ablehnung IN der Funktion ist die zu beweisende Eigenschaft.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  pool,
  sql,
  type TestUser,
} from './client'

const spawnedUsers: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

async function newAdmin(): Promise<TestUser> {
  const u = await newUser()
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

type JobRunRow = {
  job_key: string
  outcome: string | null
  items_considered: number | null
  items_processed: number | null
  detail: string | null
  finished_at: string | null
}

type RetentionResult = {
  outcome: string
  items_considered: number
  items_processed: number
  detail: string | null
  run_id: string
}

type World = {
  /** Roher Zugriff auf DIESELBE Transaktion — sonst sähe eine Prüfung die Fixtures gar nicht. */
  q: <R extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>
  /** Legt einen Lead an, dessen Löschfrist vor `monthsAgo` Monaten erreicht wurde bzw. wird. */
  newLead: (opts?: { monthsSinceInteraction?: number }) => Promise<string>
  /** Ruft den Fristenlauf auf und liefert seine Kennzahlen. */
  run: (maxBatch?: number, refuseAbove?: number) => Promise<RetentionResult>
  /** Alle Laufdatensätze dieser Transaktion, ältester zuerst. */
  runs: () => Promise<JobRunRow[]>
  /** Führt eine Anweisung unter der Rolle `authenticated` mit den Claims von `actor` aus. */
  callAs: <R>(actor: TestUser, text: string, params?: unknown[]) => Promise<R>
}

/**
 * Eine Welt, in der NUR die eigenen Fixtures fällig sind — und die danach spurlos verschwindet.
 * Der Bestand ausserhalb bleibt unangetastet (rollback stellt auch die gelöschten Zeilen wieder her).
 */
async function inIsolatedRetentionWorld<T>(fn: (world: World) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('begin')

    // Fremde fällige Leads aus dem Weg räumen (nur innerhalb dieser Transaktion) — sonst
    // anonymisierte der Lauf sie mit. Die Einwilligungen gehen per Cascade mit.
    await client.query(
      `delete from platform.leads where anonymized_at is null and deletion_due_at <= now()`,
    )
    // Bestehende Laufdatensätze ebenso: „genau ein Datensatz je Lauf" lässt sich sonst nicht zählen.
    await client.query(`delete from platform.job_runs`)

    /*
     * JEDE Anweisung läuft in einem eigenen Sicherungspunkt. Das ist hier keine Vorsicht auf
     * Vorrat: mehrere Tests prüfen ausdrücklich, dass eine Anweisung SCHEITERT (CHECK, Trigger,
     * 42501). Eine gescheiterte Anweisung bricht in PostgreSQL die ganze Transaktion ab — jede
     * folgende Prüfung („und der Lead ist trotzdem unverändert") liefe dann in 25P02 statt in ihre
     * eigentliche Aussage, und der Test wäre grün oder rot aus dem falschen Grund.
     */
    const q = async <R extends Record<string, unknown>>(
      text: string,
      params: unknown[] = [],
    ): Promise<R[]> => {
      await client.query('savepoint stmt')
      try {
        const { rows } = await client.query<R>(text, params)
        await client.query('release savepoint stmt')
        return rows
      } catch (err) {
        await client.query('rollback to savepoint stmt')
        throw err
      }
    }

    const world: World = {
      q,
      newLead: async ({ monthsSinceInteraction = 30 } = {}) => {
        // deletion_due_at wird NICHT gesetzt, sondern vom B1-1-Trigger abgeleitet
        // (last_interaction_at + 24 Monate bei retention_basis 'marketing'). 30 Monate her ⇒ seit
        // 6 Monaten fällig; 0 ⇒ in 24 Monaten fällig.
        const rows = await q<{ id: string }>(
          `insert into platform.leads (email, first_source_key, company, last_interaction_at)
           values ($1, 'kontaktformular', 'B4-1 Gate GmbH', now() - make_interval(months => $2::int))
           returning id`,
          [`b41-${randomUUID()}@test.local`, monthsSinceInteraction],
        )
        return rows[0]!.id
      },
      run: async (maxBatch = 500, refuseAbove = 1000) => {
        const rows = await q<{ r: RetentionResult }>(
          `select platform.run_lead_retention($1::int, $2::int) as r`,
          [maxBatch, refuseAbove],
        )
        return rows[0]!.r
      },
      runs: () =>
        q<JobRunRow>(
          `select job_key, outcome, items_considered, items_processed, detail, finished_at
             from platform.job_runs order by started_at, id`,
        ),
      callAs: async <R,>(actor: TestUser, text: string, params: unknown[] = []): Promise<R> => {
        // Claims exakt wie PostgREST/GoTrue sie setzen (auth.uid() liest claims->>'sub').
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: actor.id, role: 'authenticated', aud: 'authenticated' }),
        ])
        await client.query('savepoint call')
        try {
          await client.query('set local role authenticated')
          const { rows } = await client.query<{ r: R }>(text, params)
          await client.query('reset role')
          await client.query('release savepoint call')
          return rows[0]!.r
        } catch (err) {
          // ERST zurückrollen, DANN die Rolle zurücksetzen: in einer abgebrochenen Transaktion
          // scheitert auch `reset role` (25P02) und überschriebe den eigentlichen Fehler — genau
          // den, den der Test prüfen will (42501).
          await client.query('rollback to savepoint call')
          await client.query('reset role')
          throw err
        }
      },
    }

    return await fn(world)
  } finally {
    await client.query('rollback').catch(() => undefined)
    client.release()
  }
}

beforeAll(async () => {
  await assertStackReachable()
})

afterAll(async () => {
  for (const id of spawnedUsers.splice(0)) await deleteUser(id)
  await pool.end()
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-1 — Auswahl: was „fällig" heisst', () => {
  it('erfasst nur Leads mit erreichter Frist, die noch nicht anonymisiert sind', async () => {
    await inIsolatedRetentionWorld(async (w) => {
      const overdue = await w.newLead({ monthsSinceInteraction: 30 })
      const future = await w.newLead({ monthsSinceInteraction: 0 })
      const alreadyDone = await w.newLead({ monthsSinceInteraction: 40 })

      // Der dritte wird vorab anonymisiert — er ist damit weiter überfällig, aber erledigt.
      await w.q(`select platform.anonymize_lead($1, null, true)`, [alreadyDone])

      const due = await w.q<{ lead_id: string }>(
        `select lead_id::text as lead_id from platform.leads_due_for_anonymization(null)`,
      )

      expect(due.map((r) => r.lead_id)).toEqual([overdue])
      expect(due.map((r) => r.lead_id)).not.toContain(future)
      expect(due.map((r) => r.lead_id)).not.toContain(alreadyDone)
    })
  })

  it('p_limit begrenzt die Menge, p_limit => null liefert alle (dieselbe Definition von fällig)', async () => {
    await inIsolatedRetentionWorld(async (w) => {
      await w.newLead({ monthsSinceInteraction: 30 })
      await w.newLead({ monthsSinceInteraction: 36 })
      await w.newLead({ monthsSinceInteraction: 42 })

      const all = await w.q(`select 1 from platform.leads_due_for_anonymization(null)`)
      const limited = await w.q<{ lead_id: string; deletion_due_at: Date }>(
        `select lead_id::text as lead_id, deletion_due_at
           from platform.leads_due_for_anonymization(2)`,
      )

      expect(all).toHaveLength(3)
      expect(limited).toHaveLength(2)
      // Älteste Frist zuerst — ein abgeschnittener Stapel darf nicht beim nächsten Lauf wieder
      // dieselben Zeilen greifen, während andere nie an die Reihe kämen.
      expect(limited[0]!.deletion_due_at.getTime()).toBeLessThan(
        limited[1]!.deletion_due_at.getTime(),
      )
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-1 — Mengenbegrenzung: oberhalb der Obergrenze passiert GAR NICHTS', () => {
  it('verweigert vollständig und anonymisiert keinen einzigen Lead', async () => {
    await inIsolatedRetentionWorld(async (w) => {
      const ids = [
        await w.newLead({ monthsSinceInteraction: 30 }),
        await w.newLead({ monthsSinceInteraction: 31 }),
        await w.newLead({ monthsSinceInteraction: 32 }),
      ]

      // Obergrenze 2 bei 3 fälligen — bewusst knapp: die Regel lautet „nicht die erste Teilmenge",
      // nicht „nur bei absurden Mengen".
      const result = await w.run(500, 2)

      expect(result.outcome).toBe('refused')
      expect(result.items_considered).toBe(3)
      expect(result.items_processed).toBe(0)
      expect(result.detail).toMatch(/übersteigt die Obergrenze von 2/)

      const untouched = await w.q<{ n: string }>(
        `select count(*)::text as n from platform.leads
          where id = any($1::uuid[]) and anonymized_at is null`,
        [ids],
      )
      expect(untouched[0]!.n).toBe('3')
    })
  })

  it('die Stapelgrenze schneidet ab, ohne den Rest zu verschweigen', async () => {
    await inIsolatedRetentionWorld(async (w) => {
      await w.newLead({ monthsSinceInteraction: 30 })
      await w.newLead({ monthsSinceInteraction: 31 })
      await w.newLead({ monthsSinceInteraction: 32 })

      const result = await w.run(2, 1000)

      expect(result.outcome).toBe('success')
      expect(result.items_considered).toBe(3)
      expect(result.items_processed).toBe(2)
      // „2 bearbeitet" allein läse sich wie „fertig".
      expect(result.detail).toMatch(/Stapelgrenze erreicht/)

      const remaining = await w.q<{ n: string }>(
        `select count(*)::text as n from platform.leads_due_for_anonymization(null)`,
      )
      expect(remaining[0]!.n).toBe('1')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-1 — Urheberschaft', () => {
  it('innerhalb der Grenzen wird anonymisiert: by_system true, anonymized_by null', async () => {
    await inIsolatedRetentionWorld(async (w) => {
      const id = await w.newLead({ monthsSinceInteraction: 30 })

      const result = await w.run()
      expect(result.outcome).toBe('success')
      expect(result.items_processed).toBe(1)

      const rows = await w.q<{
        email: string
        status: string
        anonymized_by: string | null
        anonymized_by_system: boolean
        anonymized_at: Date | null
        company: string | null
      }>(
        `select email, status, anonymized_by::text as anonymized_by, anonymized_by_system,
                anonymized_at, company
           from platform.leads where id = $1`,
        [id],
      )

      const lead = rows[0]!
      expect(lead.anonymized_by_system).toBe(true)
      expect(lead.anonymized_by).toBeNull()
      expect(lead.status).toBe('anonymized')
      expect(lead.anonymized_at).not.toBeNull()
      expect(lead.email).toBe(`anonymized+${id}@invalid`)
      expect(lead.company).toBeNull()
    })
  })

  it('der CHECK weist „vom System UND von Konto X" ab', async () => {
    const admin = await newAdmin()
    await inIsolatedRetentionWorld(async (w) => {
      const id = await w.newLead({ monthsSinceInteraction: 30 })

      // Direkt am Tisch vorbei, unter der privilegiertesten Rolle: der Widerspruch darf auch so
      // nicht entstehen. (Der Guard greift hier noch nicht — der Lead ist nicht anonymisiert.)
      await expect(
        w.q(
          `update platform.leads
              set anonymized_at = now(), anonymized_by = $2, anonymized_by_system = true
            where id = $1`,
          [id, admin.id],
        ),
      ).rejects.toThrow(/leads_anonymized_authorship_check/)
    })
  })

  it('anonymize_lead wirft, wenn p_by_system und p_actor zugleich kommen', async () => {
    const admin = await newAdmin()
    await inIsolatedRetentionWorld(async (w) => {
      const id = await w.newLead({ monthsSinceInteraction: 30 })

      await expect(
        w.q(`select platform.anonymize_lead($1, $2, true)`, [id, admin.id]),
      ).rejects.toThrow(/p_by_system.*verlangt p_actor/s)

      // Und zwar VOR jeder Wirkung.
      const rows = await w.q<{ anonymized_at: Date | null }>(
        `select anonymized_at from platform.leads where id = $1`,
        [id],
      )
      expect(rows[0]!.anonymized_at).toBeNull()
    })
  })

  it('ein anonymisierter Lead lässt sich über anonymized_by_system nicht mehr ändern — auch nicht als service_role', async () => {
    await inIsolatedRetentionWorld(async (w) => {
      const id = await w.newLead({ monthsSinceInteraction: 30 })
      await w.run()

      // Als service_role (BYPASSRLS) — die Rolle, mit der der Anwendungscode schreibt.
      await w.q(`set local role service_role`)
      await expect(
        w.q(`update platform.leads set anonymized_by_system = false where id = $1`, [id]),
      ).rejects.toThrow(/Urheberschaft der Anonymisierung|unveränderlich/)
      await w.q(`reset role`)

      // Und als postgres, der privilegiertesten Rolle überhaupt: ein Trigger kennt keine Ausnahme.
      await expect(
        w.q(`update platform.leads set anonymized_by_system = false where id = $1`, [id]),
      ).rejects.toThrow(/Urheberschaft der Anonymisierung|unveränderlich/)

      const rows = await w.q<{ anonymized_by_system: boolean }>(
        `select anonymized_by_system from platform.leads where id = $1`,
        [id],
      )
      expect(rows[0]!.anonymized_by_system).toBe(true)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-1 — Laufprotokoll', () => {
  it('jeder Lauf hinterlässt GENAU EINEN Datensatz, auch der verweigerte und der leere', async () => {
    await inIsolatedRetentionWorld(async (w) => {
      // (1) leer — der Normalzustand bis 2028.
      const empty = await w.run()
      // (2) verweigert.
      await w.newLead({ monthsSinceInteraction: 30 })
      await w.newLead({ monthsSinceInteraction: 31 })
      const refused = await w.run(500, 1)
      // (3) erfolgreich mit Arbeit.
      const worked = await w.run()

      expect(empty.outcome).toBe('success')
      expect(refused.outcome).toBe('refused')
      expect(worked.outcome).toBe('success')

      const runs = await w.runs()
      expect(runs).toHaveLength(3)
      expect(runs.map((r) => r.outcome)).toEqual(['success', 'refused', 'success'])
      expect(runs.map((r) => r.job_key)).toEqual([
        'lead_retention',
        'lead_retention',
        'lead_retention',
      ])
      // Kein Lauf bleibt offen — `finished_at is null` bedeutet „abgebrochen" und muss aussagekräftig
      // bleiben.
      expect(runs.every((r) => r.finished_at !== null)).toBe(true)

      expect(runs[0]).toMatchObject({ items_considered: 0, items_processed: 0, detail: null })
      expect(runs[1]!.items_considered).toBe(2)
      expect(runs[1]!.items_processed).toBe(0)
      expect(runs[1]!.detail).toMatch(/Obergrenze/)
      expect(runs[2]).toMatchObject({ items_considered: 2, items_processed: 2 })
    })
  })

  it('admin_list_job_runs liefert die Läufe und den zuletzt erfolgreichen getrennt', async () => {
    const admin = await newAdmin()
    await inIsolatedRetentionWorld(async (w) => {
      await w.run() // erfolgreich, leer
      await w.newLead({ monthsSinceInteraction: 30 })
      await w.run(500, 0) // verweigert — der JÜNGSTE Lauf

      const res = await w.callAs<{
        status: string
        runs: { outcome: string }[]
        last_success: { outcome?: string; items_considered: number } | null
      }>(admin, `select public.admin_list_job_runs('lead_retention', 10) as r`)

      expect(res.status).toBe('ok')
      expect(res.runs.map((r) => r.outcome)).toEqual(['refused', 'success'])
      // Der zuletzt ERFOLGREICHE ist nicht der jüngste — genau deshalb wird er getrennt ermittelt.
      expect(res.last_success).not.toBeNull()
      expect(res.last_success!.items_considered).toBe(0)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-1 — Zugriffsgrenzen', () => {
  it('ein eingeloggter Nicht-Admin bekommt aus admin_list_job_runs einen FEHLER, keine leere Antwort', async () => {
    const user = await newUser()
    await inIsolatedRetentionWorld(async (w) => {
      await w.run()

      // Eine leere Liste ist hier eine ECHTE Aussage („der Job läuft nicht"). Sie darf nicht
      // zugleich „kein Zugriff" bedeuten — eine Exception kann man nicht verwechseln.
      await expect(
        w.callAs(user, `select public.admin_list_job_runs('lead_retention', 10) as r`),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('die Grant-Fläche der beiden neuen Wrapper ist exakt so eng wie gedacht', async () => {
    const canExecute = async (role: string, fn: string, args: string): Promise<boolean> => {
      const rows = await sql<{ can: boolean }>(
        `select has_function_privilege($1, $2, 'execute') as can`,
        [role, `public.${fn}(${args})`],
      )
      return rows[0]!.can
    }

    // Der Auslöser ist ein Maschinenvorgang: nur service_role.
    expect(await canExecute('service_role', 'run_lead_retention_job', 'integer, integer')).toBe(true)
    expect(await canExecute('authenticated', 'run_lead_retention_job', 'integer, integer')).toBe(
      false,
    )
    expect(await canExecute('anon', 'run_lead_retention_job', 'integer, integer')).toBe(false)

    // Die Auskunft hängt an auth.uid(): nur authenticated.
    expect(await canExecute('authenticated', 'admin_list_job_runs', 'text, integer')).toBe(true)
    expect(await canExecute('service_role', 'admin_list_job_runs', 'text, integer')).toBe(false)
    expect(await canExecute('anon', 'admin_list_job_runs', 'text, integer')).toBe(false)
  })

  it('die platform-Funktionen sind von aussen gar nicht aufrufbar', async () => {
    for (const proname of ['run_lead_retention', 'leads_due_for_anonymization', 'anonymize_lead']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const rows = await sql<{ can: boolean }>(
          `select bool_or(has_function_privilege($1, p.oid, 'execute')) as can
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'platform' and p.proname = $2`,
          [role, proname],
        )
        expect(rows[0]!.can, `${role} darf platform.${proname} nicht direkt aufrufen`).toBe(false)
      }
    }
  })

  it('platform.job_runs hat RLS und für keine Rolle ein Tabellen-Grant', async () => {
    const rls = await sql<{ relrowsecurity: boolean; policies: string }>(
      `select c.relrowsecurity,
              (select count(*)::text from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'job_runs'`,
    )
    expect(rls[0]!.relrowsecurity).toBe(true)
    // Zwei unabhängige Schichten: RLS ohne Policy sperrt auch dann, wenn jemand später
    // versehentlich ein Grant vergibt.
    expect(rls[0]!.policies).toBe('0')

    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        const rows = await sql<{ can: boolean }>(
          `select has_table_privilege($1, 'platform.job_runs', $2) as can`,
          [role, priv],
        )
        expect(rows[0]!.can, `${role} darf job_runs nicht ${priv}`).toBe(false)
      }
    }
  })
})
