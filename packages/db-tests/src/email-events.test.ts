// DB-Gate für Rückläufer- und Beschwerdeverarbeitung (B2-2)
// (Migration 20260723120000_create_email_events_ledger.sql).
//
// Dieser Bauabschnitt trifft die erste Entscheidung, die eine reale Person DAUERHAFT von jeder
// künftigen Aussendung ausschliesst — und für die es über die Oberfläche bewusst keinen Rückweg
// gibt. Falsch ist sie in beide Richtungen still: eine zu Unrecht gesperrte Adresse fällt aus jedem
// Versand heraus, ohne dass irgendwo ein Fehler erscheint; ein nicht verarbeiteter Rückläufer lässt
// eine tote Adresse im Verteiler, bis die Absenderdomain darunter leidet. Das Gate beweist deshalb
// fünf Dinge:
//
//   (1) WIRKUNG JE ART — Beschwerde sperrt UND widerruft; dauerhafter Rückläufer sperrt und lässt
//       die Einwilligungen unberührt; vorübergehender Rückläufer und Zustellung sperren NICHT.
//   (2) IDEMPOTENZ — dieselbe Ereigniskennung zweimal wirkt genau einmal.
//   (3) GRENZEN — der Webhook legt niemals einen Lead an; ein bestehender Sperrgrund wird nicht
//       überschrieben; der Ledger ist gegen UPDATE und DELETE gesperrt.
//   (4) ZUGRIFF — beide Lese-Wrapper lehnen einen eingeloggten NICHT-Admin mit einem FEHLER ab
//       (nicht mit einer leeren Antwort), und die Grant-Fläche ist exakt service_role bzw.
//       authenticated.
//   (5) DURCHGRIFF — eine so entstandene Sperre wirkt nachweislich auf die BESTEHENDEN Pfade: der
//       Lead fällt aus `leads_due_for_contract_reminder` (B4-2) und aus `admin_export_leads`
//       (B2-1) heraus. Ohne diesen Nachweis wäre die Sperre eine Zeile in einer Tabelle, die
//       niemand liest.
//
// ── JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ──────────────────────────────────────────────
// Arbeitsregel seit B3-4: Introspektion beweist nur die Existenz einer Funktion, plpgsql prüft
// Funktionsrümpfe nicht beim Anlegen. `record_email_event`, `admin_list_email_events`,
// `admin_email_event_stats` und das ERSETZTE `admin_get_lead` werden hier echt ausgeführt.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ─────────────────────────────────────
// Wie in allen bisherigen Wrapper-Gates: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant. `has_function_privilege` ist dieselbe
// Wahrheit ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten
// NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und genau die
// Ablehnung IN der Funktion ist die zu beweisende Eigenschaft.
//
// ── WARUM DIE ZÄHL-TESTS IN DELTAS MESSEN ───────────────────────────────────────────────────────
// `platform.email_events` ist APPEND-ONLY: die Zeilen dieses Gates lassen sich hinterher nicht mehr
// entfernen — auch nicht von `postgres`. `admin_email_event_stats` zählt bestandsweit, also wird die
// Differenz vor/nach gemessen (Muster B3-4). Was aufgeräumt WIRD, sind Leads, Sperreinträge und
// Konten; die Ledger-Zeilen bleiben mit `lead_id = null` zurück, was der ON-DELETE-SET-NULL-Absicht
// entspricht und keinen anderen Test beeinflusst.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

/** Die drei Wrapper, die B2-2 neu anlegt. `admin_get_lead` wird ERSETZT und separat geprüft. */
const B2_2_WRAPPERS = [
  'record_email_event',
  'admin_list_email_events',
  'admin_email_event_stats',
] as const

const spawnedUsers: string[] = []
const spawnedLeads: string[] = []
const spawnedSuppressionHashes: string[] = []

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

interface TestLead {
  id: string
  email: string
}

/** Legt einen Lead auf dem REALEN Schreibpfad an (service_role, committed). */
async function newLead(
  opts: { company?: string; contractEndDate?: string } = {},
): Promise<TestLead> {
  const email = `b22-${randomUUID()}@test.local`
  const id = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.leads (email, first_source_key, company, supplier, contract_end_date)
       values ($1, 'kontaktformular', $2, $3, $4::date)
       returning id`,
      [
        email,
        opts.company ?? 'B2-2 GmbH',
        opts.contractEndDate ? 'Wien Energie' : null,
        opts.contractEndDate ?? null,
      ],
    )
    return rows[0]!.id
  })
  spawnedLeads.push(id)
  return { id, email }
}

async function consentTextId(purpose: string): Promise<string> {
  const rows = await sql<{ id: string }>(
    `select id from platform.consent_texts where purpose = $1 and version = 1 and locale = 'de'`,
    [purpose],
  )
  return rows[0]!.id
}

async function insertConsent(fields: {
  leadId: string
  purpose: string
  status: 'pending' | 'confirmed'
}): Promise<void> {
  const textId = await consentTextId(fields.purpose)
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `insert into platform.consents
         (lead_id, consent_text_id, source_key, status, confirmed_at, token_hash, token_expires_at)
       values ($1, $2, 'kontaktformular', $3,
               case when $3 = 'confirmed' then now() else null end,
               $4, now() + interval '7 days')`,
      [fields.leadId, textId, fields.status, randomUUID()],
    ),
  )
}

type RecordResult = {
  outcome: 'recorded' | 'duplicate'
  effect: 'none' | 'suppressed' | 'suppressed_and_withdrawn'
  lead_known?: boolean
  withdrawn_count?: number
}

/**
 * Ruft `record_email_event` so auf, wie es der Webhook tut: als service_role, mit BENANNTEN
 * Parametern (so ruft supabase-js sie auf).
 */
async function recordEvent(args: {
  eventId?: string
  eventType: string
  email: string
  bounceType?: string | null
  bounceSubtype?: string | null
  reason?: string | null
}): Promise<RecordResult> {
  const eventId = args.eventId ?? `msg_${randomUUID()}`
  const hash = await emailHash(args.email)
  if (!spawnedSuppressionHashes.includes(hash)) spawnedSuppressionHashes.push(hash)
  return runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: RecordResult }>(
      `select public.record_email_event(
         p_event_id => $1, p_event_type => $2, p_email => $3, p_occurred_at => now(),
         p_bounce_type => $4, p_bounce_subtype => $5, p_reason => $6
       ) as r`,
      [
        eventId,
        args.eventType,
        args.email,
        args.bounceType ?? null,
        args.bounceSubtype ?? null,
        args.reason ?? null,
      ],
    )
    return rows[0]!.r
  })
}

async function emailHash(email: string): Promise<string> {
  return (await sql<{ h: string }>(`select platform.email_hash($1) as h`, [email]))[0]!.h
}

/** Der Sperrgrund dieser Adresse — `null` heisst „steht nicht auf der Liste". */
async function suppressionReason(email: string): Promise<string | null> {
  const rows = await sql<{ reason: string }>(
    `select reason from platform.email_suppressions where email_hash = platform.email_hash($1)`,
    [email],
  )
  return rows[0]?.reason ?? null
}

async function consentStatuses(leadId: string): Promise<string[]> {
  const rows = await sql<{ status: string }>(
    `select status from platform.consents where lead_id = $1 order by status`,
    [leadId],
  )
  return rows.map((r) => r.status)
}

async function ledgerRows(email: string) {
  return sql<{
    id: string
    event_type: string
    lead_id: string | null
    bounce_type: string | null
    reason: string | null
  }>(
    `select id, event_type, lead_id, bounce_type, reason
       from platform.email_events
      where email_hash = platform.email_hash($1)
      order by received_at`,
    [email],
  )
}

/** Aufruf als eingeloggter Nutzer MIT JWT-Claims — so ruft es die Server Component. */
async function callAs<T = Record<string, unknown>>(
  user: TestUser,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(text, params)
    return rows[0]!.r
  })
}

/** Execute-Recht per Katalog (robust über die OID, keine fragile Signatur-Zeichenkette). */
async function canExecute(role: string, funcName: string, schema = 'public'): Promise<boolean> {
  const rows = await sql<{ can: boolean }>(
    `select has_function_privilege($1, p.oid, 'execute') as can
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $3 and p.proname = $2`,
    [role, funcName, schema],
  )
  return rows[0]?.can ?? false
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  for (const h of spawnedSuppressionHashes.splice(0)) {
    await sql('delete from platform.email_suppressions where email_hash = $1', [h])
  }
  for (const id of spawnedUsers.splice(0)) {
    await deleteUser(id)
  }
  // platform.email_events wird NICHT aufgeräumt — append-only, und zwar mit Absicht (s. Kopf).
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Wirkung je Ereignisart ───────────────────────────────────────────────────────────────────
describe('(1) Wirkung je Ereignisart', () => {
  it('Beschwerde sperrt die Adresse mit reason=complaint UND widerruft alle Einwilligungen', async () => {
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email', status: 'confirmed' })
    await insertConsent({ leadId: lead.id, purpose: 'contract_expiry_reminder', status: 'pending' })

    const res = await recordEvent({ eventType: 'email.complained', email: lead.email })

    expect(res.outcome).toBe('recorded')
    expect(res.effect).toBe('suppressed_and_withdrawn')
    expect(res.lead_known).toBe(true)
    // BEIDE Zwecke, nicht nur der bestätigte: eine übersehene offene Bestätigung würde sonst
    // weiterhin zum Versand berechtigen, sobald sie bestätigt wird.
    expect(res.withdrawn_count).toBe(2)
    expect(await suppressionReason(lead.email)).toBe('complaint')
    expect(await consentStatuses(lead.id)).toEqual(['withdrawn', 'withdrawn'])
  })

  it('dauerhafter Rückläufer sperrt mit reason=bounced und lässt die Einwilligungen UNBERÜHRT', async () => {
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email', status: 'confirmed' })

    const res = await recordEvent({
      eventType: 'email.bounced',
      email: lead.email,
      bounceType: 'Permanent',
      bounceSubtype: 'General',
    })

    expect(res.effect).toBe('suppressed')
    expect(await suppressionReason(lead.email)).toBe('bounced')
    // Der eigentliche Beweis: ein technisches Zustellversagen ist KEINE Willenserklärung. Die
    // Einwilligung bleibt bestehen (und bleibt wirkungslos, solange die Sperre gilt).
    expect(await consentStatuses(lead.id)).toEqual(['confirmed'])
  })

  it('dauerhafter Rückläufer ohne bounce.type gilt ebenfalls als dauerhaft', async () => {
    // Die Ereignisart selbst IST bei Resend bereits die Aussage „dauerhaft abgelehnt"; eine
    // fehlende Unterklassifikation widerspricht ihr nicht.
    const lead = await newLead()
    const res = await recordEvent({ eventType: 'email.bounced', email: lead.email })
    expect(res.effect).toBe('suppressed')
    expect(await suppressionReason(lead.email)).toBe('bounced')
  })

  it('vorübergehender Rückläufer sperrt NICHT — weder als Transient noch als delivery_delayed', async () => {
    const transient = await newLead()
    const delayed = await newLead()

    const a = await recordEvent({
      eventType: 'email.bounced',
      email: transient.email,
      bounceType: 'Transient',
      bounceSubtype: 'MailboxFull',
    })
    const b = await recordEvent({ eventType: 'email.delivery_delayed', email: delayed.email })

    expect(a.outcome).toBe('recorded')
    expect(a.effect).toBe('none')
    expect(await suppressionReason(transient.email)).toBeNull()
    expect(b.effect).toBe('none')
    expect(await suppressionReason(delayed.email)).toBeNull()

    // Trotzdem PROTOKOLLIERT: ein volles Postfach ist keine Sperre, aber ein Befund.
    expect((await ledgerRows(transient.email)).length).toBe(1)
    expect((await ledgerRows(delayed.email)).length).toBe(1)
  })

  it('Zustellung und Versand sperren nicht', async () => {
    const lead = await newLead()
    for (const type of ['email.sent', 'email.delivered']) {
      const res = await recordEvent({ eventType: type, email: lead.email })
      expect(res.effect).toBe('none')
    }
    expect(await suppressionReason(lead.email)).toBeNull()
    expect((await ledgerRows(lead.email)).length).toBe(2)
  })
})

// ── (2) Idempotenz ───────────────────────────────────────────────────────────────────────────────
describe('(2) Idempotenz', () => {
  it('dieselbe Ereigniskennung zweimal → beim zweiten Mal duplicate, keine zweite Wirkung', async () => {
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email', status: 'confirmed' })
    const eventId = `msg_${randomUUID()}`

    const first = await recordEvent({ eventId, eventType: 'email.complained', email: lead.email })
    expect(first.outcome).toBe('recorded')
    expect(first.withdrawn_count).toBe(1)

    // Zwischen den beiden Aufrufen wird die Einwilligung erneut erteilt: liefe die Wirkung ein
    // zweites Mal, würde sie erneut widerrufen — und genau das darf nicht passieren.
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email', status: 'confirmed' })

    const second = await recordEvent({ eventId, eventType: 'email.complained', email: lead.email })
    expect(second.outcome).toBe('duplicate')
    expect(second.effect).toBe('none')
    expect(await consentStatuses(lead.id)).toEqual(['confirmed', 'withdrawn'])
    // Und nur EINE Ledger-Zeile.
    expect((await ledgerRows(lead.email)).length).toBe(1)
  })
})

// ── (3) Grenzen ──────────────────────────────────────────────────────────────────────────────────
describe('(3) Grenzen', () => {
  it('Ereignis zu unbekannter Adresse legt KEINEN Lead an, erzeugt aber Ledger- und Sperreintrag', async () => {
    const unknown = `b22-unbekannt-${randomUUID()}@test.local`
    const before = (await sql<{ n: string }>(`select count(*) as n from platform.leads`))[0]!.n

    const res = await recordEvent({
      eventType: 'email.bounced',
      email: unknown,
      bounceType: 'Permanent',
    })

    expect(res.outcome).toBe('recorded')
    expect(res.effect).toBe('suppressed')
    expect(res.lead_known).toBe(false)
    expect((await sql<{ n: string }>(`select count(*) as n from platform.leads`))[0]!.n).toBe(
      before,
    )
    expect((await sql(`select 1 from platform.leads where email = $1`, [unknown])).length).toBe(0)
    // Die Sperre entsteht trotzdem — über den HASHWERT. Genau dafür ist email_suppressions seit
    // B1-1 ohne Fremdschlüssel auf leads gebaut.
    expect(await suppressionReason(unknown)).toBe('bounced')
    const rows = await ledgerRows(unknown)
    expect(rows.length).toBe(1)
    expect(rows[0]!.lead_id).toBeNull()
  })

  it('eine bestehende Sperre mit Grund unsubscribed wird von einem späteren Rückläufer NICHT überschrieben', async () => {
    const lead = await newLead()
    const hash = await emailHash(lead.email)
    spawnedSuppressionHashes.push(hash)
    await sql(
      `insert into platform.email_suppressions (email_hash, reason) values ($1, 'unsubscribed')`,
      [hash],
    )

    const res = await recordEvent({
      eventType: 'email.bounced',
      email: lead.email,
      bounceType: 'Permanent',
    })

    expect(res.effect).toBe('suppressed')
    // Der zuerst festgestellte Grund bleibt stehen: die Person hat sich SELBST abgemeldet, und das
    // ist die stärkere Aussage — ein späterer technischer Rückläufer darf sie nicht überschreiben.
    expect(await suppressionReason(lead.email)).toBe('unsubscribed')
  })

  it('der Ledger ist gegen UPDATE und DELETE gesperrt — zwei unabhängige Schichten', async () => {
    const lead = await newLead()
    await recordEvent({ eventType: 'email.delivered', email: lead.email })
    const eventId = (await ledgerRows(lead.email))[0]!.id

    // SCHICHT 1 — fehlendes Tabellenrecht: service_role kommt gar nicht bis zum Trigger. Das ist
    // die erwartete Meldung und zugleich der Beweis, dass die Tabelle für KEINE Rolle ein Grant hat.
    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query(`update platform.email_events set event_type = 'x' where id = $1`, [eventId]),
      ),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query(`delete from platform.email_events where id = $1`, [eventId]),
      ),
    ).rejects.toThrow(/permission denied/i)

    // SCHICHT 2 — der Trigger: `postgres` HAT jedes Recht und wird trotzdem abgewiesen. Genau
    // deshalb steht der Trigger da: ein Grant, das jemand später versehentlich vergibt, hebt die
    // Append-only-Eigenschaft nicht auf.
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.email_events set event_type = 'x' where id = $1`, [eventId]),
      ),
    ).rejects.toThrow(/append-only/i)
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`delete from platform.email_events where id = $1`, [eventId]),
      ),
    ).rejects.toThrow(/append-only/i)

    // Und die Zeile steht danach unverändert da.
    expect((await ledgerRows(lead.email))[0]!.event_type).toBe('email.delivered')
  })

  it('die EINE Ausnahme ist eng: lead_id nullen geht, setzen und umhängen nicht', async () => {
    const lead = await newLead()
    const other = await newLead()
    await recordEvent({ eventType: 'email.delivered', email: lead.email })
    const eventId = (await ledgerRows(lead.email))[0]!.id

    // UMHÄNGEN auf einen anderen Lead: abgewiesen. Sonst liesse sich ein Rückläufer nachträglich
    // einer fremden Person zuschreiben.
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.email_events set lead_id = $2 where id = $1`, [eventId, other.id]),
      ),
    ).rejects.toThrow(/append-only/i)

    // NULLEN UND GLEICHZEITIG etwas anderes ändern: ebenfalls abgewiesen.
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.email_events set lead_id = null, event_type = 'x' where id = $1`, [
          eventId,
        ]),
      ),
    ).rejects.toThrow(/append-only/i)

    // Der ECHTE Pfad: den Lead löschen. ON DELETE SET NULL ist selbst ein UPDATE — ohne die
    // Ausnahme wäre jeder Lead mit Zustellereignissen unlöschbar.
    await sql('delete from platform.leads where id = $1', [lead.id])
    spawnedLeads.splice(spawnedLeads.indexOf(lead.id), 1)

    const rows = await ledgerRows(lead.email)
    expect(rows.length).toBe(1)
    expect(rows[0]!.lead_id).toBeNull()
    // Der INHALT hat überlebt — das ist der Punkt: der Vorgang bleibt belegt, nur die Zuschreibung
    // entfällt.
    expect(rows[0]!.event_type).toBe('email.delivered')
  })

  it('eine Adresse im Anbieter-Freitext wird beim SCHREIBEN entfernt', async () => {
    const lead = await newLead()
    await recordEvent({
      eventType: 'email.bounced',
      email: lead.email,
      bounceType: 'Permanent',
      reason: `The recipient ${lead.email} does not exist; contact postmaster@fremd.test.`,
    })

    const stored = (await ledgerRows(lead.email))[0]!.reason!
    expect(stored).not.toContain(lead.email)
    expect(stored).not.toContain('@')
    // BEIDE Adressen sind weg, nicht nur die bekannte: eine Bounce-Meldung kann eine zweite
    // enthalten, und ein gezielter Abgleich liesse genau die stehen.
    expect(stored).toContain('[Adresse entfernt]')
    expect(stored).toContain('does not exist')
  })
})

// ── (4) Zugriffsgrenze ───────────────────────────────────────────────────────────────────────────
describe('(4) Zugriffsgrenze', () => {
  it('die Grant-Fläche ist exakt service_role bzw. authenticated — anon nirgends', async () => {
    expect(await canExecute('service_role', 'record_email_event')).toBe(true)
    expect(await canExecute('authenticated', 'record_email_event')).toBe(false)
    expect(await canExecute('anon', 'record_email_event')).toBe(false)

    for (const fn of ['admin_list_email_events', 'admin_email_event_stats']) {
      expect(await canExecute('authenticated', fn), `authenticated darf ${fn}`).toBe(true)
      expect(await canExecute('service_role', fn), `service_role darf ${fn} NICHT`).toBe(false)
      expect(await canExecute('anon', fn), `anon darf ${fn} NICHT`).toBe(false)
    }

    // Die platform-Helfer sind von aussen gar nicht aufrufbar.
    for (const fn of ['is_permanent_bounce', 'strip_emails']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        expect(await canExecute(role, fn, 'platform'), `${role} darf platform.${fn}`).toBe(false)
      }
    }
  })

  it('platform.email_events hat RLS und für KEINE Rolle ein Tabellenrecht', async () => {
    const [rls] = await sql<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'email_events'`,
    )
    expect(rls!.relrowsecurity).toBe(true)

    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        const [row] = await sql<{ can: boolean }>(
          `select has_table_privilege($1, 'platform.email_events', $2) as can`,
          [role, priv],
        )
        expect(row!.can, `${role} darf ${priv}`).toBe(false)
      }
    }
  })

  it('ein eingeloggter Nicht-Admin scheitert an BEIDEN Lese-Wrappern mit 42501, nicht mit leerer Antwort', async () => {
    const user = await newUser()

    await expect(
      callAs(user, `select public.admin_list_email_events(null, 10) as r`),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      callAs(user, `select public.admin_email_event_stats(30) as r`),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('als Admin liefern beide Lese-Wrapper echte Zahlen (Delta-Messung, der Ledger ist append-only)', async () => {
    const admin = await newAdmin()
    const lead = await newLead()

    type Stats = {
      status: string
      days: number
      permanent_bounces: number
      complaints: number
      counts: { event_type: string; event_count: number }[]
    }
    const before = await callAs<Stats>(admin, `select public.admin_email_event_stats(30) as r`)

    await recordEvent({ eventType: 'email.delivered', email: lead.email })
    await recordEvent({
      eventType: 'email.bounced',
      email: lead.email,
      bounceType: 'Transient',
      bounceSubtype: 'MailboxFull',
    })
    await recordEvent({
      eventType: 'email.bounced',
      email: lead.email,
      bounceType: 'Permanent',
    })

    const after = await callAs<Stats>(admin, `select public.admin_email_event_stats(30) as r`)
    expect(after.status).toBe('ok')
    // Der VERWENDETE Zeitraum fährt mit, damit die Oberfläche keinen anderen behaupten kann.
    expect(after.days).toBe(30)
    // Zwei email.bounced, aber nur EINER davon dauerhaft — die Trennung ist der Sinn der Zahl.
    expect(after.permanent_bounces - before.permanent_bounces).toBe(1)
    expect(after.complaints - before.complaints).toBe(0)
    const bouncedDelta =
      (after.counts.find((c) => c.event_type === 'email.bounced')?.event_count ?? 0) -
      (before.counts.find((c) => c.event_type === 'email.bounced')?.event_count ?? 0)
    expect(bouncedDelta).toBe(2)

    type Listing = {
      status: string
      events: { event_type: string; is_permanent_bounce: boolean }[]
    }
    const listing = await callAs<Listing>(
      admin,
      `select public.admin_list_email_events($1, 50) as r`,
      [lead.id],
    )
    expect(listing.status).toBe('ok')
    expect(listing.events.length).toBe(3)
    // Die Sperrwirkung kommt aus der DATENBANK mit — die Oberfläche legt „dauerhaft" nicht ein
    // zweites Mal aus.
    expect(listing.events.filter((e) => e.is_permanent_bounce).length).toBe(1)
  })

  it('admin_get_lead nennt seit B2-2 den GRUND der Sperre', async () => {
    const admin = await newAdmin()
    const lead = await newLead()

    type Detail = {
      status: string
      lead: { is_suppressed: boolean; suppression_reason: string | null }
    }
    const before = await callAs<Detail>(admin, `select public.admin_get_lead($1) as r`, [lead.id])
    expect(before.lead.is_suppressed).toBe(false)
    expect(before.lead.suppression_reason).toBeNull()

    await recordEvent({ eventType: 'email.complained', email: lead.email })

    const after = await callAs<Detail>(admin, `select public.admin_get_lead($1) as r`, [lead.id])
    expect(after.lead.is_suppressed).toBe(true)
    expect(after.lead.suppression_reason).toBe('complaint')
  })
})

// ── (5) Durchgriff auf die bestehenden Pfade ────────────────────────────────────────────────────
describe('(5) Die Sperre wirkt auf die bestehenden Pfade', () => {
  it('ein gesperrter Lead fällt aus leads_due_for_contract_reminder (B4-2) heraus', async () => {
    // Vertragsende innerhalb der Vorlaufzeit (56 Tage) + bestätigte Einwilligung = fällig.
    const dueDate = (
      await sql<{ d: string }>(`select (current_date + interval '30 days')::date::text as d`)
    )[0]!.d
    const lead = await newLead({ contractEndDate: dueDate })
    await insertConsent({
      leadId: lead.id,
      purpose: 'contract_expiry_reminder',
      status: 'confirmed',
    })

    const isDue = async () =>
      (
        await sql<{ n: string }>(
          `select count(*) as n from platform.leads_due_for_contract_reminder(null)
            where lead_id = $1`,
          [lead.id],
        )
      )[0]!.n === '1'

    expect(await isDue()).toBe(true)

    // Ein DAUERHAFTER RÜCKLÄUFER — er widerruft die Einwilligung ausdrücklich NICHT. Fiele der Lead
    // trotzdem heraus, kann das nur an der Sperre liegen; genau das ist die zu zeigende Wirkung.
    await recordEvent({ eventType: 'email.bounced', email: lead.email, bounceType: 'Permanent' })

    expect(await consentStatuses(lead.id)).toEqual(['confirmed'])
    expect(await isDue()).toBe(false)
  })

  it('ein gesperrter Lead fällt aus admin_export_leads (B2-1) heraus', async () => {
    const admin = await newAdmin()
    // Eindeutiger Firmenname als Filter-Marker — der Export zählt bestandsweit.
    const marker = `B22-EXPORT-${randomUUID().slice(0, 8)}`
    const keep = await newLead({ company: marker })
    const blocked = await newLead({ company: marker })

    type ExportResult = { status: string; row_count: number; rows: { id: string }[] }
    const exportRows = async () =>
      callAs<ExportResult>(admin, `select public.admin_export_leads(p_search => $1) as r`, [marker])

    const before = await exportRows()
    expect(before.row_count).toBe(2)

    await recordEvent({ eventType: 'email.complained', email: blocked.email })

    const after = await exportRows()
    expect(after.row_count).toBe(1)
    expect(after.rows.map((r) => r.id)).toEqual([keep.id])
  })
})

// ── (6) Grundlagen ───────────────────────────────────────────────────────────────────────────────
describe('(6) Grundlagen', () => {
  it('alle drei neuen Wrapper existieren', async () => {
    for (const fn of B2_2_WRAPPERS) {
      const rows = await sql(
        `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [fn],
      )
      expect(rows.length, `public.${fn} fehlt`).toBeGreaterThan(0)
    }
  })

  it('record_email_event weist eine fehlende Kennung oder Adresse mit 22023 ab', async () => {
    const lead = await newLead()
    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query(`select public.record_email_event(null, 'email.bounced', $1)`, [lead.email]),
      ),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query(`select public.record_email_event($1, 'email.bounced', '  ')`, [
          `msg_${randomUUID()}`,
        ]),
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
