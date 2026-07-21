// DB-Gate für die Herkunftszählung (B3-4)
// (Migration 20260722180000_create_warteliste_source_and_lead_source_stats.sql).
//
// Die Auswertung ist klein, aber sie ist der einzige Grund, warum B3-4 die Warteliste überhaupt in
// ZWEI Routen teilt. Wäre sie falsch, wäre die Teilung folgenlos — und zwar unbemerkt: eine falsche
// Zahl sieht genauso aus wie eine richtige. Das Gate beweist deshalb drei Dinge:
//
//   (1) ZUGANG — der Wrapper WIRFT für Nicht-Admins (42501), statt eine leere Antwort zu liefern.
//       Gerade hier wäre die Verwechslung fatal: eine Null ist die eigentliche Aussage dieser
//       Auswertung („der Brief hat nichts gebracht"), und „kein Zugriff" darf sich nicht so lesen.
//   (2) ZUORDNUNG — Leads landen bei ihrer Herkunft; bestätigte Einwilligungen werden getrennt von
//       offenen gezählt UND nach der Herkunft der EINWILLIGUNG, nicht der des Leads.
//   (3) RECHTE — Grant-Fläche exakt `authenticated`; `anon` und `service_role` haben nichts.
//
// ── WARUM MIT DELTAS UND NICHT MIT ABSOLUTZAHLEN GEPRÜFT WIRD ───────────────────────────────────
// `admin_lead_source_stats` zählt BESTANDSWEIT — es gibt keinen Parameter, der den Blick auf die
// eigenen Fixtures einschränken würde (und es soll ihn nicht geben, sonst zählte die Oberfläche
// etwas anderes als die Überschrift verspricht). In derselben Datenbank liegen die Fixtures aller
// übrigen Gates. Jeder Test misst deshalb VORHER und NACHHER und prüft die DIFFERENZ; alles läuft
// in einer Transaktion mit `rollback`, der Bestand bleibt unangetastet.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ─────────────────────────────────────
// Wie in allen bisherigen Wrapper-Gates: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant. `has_function_privilege` ist dieselbe
// Wahrheit ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten
// NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und genau die
// Ablehnung IN der Funktion ist die zu beweisende Eigenschaft.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import { assertStackReachable, createUser, deleteUser, pool, sql, type TestUser } from './client'

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

type SourceStat = {
  key: string
  label: string
  is_active: boolean
  lead_count: number
  confirmed_marketing_count: number
}

type World = {
  q: <R extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>
  /** Legt einen Lead mit der angegebenen Ersterfassungs-Herkunft an. */
  newLead: (sourceKey: string) => Promise<string>
  /** Legt eine Marketing-Einwilligung an — mit EIGENER Herkunft, unabhängig von der des Leads. */
  newMarketingConsent: (
    leadId: string,
    sourceKey: string,
    status: 'pending' | 'confirmed',
  ) => Promise<void>
  /** Die Zählung, aufgerufen als eingeloggter Admin (der einzige zulässige Weg). */
  stats: (actor: TestUser) => Promise<Record<string, SourceStat>>
  callAs: <R>(actor: TestUser, text: string, params?: unknown[]) => Promise<R>
}

async function inTransaction<T>(fn: (world: World) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('begin')

    /*
     * Jede Anweisung in einem eigenen Sicherungspunkt: ein Test prüft ausdrücklich, dass ein Aufruf
     * SCHEITERT (42501). Ohne Sicherungspunkt bräche das die ganze Transaktion ab, und jede weitere
     * Prüfung liefe in 25P02 statt in ihre eigentliche Aussage.
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

    const callAs = async <R>(actor: TestUser, text: string, params: unknown[] = []): Promise<R> => {
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
        // ERST zurückrollen, DANN die Rolle zurücksetzen — sonst scheitert `reset role` in der
        // abgebrochenen Transaktion (25P02) und überschriebe den Fehler, den der Test prüfen will.
        await client.query('rollback to savepoint call')
        await client.query('reset role')
        throw err
      }
    }

    const world: World = {
      q,
      callAs,
      newLead: async (sourceKey) => {
        const rows = await q<{ id: string }>(
          `insert into platform.leads (email, first_source_key)
           values ($1, $2) returning id`,
          [`b34-${randomUUID()}@test.local`, sourceKey],
        )
        return rows[0]!.id
      },
      newMarketingConsent: async (leadId, sourceKey, status) => {
        // Der Zweck hängt am TEXT (B1-1: `consents` hat keine eigene `purpose`-Spalte) — deshalb
        // die jüngste Marketing-Fassung heranziehen, genau wie `capture_lead` es tut.
        await q(
          `insert into platform.consents (lead_id, consent_text_id, source_key, status, confirmed_at)
           select $1,
                  (select ct.id from platform.consent_texts ct
                    where ct.purpose = 'marketing_email' and ct.locale = 'de'
                    order by ct.version desc limit 1),
                  $2,
                  $3,
                  case when $3 = 'confirmed' then now() else null end`,
          [leadId, sourceKey, status],
        )
      },
      stats: async (actor) => {
        const result = await callAs<{ status: string; sources: SourceStat[] }>(
          actor,
          `select public.admin_lead_source_stats() as r`,
        )
        expect(result.status).toBe('ok')
        return Object.fromEntries(result.sources.map((s) => [s.key, s]))
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
describe('B3-4 — der Einstiegspunkt der Warteliste', () => {
  it('platform.lead_sources trägt eine AKTIVE Zeile „warteliste"', async () => {
    const rows = await sql<{ key: string; is_active: boolean }>(
      `select key, is_active from platform.lead_sources where key = 'warteliste'`,
    )
    expect(rows).toHaveLength(1)
    // Inaktiv wäre so schlimm wie fehlend: der Abgleich mit der Registry (lead-source-registry.test)
    // prüft ausdrücklich gegen die AKTIVEN Zeilen.
    expect(rows[0]!.is_active).toBe(true)
  })

  it('der QR-Code-Einstiegspunkt aus B1-1 ist unverändert vorhanden', async () => {
    // `wko-postaktion-qr` wird von B3-4 nur PLATZIERT, nicht angelegt. Verschwände er (umbenannt,
    // deaktiviert), liefe die gedruckte Adresse ins Leere — und der Fremdschlüssel verhinderte
    // jede Eintragung über den Brief.
    const rows = await sql<{ is_active: boolean }>(
      `select is_active from platform.lead_sources where key = 'wko-postaktion-qr'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.is_active).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B3-4 — (1) Zugang: der Wrapper wirft, statt leer zu antworten', () => {
  it('ein eingeloggter NICHT-Admin bekommt 42501 und keine Zahlen', async () => {
    await inTransaction(async (w) => {
      const outsider = await newUser()

      await expect(
        w.callAs(outsider, `select public.admin_lead_source_stats() as r`),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('ein Admin bekommt eine Antwort mit Status ok', async () => {
    await inTransaction(async (w) => {
      const admin = await newAdmin()
      const stats = await w.stats(admin)

      // Jede Quelle erscheint, auch die ohne einen einzigen Lead: „keine Reaktion" ist ein
      // Ergebnis und darf nicht als fehlende Zeile aussehen.
      expect(Object.keys(stats)).toContain('warteliste')
      expect(Object.keys(stats)).toContain('wko-postaktion-qr')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B3-4 — (2) Zuordnung', () => {
  it('zählt Leads bei ihrer Herkunft und bestätigte Einwilligungen getrennt von offenen', async () => {
    await inTransaction(async (w) => {
      const admin = await newAdmin()
      const before = await w.stats(admin)

      // Organisch: Lead + BESTÄTIGTE Einwilligung, beide unter 'warteliste'.
      const a = await w.newLead('warteliste')
      await w.newMarketingConsent(a, 'warteliste', 'confirmed')

      // Über den Brief: Lead + noch OFFENE Einwilligung. Sie darf NICHT mitgezählt werden —
      // unbestätigt ist rechtlich wertlos (B1-1), und eine Zahl, die offene mitzählt, verspräche
      // einen Verteiler, den es nicht gibt.
      const b = await w.newLead('wko-postaktion-qr')
      await w.newMarketingConsent(b, 'wko-postaktion-qr', 'pending')

      const after = await w.stats(admin)

      expect(after['warteliste']!.lead_count - before['warteliste']!.lead_count).toBe(1)
      expect(
        after['warteliste']!.confirmed_marketing_count -
          before['warteliste']!.confirmed_marketing_count,
      ).toBe(1)

      expect(after['wko-postaktion-qr']!.lead_count - before['wko-postaktion-qr']!.lead_count).toBe(
        1,
      )
      expect(
        after['wko-postaktion-qr']!.confirmed_marketing_count -
          before['wko-postaktion-qr']!.confirmed_marketing_count,
      ).toBe(0)
    })
  })

  it('eine Einwilligung zählt bei IHRER Herkunft, nicht bei der des Leads', async () => {
    await inTransaction(async (w) => {
      const admin = await newAdmin()
      const before = await w.stats(admin)

      /*
       * DER FALL, FÜR DEN DIE ENTSCHEIDUNG GETROFFEN WURDE: Jemand kam vor Monaten über einen
       * Artikel herein (first_source_key bleibt 'artikel-inline' — seit B1-1 unveränderlich),
       * bekommt jetzt den Brief und trägt sich über den QR-Code ein. Zählte man beide Spalten über
       * die Lead-Herkunft, bekäme der ARTIKEL die Einwilligung gutgeschrieben und der Brief stünde
       * bei null — die Frage, für die es diese Auswertung gibt, wäre falsch beantwortet.
       */
      const lead = await w.newLead('artikel-inline')
      await w.newMarketingConsent(lead, 'wko-postaktion-qr', 'confirmed')

      const after = await w.stats(admin)

      expect(after['artikel-inline']!.lead_count - before['artikel-inline']!.lead_count).toBe(1)
      expect(
        after['artikel-inline']!.confirmed_marketing_count -
          before['artikel-inline']!.confirmed_marketing_count,
      ).toBe(0)

      expect(after['wko-postaktion-qr']!.lead_count - before['wko-postaktion-qr']!.lead_count).toBe(
        0,
      )
      expect(
        after['wko-postaktion-qr']!.confirmed_marketing_count -
          before['wko-postaktion-qr']!.confirmed_marketing_count,
      ).toBe(1)
    })
  })

  it('ein anonymisierter Lead bleibt in der Zählung enthalten', async () => {
    await inTransaction(async (w) => {
      const admin = await newAdmin()

      const lead = await w.newLead('warteliste')
      await w.newMarketingConsent(lead, 'warteliste', 'confirmed')
      const before = await w.stats(admin)

      await w.q(`select platform.anonymize_lead($1, null, true)`, [lead])

      const after = await w.stats(admin)

      /*
       * Er war echter Rücklauf. Die Anonymisierung entfernt die Identitätsmerkmale (B1-3), die
       * Herkunft überlebt sie bewusst — sie ist kein Personenmerkmal. Ihn herauszurechnen hiesse,
       * dass eine Kampagne im Nachhinein schlechter dasteht, weil ihre Leads ordnungsgemäss
       * gelöscht wurden.
       */
      expect(after['warteliste']!.lead_count).toBe(before['warteliste']!.lead_count)
      expect(after['warteliste']!.confirmed_marketing_count).toBe(
        before['warteliste']!.confirmed_marketing_count,
      )
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B3-4 — (3) Rechte', () => {
  it('Grant-Fläche ist exakt authenticated — anon und service_role dürfen nicht', async () => {
    const rows = await sql<{ role: string; allowed: boolean }>(
      `select r.rolname as role,
              has_function_privilege(r.rolname, 'public.admin_lead_source_stats()', 'execute') as allowed
         from unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)`,
    )
    const allowed = Object.fromEntries(rows.map((r) => [r.role, r.allowed]))

    expect(allowed['authenticated']).toBe(true)
    // `anon` bekommt in `platform` nirgends etwas — hier zusätzlich, weil die Antwort eine
    // Bestandsauskunft ist.
    expect(allowed['anon']).toBe(false)
    // Auch service_role NICHT: die Auswertung ist eine Auskunft an einen Menschen, und ein
    // Maschinenpfad, der Bestandszahlen je Kanal liest, soll nicht auf Vorrat entstehen.
    expect(allowed['service_role']).toBe(false)
  })
})
