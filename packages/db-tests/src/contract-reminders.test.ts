// DB-Gate für die Vertragsablauf-Erinnerung (B4-2)
// (Migration 20260722150000_create_contract_reminders.sql).
//
// Mit dieser Migration entsteht die Grundlage für den ERSTEN automatisierten E-Mail-Versand an
// reale Personen. Anders als beim Fristenlauf (B4-1) lässt sich die Wirkung nicht zurücknehmen:
// eine versendete Mail ist versendet. Das Gate beweist deshalb genau die Eigenschaften, an denen
// dieser Unterschied hängt:
//
//   (1) AUSWAHL — „fällig" heisst: Vertragsende in der Zukunft, Vorlaufzeit erreicht, noch nicht
//       erinnert, nicht anonymisiert, BESTÄTIGTE Einwilligung, Adresse nicht gesperrt. Die beiden
//       letzten Bedingungen stehen in der ABFRAGE und nicht im Anwendungscode — eine Prüfung im
//       Code kann übersprungen werden, eine in der Auswahl nicht.
//   (2) DOPPELVERSAND-SPERRE — der zusammengesetzte Primärschlüssel, nicht eine Abfrage. Ein
//       zweites Beanspruchen überschreibt NICHTS.
//   (3) KÖRNUNG — ein GEÄNDERTES Vertragsende ist ein anderer Schlüssel und damit zu Recht eine
//       neue Fälligkeit, kein Duplikat.
//   (4) ZWECKBINDUNG — Widerruf und Anonymisierung löschen die Erinnerungszeilen mit. Das
//       Vertragsende steht dort im Primärschlüssel; ohne diese Regel überlebte eine Kopie den
//       Wegfall ihres Zwecks.
//
// ── WARUM JEDER TEST IN EINER EIGENEN TRANSAKTION MIT ROLLBACK LÄUFT ─────────────────────────────
// Dieselbe Begründung wie im B4-1-Gate: `leads_due_for_contract_reminder` und
// `start_contract_reminder_run` arbeiten BESTANDSWEIT. Ein fremder fälliger Lead aus einem anderen
// Test würde mitgezählt (und im Endpunkt mit angeschrieben). Deshalb: EINE Transaktion, in der
// fremde fällige Fälle und bestehende Laufdatensätze entfernt sind, alle Fixtures uncommitted — und
// ein `rollback` am Ende, der den Bestand vollständig wiederherstellt.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import { assertStackReachable, pool } from './client'

const REMINDER_PURPOSE = 'contract_expiry_reminder'

type DueRow = {
  lead_id: string
  email: string
  supplier: string | null
  contract_end_date: string
}

type ReminderRow = {
  lead_id: string
  contract_end_date: string
  attempted_at: string
  delivered_at: string | null
  error: string | null
}

type ClaimResult = {
  status: string
  outcome: string
  email?: string
  supplier?: string | null
  contract_end_date?: string
  attempted_at?: string
  delivered_at?: string | null
}

type LeadFixture = {
  /** Tage bis zum Vertragsende. Negativ = Vergangenheit. `null` = kein Vertragsende. */
  daysUntilEnd?: number | null
  /** Zustand der Einwilligung für den Erinnerungszweck. */
  consent?: 'confirmed' | 'pending' | 'none'
  /** Adresse zusätzlich auf die Sperrliste setzen. */
  suppressed?: boolean
  supplier?: string
}

type World = {
  q: <R extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>
  newLead: (opts?: LeadFixture) => Promise<{ id: string; email: string; endDate: string | null }>
  due: () => Promise<DueRow[]>
  claim: (leadId: string, endDate: string) => Promise<ClaimResult>
  reminders: (leadId: string) => Promise<ReminderRow[]>
}

/** Das Datum in `p_days` Tagen als ISO-Datum — dieselbe Rechnung wie `current_date + n` in SQL. */
function isoDateIn(days: number, today: Date): string {
  const d = new Date(today)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function inIsolatedReminderWorld<T>(fn: (world: World) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('begin')

    // Fremde Fälle aus dem Weg räumen (nur innerhalb dieser Transaktion) — sonst zählte
    // `start_contract_reminder_run` sie mit. Die Einwilligungen gehen per Cascade mit.
    await client.query(`delete from platform.leads where contract_end_date is not null`)
    await client.query(`delete from platform.job_runs`)

    /*
     * JEDE Anweisung in einem eigenen Sicherungspunkt: mehrere Tests prüfen ausdrücklich, dass eine
     * Anweisung SCHEITERT. Ohne Sicherungspunkt liefe jede folgende Prüfung in 25P02 statt in ihre
     * eigentliche Aussage (Muster aus dem B4-1-Gate).
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
      newLead: async ({
        daysUntilEnd = 30,
        consent = 'confirmed',
        suppressed = false,
        supplier = 'Testversorger GmbH',
      } = {}) => {
        const email = `b42-${randomUUID()}@test.local`
        const rows = await q<{ id: string; contract_end_date: string | null }>(
          `insert into platform.leads (email, first_source_key, supplier, contract_end_date)
           values (
             $1,
             'vertragsablauf-landing',
             $2,
             case when $3::int is null then null else current_date + $3::int end
           )
           returning id, contract_end_date::text as contract_end_date`,
          [email, supplier, daysUntilEnd],
        )
        const id = rows[0]!.id

        if (consent !== 'none') {
          await q(
            `insert into platform.consents
               (lead_id, consent_text_id, source_key, status, confirmed_at, token_hash,
                token_expires_at)
             select $1::uuid,
                    ct.id,
                    'vertragsablauf-landing',
                    $2,
                    case when $2 = 'confirmed' then now() else null end,
                    case when $2 = 'confirmed' then null else 'hash-' || $1::uuid::text end,
                    case when $2 = 'confirmed' then null else now() + interval '7 days' end
               from platform.consent_texts ct
              where ct.purpose = $3::platform.consent_purpose
              order by ct.version desc
              limit 1`,
            [id, consent, REMINDER_PURPOSE],
          )
        }

        if (suppressed) {
          await q(
            `insert into platform.email_suppressions (email_hash, reason)
             values (platform.email_hash($1), 'unsubscribed')`,
            [email],
          )
        }

        return { id, email, endDate: rows[0]!.contract_end_date }
      },
      due: () =>
        q<DueRow>(
          `select lead_id::text as lead_id, email, supplier, contract_end_date::text
             from platform.leads_due_for_contract_reminder(null)`,
        ),
      claim: async (leadId, endDate) => {
        const rows = await q<{ r: ClaimResult }>(
          `select public.claim_contract_reminder($1::uuid, $2::date) as r`,
          [leadId, endDate],
        )
        return rows[0]!.r
      },
      reminders: (leadId) =>
        q<ReminderRow>(
          `select lead_id::text as lead_id, contract_end_date::text, attempted_at::text,
                  delivered_at::text, error
             from platform.contract_reminders
            where lead_id = $1
            order by contract_end_date`,
          [leadId],
        ),
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
  await pool.end()
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-2 — Auswahl: wer bekommt eine Erinnerung', () => {
  it('(1) erfasst einen Lead innerhalb der Vorlaufzeit mit bestätigter Einwilligung', async () => {
    await inIsolatedReminderWorld(async (w) => {
      // 30 Tage: innerhalb der 56 Tage Vorlaufzeit und in der Zukunft.
      const lead = await w.newLead({ daysUntilEnd: 30 })

      const due = await w.due()

      expect(due).toHaveLength(1)
      expect(due[0]!.lead_id).toBe(lead.id)
      expect(due[0]!.email).toBe(lead.email)
      // Der Versorger fährt mit — die Mail nennt ihn, und ein zweiter Aufruf dafür wäre eine
      // zweite Gelegenheit, den falschen Lead zu treffen.
      expect(due[0]!.supplier).toBe('Testversorger GmbH')
    })
  })

  it('(2) erfasst NICHT ohne bestätigte Einwilligung — auch bei „pending" nicht', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const pending = await w.newLead({ daysUntilEnd: 30, consent: 'pending' })
      const none = await w.newLead({ daysUntilEnd: 30, consent: 'none' })

      const dueIds = (await w.due()).map((r) => r.lead_id)

      // 'pending' ist rechtlich wertlos (B1-1: has_confirmed_consent ist dafür ausdrücklich false).
      // Eine Erinnerung an eine unbestätigte Adresse wäre eine unerlaubte Aussendung.
      expect(dueIds).not.toContain(pending.id)
      expect(dueIds).not.toContain(none.id)
      expect(dueIds).toHaveLength(0)
    })
  })

  it('(3) erfasst NICHT bei gesperrter Adresse', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const suppressed = await w.newLead({ daysUntilEnd: 30, suppressed: true })

      // Die Sperre steht NICHT an der Einwilligung (B1-1: sie überlebt die Lead-Löschung) — die
      // bestätigte Einwilligung allein genügt also nicht.
      expect((await w.due()).map((r) => r.lead_id)).not.toContain(suppressed.id)
    })
  })

  it('(4) erfasst NICHT bei Vertragsende in der Vergangenheit', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const past = await w.newLead({ daysUntilEnd: -1 })
      const today = await w.newLead({ daysUntilEnd: 0 })

      const dueIds = (await w.due()).map((r) => r.lead_id)

      // An einem abgelaufenen Vertrag ändert eine Erinnerung nichts mehr. „Heute" zählt ebenfalls
      // nicht: die Bedingung lautet ZUKUNFT (`> current_date`), nicht „nicht vergangen".
      expect(dueIds).not.toContain(past.id)
      expect(dueIds).not.toContain(today.id)
    })
  })

  it('(5) erfasst NICHT ausserhalb der Vorlaufzeit', async () => {
    await inIsolatedReminderWorld(async (w) => {
      // 57 Tage: einen Tag zu früh (Vorlaufzeit ist 56 = acht Wochen).
      const tooEarly = await w.newLead({ daysUntilEnd: 57 })
      const justInside = await w.newLead({ daysUntilEnd: 56 })

      const dueIds = (await w.due()).map((r) => r.lead_id)

      expect(dueIds).not.toContain(tooEarly.id)
      // Die Grenze selbst gehört dazu („kleiner oder gleich") — sonst fiele genau der Stichtag
      // durch, an dem die Erinnerung geplant ist.
      expect(dueIds).toContain(justInside.id)

      // Und die Vorlaufzeit steht an genau EINER Stelle.
      const [leadDays] = await w.q<{ days: number }>(
        `select platform.contract_reminder_lead_days() as days`,
      )
      expect(leadDays!.days).toBe(56)
    })
  })

  it('(6) erfasst NICHT mehr, sobald eine Zeile in contract_reminders steht', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const lead = await w.newLead({ daysUntilEnd: 30 })
      expect((await w.due()).map((r) => r.lead_id)).toContain(lead.id)

      await w.claim(lead.id, lead.endDate!)

      // Die Sperre wirkt in der AUSWAHL, nicht erst beim Versand: ein zweiter Lauf sieht den Fall
      // gar nicht mehr.
      expect((await w.due()).map((r) => r.lead_id)).not.toContain(lead.id)
    })
  })

  it('(7) ein knapp bevorstehendes Vertragsende wird SOFORT erfasst, nicht übersprungen', async () => {
    await inIsolatedReminderWorld(async (w) => {
      // Drei Wochen: der Tag, an dem dieses Vertragsende „genau acht Wochen entfernt" war, liegt in
      // der Vergangenheit. Mit einer Stichtagsprüfung bekäme diese Person NIE eine Erinnerung —
      // ausgerechnet die, die sie am dringendsten braucht.
      const soon = await w.newLead({ daysUntilEnd: 21 })

      expect((await w.due()).map((r) => r.lead_id)).toContain(soon.id)

      // Und daraus wird trotzdem keine tägliche Wiederholung: das verhindert der Primärschlüssel.
      await w.claim(soon.id, soon.endDate!)
      expect((await w.due()).map((r) => r.lead_id)).not.toContain(soon.id)
    })
  })

  it('(12) ein anonymisierter Lead wird nie erfasst', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const lead = await w.newLead({ daysUntilEnd: 30 })
      await w.q(`select platform.anonymize_lead($1, null, true)`, [lead.id])

      // Die Anonymisierung nullt contract_end_date ohnehin; der Test hält fest, dass die Auswahl
      // nicht auf einem anderen Weg (etwa über eine stehengebliebene Erinnerungszeile) doch noch
      // etwas findet.
      expect((await w.due()).map((r) => r.lead_id)).not.toContain(lead.id)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-2 — Beanspruchen: die Doppelversand-Sperre', () => {
  it('(8) doppeltes Beanspruchen desselben Paares überschreibt NICHTS', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const lead = await w.newLead({ daysUntilEnd: 30 })

      const first = await w.claim(lead.id, lead.endDate!)
      expect(first.outcome).toBe('claimed')
      expect(first.email).toBe(lead.email)

      const before = await w.reminders(lead.id)
      expect(before).toHaveLength(1)

      const second = await w.claim(lead.id, lead.endDate!)
      expect(second.outcome).toBe('already_claimed')
      // Kein zweiter Versuch, kein neuer Zeitstempel: attempted_at bleibt der ERSTE (ein
      // nachgeschriebener Zeitpunkt wäre eine Fälschung).
      expect(second.email).toBeUndefined()

      const after = await w.reminders(lead.id)
      expect(after).toHaveLength(1)
      expect(after[0]!.attempted_at).toBe(before[0]!.attempted_at)
    })
  })

  it('das Ergebnis wird festgehalten — Zustellung ODER Fehler, nie beides', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const lead = await w.newLead({ daysUntilEnd: 30 })
      await w.claim(lead.id, lead.endDate!)

      await w.q(`select public.record_contract_reminder_result($1::uuid, $2::date, $3)`, [
        lead.id,
        lead.endDate,
        'Resend hat abgelehnt.',
      ])
      let row = (await w.reminders(lead.id))[0]!
      expect(row.error).toBe('Resend hat abgelehnt.')
      expect(row.delivered_at).toBeNull()

      await w.q(`select public.record_contract_reminder_result($1::uuid, $2::date)`, [
        lead.id,
        lead.endDate,
      ])
      row = (await w.reminders(lead.id))[0]!
      expect(row.delivered_at).not.toBeNull()
      expect(row.error).toBeNull()
    })
  })

  it('beanspruchen lehnt ab, was nicht (mehr) fällig ist — ohne Zeile anzulegen', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const suppressed = await w.newLead({ daysUntilEnd: 30, suppressed: true })

      const claim = await w.claim(suppressed.id, suppressed.endDate!)

      // Die Prüfung sitzt in der AUSWAHL und wirkt damit auch hier: zwischen Auswahl und
      // Beanspruchung kann ein Widerruf oder eine Sperre dazwischenkommen.
      expect(claim.outcome).toBe('not_eligible')
      expect(await w.reminders(suppressed.id)).toHaveLength(0)
    })
  })

  it('(9) ein GEÄNDERTES Vertragsende erzeugt eine neue Fälligkeit', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const lead = await w.newLead({ daysUntilEnd: 30 })
      await w.claim(lead.id, lead.endDate!)
      expect((await w.due()).map((r) => r.lead_id)).not.toContain(lead.id)

      // Die Person korrigiert ihr Vertragsende (Tippfehler, Verlängerung, Wechsel).
      const [todayRow] = await w.q<{ today: string }>(`select current_date::text as today`)
      const corrected = isoDateIn(40, new Date(`${todayRow!.today}T00:00:00Z`))
      await w.q(`update platform.leads set contract_end_date = $2::date where id = $1`, [
        lead.id,
        corrected,
      ])

      // Anderer Schlüssel ⇒ zu Recht eine neue Erinnerung, kein Duplikat. Genau das ist die
      // passende Körnung des Primärschlüssels.
      const due = await w.due()
      expect(due.map((r) => r.lead_id)).toContain(lead.id)
      expect(due[0]!.contract_end_date).toBe(corrected)

      await w.claim(lead.id, corrected)
      const rows = await w.reminders(lead.id)
      // Beide Zeilen bleiben stehen: die alte ist die sichtbare Spur der Korrektur.
      expect(rows).toHaveLength(2)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-2 — Zweckbindung: eine Kopie überlebt ihren Zweck nicht', () => {
  it('(10) Widerruf löscht die Erinnerungszeilen UND nullt Versorger und Vertragsende', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const lead = await w.newLead({ daysUntilEnd: 30 })
      await w.claim(lead.id, lead.endDate!)
      expect(await w.reminders(lead.id)).toHaveLength(1)

      await w.q(
        `update platform.consents set status = 'withdrawn', withdrawn_at = now()
          where lead_id = $1`,
        [lead.id],
      )

      // Ohne diese Regel bliebe das Vertragsende im Primärschlüssel des Versandprotokolls stehen —
      // die Zweckbindung wäre an einer Stelle durchgesetzt und an der anderen behauptet.
      expect(await w.reminders(lead.id)).toHaveLength(0)

      const [row] = await w.q<{ supplier: string | null; contract_end_date: string | null }>(
        `select supplier, contract_end_date::text as contract_end_date
           from platform.leads where id = $1`,
        [lead.id],
      )
      expect(row!.supplier).toBeNull()
      expect(row!.contract_end_date).toBeNull()
    })
  })

  it('(11) anonymize_lead löscht die Erinnerungszeilen', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const lead = await w.newLead({ daysUntilEnd: 30 })
      await w.claim(lead.id, lead.endDate!)
      expect(await w.reminders(lead.id)).toHaveLength(1)

      const [anonymized] = await w.q<{ r: { outcome: string } }>(
        `select platform.anonymize_lead($1, null, true) as r`,
        [lead.id],
      )
      expect(anonymized!.r.outcome).toBe('anonymized')

      // Das Vertragsende steht im Primärschlüssel und liesse sich nicht nullen — die Zeile muss
      // weg, sonst überlebte ausgerechnet ein lokalisierendes Merkmal die Anonymisierung.
      expect(await w.reminders(lead.id)).toHaveLength(0)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-2 — Lauf und Protokoll', () => {
  it('start_contract_reminder_run legt eine job_runs-Zeile an und liefert Zahl + Stapel', async () => {
    await inIsolatedReminderWorld(async (w) => {
      await w.newLead({ daysUntilEnd: 10 })
      await w.newLead({ daysUntilEnd: 20 })
      await w.newLead({ daysUntilEnd: 30 })

      const [started] = await w.q<{
        r: { run_id: string; items_considered: number; due: DueRow[] }
      }>(`select public.start_contract_reminder_run($1::int) as r`, [2])
      const r = started!.r

      // Die Gesamtzahl und der Stapel kommen aus DERSELBEN Momentaufnahme — sonst prüfte der
      // Endpunkt seine Obergrenze gegen eine andere Menge, als er abarbeitet.
      expect(r.items_considered).toBe(3)
      expect(r.due).toHaveLength(2)
      // Älteste Vertragsenden zuerst.
      expect(r.due[0]!.contract_end_date < r.due[1]!.contract_end_date).toBe(true)

      const runs = await w.q<{
        job_key: string
        items_considered: number | null
        finished_at: string | null
      }>(`select job_key, items_considered, finished_at::text from platform.job_runs`)
      expect(runs).toHaveLength(1)
      expect(runs[0]!.job_key).toBe('contract_reminder')
      // items_considered steht SOFORT im Protokoll: stirbt der Lauf mittendrin, ist wenigstens
      // sichtbar, wie viele er vor sich hatte.
      expect(runs[0]!.items_considered).toBe(3)
      expect(runs[0]!.finished_at).toBeNull()

      const [finished] = await w.q<{ f: { status: string } }>(
        `select public.finish_contract_reminder_run($1::uuid, 'success', 2, null) as f`,
        [r.run_id],
      )
      expect(finished!.f.status).toBe('ok')
      const [done] = await w.q<{ outcome: string; items_processed: number }>(
        `select outcome, items_processed from platform.job_runs where id = $1`,
        [r.run_id],
      )
      expect(done!.outcome).toBe('success')
      expect(done!.items_processed).toBe(2)
    })
  })

  it('finish_contract_reminder_run fasst den Fristenlauf NICHT an', async () => {
    await inIsolatedReminderWorld(async (w) => {
      const [row] = await w.q<{ id: string }>(
        `insert into platform.job_runs (job_key) values ('lead_retention') returning id`,
      )

      const [finished] = await w.q<{ f: { status: string } }>(
        `select public.finish_contract_reminder_run($1::uuid, 'error', 0, 'fremder Lauf') as f`,
        [row!.id],
      )

      // Eine verwechselte run_id darf nicht das Protokoll überschreiben, das belegt, ob
      // Löschfristen durchgesetzt werden.
      expect(finished!.f.status).toBe('not_found')
      const [untouched] = await w.q<{ outcome: string | null; detail: string | null }>(
        `select outcome, detail from platform.job_runs where id = $1`,
        [row!.id],
      )
      expect(untouched!.outcome).toBeNull()
      expect(untouched!.detail).toBeNull()
    })
  })

  it('der job_key-CHECK kennt genau die zwei Jobs', async () => {
    await inIsolatedReminderWorld(async (w) => {
      await expect(
        w.q(`insert into platform.job_runs (job_key) values ('irgendwas')`),
      ).rejects.toThrow(/job_key/i)

      await w.q(`insert into platform.job_runs (job_key) values ('lead_retention')`)
      await w.q(`insert into platform.job_runs (job_key) values ('contract_reminder')`)
      const rows = await w.q(`select 1 from platform.job_runs`)
      expect(rows).toHaveLength(2)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B4-2 — Rechte', () => {
  it('die vier Versand-Wrapper sind service_role-only, die Admin-Funktion authenticated-only', async () => {
    // Katalog-Introspektion statt echtem Aufruf: das gepinnte Postgres-Image segfaultet bei einem
    // Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant (Begründung im B4-1-Gate).
    const rows = await pool.query<{
      fn: string
      anon: boolean
      authenticated: boolean
      service_role: boolean
    }>(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service_role
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('start_contract_reminder_run', 'claim_contract_reminder',
                            'record_contract_reminder_result', 'finish_contract_reminder_run',
                            'admin_contract_reminder_health')`,
    )

    expect(rows.rows).toHaveLength(5)
    for (const row of rows.rows) {
      // anon bekommt NIRGENDS etwas (Konvention seit T4-1).
      expect(row.anon, row.fn).toBe(false)
      if (row.fn.startsWith('admin_contract_reminder_health')) {
        expect(row.authenticated, row.fn).toBe(true)
        expect(row.service_role, row.fn).toBe(false)
      } else {
        // Der Auslöser ist ein Maschinenvorgang — daran hängt ab jetzt ein Versand an reale
        // Personen.
        expect(row.service_role, row.fn).toBe(true)
        expect(row.authenticated, row.fn).toBe(false)
      }
    }
  })

  it('platform.contract_reminders hat für KEINE Rolle ein Grant', async () => {
    const rows = await pool.query<{ role: string; can: boolean }>(
      `select r.role,
              has_table_privilege(r.role, 'platform.contract_reminders', 'select') as can
         from (values ('anon'), ('authenticated'), ('service_role')) as r(role)`,
    )
    for (const row of rows.rows) expect(row.can, row.role).toBe(false)

    const [rlsRow] = (
      await pool.query<{ rls: boolean }>(
        `select relrowsecurity as rls from pg_class
          where oid = 'platform.contract_reminders'::regclass`,
      )
    ).rows
    // Zwei unabhängige Schichten wie bei platform.job_runs (B4-1): ohne Policy sähe selbst eine
    // Rolle nichts, der jemand später versehentlich ein Tabellen-Grant gäbe.
    expect(rlsRow!.rls).toBe(true)
  })
})
